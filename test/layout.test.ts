import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareObservations } from '../src/compare.ts';
import type { Observation } from '../src/compare.ts';
import { laidOut, stored } from '../src/layout.ts';

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
