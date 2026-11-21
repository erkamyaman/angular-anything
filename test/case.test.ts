import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
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
    'fill textbox "New task" with "Call mom"',
    'press Enter on textbox "New task"',
    'click button "Add"',
    'check checkbox "Buy milk"',
    'uncheck checkbox "Buy milk"',
    'reload',
    'advance 150 frames',
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
    [(data) => (data.steps[1].target = { role: 'textbox' }), /step 2 needs a "target" with "role" and "name"/],
    [(data) => (data.steps[1].target = '#new-task'), /step 2 needs a "target" with "role" and "name"/],
    [(data) => delete data.steps[1].value, /step 2 needs a string "value"/],
    [(data) => delete data.steps[2].key, /step 3 needs a "key"/],
    [(data) => delete data.steps[2].target, /step 3 needs a "target" with "role" and "name"/],
    [(data) => (data.steps[3].action = 'hover'), /step 4 has the unknown action "hover"/],
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

test('the fixture suite loads: nine valid cases in the order of their ids', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const cases = await loadSuite(root, 'fixture');
  assert.deepEqual(
    cases.map((loaded) => loaded.case.id),
    ['add-empty', 'add-reload', 'add-task', 'delete-task', 'details', 'filter-tabs', 'initial-render', 'load-suggestions', 'toggle-task'],
  );
  for (const loaded of cases) assert.match(loaded.sha256, /^[0-9a-f]{64}$/);
  await assert.rejects(loadSuite(root, 'no-such-suite'), UsageError);
  await assert.rejects(loadSuite(root, '../cases'), UsageError);
});
