import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('an unknown command prints the usage and exits 2', () => {
  const result = spawnSync(process.execPath, [cli, 'nope'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^Usage: angular-anything <command>/);
});
