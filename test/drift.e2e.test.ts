import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createTcp } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { unreachable } from '../src/replay.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const page = (text: string) => `<!doctype html><html lang="en"><head><title>Drift</title></head><body><main><p>${text}</p><img src="/logo.svg" alt="logo"></main></body></html>`;

let root: string;
let original: string;
let port: string;
const texts = { original: 'same', port: 'same' };
const widths = { original: 10, port: 10 };
const later = { original: 'page', port: 'page' };
const silent = { original: false, port: false };
let dead: string;
const closers: (() => void)[] = [];

async function serve(side: keyof typeof texts): Promise<string> {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url!, 'http://localhost');
    if (silent[side]) return;
    const send = (type: string, body: string) =>
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', connection: 'close' }).end(body);
    if (pathname === '/logo.svg') {
      send('image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" width="${widths[side]}" height="10"/>`);
    } else if (pathname === '/next' && later[side] === 'empty') {
      request.socket.destroy();
    } else if (pathname === '/next' && later[side] === 'failing') {
      response.writeHead(500, { connection: 'close' }).end();
    } else if (pathname === '/next' && later[side] === 'dead') {
      response.writeHead(302, { location: `${dead}/x`, connection: 'close' }).end();
    } else if (pathname === '/next' && later[side] === 'reset') {
      request.socket.resetAndDestroy();
    } else if (pathname === '/next' && later[side] === 'hanging') {
      return;
    } else if (pathname === '/next' && later[side] === 'moved to hanging') {
      response.writeHead(302, { location: '/hang', connection: 'close' }).end();
    } else if (pathname === '/hang') {
      return;
    } else if (pathname === '/next' && later[side] === 'stuck script') {
      send('text/html; charset=utf-8', `${page('next')}<script src="/hang"></script>`);
    } else if (pathname === '/next') {
      send('text/html; charset=utf-8', page('next'));
    } else {
      send('text/html; charset=utf-8', page(pathname === '/' ? texts[side] : 'other'));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => {
    server.close();
    server.closeAllConnections();
  });
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
  for (const [suite, id, ...paths] of [['two', 'home', '/'], ['two', 'other', '/other'], ['walk', 'walk', '/', '/next']]) {
    await mkdir(join(root, 'cases', suite, id), { recursive: true });
    const steps = paths.map((path) => ({ action: 'goto', path }));
    const testCase = { format: 'angular-anything/case@1', id, viewport: { width: 400, height: 300 }, steps };
    await writeFile(join(root, 'cases', suite, id, 'case.json'), JSON.stringify(testCase));
  }
  [original, port] = await Promise.all([serve('original'), serve('port')]);
  dead = await unused();
  for (const [suite, source] of [['two', 'original'], ['walk', 'walker']]) {
    const recorded = await run('record', suite, '--source', source, '--url', original);
    assert.equal(recorded.status, 0, recorded.output);
  }
});

beforeEach(() => {
  texts.original = 'same';
  texts.port = 'same';
  Object.assign(widths, { original: 10, port: 10 });
  Object.assign(later, { original: 'page', port: 'page' });
  Object.assign(silent, { original: false, port: false });
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

test('sizes that differ between the original and the port blame neither side, whichever of them moved', async () => {
  for (const side of ['original', 'port'] as const) {
    Object.assign(widths, { original: 10, port: 10, [side]: 40 });
    const { status, output } = await drift();
    assert.equal(status, 1, output);
    assert.match(
      output,
      /^sizes or positions differ between the original and the port in home, other \(2 of 2 cases\): the recording holds none, so which side moved is not known$/m,
    );
    assert.doesNotMatch(output, /original changed|regressed|no drift|record again|not checked:/);
    const differing = { ...same, sizes: 'differ' };
    assert.deepEqual(await states(), [['home', differing], ['other', differing]]);
  }
});

test('a port that differs from the recording and in sizes has regressed', async () => {
  texts.port = 'broken';
  widths.port = 40;
  const { output } = await drift();
  assert.match(output, /^the port regressed: home \(1 of 2 cases\)$/m);
  assert.match(output, /^sizes or positions differ between the original and the port in other \(1 of 2 cases\)/m);
});

test('a finding of the tape alone is a difference of the port', async () => {
  texts.port = 'same<script>fetch("/extra")</script>';
  const { status, output } = await drift();
  assert.equal(status, 1, output);
  assert.match(output, /^the port regressed: home \(1 of 2 cases\)$/m);
  assert.deepEqual(await states(), [['home', { original: 'matches', port: 'differs' }], ['other', same]]);
  texts.port = 'same';
  texts.original = 'same<script>fetch("/extra")</script>';
  const asking = await drift();
  assert.match(asking.output, /^the original changed: home \(1 of 2 cases\)$/m);
  assert.match(asking.output, /does not match its recording: step 1, tape GET \/extra: /);
  assert.deepEqual(await states(), [['home', { original: 'differs', port: 'matches' }], ['other', same]]);
});

const walk = async () => {
  const { status, output } = await run('drift', 'walk', '--source', 'walker', '--url', port, '--original-url', original);
  const [item] = JSON.parse(await readFile(join(root, 'reports', 'walker', 'report.json'), 'utf8')).cases;
  return { status, output, drift: item.drift, error: item.error as string };
};

test('differences found before a network error still count', async () => {
  texts.port = 'broken';
  later.port = 'dead';
  const regressed = await walk();
  assert.match(regressed.output, /^the port regressed: walk \(1 of 1 case\)$/m);
  assert.doesNotMatch(regressed.output, /not checked:/);
  assert.deepEqual(regressed.drift, { original: 'matches', port: 'differs' });
  texts.port = 'same';
  texts.original = 'new';
  later.port = 'page';
  later.original = 'dead';
  const changed = await walk();
  assert.match(changed.output, /^the original changed: walk \(1 of 1 case\)$/m);
  assert.doesNotMatch(changed.output, /not checked:|regressed/);
  assert.deepEqual(changed.drift, { original: 'differs', port: 'matches' });
  assert.match(changed.error, /does not match its recording: step 1, .*"new".*; step 2 \(goto \/next\): .*ERR_CONNECTION_REFUSED/);
  later.port = 'failing';
  assert.match((await walk()).error, /; the port: step 2 \(goto \/next\): the page answered 500/);
});

test('a route that answers nothing is a difference', async () => {
  later.port = 'failing';
  assert.deepEqual((await walk()).drift, { original: 'matches', port: 'differs' });
  later.port = 'empty';
  const empty = await walk();
  assert.match(empty.output, /^the port regressed: walk \(1 of 1 case\)$/m);
  assert.deepEqual(empty.drift, { original: 'matches', port: 'differs' });
});

for (const [kind, words] of [
  ['dead', 'redirects to an address that refuses'],
  ['reset', 'resets the connection after the server has answered'],
  ['moved to hanging', 'redirects to an address that never answers'],
  ['stuck script', 'loads a page whose script never arrives'],
]) {
  test(`a route that ${words} differs, on either side`, async () => {
    later.port = kind;
    const port = await walk();
    assert.equal(port.status, 1, port.output);
    assert.deepEqual(port.drift, { original: 'matches', port: 'differs' });
    later.port = 'page';
    later.original = kind;
    assert.deepEqual((await walk()).drift, { original: 'differs', port: 'matches' });
  });
}

test('a route that never answers is not checked, on either side', async () => {
  later.port = 'hanging';
  const port = await walk();
  assert.equal(port.status, 1, port.output);
  assert.match(port.output, /^not checked: the port in walk \(1 of 1 case\)$/m);
  assert.deepEqual(port.drift, { original: 'matches', port: 'not checked' });
  later.port = 'page';
  later.original = 'hanging';
  const original = await walk();
  assert.match(original.output, /^not checked: the original in walk \(1 of 1 case\)$/m);
  assert.doesNotMatch(original.output, /changed|regressed/);
  assert.deepEqual(original.drift, { original: 'not checked', port: 'matches' });
  texts.original = 'new';
  assert.deepEqual((await walk()).drift, { original: 'differs', port: 'matches' });
});

test('a server that never answers or resets before it has answered is not checked', async () => {
  silent.original = true;
  const hanging = await drift();
  assert.equal(hanging.status, 1, hanging.output);
  assert.match(hanging.output, /^not checked: the original in home, other \(2 of 2 cases\)$/m);
  assert.doesNotMatch(hanging.output, /changed|regressed|no drift/);
  silent.original = false;
  const resetting = createTcp((socket) => socket.once('data', () => socket.resetAndDestroy()));
  await new Promise<void>((resolve) => resetting.listen(0, '127.0.0.1', resolve));
  closers.push(() => resetting.close());
  const reset = await drift(original, `http://127.0.0.1:${(resetting.address() as AddressInfo).port}`);
  assert.match(reset.output, /ERR_CONNECTION_RESET/);
  assert.match(reset.output, /^not checked: the port in home, other \(2 of 2 cases\)$/m);
  assert.doesNotMatch(reset.output, /changed|regressed|no drift/);
});

test('an unresolved name, an unreachable address and a timeout of the network are not checked, other errors differ', () => {
  for (const code of ['CONNECTION_REFUSED', 'CONNECTION_RESET', 'NAME_NOT_RESOLVED', 'ADDRESS_UNREACHABLE', 'TIMED_OUT']) {
    assert.ok(unreachable(`step 1 (goto /): page.goto: net::ERR_${code} at http://localhost/`), code);
  }
  for (const code of ['EMPTY_RESPONSE', 'ABORTED', 'TOO_MANY_REDIRECTS', 'CERT_AUTHORITY_INVALID']) {
    assert.ok(!unreachable(`step 1 (goto /): page.goto: net::ERR_${code} at http://localhost/`), code);
  }
  assert.ok(!unreachable('step 1 (goto /): the page answered 500'));
  assert.ok(!unreachable(undefined));
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

test('replay, gate and drift never print or store the query of --url or --original-url', async () => {
  texts.original = 'new';
  texts.port = 'broken';
  for (const command of ['replay', 'gate', 'drift']) {
    const { status, output } = await run(
      command, 'two', '--source', 'original', '--url', `${port}/?zqkey=zqport`, '--original-url', `${original}/?zqkey=zqoriginal`,
    );
    assert.equal(status, 1, output);
    const stored = await report();
    assert.deepEqual([stored.url, stored.original], [`${port}/`, `${original}/`]);
    const all = output + JSON.stringify(stored) + (await readFile(join(root, 'reports', 'original', 'summary.txt'), 'utf8'));
    assert.doesNotMatch(all, /zq/, command);
    assert.match(output, /does not match its recording/);
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
