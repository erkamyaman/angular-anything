import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

// A static page that misbehaves on purpose with ?bug=<name>, like the Angular fixture does.
// data-nonce is different on every load, so it is noise that the two recording runs have to mask.
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Tiny</title>
<style>
  body { margin: 16px; font: 16px/1.5 sans-serif; }
  .on { color: rgb(180, 0, 0); }
  .loud #state { text-transform: uppercase; }
</style>
</head>
<body>
<main>
  <h1>Tiny</h1>
  <label for="name">Name</label>
  <input id="name" type="text">
  <button type="button" id="save" aria-expanded="false">Save</button>
  <input id="loud" type="checkbox">
  <label for="loud">Loud</label>
  <p id="state" class="off">nothing saved</p>
  <canvas id="swatch" width="16" height="16"></canvas>
</main>
<script>
  const bug = new URLSearchParams(location.search).get('bug');
  const main = document.querySelector('main');
  const input = document.getElementById('name');
  const button = document.getElementById('save');
  const loud = document.getElementById('loud');
  const state = document.getElementById('state');

  main.dataset.nonce = String(Math.random());
  const swatch = document.getElementById('swatch').getContext('2d');
  swatch.fillStyle = bug === 'pixels' ? 'rgb(200, 0, 0)' : 'rgb(0, 0, 200)';
  swatch.fillRect(0, 0, 16, 16);
  if (localStorage.getItem('name')) state.textContent = 'saved ' + localStorage.getItem('name');
  if (bug === 'restless') setInterval(() => (state.textContent = String(performance.now())), 10);
  if (bug === 'style') {
    const style = document.createElement('style');
    style.textContent = '#state { margin-left: 3px; }';
    document.head.append(style);
  }

  function save() {
    const name = input.value;
    if (bug !== 'storage') localStorage.setItem('name', name);
    window.__aa?.emit('saved', { name });
    if (bug === 'events') window.__aa?.emit('saved', { name });
    if (bug !== 'focus') input.focus();
    fetch('/api/names', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bug === 'request' ? {} : { name }),
    }).then((response) => response.json()).then(() => {
      state.textContent = (bug === 'text' ? 'stored ' : 'saved ') + name;
      state.className = bug === 'dom' ? 'off' : 'on';
      button.setAttribute('aria-expanded', bug === 'aria' ? 'false' : 'true');
      setTimeout(() => {
        state.className = 'off';
      }, 5000);
    });
  }

  button.addEventListener('click', save);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') save();
  });
  const ticker = new Worker(URL.createObjectURL(new Blob([
    'onmessage = () => { let n = 0; const timer = setInterval(() => { postMessage(n); if (++n > 10) clearInterval(timer); }, 20); };',
  ])));
  ticker.onmessage = (event) => {
    swatch.fillStyle = 'rgb(0, ' + event.data * 20 + ', 0)';
    swatch.fillRect(8, 0, 8, 16);
  };
  loud.addEventListener('change', () => {
    window.__aa?.emit('loud', { on: loud.checked });
    main.classList.toggle('loud', loud.checked);
    ticker.postMessage(0);
  });
</script>
</body>
</html>
`;

const emptyPage = '<!doctype html><html lang="en"><head><title>Tiny</title></head><body><main></main></body></html>';

const steps = [
  { action: 'goto', path: '/' },
  { action: 'fill', target: { role: 'textbox', name: 'Name' }, value: 'Ada' },
  { action: 'press', target: { role: 'textbox', name: 'Name' }, key: 'Enter' },
  { action: 'advance', frames: 375 },
  { action: 'check', target: { role: 'checkbox', name: 'Loud' } },
  { action: 'uncheck', target: { role: 'checkbox', name: 'Loud' } },
  { action: 'click', target: { role: 'button', name: 'Save' } },
  { action: 'reload' },
];

// The layers the summary must name at the first differing step, and the path of a first difference.
const bugs: Record<string, { layers: string[]; path: string }> = {
  events: { layers: ['events'], path: '[1]' },
  dom: { layers: ['DOM', 'style and geometry'], path: 'html[1]/body[1]/main[1]/p[1].attrs.class' },
  aria: { layers: ['accessibility', 'DOM'], path: 'tree/main[1]/button[1].expanded' },
  text: { layers: ['accessibility', 'DOM'], path: 'html[1]/body[1]/main[1]/p[1]/text()[1]' },
  request: { layers: ['side effects'], path: 'requests[0].body.name' },
  storage: { layers: ['side effects'], path: 'storage.name' },
  focus: { layers: ['style and geometry', 'side effects'], path: 'the first at focus' },
  style: { layers: ['style and geometry'], path: 'html[1]/body[1]/main[1]/p[1].style.inline-size' },
};

let root: string;
let original: string;
let port: string;
let empty: string;
const closers: (() => void)[] = [];

async function serve(html: string): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    if (request.method === 'POST') {
      setTimeout(() => response.writeHead(201, { 'content-type': 'application/json' }).end('{}'), 150);
    } else if (new URL(request.url!, 'http://localhost').pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// Runs the CLI in the temporary project. The servers live in this process, so the call must not block it.
function run(...args: string[]): Promise<{ status: number | string; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ status: error ? (error.code ?? 'killed') : 0, output: stdout + stderr });
    });
  });
}

const gate = (url: string) => run('gate', 'tiny', '--source', 'original', '--url', url);
const recorded = (...path: string[]) => join(root, 'recordings', 'original', 'save', ...path);
const exists = (file: string) => access(file).then(
  () => true,
  () => false,
);

type Recorded = { style: Record<string, { style: Record<string, string> }> };

// The value of a longhand for an element: its own, or the one of the closest ancestor that lists it.
function longhand(observation: Recorded, path: string, property: string): string | undefined {
  for (;;) {
    const value = observation.style[path].style[property];
    if (value !== undefined || !path.includes('/')) return value;
    path = path.slice(0, path.lastIndexOf('/'));
  }
}
const failingLayers = (output: string) =>
  [...output.matchAll(/^ {8}(accessibility|DOM|style and geometry|events|side effects): /gm)].map((match) => match[1]);

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-e2e-'));
  await mkdir(join(root, 'cases', 'tiny', 'save'), { recursive: true });
  await mkdir(join(root, 'cases', 'none'), { recursive: true });
  const testCase = { format: 'angular-anything/case@1', id: 'save', viewport: { width: 800, height: 600 }, steps };
  await writeFile(join(root, 'cases', 'tiny', 'save', 'case.json'), JSON.stringify(testCase, null, 2));
  [original, port, empty] = await Promise.all([serve(page), serve(page), serve(emptyPage)]);
});

after(async () => {
  for (const close of closers) close();
  await rm(root, { recursive: true, force: true });
});

test('record launches Chromium, writes a locked recording and masks the noise of the original', async () => {
  const { status, output } = await run('record', 'tiny', '--source', 'original', '--url', original);
  assert.equal(status, 0, output);
  assert.match(output, /chromium \d+\./);
  assert.match(output, /Recorded 1 of 1 cases into recordings\/original\./);

  const lock = JSON.parse(await readFile(recorded('lock.json'), 'utf8'));
  const files = steps.flatMap((_, index) => [`0${index + 1}.json`, `0${index + 1}.png`]);
  assert.deepEqual(Object.keys(lock.files), [...files, 'recording.json'].sort());
  assert.match(lock.browser, /^chromium \d+\./);

  const recording = JSON.parse(await readFile(recorded('recording.json'), 'utf8'));
  assert.deepEqual(
    recording.masked,
    steps.map((_, index) => ({ step: index + 1, layer: 'dom', path: 'html[1]/body[1]/main[1].attrs.data-nonce' })),
  );

  const afterEnter = JSON.parse(await readFile(recorded('03.json'), 'utf8'));
  assert.deepEqual(afterEnter.events, [{ name: 'saved', payload: { name: 'Ada' } }]);
  assert.deepEqual(afterEnter.effects, {
    requests: [{ method: 'POST', url: '/api/names', body: { name: 'Ada' } }],
    gets: [],
    storage: { name: 'Ada' },
    url: '/',
    title: 'Tiny',
    focus: 'html[1]/body[1]/main[1]/input[1]',
  });
  assert.deepEqual(afterEnter.accessibility.tree[0].children[3], { role: 'button', name: 'Save', expanded: true });
  const state = async (step: string, property: string) =>
    longhand(JSON.parse(await readFile(recorded(step), 'utf8')), 'html[1]/body[1]/main[1]/p[1]', property);
  assert.equal(await state('03.json', 'color'), 'rgb(180, 0, 0)');
  assert.equal(await state('04.json', 'color'), 'rgb(0, 0, 0)', 'advance fires the 5000 ms timer');
  assert.equal(await state('05.json', 'text-transform'), 'uppercase');
  assert.equal(await state('06.json', 'text-transform'), 'none');
  const afterReload = JSON.parse(await readFile(recorded('08.json'), 'utf8'));
  assert.deepEqual(afterReload.dom.children[0].children[0].children.at(-2), {
    tag: 'p',
    attrs: { class: 'off', id: 'state' },
    children: ['saved Ada'],
  });
});

test('gate passes for the same page on another origin', async () => {
  const { status, output } = await gate(port);
  assert.equal(status, 0, output);
  assert.match(output, /^angular-anything gate: PASS$/m);
  assert.match(output, /^PASS {2}save {2}8 steps$/m);
  assert.match(output, /its two recording runs: 8\.$/m);
  assert.match(output, /8 identical, 0 different, 0 masked\.$/m);
  assert.equal(JSON.parse(await readFile(join(root, 'reports', 'original', 'report.json'), 'utf8')).result, 'pass');
});

for (const [bug, expected] of Object.entries(bugs)) {
  test(`gate fails for ?bug=${bug} and names ${expected.layers.join(' and ')}`, async () => {
    const { status, output } = await gate(`${port}/?bug=${bug}`);
    assert.equal(status, 1, output);
    assert.match(output, /^angular-anything gate: FAIL$/m);
    assert.deepEqual(failingLayers(output), expected.layers, output);
    assert.ok(output.includes(expected.path), output);
  });
}

test('gate passes when only pixels differ, and reports the screenshots as different', async () => {
  const { status, output } = await gate(`${port}/?bug=pixels`);
  assert.equal(status, 0, output);
  assert.match(output, /^angular-anything gate: PASS$/m);
  assert.match(output, /0 identical, 8 different, 0 masked\.$/m);
});

test('replay writes the report, the summary and the screenshots that differ, and exits 1 on a mismatch', async () => {
  const { status, output } = await run('replay', 'tiny', '--source', 'original', '--url', `${port}/?bug=text`);
  assert.equal(status, 1, output);
  const reports = join(root, 'reports', 'original');
  const report = JSON.parse(await readFile(join(reports, 'report.json'), 'utf8'));
  assert.equal(report.command, 'replay');
  assert.equal(report.result, 'fail');
  assert.deepEqual(report.cases[0].steps[2].layers.dom.first, [
    { path: 'html[1]/body[1]/main[1]/p[1]/text()[1]', expected: 'saved Ada', actual: 'stored Ada' },
  ]);
  assert.equal(report.cases[0].steps[2].screenshot, 'different');
  assert.equal(report.cases[0].steps[1].screenshot, 'identical');
  await access(join(reports, 'save', '03.png'));
  assert.ok(output.includes(await readFile(join(reports, 'summary.txt'), 'utf8')));
});

test('gate refuses a recording with one changed byte, replay does not check the lock', async () => {
  const observation = await readFile(recorded('02.json'));
  const changed = Buffer.from(observation);
  changed[changed.indexOf('"value": "Ada"') + '"value": "Ad'.length] = 'b'.charCodeAt(0);
  await writeFile(recorded('02.json'), changed);
  try {
    const gated = await gate(port);
    assert.equal(gated.status, 1, gated.output);
    assert.match(gated.output, /^FAIL {2}save\n {6}lock: 02\.json does not match its SHA-256 in lock\.json$/m);
    assert.match(gated.output, /0 of 0 compared steps differ/);

    const replayed = await run('replay', 'tiny', '--source', 'original', '--url', port);
    assert.equal(replayed.status, 1, replayed.output);
    assert.ok(replayed.output.includes('the first at html[1]/body[1]/main[1]/input[1].props.value'), replayed.output);
  } finally {
    await writeFile(recorded('02.json'), observation);
  }
});

test('gate refuses a recording whose case changed afterwards', async () => {
  const file = join(root, 'cases', 'tiny', 'save', 'case.json');
  const unchanged = await readFile(file);
  await writeFile(file, unchanged.toString().replace('"Ada"', '"Bob"'));
  try {
    const { status, output } = await gate(port);
    assert.equal(status, 1, output);
    assert.match(output, /lock: stale: case\.json changed after the recording/);
  } finally {
    await writeFile(file, unchanged);
  }
});

test('a case that cannot be read fails the run and leaves no report of an earlier run', async () => {
  const file = join(root, 'cases', 'tiny', 'save', 'case.json');
  const unchanged = await readFile(file);
  const report = join(root, 'reports', 'original', 'report.json');
  assert.equal((await gate(port)).status, 0);
  assert.equal(await exists(report), true);
  await writeFile(file, unchanged.toString().replace('{', '{,'));
  try {
    const { status, output } = await gate(port);
    assert.equal(status, 1, output);
    assert.match(output, /^gate failed: .*case\.json: /);
    assert.equal(await exists(report), false);
  } finally {
    await writeFile(file, unchanged);
  }
});

test('a recording is replayed only for the suite, source and case it was made for', async () => {
  await cp(join(root, 'recordings', 'original'), join(root, 'recordings', 'copy'), { recursive: true });
  const copied = await run('gate', 'tiny', '--source', 'copy', '--url', port);
  assert.equal(copied.status, 1, copied.output);
  assert.match(copied.output, /error: cannot replay against the recording: it was made for suite tiny, source original, case save/);
  assert.match(copied.output, /0 of 0 compared steps differ/);

  const recording = await readFile(recorded('recording.json'), 'utf8');
  await writeFile(recorded('recording.json'), recording.replace('"steps": 8', '"steps": 7'));
  try {
    const replayed = await run('replay', 'tiny', '--source', 'original', '--url', port);
    assert.equal(replayed.status, 1, replayed.output);
    assert.match(replayed.output, /error: cannot replay against the recording: the recording has 7 steps, the case has 8/);
  } finally {
    await writeFile(recorded('recording.json'), recording);
  }
});

test('gate fails when a recording of the suite has no case any more', async () => {
  const orphan = join(root, 'recordings', 'original', 'removed');
  await cp(recorded(), orphan, { recursive: true });
  try {
    const { status, output } = await gate(port);
    assert.equal(status, 1, output);
    assert.match(output, /^PASS {2}save {5}8 steps$/m);
    assert.match(output, /^FAIL {2}removed\n {6}lock: the suite tiny has no case for this recording$/m);
    assert.match(output, /1 of 2 cases failed/);

    const other = JSON.parse(await readFile(join(orphan, 'recording.json'), 'utf8'));
    await writeFile(join(orphan, 'recording.json'), JSON.stringify({ ...other, suite: 'another' }));
    assert.equal((await gate(port)).status, 0, 'a recording of another suite is not this suite\'s business');
  } finally {
    await rm(orphan, { recursive: true });
  }
});

test('record fails a case whose page never settles or whose target is missing, and writes nothing', async () => {
  const restless = await run('record', 'tiny', '--source', 'restless', '--url', `${original}/?bug=restless`);
  assert.equal(restless.status, 1, restless.output);
  assert.match(
    restless.output,
    /^FAIL {2}save\n {6}step 1 \(goto \/\): never settled in 300 frames: 0 requests in flight, layers still changing: accessibility, dom/m,
  );
  assert.match(restless.output, /Recorded 0 of 1 cases into recordings\/restless\./);

  const missing = await run('record', 'tiny', '--source', 'missing', '--url', empty);
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.output, /^FAIL {2}save\n {6}step 2 \(fill textbox "Name" with "Ada"\): the target matches 0 elements$/m);
  assert.equal(await exists(join(root, 'recordings', 'restless')), false);
  assert.equal(await exists(join(root, 'recordings', 'missing')), false);
});

test('a page with an empty main passes no case', async () => {
  const { status, output } = await gate(empty);
  assert.equal(status, 1, output);
  assert.match(output, /^FAIL {2}save$/m);
  assert.deepEqual(failingLayers(output), ['accessibility', 'DOM', 'style and geometry']);
  assert.match(output, /error: step 2 \(fill textbox "Name" with "Ada"\): the target matches 0 elements/);
  assert.match(output, /1 of 1 cases failed/);
});

test('a suite without cases fails, a wrong command line exits 2', async () => {
  const none = await run('gate', 'none', '--source', 'original', '--url', port);
  assert.equal(none.status, 1, none.output);
  assert.match(none.output, /FAIL {2}the suite none has no cases/);
  assert.equal((await run('record', 'none', '--source', 'original', '--url', port)).status, 1);

  for (const args of [
    ['gate', 'tiny', '--source', 'original'],
    ['gate', 'tiny', '--url', port],
    ['gate', '--source', 'original', '--url', port],
    ['gate', 'missing', '--source', 'original', '--url', port],
    ['gate', 'tiny', '--source', '../original', '--url', port],
    ['gate', 'tiny', '--source', 'original', '--url', `${port}/app/`],
    ['gate', 'tiny', '--source', 'original', '--url', 'localhost'],
    ['record', 'tiny', '--source', 'original', '--url', port, '--force'],
  ]) {
    const { status, output } = await run(...args);
    assert.equal(status, 2, `${args.join(' ')}\n${output}`);
    assert.match(output, /\n\nUsage: angular-anything <command>/);
  }
});
