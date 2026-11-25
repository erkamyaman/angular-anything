import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareObservations } from '../src/compare.ts';
import type { Observation } from '../src/compare.ts';
import { laidOut, measure, parseMeasured, stored } from '../src/layout.ts';

const observation = (dom: Observation['dom'], style: Observation['style']): Observation => ({
  accessibility: { tree: [], attributes: {} },
  dom,
  style,
  events: [],
  effects: { requests: [], gets: [], storage: {}, url: { path: [], query: {} }, title: '', focus: null, popups: [] },
});

test('a masked text node is a text node in the sizes of the same session', () => {
  const masked = observation({ tag: 'html', children: [{ tag: 'p', children: [{ $aa: 'noise', kind: 'string' } as never] }] }, {});
  const port = observation({ tag: 'html', children: [{ tag: 'p', children: ['0.123'] }] }, {});
  assert.deepEqual(compareObservations(laidOut(masked), laidOut(port)).layers.dom, []);
});

test('a laid-out value that a child shares with its parent is no difference of the child', () => {
  const box = { x: 0, y: 0, width: 1, height: 1 };
  const dom = { tag: 'html', children: [{ tag: 'div', children: [{ tag: 'p' }] }] };
  const original = observation(dom, {
    'html[1]': { style: {}, box },
    'html[1]/div[1]': { style: {}, box, layout: { width: '500px' } },
    'html[1]/div[1]/p[1]': { style: {}, box },
  });
  const port = observation(dom, {
    'html[1]': { style: {}, box },
    'html[1]/div[1]': { style: {}, box, layout: { width: '480px' } },
    'html[1]/div[1]/p[1]': { style: {}, box, layout: { width: '500px' } },
  });
  assert.deepEqual(compareObservations(laidOut(original), laidOut(port)).layers.style.map((difference) => difference.path), ['html[1]/div[1].layout.width']);
});

test('the stored form keeps no box and no laid-out value', () => {
  const full = observation({ tag: 'html', layout: { '--h': '58px' }, children: [] }, { 'html[1]': { style: { width: 'auto' }, box: { x: 0, y: 0, width: 1, height: 1 }, layout: { width: '9px' } } });
  assert.deepEqual(stored(full).style, { 'html[1]': { style: { width: 'auto' } } });
  assert.deepEqual(stored(full).dom, { tag: 'html', children: [] });
});

const sized = (height: string, written: string) =>
  observation(
    { tag: 'html', children: [{ tag: 'div', inline: { top: `${written} !important` } }] },
    { 'html[1]': { style: {} }, 'html[1]/div[1]': { style: { height, color: 'red' } } },
  );
const listed = [
  { layer: 'style' as const, path: 'html[1]/div[*].style.height' },
  { layer: 'dom' as const, path: 'html[1]/div[1].inline.top' },
];

test('a value that the case lists as measured is compared only in the same session', () => {
  const original = measure(sized('67.5px', '12px'), listed);
  const port = measure(sized('70px', '14px'), listed);
  const anywhere = compareObservations(stored(original), stored(port)).layers;
  assert.deepEqual([anywhere.style, anywhere.dom], [[], []]);
  const session = compareObservations(laidOut(original), laidOut(port)).layers;
  assert.deepEqual(session.style.map((difference) => difference.path), ['html[1]/div[1].layout.height']);
  assert.deepEqual(session.dom.map((difference) => difference.path), ['html[1]/div[1].layout.top']);
});

test('a measured entry hides no other value, no missing value and no priority', () => {
  const original = measure(sized('67.5px', '12px'), listed);
  const other = sized('67.5px', '12px');
  other.style['html[1]/div[1]'].style = { color: 'blue' };
  (other.dom as { children: { inline: Record<string, string> }[] }).children[0].inline.top = '12px';
  const differences = compareObservations(stored(original), stored(measure(other, listed))).layers;
  assert.deepEqual(differences.style.map((difference) => difference.path).sort(), ['html[1]/div[1].style.color', 'html[1]/div[1].style.height']);
  assert.deepEqual(differences.dom.map((difference) => difference.path), ['html[1]/div[1].inline.top']);
});

test('a measured entry that matches is reported as matched, and the input is left as it was', () => {
  const full = sized('67.5px', '12px');
  const matched = new Set<(typeof listed)[number]>();
  measure(full, [...listed, { layer: 'style', path: 'html[1]/p[1].style.height' }], matched);
  assert.deepEqual([...matched], listed);
  assert.equal(full.style['html[1]/div[1]'].style.height, '67.5px');
});

test('a measured list names one property of an element', () => {
  assert.deepEqual(parseMeasured(listed), listed);
  for (const bad of [
    {},
    [{ layer: 'events', path: 'html[1].style.height' }],
    [{ layer: 'style', path: 'html[1].layout.height' }],
    [{ layer: 'dom', path: 'html[1].attrs.id' }],
    [{ layer: 'style', path: 'html[1]' }],
    [{ layer: 'style', path: 'html[1].style.height', why: 'x' }],
    [listed[0], listed[0]],
  ]) {
    assert.throws(() => parseMeasured(bad));
  }
});
