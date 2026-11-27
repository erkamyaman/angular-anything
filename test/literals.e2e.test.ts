import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const texts = ['Call the bank', 'Water the plants', 'Buy more milk'];
const page = `<!doctype html><html lang="en"><head><title>Lit</title></head><body><main>${texts.map((text) => `<p>${text}</p>`).join('')}</main></body></html>`;

let root: string;
let url: string;
let close: () => void;

function run(...args: string[]): Promise<{ status: number | string; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ status: error ? (error.code ?? 'killed') : 0, output: stdout + stderr });
    });
  });
}

const gate = (...more: string[]) => run('gate', 'lit', '--source', 'original', '--url', url, ...more);
const sources = (port: string) => ['--original-source', 'original', '--port-source', port];
const report = async () => JSON.parse(await readFile(join(root, 'reports', 'original', 'report.json'), 'utf8'));

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-lit-'));
  const put = async (file: string, content: string) => {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), content);
  };
  await put('cases/lit/home/case.json', JSON.stringify({ format: 'angular-anything/case@1', id: 'home', viewport: { width: 400, height: 300 }, steps: [{ action: 'goto', path: '/' }] }));
  await put('original/app.js', 'render(await load());');
  await put('honest/app.ts', 'render(await load());');
  await put('few/app.ts', `const a = '${texts[0]}';`);
  await put('cheat/app.ts', texts.map((text, at) => `const v${at} = '${text}';`).join('\n'));
  await put('reader/app.ts', "import tape from './tape.json';");
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
  const recorded = await run('record', 'lit', '--source', 'original', '--url', url);
  assert.equal(recorded.status, 0, recorded.output);
});

after(async () => {
  close();
  await rm(root, { recursive: true, force: true });
});

test('without the two source folders nothing is checked, with an honest port the gate passes', async () => {
  const without = await gate();
  assert.equal(without.status, 0, without.output);
  assert.doesNotMatch(without.output, /literal/);
  assert.equal((await report()).literals, undefined);
  const honest = await gate(...sources('honest'));
  assert.equal(honest.status, 0, honest.output);
  assert.doesNotMatch(honest.output, /^(FAIL|note:)/m);
  assert.deepEqual((await report()).literals, { result: 'pass', found: [], named: [] });
});

test('one recorded literal is noted and the gate passes', async () => {
  const { status, output } = await gate(...sources('few'));
  assert.equal(status, 0, output);
  assert.match(output, /^note: recorded literals in the port: 1 equals recorded values and is not in the original source \(3 fail the gate\)$/m);
  assert.match(output, /^ {6}app\.ts:1: "Call the bank"$/m);
});

test('three recorded literals fail the gate although every case passes', async () => {
  const { status, output } = await gate(...sources('cheat'));
  assert.equal(status, 1, output);
  assert.match(output, /^angular-anything gate: FAIL$/m);
  assert.match(output, /^PASS {2}home/m);
  assert.match(output, /^FAIL {2}recorded literals in the port: 3 equal recorded values and are not in the original source$/m);
  assert.match(output, /^ {6}app\.ts:3: "Buy more milk"$/m);
  assert.match(output, /recorded-literal: reason/);
  assert.equal((await report()).literals.result, 'fail');
  assert.match(await readFile(join(root, 'reports', 'original', 'summary.txt'), 'utf8'), /^FAIL {2}recorded literals/m);
});

test('a port that names a recording file fails the gate', async () => {
  const { status, output } = await gate(...sources('reader'));
  assert.equal(status, 1, output);
  assert.match(output, /^FAIL {2}the port source names recording files$/m);
  assert.match(output, /^ {6}app\.ts:1: tape\.json$/m);
});

test('--redact shows the literals as shapes', async () => {
  const { status, output } = await gate(...sources('cheat'), '--redact');
  assert.equal(status, 1, output);
  assert.match(output, /^ {6}app\.ts:1: "string, length 13, hash [0-9a-f]{8}"$/m);
  const all = output + (await readFile(join(root, 'reports', 'original', 'report.json'), 'utf8'));
  for (const text of texts) assert.ok(!all.includes(text), all);
});

test('both source folders are given or neither, only to gate, and they have to exist', async () => {
  for (const [args, message] of [
    [['--original-source', 'original'], 'give both --original-source and --port-source, or neither'],
    [['--port-source', 'honest'], 'give both --original-source and --port-source, or neither'],
    [[...sources('nowhere')], '--port-source'],
    [[...sources('honest'), '--port-source', 'few'], '--port-source is given twice'],
    [[...sources('honest'), '--original-source', 'few'], '--original-source is given twice'],
    [['--original-source', '.', '--port-source', 'honest'], '--original-source'],
  ] as const) {
    const result = await gate(...args);
    assert.equal(result.status, 2, result.output);
    assert.ok(result.output.startsWith(message), result.output);
  }
  for (const command of ['replay', 'record', 'drift']) {
    const result = await run(command, 'lit', '--source', 'original', '--url', url, '--original-url', url, ...sources('honest'));
    assert.equal(result.status, 2, result.output);
  }
  const replayed = await run('replay', 'lit', '--source', 'original', '--url', url, ...sources('honest'));
  assert.match(replayed.output, /^only gate takes --original-source and --port-source/);
});
