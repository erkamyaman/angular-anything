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

type Noise = { layer: string; path: string };
type Step = Record<string, unknown>;

const click = (name: string): Step => ({ action: 'click', target: { role: 'button', name } });
const row = (id: string) => `html[1]/body[1]/main[1]/ul[1]/li[2]/${id}`;
const noted: Noise[] = [
  { layer: 'dom', path: row('input[1].attrs.id') },
  { layer: 'dom', path: row('label[1].attrs.for') },
  { layer: 'events', path: '[0].payload.id' },
  { layer: 'effects', path: 'storage.notes[1].id' },
];

const suites: Record<string, { page: string; steps: Step[]; noise?: Noise[] }> = {
  add: { page: 'r1', steps: [click('Add note')], noise: noted },
  'add-reload': { page: 'r1', steps: [click('Add note'), { action: 'reload' }], noise: noted },
  toggle: { page: 'r1', steps: [{ action: 'check', target: { role: 'checkbox', name: 'First' } }] },
  refresh: { page: 'r1', steps: [click('Refresh')], noise: [{ layer: 'effects', path: 'gets[*].query.cb[0]' }] },
  upload: { page: 'r1', steps: [click('Upload')] },
  prefs: { page: 'r1', steps: [click('Save prefs')], noise: [{ layer: 'effects', path: 'storage.cart' }] },
  keep: {
    page: 'notes',
    steps: [click('Keep note'), click('Sync'), click('Send file')],
    noise: [
      { layer: 'effects', path: 'storage.cart' },
      { layer: 'effects', path: 'storage.notes[0].ref' },
      { layer: 'effects', path: 'gets[0].query.nonce[0]' },
    ],
  },
};

const ports: [string, string, string, number][] = [
  ['r1', '', 'add', 0],
  ['r1', '', 'add-reload', 0],
  ['r1', '', 'toggle', 0],
  ['r1', '', 'refresh', 0],
  ['r1', '', 'upload', 0],
  ['r1', '', 'prefs', 0],
  ['r1', 'no-storage', 'toggle', 1],
  ['r1', 'empty-storage', 'toggle', 1],
  ['r1', 'stored-flag', 'add', 1],
  ['r1', 'get-other', 'refresh', 1],
  ['r1', 'get-none', 'refresh', 1],
  ['r1', 'get-noconfig', 'refresh', 1],
  ['r1', 'form-field', 'upload', 1],
  ['r1', 'form-empty', 'upload', 1],
  ['r1', 'form-nopost', 'upload', 1],
  ['r1', 'prefs-below', 'prefs', 1],
  ['r1', 'prefs-sibling', 'prefs', 1],
  ['r1', 'event-id', 'add', 1],
  ['r1', 'reload-id', 'add-reload', 1],
  ['notes', '', 'keep', 0],
  ['notes', 'cart7', 'keep', 0],
  ['notes', 'store', 'keep', 1],
  ['notes', 'sync-none', 'keep', 1],
  ['notes', 'sync-other', 'keep', 1],
  ['notes', 'field', 'keep', 1],
  ['notes', 'items', 'keep', 1],
  ['notes', 'lang', 'keep', 1],
  ['notes', 'ref-number', 'keep', 1],
  ['notes', 'ref-empty', 'keep', 1],
  ['notes', 'ref-object', 'keep', 1],
];

let root: string;
const servers: Server[] = [];
const urls: Record<string, string> = {};

async function serve(html: string): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    const path = new URL(request.url!, 'http://localhost').pathname;
    if (path.startsWith('/api/') || path.startsWith('/rpc/')) {
      setTimeout(() => {
        if (request.method === 'POST') response.writeHead(201, { 'content-type': 'application/json' }).end('{}');
        else response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      }, 20);
    } else if (path === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    } else {
      response.writeHead(404).end();
    }
  });
  for (let port = 6090; port <= 6099; port++) {
    const listening = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (listening) {
      servers.push(server);
      return `http://127.0.0.1:${port}`;
    }
  }
  throw new Error('no free port from 6090 to 6099');
}

function run(...args: string[]): Promise<{ status: number | string; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ status: error ? (error.code ?? 'killed') : 0, output: stdout + stderr });
    });
  });
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-masks-'));
  for (const [name, suite] of Object.entries(suites)) {
    const folder = join(root, 'cases', name, name);
    await mkdir(folder, { recursive: true });
    const testCase = {
      format: 'angular-anything/case@1',
      id: name,
      viewport: { width: 800, height: 600 },
      steps: [{ action: 'goto', path: '/' }, ...suite.steps],
      noise: suite.noise,
    };
    await writeFile(join(folder, 'case.json'), JSON.stringify(testCase, null, 2));
  }
  for (const page of ['r1', 'notes']) urls[page] = await serve(await readFile(join(pages, `${page}.html`), 'utf8'));
});

after(async () => {
  for (const server of servers) server.close();
  await rm(root, { recursive: true, force: true });
});

test('the mask pages record with their noise named, and without it record exits 1 and names the paths', async () => {
  for (const [name, suite] of Object.entries(suites)) {
    const recorded = await run('record', name, '--source', name, '--url', urls[suite.page]);
    assert.equal(recorded.status, 0, recorded.output);
    assert.match(recorded.output, new RegExp(`^ok {4}${name} {2}steps: ${suite.steps.length + 1}`, 'm'));
    const stored = await readFile(join(root, 'recordings', name, name, '02.json'), 'utf8');
    assert.equal(/(?<![0-9a-f])[0-9a-f]{10,16}(?![0-9a-f])/.test(stored), false, `${name}: no random token is in the recording`);
  }
  const folder = join(root, 'cases', 'bare', 'bare');
  await mkdir(folder, { recursive: true });
  const bare = { ...JSON.parse(await readFile(join(root, 'cases', 'keep', 'keep', 'case.json'), 'utf8')), id: 'bare', noise: undefined };
  await writeFile(join(folder, 'case.json'), JSON.stringify(bare));
  const failed = await run('record', 'bare', '--source', 'bare', '--url', urls.notes);
  assert.equal(failed.status, 1, failed.output);
  for (const entry of suites.keep.noise!) assert.ok(failed.output.includes(JSON.stringify(entry)), `${JSON.stringify(entry)} is printed\n${failed.output}`);
});

for (const [page, bug, name, expected] of ports) {
  test(`${page} ${bug === '' ? 'without a bug' : `?${page === 'r1' ? 'bug' : 'broken'}=${bug}`} gates ${name} with exit ${expected}`, async () => {
    const query = bug === '' ? '' : `/?${page === 'r1' ? 'bug' : 'broken'}=${bug}`;
    const { status, output } = await run('gate', name, '--source', name, '--url', `${urls[page]}${query}`);
    assert.equal(status, expected, output);
  });
}

test('record lists a noise entry whose value was the same in both runs, and still records it', async () => {
  const folder = join(root, 'cases', 'agree', 'agree');
  await mkdir(folder, { recursive: true });
  const keep = JSON.parse(await readFile(join(root, 'cases', 'keep', 'keep', 'case.json'), 'utf8'));
  const agree = { ...keep, id: 'agree', noise: [...keep.noise, { layer: 'effects', path: 'storage.lang' }] };
  await writeFile(join(folder, 'case.json'), JSON.stringify(agree));
  const recorded = await run('record', 'agree', '--source', 'agree', '--url', urls.notes);
  assert.equal(recorded.status, 0, recorded.output);
  assert.match(recorded.output, /^ {6}noise entry without a difference between the two runs: effects storage\.lang$/m);
  assert.equal((recorded.output.match(/without a difference between the two runs/g) ?? []).length, 1, 'only the entry that agreed is listed');
});
