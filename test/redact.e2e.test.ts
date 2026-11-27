import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const page = (side: 'one' | 'two', number: number) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>zqtitle${side}</title></head>
<body style="--zqcustom${side}: zqpaint${side}">
<main>
  <h1>zqheading${side}</h1>
  <zq-tag${side}>zqinside${side}</zq-tag${side}>
  <p id="state" class="zqclass${side}" data-zqattr${side}="zqdata${side}" aria-label="zqlabel${side}" aria-zqaria${side}="zqliteral${side}">zqtext${side}</p>
  <label>zqfield <input id="name" type="text"></label>
  <button type="button" id="go">zqbutton</button>
  ${side === 'one' ? '<button type="button">zqgone</button>' : '<button type="button">zqother</button>'}
</main>
<script>
  document.getElementById('go').addEventListener('click', () => {
    const typed = document.getElementById('name').value;
    document.getElementById('state').textContent = 'zqafter${side} ' + typed;
    localStorage.setItem('zqkey${side}', 'zqstored${side}');
    localStorage.setItem('zqshared', JSON.stringify({ zqinner${side}: ${number}, zqsame: 'zqjson${side}' }));
    window.__aa.emit('zqevent${side}', { zqprop${side}: 'zqpayload${side}', zqnumber: ${number}, typed });
    history.pushState(null, '', '/zqsegment${side}?zqurl=zqvalue${side}#zqfragment${side}');
    alert('zqalert${side}');
    const read = () => fetch('/api/zqpath?zqparam=zqquery').then((answer) => answer.text());
    read()
      ${side === 'two' ? '.then(read)' : ''}
      .then(() => fetch('/api/zqpost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zqbodykey: 'zqbody${side}', typed }) }));
  });
</script>
</body>
</html>
`;

const bare = (attribute: string) =>
  `<!doctype html><html lang="en"><head><title>zqbare</title></head><body><main><p ${attribute}>zqplain</p></main></body></html>`;

const target = (role: string, name: string) => ({ role, name });

let root: string;
let original: string;
let port: string;
const closers: (() => void)[] = [];

async function serve(side: 'one' | 'two', number: number): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    const { pathname } = new URL(request.url!, 'http://localhost');
    if (pathname.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"zqanswer":"zqreply"}');
    } else {
      const body = pathname === '/zqconv' ? bare(side === 'two' ? 'zqselector' : '') : page(side, number);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
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

async function writeCase(id: string, steps: unknown[]) {
  await mkdir(join(root, 'cases', 'marked', id), { recursive: true });
  const testCase = { format: 'angular-anything/case@1', id, description: 'zqdescription', viewport: { width: 800, height: 600 }, steps };
  await writeFile(join(root, 'cases', 'marked', id, 'case.json'), JSON.stringify(testCase));
}

async function written(): Promise<{ names: string[]; text: string }> {
  const directory = join(root, 'reports', 'original');
  const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
  const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  return { names: files.map((file) => file.slice(directory.length + 1)).sort(), text: contents.join('\n') };
}

const leaks = (text: string) => [...text.matchAll(/.{0,40}(zq|918273645|564738291).{0,40}/gi)].map((match) => match[0]);

const report = async () => JSON.parse(await readFile(join(root, 'reports', 'original', 'report.json'), 'utf8'));

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-redact-'));
  await writeCase('typed', [
    { action: 'goto', path: '/?zqstart=zqgoto' },
    { action: 'fill', target: target('textbox', 'zqfield'), value: 'zqtyped' },
    { action: 'click', target: target('button', 'zqbutton') },
  ]);
  await writeCase('missing', [
    { action: 'goto', path: '/' },
    { action: 'click', target: target('button', 'zqgone') },
  ]);
  await writeCase('convention', [{ action: 'goto', path: '/zqconv' }]);
  [original, port] = await Promise.all([serve('one', 918273645), serve('two', 564738291)]);
  const recorded = await run('record', 'marked', '--source', 'original', '--url', original);
  assert.equal(recorded.status, 0, recorded.output);
});

after(async () => {
  for (const close of closers) close();
  await rm(root, { recursive: true, force: true });
});

const suite = (command: string, ...more: string[]) => run(command, 'marked', '--source', 'original', ...more);

test('without --redact the report holds the values and the screenshots, so the check below can see a leak', async () => {
  const { status, output } = await suite('gate', '--url', port, '--original-url', original);
  assert.equal(status, 1, output);
  const files = await written();
  assert.ok(leaks(output).length > 0 && leaks(files.text).length > 0, output);
  assert.ok(files.names.some((name) => name.endsWith('.png')), files.names.join());
  const whole = await report();
  const steps = whole.cases.flatMap((item: { steps: { layers: Record<string, { differences: number; first: { kind: string; path: string }[] }> }[] }) => item.steps);
  const results = steps.flatMap((step: (typeof steps)[number]) => Object.values(step.layers));
  assert.ok(results.some((result: { differences: number }) => result.differences > 10), 'a layer with more differences than are kept');
  const total = results.reduce((sum: number, result: { differences: number }) => sum + result.differences, 0);
  assert.equal(whole.distinct.differences.reduce((sum: number, group: { count: number }) => sum + group.count, 0), total);
  assert.equal(whole.distinct.cases, 3);
  const tape = results.flatMap((result: { first: { kind: string; path: string }[] }) => result.first).filter((each: { path: string }) => each.path.startsWith('tape '));
  assert.ok(tape.length > 0 && tape.every((each: { kind: string }) => each.kind === 'tape'), JSON.stringify(tape));
});

for (const command of ['gate', 'replay']) {
  test(`${command} --redact prints and writes shapes only: no recorded, typed or page value, and no screenshot`, async () => {
    const { status, output } = await suite(command, '--url', `${port}/?zqbug=zqon`, '--original-url', `${original}/?zqorig=zqon`, '--redact');
    assert.equal(status, 1, output);
    const files = await written();
    assert.deepEqual(files.names, ['report.json', 'summary.txt']);
    assert.deepEqual(leaks(output), [], output);
    assert.deepEqual(leaks(files.text), []);
    assert.match(output, /string, length \d+, hash [0-9a-f]{8}/);
    assert.match(output, /first difference at char \d+/);
    assert.match(output, /distinct differences in \d+ cases:/);
    assert.match(output, /step 2: hidden, length \d+, hash [0-9a-f]{8}/);
    assert.match(output, /note: step 3: hidden, length \d+/);
    assert.match(output, /empty attributes[^\n]*: <[0-9a-f]{8}>\./);
    const written_ = await report();
    const typed = written_.cases.find((item: { id: string }) => item.id === 'typed');
    assert.match(typed.steps[1].action, /^fill textbox <[0-9a-f]{8}> with <[0-9a-f]{8}>$/);
    assert.match(typed.steps[0].action, /^goto <[0-9a-f]{8}>$/);
    const text = typed.steps[2].layers.events.first.find((each: { kind: string }) => each.kind === 'text');
    assert.match(text.path, /^\[0\]\.(name|payload\.<[0-9a-f]{8}>)$/);
    assert.deepEqual(Object.keys(text.at), ['offset']);
    assert.ok(typed.steps[2].layers.style.first.length > 0 && typed.steps[2].layers.dom.first.length > 0);
    assert.equal(typed.steps[2].screenshot, 'different', output);
    assert.equal(new URL(written_.url).search, '');
  });
}

test('--redact hides the original that does not match its recording, and a target that matches nothing', async () => {
  const { status, output } = await suite('gate', '--url', port, '--original-url', port, '--redact');
  assert.equal(status, 1, output);
  assert.match(output, /the original does not match its recording: hidden, length \d+/);
  assert.deepEqual(leaks(output), [], output);
  assert.deepEqual(leaks((await written()).text), []);
});

test('--redact hides error messages of a broken recording and of a broken case', async () => {
  const tape = join(root, 'recordings', 'original', 'typed', 'tape.json');
  const recording = join(root, 'recordings', 'original', 'missing', 'recording.json');
  const kept = [await readFile(tape, 'utf8'), await readFile(recording, 'utf8')];
  try {
    await writeFile(tape, 'zqbroken');
    await writeFile(recording, kept[1].replace('angular-anything/recording@4', 'zqformat'));
    const { status, output } = await suite('replay', '--url', port, '--redact');
    assert.equal(status, 1, output);
    assert.match(output, /cannot replay against the recording: hidden, length \d+/);
    assert.deepEqual(leaks(output), [], output);
    assert.deepEqual(leaks((await written()).text), []);
  } finally {
    await writeFile(tape, kept[0]);
    await writeFile(recording, kept[1]);
  }
  const file = join(root, 'cases', 'marked', 'convention', 'case.json');
  const testCase = await readFile(file, 'utf8');
  try {
    await writeFile(file, '{"format": "angular-anything/case@1", "zqunquoted": 1}');
    const open = await suite('gate', '--url', port);
    assert.ok(leaks(open.output).length > 0, open.output);
    const { status, output } = await suite('gate', '--url', port, '--redact');
    assert.equal(status, 1, output);
    assert.match(output, /^gate failed: hidden, length \d+/m);
    assert.deepEqual(leaks(output), [], output);
  } finally {
    await writeFile(file, testCase);
  }
});

test('a tape answer without a text body is refused and not printed', async () => {
  const tape = join(root, 'recordings', 'original', 'typed', 'tape.json');
  const kept = await readFile(tape, 'utf8');
  try {
    for (const broken of [{ body: 918273645 }, { body: ['zqlist'] }, { headers: 'zqheaders' }, { headers: { location: 564738291 } }, { status: 'zqstatus' }]) {
      const entries = JSON.parse(kept);
      assert.ok(entries.length > 0);
      Object.assign(entries[0].answer, broken);
      await writeFile(tape, JSON.stringify(entries));
      for (const more of [['--redact'], []]) {
        const { status, output } = await suite('replay', '--url', original, ...more);
        assert.equal(status, 1, output);
        assert.match(output, more.length > 0 ? /cannot replay against the recording: hidden, length \d+/ : /cannot replay against the recording: its tape holds an answer that is not one/);
        assert.doesNotMatch(output, /TypeError|918273645|564738291|zqlist|zqheaders|zqstatus/);
      }
    }
    const entries = JSON.parse(kept);
    entries[0].answer = null;
    await writeFile(tape, JSON.stringify(entries));
    const aborted = await suite('replay', '--url', original);
    assert.doesNotMatch(aborted.output, /cannot replay against the recording/);
  } finally {
    await writeFile(tape, kept);
  }
});

test('record takes no --redact', async () => {
  const { status, output } = await run('record', 'marked', '--source', 'other', '--url', original, '--redact');
  assert.equal(status, 2, output);
  assert.match(output, /record takes no --redact/);
});
