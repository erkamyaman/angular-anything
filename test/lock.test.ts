import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkLock, sha256, writeLock } from '../src/lock.ts';
import type { Pins } from '../src/lock.ts';

const pins: Pins = { playwright: '1.65.1', browser: 'chromium 159.0.8154.6', case: sha256('the case') };

async function problemsAfter(change: (directory: string) => Promise<unknown>, now: Pins = pins): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'aa-lock-'));
  try {
    await writeFile(join(directory, '01.json'), '{"dom":{"tag":"body"}}\n');
    await writeFile(join(directory, '01.png'), Buffer.from([137, 80, 78, 71]));
    await writeFile(join(directory, 'recording.json'), '{"masked":[]}\n');
    await writeLock(directory, pins);
    await change(directory);
    return await checkLock(directory, now);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('an untouched recording matches its lock', async () => {
  assert.deepEqual(await problemsAfter(async () => {}), []);
  assert.deepEqual(await problemsAfter((directory) => writeFile(join(directory, '.DS_Store'), 'x')), []);
});

test('the lock holds a SHA-256 per file, a root hash and the versions', async () => {
  await problemsAfter(async (directory) => {
    const lock = JSON.parse(await readFile(join(directory, 'lock.json'), 'utf8'));
    assert.deepEqual(Object.keys(lock), ['format', 'playwright', 'browser', 'case', 'files', 'root']);
    assert.deepEqual(lock.files, {
      '01.json': sha256('{"dom":{"tag":"body"}}\n'),
      '01.png': sha256(Buffer.from([137, 80, 78, 71])),
      'recording.json': sha256('{"masked":[]}\n'),
    });
    assert.match(lock.root, /^[0-9a-f]{64}$/);
    assert.equal(lock.playwright, '1.65.1');
    assert.equal(lock.browser, 'chromium 159.0.8154.6');
  });
});

test('one changed byte in a recorded file is detected', async () => {
  const problems = await problemsAfter(async (directory) => {
    const bytes = await readFile(join(directory, '01.json'));
    bytes[bytes.indexOf('b')] = 'B'.charCodeAt(0);
    await writeFile(join(directory, '01.json'), bytes);
  });
  assert.deepEqual(problems, ['01.json does not match its SHA-256 in lock.json']);

  const screenshot = await problemsAfter((directory) => writeFile(join(directory, '01.png'), Buffer.from([137, 80, 78, 72])));
  assert.deepEqual(screenshot, ['01.png does not match its SHA-256 in lock.json']);
});

test('a missing file, an added file and a missing lock are detected', async () => {
  assert.deepEqual(await problemsAfter((directory) => rm(join(directory, '01.png'))), ['01.png is missing']);
  assert.deepEqual(await problemsAfter((directory) => writeFile(join(directory, '02.json'), '{}')), [
    '02.json is not in lock.json',
  ]);
  assert.deepEqual(await problemsAfter((directory) => rm(join(directory, 'lock.json'))), [
    'no readable lock.json: record the case first',
  ]);
});

test('a lock in another format is refused', async () => {
  const problems = await problemsAfter(async (directory) => {
    const lock = JSON.parse(await readFile(join(directory, 'lock.json'), 'utf8'));
    await writeFile(join(directory, 'lock.json'), JSON.stringify({ ...lock, format: 'angular-anything/lock@1' }));
  });
  assert.deepEqual(problems, ['lock.json is not in the format angular-anything/lock@0']);
});

test('editing a file and its hash in the lock breaks the root hash', async () => {
  const problems = await problemsAfter(async (directory) => {
    await writeFile(join(directory, '01.json'), '{"dom":{"tag":"main"}}\n');
    const lock = JSON.parse(await readFile(join(directory, 'lock.json'), 'utf8'));
    lock.files['01.json'] = sha256('{"dom":{"tag":"main"}}\n');
    await writeFile(join(directory, 'lock.json'), JSON.stringify(lock));
  });
  assert.deepEqual(problems, ['the root hash in lock.json does not match its content']);
});

test('a recording is stale after the case, Playwright or the browser changed', async () => {
  assert.deepEqual(await problemsAfter(async () => {}, { ...pins, case: sha256('the case, edited') }), [
    'stale: case.json changed after the recording',
  ]);
  assert.deepEqual(await problemsAfter(async () => {}, { ...pins, playwright: '1.66.0' }), [
    'stale: recorded with Playwright 1.65.1 and chromium 159.0.8154.6, now running Playwright 1.66.0 and chromium 159.0.8154.6',
  ]);
  assert.deepEqual(await problemsAfter(async () => {}, { ...pins, browser: 'chromium 160.0.0.0' }), [
    'stale: recorded with Playwright 1.65.1 and chromium 159.0.8154.6, now running Playwright 1.65.1 and chromium 160.0.0.0',
  ]);
});

test('the pins are part of the root hash: edited together with their lock they still break it', async () => {
  for (const [field, value] of [
    ['playwright', '1.66.0'],
    ['browser', 'chromium 160.0.0.0'],
    ['case', sha256('the case, edited')],
  ] as const) {
    const edited = { ...pins, [field]: value };
    const problems = await problemsAfter(async (directory) => {
      const lock = JSON.parse(await readFile(join(directory, 'lock.json'), 'utf8'));
      await writeFile(join(directory, 'lock.json'), JSON.stringify({ ...lock, [field]: value }));
    }, edited);
    assert.deepEqual(problems, ['the root hash in lock.json does not match its content'], field);
  }
});

test('the root hash covers every file of the recording and no file that is not in the lock', async () => {
  const problems = await problemsAfter(async (directory) => {
    const lock = JSON.parse(await readFile(join(directory, 'lock.json'), 'utf8'));
    delete lock.files['01.png'];
    await writeFile(join(directory, 'lock.json'), JSON.stringify(lock));
  });
  assert.deepEqual(problems, ['01.png is not in lock.json', 'the root hash in lock.json does not match its content']);
});

test('a lock that is no object is refused by name', async () => {
  for (const text of ['null', '[]', '"lock"', '7']) {
    const problems = await problemsAfter((directory) => writeFile(join(directory, 'lock.json'), text));
    assert.deepEqual(problems, ['lock.json is not in the format angular-anything/lock@0'], text);
  }
});
