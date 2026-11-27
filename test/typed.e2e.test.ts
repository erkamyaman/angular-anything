import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const typed = 'fake-typed-value-5281';
const keyed = 'fakekey5281';
const token = ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJmYWtlIn0', 'ZmFrZXNpZ25hdHVyZQ'].join('.');

const doc = (body: string, script = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Typed</title></head><body><main>${body}</main><script>
const bug = new URLSearchParams(location.search).get('bug');
const $ = (id) => document.getElementById(id);
${script}
</script></body></html>`;

const pages: Record<string, string> = {
  '/echo': doc(
    `<label>Name <input id="name"></label><button id="go">Go</button><p id="out">-</p>`,
    `$('go').addEventListener('click', () => {
  $('out').textContent = bug === 'text' ? 'got ' + $('name').value + '!' : 'got ' + $('name').value;
  if (bug === 'rename') $('go').textContent = $('name').value;
  if (bug === 'send') fetch('/api/' + $('name').value, { method: 'POST' });
});`,
  ),
  '/stored': doc(
    `<label>Name <input id="name"></label><button id="go">Go</button>`,
    `$('go').addEventListener('click', () => {
  localStorage.setItem($('name').value, bug === 'token' ? '${token}' : String(Math.random()));
});`,
  ),
  '/named': doc(
    `<label>Name <input id="name"></label><div id="list"></div>`,
    `$('name').addEventListener('input', () => {
  const buttons = bug === 'two' ? [$('name').value, $('name').value] : [$('name').value];
  $('list').replaceChildren(...buttons.map((text) => Object.assign(document.createElement('button'), { textContent: text })));
});`,
  ),
  '/leave': doc(`<form action="/never"><label>Query <input name="q"></label></form>`),
};

let root: string;
let url: string;
let server: Server;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-typed-'));
  server = createServer((request, response) => {
    request.resume();
    const { pathname } = new URL(request.url!, 'http://localhost');
    if (pathname === '/never') return;
    if (pathname.startsWith('/api/')) return void response.writeHead(200, { 'content-type': 'application/json' }).end('1');
    if (pages[pathname] === undefined) return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pages[pathname]);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  server.closeAllConnections();
  await rm(root, { recursive: true, force: true });
});

type Raw = Record<string, unknown>;
const fill = (name: string, value = typed): Raw => ({ action: 'fill', target: { role: 'textbox', name }, value });
const click = (name: string, role = 'button'): Raw => ({ action: 'click', target: { role, name } });
const press = (name: string, key: string): Raw => ({ action: 'press', target: { role: 'textbox', name }, key });

async function suite(name: string, path: string, steps: Raw[], extra: Raw = {}) {
  const folder = join(root, 'cases', name, name);
  await mkdir(folder, { recursive: true });
  const testCase = { format: 'angular-anything/case@1', id: name, viewport: { width: 800, height: 600 }, steps: [{ action: 'goto', path }, ...steps], ...extra };
  await writeFile(join(folder, 'case.json'), JSON.stringify(testCase));
}

function run(...args: string[]): Promise<{ status: number | string; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ status: error ? (error.code ?? 'killed') : 0, output: stdout + stderr });
    });
  });
}

const record = (name: string, address = url) => run('record', name, '--source', name, '--url', address);

function clean(output: string) {
  for (const value of [typed, keyed, 'fake-typ']) assert.ok(!output.toLowerCase().includes(value), output);
}

async function failed(name: string, expected: RegExp) {
  const result = await record(name);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, expected);
  clean(result.output);
}

test('record prints no typed value when a target matches nothing or two elements', async () => {
  await suite('none', '/echo', [fill('Missing')]);
  await failed('none', /step 2 \(fill textbox "Missing"\): the target matches 0 elements/);
  await suite('two', '/named?bug=two', [fill('Name'), click(typed)]);
  await failed('two', /step 3 \(click button "\[typed\]"\): the target matches 2 elements/);
  await suite('listed', '/named', [fill('Name'), click('Absent')]);
  await failed('listed', /step 3 \(click button "Absent"\): the target matches 0 elements, the button elements here: "\[typed\]"/);
});

test('record prints no typed key that Playwright names in its own message', async () => {
  await suite('key', '/echo', [press('Name', keyed)]);
  await failed('key', /step 2 \(press a typed key on textbox "Name"\): .*Unknown key$/m);
  await suite('letter', '/echo', [press('Name', 'é€')]);
  const result = await record('letter');
  assert.equal(result.status, 1, result.output);
  assert.ok(!result.output.includes('é€'), result.output);
});

test('record prints no typed value of a navigation that does not load', async () => {
  await suite('leave', '/leave', [fill('Query'), press('Query', 'Enter')]);
  await failed('leave', /step 3 \(press Enter on textbox "Query"\): .*the navigation to \/never had not loaded$/m);
});

test('gate, replay and drift print and write no typed value when the port shows it differently', { timeout: 120_000 }, async () => {
  await suite('echo', '/echo', [fill('Name'), click('Go')]);
  const recorded = await record('echo');
  assert.equal(recorded.status, 0, recorded.output);
  clean(recorded.output);
  const report = async () => {
    for (const file of ['summary.txt', 'report.json']) clean(await readFile(join(root, 'reports', 'echo', file), 'utf8'));
  };
  for (const bug of ['text', 'rename', 'send']) {
    for (const args of [['gate'], ['replay'], ['drift', '--original-url', url], ['gate', '--original-url', `${url}/?bug=text`]]) {
      const [command, ...rest] = args;
      const result = await run(command, 'echo', '--source', 'echo', '--url', `${url}/?bug=${bug}`, ...rest);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /\[typed\]/);
      clean(result.output);
      await report();
    }
  }
});

test('gate and replay print no typed value when a step fails on the port', async () => {
  await suite('port', '/named', [fill('Name'), click(typed)]);
  const recorded = await record('port');
  assert.equal(recorded.status, 0, recorded.output);
  clean(recorded.output);
  for (const command of ['gate', 'replay']) {
    const result = await run(command, 'port', '--source', 'port', '--url', `${url}/?bug=two`);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /error: step 3 \(click button "\[typed\]"\): the target matches 2 elements/);
    clean(result.output);
    clean(await readFile(join(root, 'reports', 'port', 'report.json'), 'utf8'));
  }
});

test('the lines of record about noise and about a detected secret hold no typed value', async () => {
  const steps = [fill('Name'), click('Go')];
  const noise = [{ layer: 'effects', path: `storage["${typed}"]` }];
  await suite('noisy', '/stored', steps, { noise });
  const noisy = await record('noisy');
  assert.equal(noisy.status, 0, noisy.output);
  assert.match(noisy.output, /noise effects storage\["\[typed\]"\]: \d+ values masked/);
  clean(noisy.output);
  await suite('token', '/stored?bug=token', steps);
  await failed('token', /refused, a detected secret:\n.*storage\["\[typed\]"\]: jwt/);
});

test('a broken recording is refused without its text', async () => {
  await suite('broken', '/echo', [fill('Name'), click('Go')]);
  const recorded = await record('broken');
  assert.equal(recorded.status, 0, recorded.output);
  await writeFile(join(root, 'recordings', 'broken', 'broken', '01.json'), `{"value": ${typed}}`);
  const result = await run('replay', 'broken', '--source', 'broken', '--url', url);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /error: cannot replay against the recording: a file of it is not valid JSON/);
  clean(result.output);
});
