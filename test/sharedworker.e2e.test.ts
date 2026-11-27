import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { blockSharedWorker, SHARED_MARK } from '../src/page.ts';
import { launchBrowser } from '../src/run.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const body = (kind: string) => `
const here = self.location.origin;
fetch(here + '/api/worker-${kind}', { method: 'POST', body: 'x' });
new WebSocket(here.replace('http', 'ws') + '/socket-${kind}');
`;

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shared</title></head><body><main><button id="go">Go</button><p id="out">-</p></main><script>
const v = new URLSearchParams(location.search).get('v') ?? '';
const script = (kind) => location.origin + '/worker.js?kind=' + kind;
const blob = () => URL.createObjectURL(new Blob([\`
fetch('\${location.origin}/api/worker-blob', { method: 'POST', body: 'x' });
new WebSocket('\${location.origin.replace('http', 'ws')}/socket-blob');
\`], { type: 'text/javascript' }));
const start = (from, url) => {
  try {
    new from.SharedWorker(url).port.start();
  } catch {}
};
const frame = () => document.body.appendChild(Object.assign(document.createElement('iframe'), { hidden: true }));
const kinds = {
  url: () => start(window, script('url')),
  blob: () => start(window, blob()),
  frame: () => { const it = frame(); start(it.contentWindow, script('frame')); it.remove(); },
  loaded: () => { const it = frame(); it.onload = () => start(it.contentWindow, script('loaded')); it.src = '/inner'; },
  popup: () => { const it = window.open(''); start(it, script('popup')); },
  closing: () => { const it = window.open(''); start(it, blob()); it.close(); },
  inside: () => { window.open('/popup-page'); },
  cross: () => { const it = frame(); it.src = location.origin.replace('127.0.0.1', 'localhost') + '/popup-page'; },
  sandbox: () => { const it = document.createElement('iframe'); it.sandbox = 'allow-scripts'; it.hidden = true; it.src = '/popup-page'; document.body.append(it); },
  reload: () => location.reload(),
  deleted: () => { delete window.SharedWorker; start(window, script('deleted')); },
  borrowed: () => { delete window.SharedWorker; const it = frame(); start(it.contentWindow, script('borrowed')); },
};
if (v === 'reload') addEventListener('pagehide', () => start(window, script('reload')));
document.getElementById('go').addEventListener('click', () => {
  kinds[v]?.();
  document.getElementById('out').textContent = 'done';
});
</script></body></html>`;

const inner = `<!doctype html><title>Inner</title>`;
const popupPage = `<!doctype html><title>Popup</title><script>new SharedWorker(new URL('/worker.js?kind=inside', location.href));</script>`;

let root: string;
let url: string;
let server: Server;
let reached: string[] = [];
let served = 0;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-shared-'));
  server = createServer((request, response) => {
    request.resume();
    const { pathname, searchParams } = new URL(request.url!, 'http://localhost');
    if (pathname === '/worker.js') {
      reached.push(`GET ${request.url}`);
      return void response.writeHead(200, { 'content-type': 'text/javascript' }).end(body(searchParams.get('kind')!));
    }
    if (pathname.startsWith('/api/')) {
      reached.push(`${request.method} ${pathname}`);
      return void response.writeHead(200, { 'content-type': 'application/json' }).end('1');
    }
    if (pathname === '/once' && ++served > 1) return void response.writeHead(404).end();
    const html = pathname === '/' || pathname === '/once' ? page : pathname === '/inner' ? inner : pathname === '/popup-page' ? popupPage : undefined;
    if (html === undefined) return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  server.on('upgrade', (request, socket) => {
    reached.push(`UPGRADE ${request.url}`);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await suite('clean');
});

after(async () => {
  server.close();
  server.closeAllConnections();
  await rm(root, { recursive: true, force: true });
});

async function suite(name: string, query = '') {
  const folder = join(root, 'cases', name, name);
  await mkdir(folder, { recursive: true });
  const testCase = {
    format: 'angular-anything/case@1',
    id: name,
    viewport: { width: 800, height: 600 },
    steps: [{ action: 'goto', path: `/${query}` }, { action: 'click', target: { role: 'button', name: 'Go' } }, { action: 'advance', frames: 5 }],
  };
  await writeFile(join(folder, 'case.json'), JSON.stringify(testCase));
}

function run(...args: string[]): Promise<{ status: number | string; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ status: error ? (error.code ?? 'killed') : 0, output: stdout + stderr });
    });
  });
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const settled = () => new Promise((resolve) => setTimeout(resolve, 500));

const named: Record<string, string> = {
  url: '/worker.js',
  blob: 'blob:',
  frame: '/worker.js',
  loaded: '/worker.js',
  popup: '/worker.js',
  closing: 'blob:',
  cross: '/worker.js',
  sandbox: '/worker.js',
  reload: '/worker.js',
};

for (const [kind, name] of Object.entries(named)) {
  test(`record refuses a SharedWorker (${kind}) by name, and nothing of it reaches the server`, async () => {
    await suite(kind, `?v=${kind}`);
    reached = [];
    const result = await run('record', kind, '--source', kind, '--url', url);
    await settled();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, new RegExp(`^ {6}step 2, the page uses a SharedWorker: (http://localhost:\\d+)?${name.replaceAll('.', '\\.')}$`, 'm'));
    assert.equal(result.output.split('uses a SharedWorker').length, 2, result.output);
    assert.equal(await exists(join(root, 'recordings', kind, kind)), false);
    assert.deepEqual(reached, []);
  });
}

test('gate and replay fail a port that uses a SharedWorker, and nothing of it reaches the server', { timeout: 120_000 }, async () => {
  const recorded = await run('record', 'clean', '--source', 'clean', '--url', url);
  assert.equal(recorded.status, 0, recorded.output);
  assert.equal((await run('gate', 'clean', '--source', 'clean', '--url', url)).status, 0);
  for (const [kind, name] of Object.entries(named)) {
    for (const command of ['gate', 'replay']) {
      reached = [];
      const result = await run(command, 'clean', '--source', 'clean', '--url', `${url}/?v=${kind}`);
      await settled();
      assert.equal(result.status, 1, `${kind}\n${result.output}`);
      assert.match(result.output, new RegExp(`tape SharedWorker (http://localhost:\\d+)?${name.replaceAll('.', '\\.')}`), `${kind}\n${result.output}`);
      assert.match(result.output, /the page started a SharedWorker/, kind);
      assert.deepEqual(reached, [], kind);
    }
  }
  const redacted = await run('gate', 'clean', '--source', 'clean', '--url', `${url}/?v=url`, '--redact');
  assert.equal(redacted.status, 1, redacted.output);
  assert.match(redacted.output, /tape SharedWorker <[0-9a-f]{8}>/);
  assert.ok(!redacted.output.includes('worker.js'), redacted.output);
});

test('a port that deletes the constructor, borrows it from a frame or opens another page reaches no server', { timeout: 120_000 }, async () => {
  for (const kind of ['inside', 'deleted', 'borrowed']) {
    reached = [];
    const result = await run('gate', 'clean', '--source', 'clean', '--url', `${url}/?v=${kind}`);
    await settled();
    assert.deepEqual(reached, [], `${kind}\n${result.output}`);
    if (kind !== 'inside') assert.match(result.output, /the page started a SharedWorker/, `${kind}\n${result.output}`);
  }
});

test('the browser of record and gate has no SharedWorker of its own, so none can reach a server', async () => {
  const browser = await launchBrowser();
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(url);
    reached = [];
    const found = await page.evaluate(() => {
      const it = document.body.appendChild(document.createElement('iframe'));
      const popup = window.open('')!;
      return [window, it.contentWindow!, popup].map((each) => typeof (each as unknown as { SharedWorker?: unknown }).SharedWorker);
    });
    assert.deepEqual(found, ['undefined', 'undefined', 'undefined']);
  } finally {
    await browser.close();
  }
});

test('a SharedWorker started as a page is left is refused although the step then fails', async () => {
  await suite('once');
  const file = join(root, 'cases', 'once', 'once', 'case.json');
  const testCase = JSON.parse(await readFile(file, 'utf8'));
  testCase.steps = [{ action: 'goto', path: '/once?v=reload' }, { action: 'reload' }];
  await writeFile(file, JSON.stringify(testCase));
  served = 0;
  reached = [];
  const result = await run('record', 'once', '--source', 'once', '--url', url);
  await settled();
  assert.match(result.output, /^ {6}step 2, the page uses a SharedWorker: \/worker\.js$/m);
  assert.deepEqual(reached, []);
});

test('the constructor that stands in throws a SecurityError and stays when the page deletes it', async () => {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext();
    await context.addInitScript(blockSharedWorker, SHARED_MARK);
    const page = await context.newPage();
    await page.goto(url);
    const found = await page.evaluate(() => {
      const each = window as unknown as { SharedWorker?: new (url: string) => unknown };
      const deleted = Reflect.deleteProperty(each, 'SharedWorker');
      try {
        new each.SharedWorker!('/worker.js');
        return [deleted, 'built'];
      } catch (error) {
        return [deleted, (error as Error).name];
      }
    });
    assert.deepEqual(found, [false, 'SecurityError']);
  } finally {
    await browser.close();
  }
});
