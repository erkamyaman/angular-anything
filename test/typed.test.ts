import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeStep, parseCase } from '../src/case.ts';
import type { Case, Step } from '../src/case.ts';
import { hider, hideReport } from '../src/typed.ts';
import { REPORT_FORMAT, summarize } from '../src/report.ts';
import type { Report } from '../src/report.ts';

const target = { role: 'textbox', name: 'Name' };
const fill = (value: string): Step => ({ action: 'fill', target, value });
const press = (key: string, name = 'Name'): Step => ({ action: 'press', target: { role: 'textbox', name }, key });
const cases = (...steps: Step[]): Case[] => [
  { format: 'angular-anything/case@1', id: 'one', viewport: { width: 8, height: 8 }, steps },
];

test('a step is described without the value of fill and without a key that types text', () => {
  assert.equal(describeStep(fill('fake-typed-value')), 'fill textbox "Name"');
  for (const key of ['Enter', 'Shift+Tab', 'Control+Shift+ArrowLeft', 'F12', 'Shift', 'Space']) {
    assert.equal(describeStep(press(key)), `press ${key} on textbox "Name"`);
  }
  for (const key of ['a', '7', ' ', 'Shift+a', 'fake-typed-value', 'Enterfake', 'fake+Enter']) {
    assert.equal(describeStep(press(key)), 'press a typed key on textbox "Name"');
  }
});

test('a typed value is hidden in every written form, and a step number stays', () => {
  const value = 'Fake Pass "q&1"/x';
  const hide = hider(cases(fill(value), fill('  two\nfake-lines  ')));
  for (const form of [
    value,
    value.toUpperCase(),
    JSON.stringify(value).slice(1, -1),
    encodeURIComponent(value),
    encodeURI(value),
    new URLSearchParams({ q: value }).toString().slice(2),
    'two\nfake-lines',
    'two fake-lines',
    'fake-lines',
  ]) {
    assert.equal(hide(`x${form}y`), 'x[typed]y', form);
  }
  assert.equal(hide('nothing here'), 'nothing here');
});

test('of two typed values the longer one is hidden whole', () => {
  const hide = hider(cases(fill('fake-long'), fill('fake-long-value')));
  assert.equal(hide('x fake-long-value y fake-long'), 'x [typed] y [typed]');
});

test('a short typed value is hidden where it stands alone, an empty one never', () => {
  const hide = hider(cases(fill('2'), fill('Ada'), fill(''), fill('   ')));
  assert.equal(hide('step 2 (x): Ada, "ada" and 2 of Adaptive 25'), 'step 2 (x): [typed], "[typed]" and [typed] of Adaptive 25');
  assert.equal(hide('      step 2, 2'), '      step 2, [typed]');
});

test('keys of one character are hidden once they run to a word, a longer unnamed key by itself', () => {
  const hide = hider(cases(press('z'), press('q'), press('x'), press('Enter'), press('k'), press('Shift+fake'), press('j'), press('w', 'Other')));
  assert.equal(hide('zqx Enter Shift+fake k j kj jw'), '[typed] Enter [typed] k j kj jw');
});

test('a report shows no typed value in an error, a step, a note, a difference or a group', () => {
  const value = 'fake-typed-value';
  const difference = {
    layer: 'dom' as const,
    path: `html[1].attrs.${value}`,
    kind: 'text' as const,
    expected: `a ${value} b`,
    actual: { [value]: [value, 4242, 7] },
    at: { offset: 3, expected: 'a fak⟨e⟩', actual: 'a fax⟨e⟩' },
  };
  const layer = { differences: 1, masked: 0, first: [difference] };
  const none = { differences: 0, masked: 0, first: [] };
  const report: Report = {
    format: REPORT_FORMAT,
    command: 'gate',
    suite: 's',
    source: 'o',
    url: 'http://localhost:1/',
    original: null,
    playwright: 'p',
    browser: 'b',
    result: 'fail',
    cases: [
      {
        id: 'one',
        result: 'fail',
        stepCount: 1,
        error: `step 1 (x): ${value}`,
        steps: [
          {
            step: 1,
            action: `click button "${value}"`,
            result: 'fail',
            settleMs: 0,
            captures: 1,
            frames: 1,
            screenshot: 'not compared',
            layers: { accessibility: none, dom: layer, style: none, events: none, effects: none },
            convention: [value],
            reads: [`GET /${value}`],
          },
        ],
      },
    ],
    distinct: { cases: 1, differences: [{ id: 'i', layer: 'dom', path: value, kind: 'text', count: 1, cases: 1, example: { case: 'one', step: 1, ...difference } }] },
    literals: { result: 'pass', found: [{ file: 'a.ts', line: 1, value }], named: [] },
  };
  const shown = hideReport(report, hider(cases(fill(value), fill('4242'))));
  const text = `${JSON.stringify(shown)}${summarize(shown)}`;
  assert.ok(!text.includes(value), text);
  assert.ok(!text.includes('4242'), text);
  assert.ok(!text.includes('fak'), text);
  assert.deepEqual(shown.cases[0].steps[0].layers.dom.first[0].at, { offset: 3 });
  assert.deepEqual(shown.cases[0].steps[0].layers.dom.first[0].actual, { '[typed]': ['[typed]', '[typed]', 7] });
  assert.equal(shown.url, 'http://localhost:1/');
});

test('a case that is not JSON is refused without its text', () => {
  for (const text of ['{"value": fake-typed-value}', '{"value": "fake-typed-value" "x"}', '"fake-typed-value']) {
    assert.throws(
      () => parseCase(text, 'one'),
      (error: Error) => /^the case is not valid JSON/.test(error.message) && !error.message.includes('fake'),
    );
  }
});
