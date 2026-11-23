import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { compare } from '../src/compare.ts';
import type { Observation } from '../src/compare.ts';
import { initPage } from '../src/page.ts';

let browser: Browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
});

async function emitted(script: string): Promise<{ name: string; payload: unknown }[]> {
  const context = await browser.newContext();
  try {
    const events: { name: string; payload: unknown }[] = [];
    await context.exposeBinding('__aaEmit', (_source, json: string) => {
      events.push(JSON.parse(json));
    });
    await context.addInitScript(initPage);
    const page = await context.newPage();
    await page.goto('data:text/html,<title>t</title>');
    await page.evaluate(script);
    return events;
  } finally {
    await context.close();
  }
}

const events = (list: { name: string; payload: unknown }[]) => ({ events: list }) as unknown as Observation;
const eventDifferences = (a: { name: string; payload: unknown }[], b: { name: string; payload: unknown }[]) => {
  const empty = { accessibility: { tree: [], attributes: {} }, dom: { tag: 'html' }, style: {}, effects: {} };
  return compare({ ...empty, ...events(a) } as unknown as Observation, { ...empty, ...events(b) } as unknown as Observation).events;
};

test('an event payload is recorded with what it holds', async () => {
  const [event] = await emitted(`window.__aa.emit('x', {
    set: new Set([1, 'a', new Set([2])]),
    map: new Map([['k', 1], [2, { deep: new Set([3]) }]]),
    nan: NaN, up: Infinity, down: -Infinity, none: undefined, list: [undefined, 1, NaN], date: new Date(0), plain: { a: [1, { b: null }] },
  })`);
  assert.deepEqual(event, {
    name: 'x',
    payload: {
      set: { $aa: 'Set', values: [1, 'a', { $aa: 'Set', values: [2] }] },
      map: { $aa: 'Map', entries: [['k', 1], [2, { deep: { $aa: 'Set', values: [3] } }]] },
      nan: { $aa: 'NaN' },
      up: { $aa: 'Infinity' },
      down: { $aa: '-Infinity' },
      list: [{ $aa: 'undefined' }, 1, { $aa: 'NaN' }],
      date: '1970-01-01T00:00:00.000Z',
      plain: { a: [1, { b: null }] },
    },
  });
});

test('events that hold other entries, numbers or undefined differ, and a key with undefined equals a missing key', async () => {
  const payload = async (expression: string) => (await emitted(`window.__aa.emit('x', ${expression})`))[0];
  const same = async (a: string, b: string) => eventDifferences([await payload(a)], [await payload(b)]).length === 0;
  assert.equal(await same('{ ids: new Set([1, 2]) }', '{ ids: new Set([1, 2]) }'), true);
  assert.equal(await same('{ ids: new Set([1, 2]) }', '{ ids: new Set([3]) }'), false, 'another Set');
  assert.equal(await same('{ ids: new Set([1, 2]) }', '{ ids: new Set([2, 1]) }'), false, 'a Set keeps its order');
  assert.equal(await same('{ m: new Map([[1, true]]) }', '{ m: new Map([[1, false]]) }'), false, 'another Map');
  assert.equal(await same('{ m: new Map([[1, true]]) }', '{ m: {} }'), false, 'a Map against an empty object');
  assert.equal(await same('{ n: NaN }', '{ n: 5 }'), false, 'NaN against a number');
  assert.equal(await same('{ n: NaN }', '{ n: null }'), false, 'NaN against null');
  assert.equal(await same('{ n: NaN }', '{ n: NaN }'), true, 'NaN against NaN');
  assert.equal(await same('{ n: Infinity }', '{ n: -Infinity }'), false, 'Infinity against -Infinity');
  assert.equal(await same('{ l: [undefined] }', '{ l: [null] }'), false, 'undefined against null in a list');
  assert.equal(await same('{ a: 1, b: undefined }', '{ a: 1 }'), true, 'a key with undefined against a missing key');
  assert.equal(await same('{ a: 1, b: undefined }', '{ a: 1, b: null }'), false, 'undefined against null');
});
