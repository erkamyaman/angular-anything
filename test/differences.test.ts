import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareCase, LAYERS } from '../src/compare.ts';
import type { Difference, Layer, LayerResult, Observation } from '../src/compare.ts';
import { distinct, finish, locate, REPORT_FORMAT, stepReport, summarize } from '../src/report.ts';
import type { Found, Report } from '../src/report.ts';

const timing = { settleMs: 10, captures: 2, frames: 4 };

const layers = (changed: Partial<Record<Layer, Difference[]>> = {}): Record<Layer, LayerResult> =>
  Object.fromEntries(LAYERS.map((layer) => [layer, { differences: changed[layer] ?? [], masked: 0 }])) as Record<Layer, LayerResult>;

const observation = (title: string, payload: unknown): Observation => ({
  accessibility: { tree: [], attributes: {} },
  dom: { tag: 'html' },
  style: {},
  events: [{ name: 'e', payload }],
  effects: { requests: [], storage: {}, url: { path: [], query: {} }, title, focus: null, popups: [] },
});

test('a difference gets its layer, path and kind', () => {
  const kind = (expected: unknown, actual: unknown) => locate('dom', { path: 'a', expected, actual }).kind;
  assert.equal(kind('x', 'y'), 'text');
  assert.equal(kind(1, 2), 'value');
  assert.equal(kind(true, false), 'value');
  assert.equal(kind({ tag: 'a' }, { tag: 'b' }), 'value');
  assert.equal(kind(1, '1'), 'type');
  assert.equal(kind('a', { tag: 'a' }), 'type');
  assert.equal(kind(null, {}), 'type');
  assert.equal(kind([], {}), 'type');
  assert.equal(kind('a', undefined), 'missing');
  assert.equal(kind(undefined, 'a'), 'extra');
  assert.equal(kind({ $aa: 'number', source: '1e30' }, 5), 'value');
  assert.deepEqual(locate('events', { path: '[0].name', expected: 1, actual: 2 }), { layer: 'events', path: '[0].name', kind: 'value', expected: 1, actual: 2 });
});

test('a text difference names the first differing character and marks it in a short context', () => {
  const at = (expected: string, actual: string) => locate('dom', { path: 'a', expected, actual }).at;
  assert.deepEqual(at('abcdef', 'abcxef'), { offset: 3, expected: 'abc⟨d⟩ef', actual: 'abc⟨x⟩ef' });
  assert.deepEqual(at('ab', 'abc'), { offset: 2, expected: 'ab⟨⟩', actual: 'ab⟨c⟩' });
  assert.deepEqual(at('abc', ''), { offset: 0, expected: '⟨a⟩bc', actual: '⟨⟩' });
  assert.deepEqual(at('😀😀a', '😀😀b'), { offset: 2, expected: '😀😀⟨a⟩', actual: '😀😀⟨b⟩' });
  assert.deepEqual(at('😀', '😁'), { offset: 0, expected: '⟨😀⟩', actual: '⟨😁⟩' });
  const long = `${'0123456789'.repeat(4)}`;
  assert.deepEqual(at(`${long}A${long}`, `${long}B${long}`), {
    offset: 40,
    expected: `${long.slice(-16)}⟨A⟩${long.slice(0, 16)}`,
    actual: `${long.slice(-16)}⟨B⟩${long.slice(0, 16)}`,
  });
  assert.equal(locate('dom', { path: 'a', expected: 1, actual: 2 }).at, undefined);
  assert.equal(locate('dom', { path: 'a', expected: 'x', actual: undefined }).at, undefined);
});

test('a masked value of another kind is a type difference and a broken tie a value difference, not a text one', () => {
  const mask = { $aa: 'noise', kind: 'string' } as const;
  const [wrong, gone] = [5, undefined].map(
    (payload) => compareCase([observation('t', mask)], [observation('t', payload)])[0].events.differences[0],
  );
  assert.equal(locate('events', wrong).kind, 'type');
  assert.equal(locate('events', gone).kind, 'missing');
  const [empty] = compareCase([observation('t', mask)], [observation('t', '')]);
  assert.equal(locate('events', empty.events.differences[0]).kind, 'type');
  const tied = { $aa: 'noise', kind: 'string', group: 1 } as const;
  const [first, second] = compareCase(
    [observation('t', tied), observation('t', tied)],
    [observation('t', 'aaaaaaaa'), observation('t', 'bbbbbbbb')],
  );
  assert.equal(first.events.differences.length, 0);
  const found = locate('events', second.events.differences[0]);
  assert.equal(found.kind, 'value');
  assert.equal(found.at, undefined);
});

const found = (id: string, step: number, layer: Layer, path: string, ...values: [unknown?, unknown?]): Found => {
  const [expected, actual] = values.length === 0 ? ['a', 'b'] : values;
  return { case: id, step, difference: locate(layer, { path, expected, actual }) };
};

test('differences group by layer, path without its indices, and kind, ranked by count with one example', () => {
  const result = distinct([
    found('one', 1, 'events', '[0].name'),
    found('one', 1, 'dom', 'html[1]/body[1]/li[1].attrs.class'),
    found('one', 2, 'dom', 'html[1]/body[1]/li[2].attrs.class', 'c', 'd'),
    found('two', 1, 'dom', 'html[1]/body[1]/li[3].attrs.class'),
    found('two', 1, 'style', 'html[1]/body[1]/li[3].attrs.class'),
    found('two', 1, 'dom', 'html[1]/body[1]/li[3].attrs.class', 'a'),
  ]);
  assert.equal(result.cases, 2);
  assert.deepEqual([result.differences[0].count, result.differences[0].cases], [3, 2]);
  assert.deepEqual(new Set(result.differences.map((group) => `${group.layer} ${group.kind}`)), new Set(['dom text', 'dom missing', 'events text', 'style text']));
  assert.equal(new Set(result.differences.map((group) => group.id)).size, 4);
  for (const group of result.differences) assert.match(group.id, /^[0-9a-f]{8}$/);
  assert.equal(result.differences[0].example.case, 'one');
  assert.equal(result.differences[0].example.step, 1);
  assert.equal(result.differences[0].example.path, 'html[1]/body[1]/li[1].attrs.class');
  assert.equal(result.differences[0].id, distinct([found('x', 9, 'dom', 'html[7]/body[1]/li[40].attrs.class')]).differences[0].id);
});

test('an index inside a quoted key is not collapsed, and more cases rank before fewer at the same count', () => {
  const quoted = distinct([found('one', 1, 'effects', 'storage["a[1]"]'), found('one', 1, 'effects', 'storage["a[2]"]')]);
  assert.deepEqual(quoted.differences.map((group) => group.path).sort(), ['storage["a[1]"]', 'storage["a[2]"]']);
  const ranked = distinct([
    found('one', 1, 'effects', 'title'),
    found('one', 2, 'effects', 'title'),
    found('one', 1, 'effects', 'focus'),
    found('two', 1, 'effects', 'focus'),
  ]);
  assert.deepEqual(ranked.differences.map((group) => group.path), ['focus', 'title']);
  const often = distinct([
    found('one', 1, 'effects', 'focus'),
    found('two', 1, 'effects', 'focus'),
    found('one', 1, 'effects', 'title'),
    found('one', 2, 'effects', 'title'),
    found('one', 3, 'effects', 'title'),
  ]);
  assert.deepEqual(often.differences.map((group) => group.path), ['title', 'focus']);
});

const report = (differences: Found[]): Report => {
  const step = stepReport(1, 'goto /', timing, 'identical', layers({ dom: [{ path: 'html[1].attrs.lang', expected: 'en-US', actual: 'en-GB' }] }));
  return finish({
    format: REPORT_FORMAT,
    command: 'gate',
    suite: 's',
    source: 'o',
    url: 'http://localhost:1/',
    original: null,
    playwright: 'p',
    browser: 'b',
    result: 'fail',
    cases: [{ id: 'one', result: 'fail', stepCount: 1, steps: [step] }],
    distinct: distinct(differences),
  });
};

test('a step keeps layer, kind and first character of its differences, and the summary prints them and the groups', () => {
  const kept = report([]).cases[0].steps[0].layers.dom.first[0];
  assert.deepEqual(kept, {
    layer: 'dom',
    path: 'html[1].attrs.lang',
    kind: 'text',
    expected: 'en-US',
    actual: 'en-GB',
    at: { offset: 3, expected: 'en-⟨U⟩S', actual: 'en-⟨G⟩B' },
  });
  const many = Array.from({ length: 25 }, (_, at) => found('one', 1, 'effects', `storage.k${at}`));
  const text = summarize(report([found('one', 1, 'dom', 'html[1].attrs.lang', 'en-US', 'en-GB'), found('two', 3, 'dom', 'html[1].attrs.lang', 'en-US', 'en-GB')]));
  assert.match(text, /^ {10}at char 3: expected "en-⟨U⟩S", actual "en-⟨G⟩B"$/m);
  assert.match(text, /^1 distinct difference in 2 cases:$/m);
  assert.match(text, /^ {2}2x {2}[0-9a-f]{8} {2}DOM html\[\*\]\.attrs\.lang \(text\), in 2 cases$/m);
  assert.match(text, /^ {6}example: one, step 1, html\[1\]\.attrs\.lang: expected "en-US", actual "en-GB"$/m);
  assert.match(text, /^ {6}at char 3: expected "en-⟨U⟩S", actual "en-⟨G⟩B"$/m);
  const long = summarize(report(many));
  assert.match(long, /^25 distinct differences in 1 case:$/m);
  assert.equal(long.match(/^ {2}1x /gm)!.length, 20);
  assert.match(long, /^ {2}and 5 more in report\.json$/m);
  assert.doesNotMatch(summarize(report([])), /distinct difference/);
});
