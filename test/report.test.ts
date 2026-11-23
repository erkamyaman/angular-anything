import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAYERS } from '../src/compare.ts';
import type { Difference, Layer, LayerResult } from '../src/compare.ts';
import { finish, REPORT_FORMAT, stepReport, summarize } from '../src/report.ts';
import type { CaseReport, Report, StepReport } from '../src/report.ts';

const timing = { settleMs: 10, captures: 2, frames: 4 };

const layers = (changed: Partial<Record<Layer, Difference[]>> = {}): Record<Layer, LayerResult> =>
  Object.fromEntries(LAYERS.map((layer) => [layer, { differences: changed[layer] ?? [], masked: 0 }])) as Record<Layer, LayerResult>;

const difference = { path: 'a', expected: 1, actual: 2 };
const step = (changed: Partial<Record<Layer, Difference[]>> = {}, screenshot: StepReport['screenshot'] = 'identical') =>
  stepReport(1, 'goto /', timing, screenshot, layers(changed));

const item = (steps: StepReport[], extra: Partial<CaseReport> = {}): CaseReport => ({
  id: 'one',
  result: 'fail',
  stepCount: steps.length,
  steps,
  ...extra,
});

const report = (cases: CaseReport[]): Report => ({
  format: REPORT_FORMAT,
  command: 'gate',
  suite: 'fixture',
  source: 'react',
  url: 'http://localhost:4104/',
  playwright: '1.65.1',
  browser: 'chromium 159',
  result: 'fail',
  cases,
});

test('a difference in any one hard layer fails the step, and a different screenshot alone does not', () => {
  for (const layer of LAYERS) {
    const failing = step({ [layer]: [difference] });
    assert.equal(failing.result, 'fail', layer);
    assert.equal(failing.layers[layer].differences, 1, layer);
    for (const other of LAYERS) if (other !== layer) assert.equal(failing.layers[other].differences, 0, `${layer} ${other}`);
  }
  assert.equal(step({}, 'different').result, 'pass');
  assert.equal(step({}, 'masked').result, 'pass');
});

test('a case passes only when every step ran and passed, with no lock problem and no error', () => {
  const pass = (steps: StepReport[], extra: Partial<CaseReport> = {}) => finish(report([item(steps, extra)])).cases[0].result;
  assert.equal(pass([step(), step()]), 'pass');
  assert.equal(pass([step(), step({ events: [difference] })]), 'fail');
  assert.equal(pass([step()], { stepCount: 2 }), 'fail');
  assert.equal(pass([step(), step()], { error: 'step 3 failed' }), 'fail');
  assert.equal(pass([step(), step()], { lock: ['stale'] }), 'fail');
});

test('a suite passes only when it has cases and every case passes', () => {
  assert.equal(finish(report([])).result, 'fail');
  assert.equal(finish(report([item([step()])])).result, 'pass');
  assert.equal(finish(report([item([step()]), item([step({ dom: [difference] })], { id: 'two' })])).result, 'fail');
  assert.equal(finish(report([item([step({ accessibility: [difference] })]), item([step()], { id: 'two' })])).result, 'fail');
});

test('the summary names the first failing step, the layers that differ and the screenshots', () => {
  const text = summarize(finish(report([item([step(), stepReport(2, 'click button "Go"', timing, 'different', layers({ effects: [difference] }))], { id: 'one' })])));
  assert.match(text, /^angular-anything gate: FAIL$/m);
  assert.match(text, /^FAIL {2}one$/m);
  assert.match(text, /^ {6}step 2 of 2: click button "Go" \(4 frames\)$/m);
  assert.match(text, /side effects: 1 difference, the first at a/);
  assert.match(text, /^1 of 1 cases failed\. 1 of 2 compared steps differ\.$/m);
  assert.match(text, /1 identical, 1 different, 0 masked\./);
});
