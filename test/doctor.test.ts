import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { doctor, PLAYWRIGHT_VERSION } from '../src/doctor.ts';
import type { Found } from '../src/doctor.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const good: Found = {
  node: '24.15.0',
  playwright: PLAYWRIGHT_VERSION,
  launch: async () => ({ title: 'doctor', version: '159.0.8154.6' }),
};

async function check(found: Found) {
  const lines: string[] = [];
  const code = await doctor(found, (line) => lines.push(line));
  return { code, lines };
}

test('doctor exits 0 when Node, Playwright and Chromium are what it needs', async () => {
  const { code, lines } = await check(good);
  assert.equal(code, 0);
  assert.deepEqual(lines, [
    'ok    Node 24.15.0 (needs 24 or newer)',
    'ok    Playwright 1.65.1 (needs exactly 1.65.1)',
    'ok    Chromium 159.0.8154.6 launches headless and loads a page',
  ]);
});

test('doctor exits 1 for an old Node, another Playwright, a browser that does not launch and a page that does not load', async () => {
  const old = await check({ ...good, node: '22.9.0' });
  assert.equal(old.code, 1);
  assert.equal(old.lines[0], 'FAIL  Node 22.9.0 (needs 24 or newer)');

  const other = await check({ ...good, playwright: '1.66.0' });
  assert.equal(other.code, 1);
  assert.equal(other.lines[1], 'FAIL  Playwright 1.66.0 (needs exactly 1.65.1)');

  const missing = await check({
    ...good,
    launch: async () => {
      throw new Error("Executable doesn't exist\nmore");
    },
  });
  assert.equal(missing.code, 1);
  assert.deepEqual(missing.lines.slice(2), [
    "FAIL  Chromium does not launch: Error: Executable doesn't exist",
    `      Run: node "${join(dirname(createRequire(import.meta.url).resolve('playwright/package.json')), 'cli.js')}" install chromium`,
  ]);

  const blank = await check({ ...good, launch: async () => ({ title: '', version: '159' }) });
  assert.equal(blank.code, 1);
  assert.match(blank.lines[2], /^FAIL {2}Chromium 159 launches/);
});

test('the command exits 0 with the real browser and 1 when Playwright has no browser', async () => {
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8', env: { ...process.env, ...env } });
  const fine = run({});
  assert.equal(fine.status, 0, fine.stdout + fine.stderr);
  assert.match(fine.stdout, /^ok {4}Chromium \d+\./m);

  const empty = await mkdtemp(join(tmpdir(), 'aa-doctor-'));
  try {
    const none = run({ PLAYWRIGHT_BROWSERS_PATH: empty });
    assert.equal(none.status, 1, none.stdout + none.stderr);
    assert.match(none.stdout, /^FAIL {2}Chromium does not launch/m);
    const [, installer] = /^ {6}Run: node "(.+)" install chromium$/m.exec(none.stdout)!;
    const listed = spawnSync(process.execPath, [installer, 'install', '--dry-run', 'chromium'], { cwd: empty, encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stdout + listed.stderr);
    assert.match(listed.stdout, /chromium/i);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});
