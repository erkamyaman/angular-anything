import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const page = (text: string) => `<!doctype html><html lang="en"><head><title>Drift</title></head><body><main><p>${text}</p></main></body></html>`;

let root: string;
let original: string;
let port: string;
const texts = { original: 'same', port: 'same' };
const closers: (() => void)[] = [];

async function serve(side: keyof typeof texts): Promise<string> {
  const server = createServer((request, response) => {
    const text = new URL(request.url!, 'http://localhost').pathname === '/' ? texts[side] : 'other';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' }).end(page(text));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function unused(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port: free } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${free}`;
}

function run(...args: string[]): Promise<{ status: number | string; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ status: error ? (error.code ?? 'killed') : 0, output: stdout + stderr });
    });
  });
}

const drift = (originalUrl = original, portUrl = port) =>
  run('drift', 'two', '--source', 'original', '--url', portUrl, '--original-url', originalUrl);

const report = async () => JSON.parse(await readFile(join(root, 'reports', 'original', 'report.json'), 'utf8'));
const states = async () => (await report()).cases.map((item: { id: string; drift?: unknown }) => [item.id, item.drift]);

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-drift-'));
  for (const [id, path] of [['home', '/'], ['other', '/other']]) {
    await mkdir(join(root, 'cases', 'two', id), { recursive: true });
    const testCase = { format: 'angular-anything/case@1', id, viewport: { width: 400, height: 300 }, steps: [{ action: 'goto', path }] };
    await writeFile(join(root, 'cases', 'two', id, 'case.json'), JSON.stringify(testCase));
  }
  [original, port] = await Promise.all([serve('original'), serve('port')]);
  const recorded = await run('record', 'two', '--source', 'original', '--url', original);
  assert.equal(recorded.status, 0, recorded.output);
});

beforeEach(() => {
  texts.original = 'same';
  texts.port = 'same';
});

after(async () => {
  for (const close of closers) close();
  await rm(root, { recursive: true, force: true });
});

const same = { original: 'matches', port: 'matches' };

test('drift exits 0 and says so when the original and the port match the recording', async () => {
  const { status, output } = await drift();
  assert.equal(status, 0, output);
  assert.match(output, /^angular-anything drift: PASS$/m);
  assert.match(output, /^no drift: the original and the port match the recording in all 2 cases$/m);
  assert.doesNotMatch(output, /changed|regressed|not checked:/);
  assert.equal((await report()).command, 'drift');
  assert.deepEqual(await states(), [['home', same], ['other', same]]);
  assert.match(await readFile(join(root, 'reports', 'original', 'summary.txt'), 'utf8'), /^no drift/m);
});

test('drift says the original changed, and not that the port regressed', async () => {
  texts.original = 'new';
  const { status, output } = await drift();
  assert.equal(status, 1, output);
  assert.match(output, /^the original changed: home \(1 of 2 cases\)$/m);
  assert.doesNotMatch(output, /regressed|no drift|record again|not checked:/);
  assert.deepEqual(await states(), [['home', { original: 'differs', port: 'matches' }], ['other', same]]);
});

test('drift says the port regressed, and not that the original changed', async () => {
  texts.port = 'broken';
  const { status, output } = await drift();
  assert.equal(status, 1, output);
  assert.match(output, /^the port regressed: home \(1 of 2 cases\)$/m);
  assert.doesNotMatch(output, /original changed|no drift|record again|not checked:/);
  assert.deepEqual(await states(), [['home', { original: 'matches', port: 'differs' }], ['other', same]]);
});

test('drift says both when both differ from the recording, and what to do then', async () => {
  texts.original = 'new';
  texts.port = 'broken';
  const { status, output } = await drift();
  assert.equal(status, 1, output);
  assert.match(output, /^the original changed: home \(1 of 2 cases\)$/m);
  assert.match(output, /^the port regressed: home \(1 of 2 cases\)$/m);
  assert.match(output, /^both differ in home: record again, then gate the port against the new recording$/m);
});

test('a server that cannot be reached is not checked, it is neither a change nor a regression', async () => {
  const dead = await unused();
  const noOriginal = await drift(dead);
  assert.equal(noOriginal.status, 1, noOriginal.output);
  assert.match(noOriginal.output, /^not checked: the original in home, other \(2 of 2 cases\)$/m);
  assert.doesNotMatch(noOriginal.output, /original changed|regressed|no drift/);
  const noPort = await drift(original, dead);
  assert.equal(noPort.status, 1, noPort.output);
  assert.match(noPort.output, /^not checked: the port in home, other \(2 of 2 cases\)$/m);
  assert.doesNotMatch(noPort.output, /original changed|regressed|no drift/);
});

test('a recording that the lock refuses is not checked', async () => {
  const file = join(root, 'recordings', 'original', 'home', '01.json');
  const kept = await readFile(file, 'utf8');
  try {
    await writeFile(file, `${kept} `);
    const { status, output } = await drift();
    assert.equal(status, 1, output);
    assert.match(output, /^not checked: the recording of home \(1 of 2 cases\)$/m);
    assert.doesNotMatch(output, /original changed|regressed|no drift/);
  } finally {
    await writeFile(file, kept);
  }
});

test('drift needs --original-url and takes no --redact', async () => {
  const alone = await run('drift', 'two', '--source', 'original', '--url', port);
  assert.equal(alone.status, 2, alone.output);
  assert.match(alone.output, /^drift needs --original-url/);
  const redacted = await run('drift', 'two', '--source', 'original', '--url', port, '--original-url', original, '--redact');
  assert.equal(redacted.status, 2, redacted.output);
  assert.match(redacted.output, /^drift takes no --redact/);
});
