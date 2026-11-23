import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import type { Case } from '../src/case.ts';
import type { Observation } from '../src/compare.ts';
import { writeLock } from '../src/lock.ts';
import type { DomNode } from '../src/page.ts';
import { runCase } from '../src/run.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Frames</title></head>
<body>
<main>
  <h1>Frames</h1>
  <p><button type="button" id="vue">Vue</button> <output id="vue-out"></output></p>
  <p><button type="button" id="close">Close</button> <output id="close-out"></output></p>
  <p><button type="button" id="toast">Toast</button> <output id="region"></output></p>
  <p><button type="button" id="idle">Idle</button> <output id="media"></output></p>
  <p id="ticks"></p>
</main>
<script>
  const byId = (id) => document.getElementById(id);
  const query = new URLSearchParams(location.search);
  byId('media').textContent = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no preference';
  byId('vue').addEventListener('click', () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      byId('vue-out').textContent = 'entering';
      setTimeout(() => {
        byId('vue-out').textContent = 'done';
      }, 201);
    }));
  });
  byId('close').addEventListener('click', () => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        byId('close-out').textContent = 'closed';
      }, 300);
    });
  });
  byId('toast').addEventListener('click', () => {
    byId('region').textContent = 'Saved';
    setTimeout(() => {
      byId('region').textContent = '';
    }, Number(query.get('toast') ?? 2000));
  });
  if (query.has('interval')) setInterval(() => {}, 100);
  if (query.has('chain')) {
    const poll = () => setTimeout(poll, 200);
    poll();
  }
  if (query.has('fetch')) {
    const poll = () => fetch('/api/poll').then((response) => response.json()).then(() => setTimeout(() => poll(), 200));
    poll();
  }
</script>
</body>
</html>
`;

const flip = (load: number) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Flip</title></head>
<body><main><h1>Flip</h1><p id="out">waiting</p></main>
<script>setTimeout(() => { document.getElementById('out').textContent = 'done'; }, ${load % 2 ? 100 : 400});</script>
</body>
</html>
`;

let browser: Browser;
let base: URL;
let close: () => void;
let loads = 0;

before(async () => {
  const server = createServer((request, response) => {
    request.resume();
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/poll') return void response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    if (url.pathname === '/flip') {
      return void response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(flip(++loads));
    }
    if (url.pathname !== '/') return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  close = () => {
    server.close();
    server.closeAllConnections();
  };
  base = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  close();
});

const click = (name: string): Case['steps'][number] => ({ action: 'click', target: { role: 'button', name } });
const advance = (frames: number): Case['steps'][number] => ({ action: 'advance', frames });
const make = (...steps: Case['steps']): Case => ({
  format: 'angular-anything/case@1',
  id: 'frames',
  viewport: { width: 600, height: 400 },
  steps: [{ action: 'goto', path: '/' }, ...steps],
});

function find(node: DomNode, id: string): Exclude<DomNode, string> | undefined {
  if (typeof node === 'string') return undefined;
  if (node.attrs?.id === id) return node;
  for (const child of node.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return undefined;
}
const text = (observation: Observation, id: string) => (find(observation.dom, id)?.children ?? []).join('');

async function record(testCase: Case, url: URL = base) {
  const run = await runCase(browser, testCase, url);
  assert.equal(run.error, undefined);
  return run;
}

test('a class change two animation frames after a click, followed by a timer of 201 ms, is seen when it is over', async () => {
  const run = await record(make(click('Vue')));
  assert.equal(text(run.steps[1].observation, 'vue-out'), 'done');
  assert.ok(run.steps[1].frames >= 14 + 4, `${run.steps[1].frames} frames`);
});

test('a closing timer of 300 ms armed one animation frame after a click is waited for', async () => {
  const run = await record(make(click('Close')));
  assert.equal(text(run.steps[1].observation, 'close-out'), 'closed');
  assert.ok(run.steps[1].frames >= 19 + 4, `${run.steps[1].frames} frames`);
});

test('the browser context does not ask for reduced motion', async () => {
  const run = await record(make());
  assert.equal(text(run.steps[0].observation, 'media'), 'no preference');
});

test('a step that ends within 500 ms of a one-shot timer stays open until the timer has fired', async () => {
  const near = await record(make(click('Toast'), advance(100)));
  assert.equal(text(near.steps[2].observation, 'region'), '');
  assert.ok(near.steps[2].frames > 100 + 20, `${near.steps[2].frames} frames`);
  const far = await record(make(click('Toast'), advance(80)));
  assert.equal(text(far.steps[2].observation, 'region'), 'Saved');
  assert.equal(far.steps[2].frames, 80 + 4);
});

test('a page with a timer that arms itself again keeps a step open for two periods and no longer', async () => {
  const chain = await record(make(click('Idle'), click('Idle'), click('Idle')), new URL('/?chain', base));
  for (const step of chain.steps.slice(1)) assert.ok(step.frames >= 4 && step.frames <= 40, `${step.frames} frames`);
  assert.ok(chain.steps.slice(1).some((step) => step.frames > 4));
  const fetched = await record(make(click('Idle'), click('Idle')), new URL('/?fetch', base));
  for (const step of fetched.steps.slice(1)) assert.ok(step.frames >= 4 && step.frames <= 40, `${step.frames} frames`);
});

test('a setInterval never keeps a step open', async () => {
  const run = await record(make(click('Idle'), click('Idle')), new URL('/?interval', base));
  assert.deepEqual(
    run.steps.map((step) => step.frames),
    [4, 4, 4],
  );
});

test('the frames of a step are the same in every run of the page', async () => {
  const testCase = make(click('Vue'), click('Close'), click('Toast'), advance(10));
  const runs = await Promise.all([1, 2, 3].map(() => record(testCase)));
  const frames = runs.map((run) => run.steps.map((step) => step.frames).join(' '));
  assert.equal(new Set(frames).size, 1, frames.join(' | '));
});

test('replay runs the stored frames on the port, with the same end state', async () => {
  const testCase = make(click('Vue'), click('Close'), click('Toast'), advance(10));
  const original = await record(testCase);
  const stored = original.steps.map((step) => step.frames);
  const port = await runCase(browser, testCase, base, undefined, stored);
  assert.equal(port.error, undefined);
  assert.deepEqual(
    port.steps.map((step) => step.frames),
    stored,
  );
  assert.deepEqual(
    port.steps.map((step) => step.observation),
    original.steps.map((step) => step.observation),
  );
});

test('a port with a one-shot timer that is due within 500 ms at the end of a step is not settled', async () => {
  const testCase = make(click('Toast'), advance(20));
  const original = await record(testCase);
  const stored = original.steps.map((step) => step.frames);
  const port = await runCase(browser, testCase, new URL('/?toast=800', base), undefined, stored);
  assert.match(port.error ?? '', /^step 3 \(advance 20 frames\): not settled within the frames of the original/);
  assert.match(port.error ?? '', /a one-shot timer of 800 ms is due in \d+ ms of page time/);
});

test('a port may show its last change up to 3 frames later than the original and still pass, 4 frames later it fails', async () => {
  const testCase = make(click('Vue'));
  const original = await record(testCase);
  const stored = original.steps.map((step) => step.frames);
  const three = await runCase(browser, testCase, base, undefined, [stored[0], stored[1] - 3]);
  assert.equal(three.error, undefined);
  assert.equal(text(three.steps[1].observation, 'vue-out'), 'done');
  const four = await runCase(browser, testCase, base, undefined, [stored[0], stored[1] - 4]);
  assert.match(four.error ?? '', /not settled within the frames of the original \(\d+ frames\).*the page changed/);
});

let root: string;

const run = (...args: string[]): Promise<{ status: number | string; output: string }> =>
  new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ status: error ? (error.code ?? 'killed') : 0, output: stdout + stderr });
    });
  });

const recordingFile = (suite: string, name: string) => join(root, 'recordings', 'original', suite, name);

async function writeCase(suite: string, testCase: Case): Promise<void> {
  const directory = join(root, 'cases', suite, testCase.id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'case.json'), JSON.stringify({ ...testCase, id: testCase.id }, null, 2));
}

test('record stores the frames of every step under the lock, and a changed count fails the gate with a lock error', async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-frames-'));
  try {
    await writeCase('frames', { ...make(click('Vue'), advance(10), click('Toast')), id: 'steps' });
    const recorded = await run('record', 'frames', '--source', 'original', '--url', base.origin);
    assert.equal(recorded.status, 0, recorded.output);
    const file = recordingFile('steps', 'recording.json');
    const recording = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(recording.frames.length, 4);
    assert.ok(recording.frames.every((count: number) => Number.isInteger(count) && count >= 4));
    assert.ok(recording.frames[2] >= 14);

    const gate = () => run('gate', 'frames', '--source', 'original', '--url', base.origin);
    const good = await gate();
    assert.equal(good.status, 0, good.output);
    assert.match(good.output, /^PASS {2}steps {2}4 steps, frames: \d+ \d+ \d+ \d+$/m);

    const original = await readFile(file, 'utf8');
    recording.frames[1]++;
    await writeFile(file, `${JSON.stringify(recording, null, 2)}\n`);
    const changed = await gate();
    assert.equal(changed.status, 1, changed.output);
    assert.match(changed.output, /lock: recording\.json does not match its SHA-256 in lock\.json/);
    await writeFile(file, original);
    assert.equal((await gate()).status, 0);

    delete recording.frames;
    await writeFile(file, `${JSON.stringify(recording, null, 2)}\n`);
    const directory = join(root, 'recordings', 'original', 'steps');
    const lock = JSON.parse(await readFile(join(directory, 'lock.json'), 'utf8'));
    await writeLock(directory, { playwright: lock.playwright, browser: lock.browser, case: lock.case });
    const old = await gate();
    assert.equal(old.status, 1, old.output);
    assert.match(old.output, /it has no stored frames, so it has to be recorded again/);
    const replayed = await run('replay', 'frames', '--source', 'original', '--url', base.origin);
    assert.equal(replayed.status, 1, replayed.output);
    assert.match(replayed.output, /recorded again/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('gate runs the stored frames on the port and fails a port that is not at rest after them', async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-frames-'));
  try {
    await writeCase('frames', { ...make(click('Toast'), advance(20)), id: 'toast' });
    const recorded = await run('record', 'frames', '--source', 'original', '--url', base.origin);
    assert.equal(recorded.status, 0, recorded.output);
    const same = await run('gate', 'frames', '--source', 'original', '--url', `${base.origin}/?toast=2000`);
    assert.equal(same.status, 0, same.output);
    const port = await run('gate', 'frames', '--source', 'original', '--url', `${base.origin}/?toast=800`);
    assert.equal(port.status, 1, port.output);
    assert.match(port.output, /error: step 3 \(advance 20 frames\): not settled within the frames of the original \(24 frames\)/);
    assert.match(port.output, /a one-shot timer of 800 ms is due in \d+ ms of page time/);
    assert.match(port.output, /^FAIL {2}toast$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('record exits 1 and names the step when its two runs take a different number of frames', async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-frames-'));
  try {
    const testCase: Case = {
      format: 'angular-anything/case@1',
      id: 'flip',
      viewport: { width: 600, height: 400 },
      steps: [{ action: 'goto', path: '/flip' }],
    };
    await writeCase('flip', testCase);
    const recorded = await run('record', 'flip', '--source', 'original', '--url', base.origin);
    assert.equal(recorded.status, 1, recorded.output);
    assert.match(recorded.output, /step 1 \(goto \/flip\): the first run took \d+ frames, the second \d+/);
    assert.match(recorded.output, /Recorded 0 of 1 cases/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a recording whose stored frames are not a whole number above 0 for every step is refused', async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-frames-'));
  try {
    await writeCase('frames', { ...make(click('Vue'), advance(2)), id: 'bad' });
    const recorded = await run('record', 'frames', '--source', 'original', '--url', base.origin);
    assert.equal(recorded.status, 0, recorded.output);
    const file = recordingFile('bad', 'recording.json');
    const recording = JSON.parse(await readFile(file, 'utf8'));
    const directory = join(root, 'recordings', 'original', 'bad');
    const lock = JSON.parse(await readFile(join(directory, 'lock.json'), 'utf8'));
    const [first, second, third] = recording.frames as number[];
    for (const frames of [[first + 0.5, second, third], [first, second], [first, second, third, third], [first, 0, third], [first, second, -third], [first, second, '5']]) {
      await writeFile(file, `${JSON.stringify({ ...recording, frames }, null, 2)}\n`);
      await writeLock(directory, { playwright: lock.playwright, browser: lock.browser, case: lock.case });
      const refused = await run('gate', 'frames', '--source', 'original', '--url', base.origin);
      assert.equal(refused.status, 1, `${JSON.stringify(frames)}: ${refused.output}`);
      assert.match(refused.output, /its stored frames are not a whole number above 0 for each step, so it has to be recorded again/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
