import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeStep, loadSuite, parseCase, UsageError } from '../src/case.ts';

const target = { role: 'textbox', name: 'New task' };
const valid = {
  format: 'angular-anything/case@1',
  id: 'every-step',
  description: 'One step of every kind',
  viewport: { width: 1024, height: 768 },
  steps: [
    { action: 'goto', path: '/' },
    { action: 'fill', target, value: 'Call mom' },
    { action: 'press', target, key: 'Enter' },
    { action: 'click', target: { role: 'button', name: 'Add' } },
    { action: 'check', target: { role: 'checkbox', name: 'Buy milk' } },
    { action: 'uncheck', target: { role: 'checkbox', name: 'Buy milk' } },
    { action: 'reload' },
    { action: 'advance', frames: 150 },
    { action: 'hover', target: { role: 'listitem', index: 2 } },
    { action: 'dblclick', target: { role: 'listitem', index: 1 } },
    { action: 'click', target: { role: 'button', name: 'Delete', within: { role: 'listitem', index: 2 } } },
    { action: 'check', target: { role: 'checkbox', within: { role: 'list', name: 'Tasks' } } },
  ],
};

const parse = (change: (data: typeof valid & Record<string, unknown>) => void) => {
  const data = structuredClone(valid);
  change(data);
  return parseCase(JSON.stringify(data), 'every-step');
};

test('a case with every kind of step is accepted and described', () => {
  const parsed = parse(() => {});
  assert.deepEqual(parsed, valid);
  assert.deepEqual(parsed.steps.map(describeStep), [
    'goto /',
    'fill textbox "New task"',
    'press Enter on textbox "New task"',
    'click button "Add"',
    'check checkbox "Buy milk"',
    'uncheck checkbox "Buy milk"',
    'reload',
    'advance 150 frames',
    'hover listitem #2',
    'dblclick listitem #1',
    'click button "Delete" in listitem #2',
    'check checkbox in list "Tasks"',
  ]);
});

test('a broken case is rejected with the reason', () => {
  const broken: [(data: Record<string, any>) => void, RegExp][] = [
    [(data) => (data.format = 'angular-anything/case@0'), /"format" must be "angular-anything\/case@1"/],
    [(data) => (data.id = 'other'), /"id" must be "every-step", the name of its folder/],
    [(data) => delete data.viewport, /"viewport" needs a "width" and a "height"/],
    [(data) => (data.viewport.width = 0), /"viewport" needs a "width" and a "height"/],
    [(data) => (data.steps = []), /"steps" must hold at least one step/],
    [(data) => data.steps.shift(), /step 1 must be a "goto"/],
    [(data) => (data.steps[0].path = 'index.html'), /step 1 needs a "path" that starts with \//],
    [(data) => (data.steps[0].path = '//example.com/'), /step 1 needs a "path" that starts with \/ and stays on the page/],
    [(data) => (data.steps[0].path = '/\\example.com/'), /step 1 needs a "path" that starts with \/ and stays on the page/],
    [(data) => (data.steps[1].target = { name: 'New task' }), /step 2 needs a "target": a "role", and as needed a "name", an "index" from 1 and a "within" target/],
    [(data) => (data.steps[1].target = '#new-task'), /step 2 needs a "target": a "role"/],
    [(data) => (data.steps[1].target = { role: 'textbox', name: '' }), /step 2 needs a "target": a "role"/],
    [(data) => (data.steps[1].target = { role: 'textbox', index: 0 }), /step 2 needs a "target": a "role"/],
    [(data) => (data.steps[1].target = { role: 'textbox', index: 1.5 }), /step 2 needs a "target": a "role"/],
    [(data) => (data.steps[1].target = { role: 'textbox', within: 'form' }), /step 2 needs a "target": a "role"/],
    [(data) => (data.steps[1].target = { role: 'textbox', within: { role: 'form', nth: 1 } }), /step 2 needs a "target": a "role"/],
    [(data) => (data.steps[1].target = { role: 'textbox', nth: 1 }), /step 2 needs a "target": a "role"/],
    [(data) => delete data.steps[8].target, /step 9 needs a "target": a "role"/],
    [(data) => delete data.steps[9].target, /step 10 needs a "target": a "role"/],
    [(data) => delete data.steps[1].value, /step 2 needs a string "value"/],
    [(data) => delete data.steps[2].key, /step 3 needs a "key"/],
    [(data) => delete data.steps[2].target, /step 3 needs a "target": a "role"/],
    [(data) => (data.steps[3].action = 'tap'), /step 4 has the unknown action "tap"/],
    [(data) => (data.steps[7].frames = 0), /step 8 needs "frames", a whole number above 0/],
    [(data) => (data.steps[7].frames = 1.5), /step 8 needs "frames", a whole number above 0/],
    [(data) => delete data.steps[7].frames, /step 8 needs "frames", a whole number above 0/],
    [
      (data) => (data.steps[7] = { action: 'advance', ms: 2500 }),
      /step 8 takes "frames" and no "ms": one frame is 16 ms, so 2500 ms are 157 frames/,
    ],
    [
      (data) => (data.steps[7] = { action: 'advance', ms: 2000, frames: 125 }),
      /step 8 takes "frames" and no "ms": one frame is 16 ms, so 2000 ms are 125 frames/,
    ],
    [(data) => (data.steps[7] = { action: 'advance', ms: 0 }), /step 8 takes "frames" and no "ms": one frame is 16 ms$/],
    [(data) => (data.steps[7] = { action: 'advance', ms: -5 }), /step 8 takes "frames" and no "ms": one frame is 16 ms$/],
    [(data) => (data.steps[7] = { action: 'advance', ms: 'abc' }), /step 8 takes "frames" and no "ms": one frame is 16 ms$/],
    [(data) => (data.steps[7] = { action: 'advance', ms: null }), /step 8 takes "frames" and no "ms": one frame is 16 ms$/],
  ];
  for (const [change, message] of broken) assert.throws(() => parse(change), message);
  assert.throws(() => parseCase('[]', 'every-step'), /the case is not an object/);
});

test('the fixture suite loads: nineteen valid cases in the order of their ids', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const cases = await loadSuite(root, 'fixture');
  assert.deepEqual(
    cases.map((loaded) => loaded.case.id),
    [
      'add-empty',
      'add-reload',
      'add-task',
      'add-twice',
      'add-under-done-filter',
      'delete-reload',
      'delete-task',
      'details',
      'details-reload',
      'enter-key',
      'filter-reselect',
      'filter-tabs',
      'id-after-delete',
      'initial-render',
      'load-suggestions',
      'load-twice',
      'toggle-task',
      'toggle-under-filter',
      'trim-title',
    ],
  );
  for (const loaded of cases) assert.match(loaded.sha256, /^[0-9a-f]{64}$/);
  await assert.rejects(loadSuite(root, 'no-such-suite'), UsageError);
  await assert.rejects(loadSuite(root, '../cases'), UsageError);
});

test('a case folder that is a symbolic link is refused by name', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aa-case-'));
  try {
    const body = JSON.stringify({ ...valid, id: 'shared', steps: [valid.steps[0]] });
    await mkdir(join(root, 'cases', 'tiny', 'real'), { recursive: true });
    await writeFile(join(root, 'cases', 'tiny', 'real', 'case.json'), body.replace('shared', 'real'));
    await mkdir(join(root, 'other', 'shared'), { recursive: true });
    await writeFile(join(root, 'other', 'shared', 'case.json'), body);
    await symlink(join(root, 'other', 'shared'), join(root, 'cases', 'tiny', 'shared'));
    await assert.rejects(loadSuite(root, 'tiny'), /cases\/tiny\/shared is a symbolic link, a case is a folder of its own/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
