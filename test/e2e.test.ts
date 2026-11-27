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
    localStorage.setItem('prefs', JSON.stringify({ name, order: [1, 2] }));
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

const nonce = { layer: 'dom', path: 'html[1]/body[1]/main[1].attrs.data-nonce' };

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

const bugs: Record<string, { layers: string[]; path: string }> = {
  events: { layers: ['events'], path: '[1]' },
  dom: { layers: ['DOM', 'style and geometry'], path: 'html[1]/body[1]/main[1]/p[1].attrs.class' },
  aria: { layers: ['accessibility', 'DOM'], path: 'tree/main[1]/button[1].expanded' },
  text: { layers: ['accessibility', 'DOM'], path: 'html[1]/body[1]/main[1]/p[1]/text()[1]' },
  request: { layers: ['side effects'], path: 'requests[0].body.name' },
  storage: { layers: ['side effects'], path: 'storage.name' },
  focus: { layers: ['style and geometry', 'side effects'], path: 'the first at focus' },
  style: { layers: ['style and geometry'], path: 'html[1]/body[1]/main[1]/p[1].style.margin-' },
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

function run(...args: string[]): Promise<{ status: number | string; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ status: error ? (error.code ?? 'killed') : 0, output: stdout + stderr });
    });
  });
}

const gate = (url: string) => run('gate', 'tiny', '--source', 'original', '--url', url);
const gateSame = (url: string) => run('gate', 'tiny', '--source', 'original', '--url', url, '--original-url', original);
const recorded = (...path: string[]) => join(root, 'recordings', 'original', 'save', ...path);
const exists = (file: string) => access(file).then(
  () => true,
  () => false,
);

type Recorded = { style: Record<string, { style: Record<string, string> }> };

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
  const testCase = { format: 'angular-anything/case@1', id: 'save', viewport: { width: 800, height: 600 }, steps, noise: [nonce] };
  await writeFile(join(root, 'cases', 'tiny', 'save', 'case.json'), JSON.stringify(testCase, null, 2));
  await mkdir(join(root, 'cases', 'bare', 'save'), { recursive: true });
  await writeFile(
    join(root, 'cases', 'bare', 'save', 'case.json'),
    JSON.stringify({ ...testCase, noise: undefined, steps: steps.slice(0, 1) }, null, 2),
  );
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
  const files = steps.map((_, index) => `0${index + 1}.json`);
  assert.deepEqual(Object.keys(lock.files), [...files, 'recording.json', 'tape.json'].sort());
  assert.match(lock.browser, /^chromium \d+\./);

  const recording = JSON.parse(await readFile(recorded('recording.json'), 'utf8'));
  assert.equal(recording.format, 'angular-anything/recording@4');
  assert.deepEqual(recording.screenshotNoise, []);
  assert.match(output, /noise dom html\[1\]\/body\[1\]\/main\[1\]\.attrs\.data-nonce: 8 values masked/);
  for (let step = 1; step <= steps.length; step++) {
    const stored = JSON.parse(await readFile(recorded(`0${step}.json`), 'utf8'));
    assert.deepEqual(Object.values(stored.style).filter((entry: any) => entry.box || entry.layout), [], `step ${step}: no box and no laid-out value is stored`);
    const mask: Record<string, unknown> = { $aa: 'noise', kind: 'string' };
    if (step < steps.length) mask.group = 1;
    assert.deepEqual(stored.dom.children[0].children[0].attrs['data-nonce'], mask, `step ${step}: one value is tied across the steps of one load, the reload has its own`);
  }

  const afterEnter = JSON.parse(await readFile(recorded('03.json'), 'utf8'));
  assert.deepEqual(afterEnter.events, [{ name: 'saved', payload: { name: 'Ada' } }]);
  assert.deepEqual(afterEnter.effects, {
    requests: [{ method: 'POST', url: { path: ['api', 'names'], query: {} }, body: { name: 'Ada' } }],
    storage: { name: 'Ada', prefs: { name: 'Ada', order: [1, 2], $order: ['name', 'order'] } },
    url: { path: [''], query: {}, fragment: '' },
    title: 'Tiny',
    focus: 'html[1]/body[1]/main[1]/input[1]',
    popups: [],
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

test('record exits 1 for a mask the case does not name, prints it in the form the case needs, and leaves no recording', async () => {
  const folder = join(root, 'recordings', 'bare', 'save');
  const bare = (command: string) => run(command, 'bare', '--source', 'bare', '--url', original);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'old.json'), '{}');
  const { status, output } = await bare('record');
  assert.equal(status, 1, output);
  assert.match(output, /^FAIL {2}save$/m);
  assert.ok(output.includes(JSON.stringify(nonce)), output);
  assert.equal(await exists(join(folder, 'old.json')), false, 'no recording is left, also not the one from before');
  assert.equal(await exists(join(folder, 'lock.json')), false);
  const afterwards = await bare('gate');
  assert.equal(afterwards.status, 1, afterwards.output);
  assert.match(afterwards.output, /lock: no readable lock\.json/);
  assert.equal(JSON.parse(await readFile(join(root, 'reports', 'bare', 'report.json'), 'utf8')).result, 'fail');

  const printed = JSON.parse(output.split('\n').find((line) => line.trim().startsWith('{"layer"'))!);
  const file = join(root, 'cases', 'bare', 'save', 'case.json');
  const testCase = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...testCase, noise: [printed] }));
  const again = await bare('record');
  assert.equal(again.status, 0, again.output);
  assert.equal((await bare('gate')).status, 0);

  await writeFile(file, JSON.stringify({ ...testCase, noise: [printed, { layer: 'dom', path: 'html[1]/body[1]/main[1].attrs.nothing' }] }));
  const stale = await bare('record');
  assert.equal(stale.status, 1, stale.output);
  assert.match(stale.output, /matches nothing in any step/);
  assert.equal(await exists(join(folder, 'lock.json')), false, 'no recording is left, also not the one from before');
  await rm(join(root, 'cases', 'bare'), { recursive: true });
});

test('replay refuses a recording in another format and one that masks what the case does not name', async () => {
  const file = recorded('recording.json');
  const caseFile = join(root, 'cases', 'tiny', 'save', 'case.json');
  const recording = await readFile(file, 'utf8');
  const testCase = await readFile(caseFile, 'utf8');
  try {
    await writeFile(file, recording.replace('recording@4', 'recording@3'));
    const old = await run('replay', 'tiny', '--source', 'original', '--url', port);
    assert.equal(old.status, 1, old.output);
    assert.match(old.output, /it is in the format angular-anything\/recording@3, not angular-anything\/recording@4, so it has to be recorded again/);
    await writeFile(file, recording);
    await writeFile(caseFile, JSON.stringify({ ...JSON.parse(testCase), noise: undefined }));
    const masked = await run('replay', 'tiny', '--source', 'original', '--url', port);
    assert.equal(masked.status, 1, masked.output);
    assert.match(masked.output, /it masks values that the case does not name as noise \(step 1, DOM: html\[1\]\/body\[1\]\/main\[1\]\.attrs\.data-nonce\)/);
  } finally {
    await writeFile(file, recording);
    await writeFile(caseFile, testCase);
  }
});

test('gate passes for the same page on another origin', async () => {
  const alone = await gate(port);
  assert.equal(alone.status, 0, alone.output);
  assert.match(alone.output, /0 identical, 0 different, 0 masked, 8 not compared\.$/m);
  assert.match(alone.output, /^Sizes, positions and screenshots were not compared: no --original-url was given\.$/m);
  assert.equal(JSON.parse(await readFile(join(root, 'reports', 'original', 'report.json'), 'utf8')).original, null);
  const { status, output } = await gateSame(port);
  assert.equal(status, 0, output);
  assert.match(output, /^angular-anything gate: PASS$/m);
  assert.match(output, /^PASS {2}save {2}8 steps, frames: 4 4 4 379 4 4 4 4$/m);
  assert.match(output, /^Values not compared because the case names them as noise: 8\.$/m);
  assert.match(output, /8 identical, 0 different, 0 masked, 0 not compared\.$/m);
  assert.doesNotMatch(output, /were not compared/);
  assert.equal(JSON.parse(await readFile(join(root, 'reports', 'original', 'report.json'), 'utf8')).result, 'pass');
});

for (const [bug, expected] of Object.entries(bugs)) {
  test(`gate fails for ?bug=${bug} and names ${expected.layers.join(' and ')}`, async () => {
    const { status, output } = await gateSame(`${port}/?bug=${bug}`);
    assert.equal(status, 1, output);
    assert.match(output, /^angular-anything gate: FAIL$/m);
    assert.deepEqual(failingLayers(output), expected.layers, output);
    const report = await readFile(join(root, 'reports', 'original', 'report.json'), 'utf8');
    if (bug === 'request') {
      assert.match(output, /the first at tape POST \/api\/names \(changed mutation\)$/m);
      assert.ok(JSON.parse(report).cases[0].steps[2].layers.effects.first.some((difference: { path: string }) => difference.path === expected.path), report);
    } else assert.ok(output.includes(expected.path), output);
  });
}

test('without the original the style bug fails at its declared value only, with it also at the sizes it changes', async () => {
  const alone = await gate(`${port}/?bug=style`);
  assert.equal(alone.status, 1, alone.output);
  const paths = async () =>
    JSON.parse(await readFile(join(root, 'reports', 'original', 'report.json'), 'utf8')).cases[0].steps[0].layers.style.first.map(
      (difference: { path: string }) => difference.path.replace('html[1]/body[1]/main[1]/p[1]', 'p'),
    );
  assert.deepEqual(await paths(), ['p.style.margin-inline-start', 'p.style.margin-left']);
  const same = await gateSame(`${port}/?bug=style`);
  assert.equal(same.status, 1, same.output);
  assert.deepEqual((await paths()).sort(), [
    'p.box.width',
    'p.box.x',
    'p.layout.inline-size',
    'p.layout.perspective-origin',
    'p.layout.transform-origin',
    'p.layout.width',
    'p.style.margin-inline-start',
    'p.style.margin-left',
  ]);
});

test('an original that does not match its recording fails the gate by name, and no size is compared', async () => {
  const { status, output } = await run('gate', 'tiny', '--source', 'original', '--url', port, '--original-url', `${original}/?bug=text`);
  assert.equal(status, 1, output);
  assert.match(output, /^ {6}error: the original at http:\/\/127\.0\.0\.1:\d+\/ does not match its recording: step 3, accessibility at tree\/main\[1\]\/paragraph\[1\]\.text: expected "saved \[typed\]", actual "stored \[typed\]"; sizes, positions and screenshots were not compared$/m);
  assert.match(output, /0 identical, 0 different, 0 masked, 8 not compared\.$/m);
});

test('gate passes when only pixels differ, and reports the screenshots as different', async () => {
  const { status, output } = await gateSame(`${port}/?bug=pixels`);
  assert.equal(status, 0, output);
  assert.match(output, /^angular-anything gate: PASS$/m);
  assert.match(output, /0 identical, 8 different, 0 masked, 0 not compared\.$/m);
});

test('replay writes the report, the summary and the screenshots that differ, and exits 1 on a mismatch', async () => {
  const { status, output } = await run('replay', 'tiny', '--source', 'original', '--url', `${port}/?bug=text`, '--original-url', original);
  assert.equal(status, 1, output);
  const reports = join(root, 'reports', 'original');
  const report = JSON.parse(await readFile(join(reports, 'report.json'), 'utf8'));
  assert.equal(report.command, 'replay');
  assert.equal(report.result, 'fail');
  assert.deepEqual(report.cases[0].steps[2].layers.dom.first, [
    {
      layer: 'dom',
      path: 'html[1]/body[1]/main[1]/p[1]/text()[1]',
      kind: 'text',
      expected: 'saved [typed]',
      actual: 'stored [typed]',
      at: { offset: 1 },
    },
  ]);
  assert.equal(report.cases[0].steps[2].screenshot, 'different');
  assert.equal(report.cases[0].steps[1].screenshot, 'identical');
  await access(join(reports, 'save', '03.png'));
  await access(join(reports, 'save', '03.original.png'));
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
    for (const [edit, message] of [
      ['"suite": "tiny"', /it was made for suite other, source original, case save/],
      ['"case": "save"', /it was made for suite tiny, source original, case other/],
    ] as const) {
      await writeFile(recorded('recording.json'), recording.replace(edit, edit.replace(/"[a-z]+"$/, '"other"')));
      const other = await run('replay', 'tiny', '--source', 'original', '--url', port);
      assert.equal(other.status, 1, other.output);
      assert.match(other.output, new RegExp(`error: cannot replay against the recording: ${message.source}`));
    }
    await writeFile(recorded('recording.json'), 'null');
    const nothing = await run('replay', 'tiny', '--source', 'original', '--url', port);
    assert.equal(nothing.status, 1, nothing.output);
    assert.match(nothing.output, /error: cannot replay against the recording: it is not a recording object, so it has to be recorded again/);
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
    assert.match(output, /^PASS {2}save {5}8 steps, frames: 4 4 4 379 4 4 4 4$/m);
    assert.match(output, /^FAIL {2}removed\n {6}lock: the suite tiny has no case for this recording$/m);
    assert.match(output, /1 of 2 cases failed/);

    assert.equal((await run('replay', 'tiny', '--source', 'original', '--url', port)).status, 0, 'replay does not look for recordings without a case');

    const other = JSON.parse(await readFile(join(orphan, 'recording.json'), 'utf8'));
    await writeFile(join(orphan, 'recording.json'), JSON.stringify({ ...other, suite: 'another' }));
    assert.equal((await gate(port)).status, 0, 'a recording of another suite is not this suite\'s business');
  } finally {
    await rm(orphan, { recursive: true });
  }
  const unreadable = join(root, 'recordings', 'original', 'notes');
  await mkdir(unreadable);
  try {
    const { status, output } = await gate(port);
    assert.equal(status, 1, output);
    assert.match(output, /^FAIL {2}notes\n {6}lock: the suite tiny has no case for this recording$/m);
  } finally {
    await rm(unreadable, { recursive: true });
  }
});

test('record removes the recording of a case that the suite no longer has and keeps those of other suites', async () => {
  await mkdir(join(root, 'cases', 'orphan', 'save'), { recursive: true });
  const lone = { format: 'angular-anything/case@1', id: 'save', viewport: { width: 800, height: 600 }, steps: steps.slice(0, 1) };
  await writeFile(join(root, 'cases', 'orphan', 'save', 'case.json'), JSON.stringify(lone));
  const first = await run('record', 'orphan', '--source', 'orphans', '--url', empty);
  assert.equal(first.status, 0, first.output);
  const directory = join(root, 'recordings', 'orphans');
  await cp(join(directory, 'save'), join(directory, 'gone'), { recursive: true });
  await cp(join(directory, 'save'), join(directory, 'foreign'), { recursive: true });
  const foreign = JSON.parse(await readFile(join(directory, 'foreign', 'recording.json'), 'utf8'));
  await writeFile(join(directory, 'foreign', 'recording.json'), JSON.stringify({ ...foreign, suite: 'another' }));
  const second = await run('record', 'orphan', '--source', 'orphans', '--url', empty);
  assert.equal(second.status, 0, second.output);
  assert.match(second.output, /^removed the recording of "gone", the suite orphan has no such case$/m);
  assert.equal(await exists(join(directory, 'gone')), false);
  assert.equal(await exists(join(directory, 'foreign')), true);
  assert.equal(await exists(join(directory, 'save', 'lock.json')), true);
  assert.equal((await run('gate', 'orphan', '--source', 'orphans', '--url', empty)).status, 0);

  await cp(join(directory, 'save'), join(directory, 'ghost'), { recursive: true });
  const ghost = JSON.parse(await readFile(join(directory, 'ghost', 'recording.json'), 'utf8'));
  await writeFile(join(directory, 'ghost', 'recording.json'), JSON.stringify({ ...ghost, suite: 'none' }));
  const none = await run('record', 'none', '--source', 'orphans', '--url', empty);
  assert.equal(none.status, 1, none.output);
  assert.equal(await exists(join(directory, 'ghost')), true, 'a suite without cases removes nothing');
});

test('record fails a case whose page never settles or whose target is missing, and writes nothing', async () => {
  const restless = await run('record', 'tiny', '--source', 'restless', '--url', `${original}/?bug=restless`);
  assert.equal(restless.status, 1, restless.output);
  assert.match(
    restless.output,
    /^FAIL {2}save\n {6}step 1 \(goto \/\): never settled in 300 frames: 0 requests in flight, the last frame was not quiet: the page changed \(accessibility, DOM\)/m,
  );
  assert.match(restless.output, /Recorded 0 of 1 cases into recordings\/restless\./);

  const missing = await run('record', 'tiny', '--source', 'missing', '--url', empty);
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.output, /^FAIL {2}save\n {6}step 2 \(fill textbox "Name"\): the target matches 0 elements, there is no textbox here$/m);
  assert.equal(await exists(join(root, 'recordings', 'restless')), false);
  assert.equal(await exists(join(root, 'recordings', 'missing')), false);
});

test('a screenshot that differs between the two runs of the original is noted, never compared and never fails the gate', async () => {
  const pixel = await serve(
    `<!doctype html><html lang="en"><head><title>Pixel</title></head><body><main><canvas id="c" width="16" height="16"></canvas></main><script>
const c = document.getElementById('c').getContext('2d');
c.fillStyle = 'rgb(' + Math.floor(Math.random() * 256) + ', ' + Math.floor(Math.random() * 256) + ', 0)';
c.fillRect(0, 0, 16, 16);
</script></body></html>`,
  );
  await mkdir(join(root, 'cases', 'pixel', 'save'), { recursive: true });
  const lone = { format: 'angular-anything/case@1', id: 'save', viewport: { width: 800, height: 600 }, steps: steps.slice(0, 1) };
  await writeFile(join(root, 'cases', 'pixel', 'save', 'case.json'), JSON.stringify(lone));
  const recorded = await run('record', 'pixel', '--source', 'pixel', '--url', pixel);
  assert.equal(recorded.status, 0, recorded.output);
  assert.match(recorded.output, /^ {6}screenshots that differed between the two runs, at step 1$/m);
  const recording = JSON.parse(await readFile(join(root, 'recordings', 'pixel', 'save', 'recording.json'), 'utf8'));
  assert.deepEqual(recording.screenshotNoise, [1]);
  const gated = await run('gate', 'pixel', '--source', 'pixel', '--url', pixel, '--original-url', pixel);
  assert.equal(gated.status, 0, gated.output);
  assert.match(gated.output, /Screenshots \(soft, they never fail the gate\): 0 identical, 0 different, 1 masked, 0 not compared\./);
});

test('record exits 1 when one case of the suite fails, and records the others', async () => {
  await mkdir(join(root, 'cases', 'mixed', 'fine'), { recursive: true });
  await mkdir(join(root, 'cases', 'mixed', 'broken'), { recursive: true });
  const fine = { format: 'angular-anything/case@1', id: 'fine', viewport: { width: 800, height: 600 }, steps: steps.slice(0, 1) };
  await writeFile(join(root, 'cases', 'mixed', 'fine', 'case.json'), JSON.stringify(fine));
  await writeFile(join(root, 'cases', 'mixed', 'broken', 'case.json'), JSON.stringify({ ...fine, id: 'broken', steps: steps.slice(0, 2) }));
  const result = await run('record', 'mixed', '--source', 'mixed', '--url', empty);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /^ok {4}fine /m);
  assert.match(result.output, /^FAIL {2}broken\n {6}step 2 \(fill textbox "Name"\): the target matches 0 elements, there is no textbox here$/m);
  assert.match(result.output, /Recorded 1 of 2 cases into recordings\/mixed\./);
  assert.equal(await exists(join(root, 'recordings', 'mixed', 'fine', 'lock.json')), true);
  assert.equal(await exists(join(root, 'recordings', 'mixed', 'broken')), false);
  assert.equal((await run('gate', 'mixed', '--source', 'mixed', '--url', empty)).status, 1, 'the case that was not recorded fails the gate');
});

test('a page with an empty main passes no case', async () => {
  const { status, output } = await gate(empty);
  assert.equal(status, 1, output);
  assert.match(output, /^FAIL {2}save$/m);
  assert.deepEqual(failingLayers(output), ['accessibility', 'DOM', 'style and geometry']);
  assert.match(output, /error: step 2 \(fill textbox "Name"\): the target matches 0 elements/);
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

test('record leaves the recording of another suite with the same case id alone and fails that case by name', async () => {
  const other = join(root, 'cases', 'other');
  await cp(join(root, 'cases', 'tiny'), other, { recursive: true });
  const lock = await readFile(recorded('lock.json'));
  try {
    const { status, output } = await run('record', 'other', '--source', 'original', '--url', original);
    assert.equal(status, 1, output);
    assert.match(output, /^FAIL {2}save\n {6}recordings\/original\/save holds the recording of the suite tiny: record the suite other with another --source$/m);
    assert.deepEqual(await readFile(recorded('lock.json')), lock);
    assert.equal(JSON.parse(await readFile(recorded('recording.json'), 'utf8')).suite, 'tiny');
    assert.equal((await gate(port)).status, 0, 'the suite tiny still passes');
  } finally {
    await rm(other, { recursive: true });
  }
});

test('a box of random width passes against itself with the original when the case names its paths as noise', async () => {
  const random = await serve(
    `<!doctype html><html lang="en"><head><title>Random</title></head><body><main><div id="box" style="height: 20px; background: red">box</div></main><script>
document.getElementById('box').style.width = (100 + Math.floor(Math.random() * 100)) + 'px';
</script></body></html>`,
  );
  const folder = join(root, 'cases', 'random', 'save');
  await mkdir(folder, { recursive: true });
  const lone = { format: 'angular-anything/case@1', id: 'save', viewport: { width: 800, height: 600 }, steps: steps.slice(0, 1) };
  await writeFile(join(folder, 'case.json'), JSON.stringify(lone));
  let recorded = await run('record', 'random', '--source', 'random', '--url', random);
  for (let attempt = 0; recorded.status === 0 && attempt < 5; attempt++) recorded = await run('record', 'random', '--source', 'random', '--url', random);
  assert.equal(recorded.status, 1, recorded.output);
  const noise = recorded.output.split('\n').filter((line) => line.trim().startsWith('{"layer"')).map((line) => JSON.parse(line));
  assert.ok(noise.some((entry) => entry.path.endsWith('.box.width')), recorded.output);
  await writeFile(join(folder, 'case.json'), JSON.stringify({ ...lone, noise }));
  const again = await run('record', 'random', '--source', 'random', '--url', random);
  assert.equal(again.status, 0, again.output);
  for (let gate = 0; gate < 3; gate++) {
    const gated = await run('gate', 'random', '--source', 'random', '--url', random, '--original-url', random);
    assert.equal(gated.status, 0, gated.output);
  }
  await rm(join(root, 'cases', 'random'), { recursive: true });
});
