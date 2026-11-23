import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

test('an unknown command prints the usage and exits 2', () => {
  const result = spawnSync(process.execPath, [cli, 'nope'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^Usage: angular-anything <command>/);
});

test('an option given twice is a usage error and nothing is replayed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aa-cli-'));
  try {
    for (const [args, message] of [
      [['gate', 'tiny', '--source', 'a', '--source', 'b', '--url', 'http://localhost:1'], '--source is given twice'],
      [['gate', 'tiny', '--source', 'a', '--url', 'http://localhost:1', '--url', 'http://localhost:2'], '--url is given twice'],
      [['record', 'tiny', '--source', 'a', '--source', 'a', '--url', 'http://localhost:1'], '--source is given twice'],
    ] as const) {
      const result = run(root, ...args);
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.ok(result.stderr.startsWith(`${message}\n`), result.stderr);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a gate or replay that stops at the command line leaves no report of an earlier run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aa-cli-'));
  const exists = (file: string) => access(file).then(() => true, () => false);
  try {
    for (const args of [
      ['gate', 'tiny', '--source', 'kept'],
      ['replay', 'tiny', '--source', 'kept', '--url', 'http://localhost:1/app/'],
      ['gate', 'tiny', 'extra', '--source', 'kept', '--url', 'http://localhost:1'],
      ['gate', 'tiny', '--source', 'kept', '--url', 'http://localhost:1', '--strict'],
      ['gate', 'tiny', '--source', 'kept', '--source', 'again', '--url', 'http://localhost:1'],
    ]) {
      const report = join(root, 'reports', 'kept', 'report.json');
      await mkdir(join(root, 'reports', 'kept'), { recursive: true });
      await writeFile(report, '{"result":"pass"}');
      const result = run(root, ...args);
      assert.equal(result.status, 2, `${args.join(' ')}\n${result.stdout}${result.stderr}`);
      assert.equal(await exists(report), false, args.join(' '));
    }
    await mkdir(join(root, 'reports', 'other'), { recursive: true });
    await writeFile(join(root, 'reports', 'other', 'report.json'), '{}');
    assert.equal(run(root, 'gate', 'tiny', '--source', 'kept').status, 2);
    assert.equal(await exists(join(root, 'reports', 'other', 'report.json')), true);
    assert.equal(run(root, 'record', 'tiny', '--source', 'other').status, 2);
    assert.equal(await exists(join(root, 'reports', 'other', 'report.json')), true, 'record does not touch reports');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
