import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const pages = fileURLToPath(new URL('./pages/', import.meta.url));

type Step = Record<string, unknown>;

const click = (name: string, role = 'button'): Step => ({ action: 'click', target: { role, name } });

const suites: Record<string, Step[]> = {
  add: [click('Add')],
  later: [click('Later'), { action: 'advance', frames: 10 }],
  remove: [click('Delete')],
  rename: [click('Rename')],
  open: [click('Open')],
  both: [click('Add and open')],
  print: [click('Print')],
  link: [click('Elsewhere', 'link')],
  plain: [click('Open plain')],
  inside: [click('Popup alert')],
  closed: [click('Open'), click('Closed')],
};

const ports: [string, string, number, RegExp?][] = [
  ['add', '', 0],
  ['later', '', 0],
  ['remove', '', 0],
  ['rename', '', 0],
  ['open', '', 0],
  ['both', '', 0],
  ['print', '', 0],
  ['link', '', 0],
  ['plain', '', 0],
  ['inside', '', 0],
  ['closed', '', 0],
  ['add', 'no-alert', 1, /popups\[0\]/],
  ['add', 'alert-text', 1, /popups\[0\]\.message/],
  ['add', 'alert-twice', 1, /popups\[1\]/],
  ['later', 'no-alert', 1, /popups\[0\]/],
  ['remove', 'no-confirm', 1, /popups\[0\]/],
  ['remove', 'confirm-text', 1, /popups\[0\]\.message/],
  ['rename', 'prompt-text', 1, /popups\[0\]\.message/],
  ['rename', 'prompt-default', 1, /popups\[0\]\.default/],
  ['open', 'no-open', 1, /popups\[0\]/],
  ['open', 'open-url', 1, /popups\[0\]\.url\.query\.n\[0\]/],
  ['open', 'open-target', 1, /popups\[0\]\.target/],
  ['open', 'open-features', 1, /popups\[0\]\.features/],
  ['both', 'order', 1, /popups\[0\]\.kind/],
  ['both', 'no-alert', 1, /popups\[0\]/],
  ['both', 'no-open', 1, /popups\[1\]/],
  ['print', 'no-print', 1, /popups\[0\]/],
];

let root: string;
let html: string;
const servers: Server[] = [];

async function serve(): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    const path = new URL(request.url!, 'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      setTimeout(() => response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'), 20);
    } else if (path === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}

function run(...args: string[]): Promise<{ status: number | string; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ status: error ? (error.code ?? 'killed') : 0, output: stdout + stderr });
    });
  });
}

let url: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-popups-'));
  html = await readFile(join(pages, 'popups.html'), 'utf8');
  url = await serve();
  for (const [name, steps] of Object.entries(suites)) {
    const folder = join(root, 'cases', name, name);
    await mkdir(folder, { recursive: true });
    const testCase = { format: 'angular-anything/case@1', id: name, viewport: { width: 800, height: 600 }, steps: [{ action: 'goto', path: '/' }, ...steps] };
    await writeFile(join(folder, 'case.json'), JSON.stringify(testCase, null, 2));
  }
});

after(async () => {
  for (const server of servers) server.close();
  await rm(root, { recursive: true, force: true });
});

const state = (observation: { dom: unknown }) => JSON.stringify(observation.dom);

const recordingOf = async (name: string, step: number) => JSON.parse(await readFile(join(root, 'recordings', name, name, `0${step}.json`), 'utf8'));

test('dialogs and windows are in the side effects of the step that made them, with what a user can tell apart', async () => {
  for (const name of Object.keys(suites)) {
    const recorded = await run('record', name, '--source', name, '--url', url);
    assert.equal(recorded.status, 0, recorded.output);
  }
  const popups = async (name: string) => (await recordingOf(name, 2)).effects.popups;
  const first = (await recordingOf('add', 1)).effects.popups;
  assert.deepEqual(first, []);
  assert.deepEqual(await popups('add'), [{ kind: 'alert', message: 'Task added: Call mom' }]);
  assert.deepEqual(await popups('later'), [{ kind: 'alert', message: 'Task added: Call mom' }], 'a timer of 100 ms is inside the step that settles');
  assert.deepEqual((await recordingOf('later', 3)).effects.popups, []);
  assert.deepEqual(await popups('remove'), [{ kind: 'confirm', message: 'Delete this task?' }]);
  assert.deepEqual(await popups('rename'), [{ kind: 'prompt', message: 'Name?', default: 'Ada' }]);
  assert.deepEqual(await popups('open'), [
    { kind: 'open', url: { path: ['popup'], query: { n: ['1'] }, fragment: '' }, target: 'side', features: 'width=300' },
  ]);
  assert.deepEqual(await popups('both'), [
    { kind: 'alert', message: 'Task added: Call mom' },
    { kind: 'open', url: { path: ['popup'], query: { n: ['1'] }, fragment: '' }, target: 'side', features: 'width=300' },
  ]);
  assert.deepEqual(await popups('print'), [{ kind: 'print' }]);
  assert.deepEqual(await popups('plain'), [
    { kind: 'open', url: { path: ['popup'], query: {}, fragment: '' }, target: '_blank', features: '' },
  ]);
  assert.deepEqual(
    await popups('inside'),
    [{ kind: 'open', url: { origin: 'about:', path: ['blank'], query: {}, fragment: '' }, target: 'inner', features: '' }],
    'a call inside the new window is not logged',
  );
  assert.match(state(await recordingOf('inside', 2)), /popup alerted/);
  assert.deepEqual((await recordingOf('inside', 2)).events, [], 'an event sent inside the new window is not the page\'s');
  assert.match(state(await recordingOf('closed', 2)), /opened object false/);
  assert.match(state(await recordingOf('closed', 3)), /closed true/, 'the window is closed when the step is over');
  assert.deepEqual(await popups('link'), [], 'a link with target=_blank is in the DOM, its click is not a call');
  assert.match(state(await recordingOf('remove', 2)), /kept answer false/, 'confirm is dismissed, so it answers false');
  assert.match(state(await recordingOf('rename', 2)), /name null/, 'prompt is dismissed, so it answers null');
  assert.match(state(await recordingOf('open', 2)), /opened object false/, 'window.open gives back a window that is not closed');
});

for (const [name, bug, expected, path] of ports) {
  test(`${name} ${bug === '' ? 'without a bug' : `?bug=${bug}`} gates with exit ${expected}`, async () => {
    const query = bug === '' ? '' : `/?bug=${bug}`;
    const { status, output } = await run('gate', name, '--source', name, '--url', `${url}${query}`);
    assert.equal(status, expected, output);
    if (path) assert.match(output, path, output);
  });
}
