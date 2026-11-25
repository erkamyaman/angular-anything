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

const page = (height: string) => `<!doctype html><title>m</title><main><div id="box">box</div></main>
<style>#box { position: absolute; height: var(--measured); }</style>
<script>document.documentElement.style.setProperty('--measured', '${height}');</script>`;

const measured = ['height', 'block-size'].map((property) => ({
  layer: 'style',
  path: `html[1]/body[1]/main[1]/div[1].style.${property}`,
}));

let root: string;
let server: Server;
let url: string;

const run = (...args: string[]): Promise<{ status: number | string; output: string }> =>
  new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ status: error ? (error.code ?? 'killed') : 0, output: stdout + stderr });
    });
  });

const suite = async (name: string, extra: object) => {
  await mkdir(join(root, 'cases', name, name), { recursive: true });
  const testCase = {
    format: 'angular-anything/case@1',
    id: name,
    viewport: { width: 400, height: 300 },
    steps: [{ action: 'goto', path: '/' }],
    ...extra,
  };
  await writeFile(join(root, 'cases', name, name, 'case.json'), JSON.stringify(testCase));
};

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-measured-'));
  server = createServer((request, response) => {
    const height = new URL(request.url!, 'http://localhost').searchParams.get('height') ?? '40px';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(height));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await suite('plain', {});
  await suite('listed', { measured });
  await suite('stray', { measured: [{ layer: 'style', path: 'html[1]/body[1]/p[1].style.height' }] });
});

after(async () => {
  server.close();
  await rm(root, { recursive: true, force: true });
});

test('a size that a page writes into another property fails a gate until the case lists it', async () => {
  assert.equal((await run('record', 'plain', '--source', 'plain', '--url', url)).status, 0);
  assert.equal((await run('gate', 'plain', '--source', 'plain', '--url', `${url}/?height=50px`)).status, 1);

  assert.equal((await run('record', 'listed', '--source', 'listed', '--url', url)).status, 0);
  const stored = await readFile(join(root, 'recordings', 'listed', 'listed', '01.json'), 'utf8');
  assert.equal(stored.includes('40px'), false);
  const anywhere = await run('gate', 'listed', '--source', 'listed', '--url', `${url}/?height=50px`);
  assert.equal(anywhere.status, 0, anywhere.output);
  const session = await run('gate', 'listed', '--source', 'listed', '--url', `${url}/?height=50px`, '--original-url', url);
  assert.equal(session.status, 1, session.output);
  const report = await readFile(join(root, 'reports', 'listed', 'report.json'), 'utf8');
  assert.match(report, /div\[1\]\.layout\.height/);
  const same = await run('gate', 'listed', '--source', 'listed', '--url', url, '--original-url', url);
  assert.equal(same.status, 0, same.output);
});

test('record fails on a measured entry that matches nothing', async () => {
  const result = await run('record', 'stray', '--source', 'stray', '--url', url);
  assert.equal(result.status, 1);
  assert.match(result.output, /the measured entry style .*p\[1\].* matches nothing in any step/);
});
