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

test('a value that JSON cannot hold is marked where it is, and the other fields of the payload stay', async () => {
  const payload = async (expression: string) => (await emitted(`window.__aa.emit('x', ${expression})`))[0];
  const same = async (a: string, b: string) => eventDifferences([await payload(a)], [await payload(b)]).length === 0;
  assert.deepEqual((await payload("{ id: 10n, name: 'a' }")).payload, { id: { $aa: 'bigint', value: '10' }, name: 'a' });
  assert.equal(await same("{ id: 10n, name: 'a' }", "{ id: 10n, name: 'b' }"), false, 'another field next to a BigInt');
  assert.equal(await same('{ id: 10n }', '{ id: 11n }'), false, 'another BigInt');
  assert.equal(await same('{ id: 10n }', '{ id: 10n }'), true);
  assert.equal(await same('{ id: 10n }', '{ id: 10 }'), false, 'a BigInt against a number');
  const circular = (value: number) => `(() => { const x = { a: ${value}, list: [1] }; x.self = x; x.list.push(x); return x; })()`;
  assert.deepEqual((await payload(circular(1))).payload, {
    a: 1,
    list: [1, { $aa: 'circular' }],
    self: { $aa: 'circular' },
  });
  assert.equal(await same(circular(1), circular(2)), false, 'another field of a circular payload');
  assert.equal(await same(circular(1), circular(1)), true);
  assert.equal(await same("{ el: document.body, n: 1 }", "{ el: document.body, n: 2 }"), false, 'an element next to a field');
  assert.deepEqual((await payload('(() => { const s = new Set(); s.add(s); return { s, n: 1 }; })()')).payload, {
    s: { $aa: 'Set', values: [{ $aa: 'circular' }] },
    n: 1,
  });
  assert.deepEqual((await payload('(() => { const a = { n: 1 }; return { x: a, y: a }; })()')).payload, { x: { n: 1 }, y: { n: 1 } }, 'one object twice is no cycle');
});

test('an Error, a RegExp, a negative zero and a hole in a list are told apart', async () => {
  const payload = async (expression: string) => (await emitted(`window.__aa.emit('x', ${expression})`))[0];
  const same = async (a: string, b: string) => eventDifferences([await payload(a)], [await payload(b)]).length === 0;
  assert.deepEqual((await payload("{ e: new TypeError('a') }")).payload, { e: { $aa: 'Error', name: 'TypeError', message: 'a' } });
  assert.equal(await same("{ e: new Error('a') }", "{ e: new Error('b') }"), false, 'the message of an error');
  assert.equal(await same("{ e: new Error('a') }", "{ e: new TypeError('a') }"), false, 'the name of an error');
  assert.equal(await same("{ e: new Error('a') }", "{ e: new Error('a') }"), true);
  assert.equal(await same('{ r: /a/g }', '{ r: /a/i }'), false, 'the flags of a pattern');
  assert.equal(await same('{ r: /a/g }', '{ r: /b/g }'), false, 'the source of a pattern');
  assert.equal(await same('{ r: /a/g }', '{ r: /a/g }'), true);
  assert.equal(await same('{ n: -0 }', '{ n: 0 }'), false, 'negative zero against zero');
  assert.equal(await same('{ n: -0 }', '{ n: -0 }'), true);
  assert.equal(await same('{ n: [0, -0] }', '{ n: [0, 0] }'), false);
  assert.equal(await same('{ l: [1, , 3] }', '{ l: [1, undefined, 3] }'), false, 'a hole against undefined');
  assert.equal(await same('{ l: [1, , 3] }', '{ l: [1, null, 3] }'), false, 'a hole against null');
  assert.equal(await same('{ l: [1, , 3] }', '{ l: [1, , 3] }'), true);
  assert.equal(await same('{ l: [1, 2, 3] }', '{ l: [1, 2, 3] }'), true);
});

test('a payload whose objects all reach each other stays small, and another field of it is still a difference', { timeout: 60_000 }, async () => {
  const payload = async (expression: string) => (await emitted(`window.__aa.emit('x', ${expression})`))[0];
  const same = async (a: string, b: string) => eventDifferences([await payload(a)], [await payload(b)]).length === 0;
  const graph = (ok: number) => `(() => { const n = [...Array(9)].map((_, i) => ({ i })); for (const a of n) a.links = n.filter((b) => b !== a); return { graph: n[0], ok: ${ok} }; })()`;
  const event = await payload(graph(1));
  assert.ok(JSON.stringify(event).length < 20_000, `the payload takes ${JSON.stringify(event).length} characters`);
  assert.ok(JSON.stringify(event).includes('{"$aa":"repeated"}'));
  assert.equal(await same(graph(1), graph(1)), true);
  assert.equal(await same(graph(1), graph(2)), false);
  const deep = (await payload('(() => { const n = [...Array(14)].map((_, i) => ({ i })); for (const a of n) a.links = n.filter((b) => b !== a); return n[13]; })()')).payload as { i: number };
  assert.equal(deep.i, 13);
});

test('a large payload keeps every value, and a shared object in a payload of ordinary size is written out each time', async () => {
  const [large, shared] = await emitted(`
    window.__aa.emit('large', { list: Array.from({ length: 20000 }, (_, at) => ({ at })) });
    const item = { v: 1 };
    window.__aa.emit('shared', Array.from({ length: 100 }, () => item));
  `);
  const list = (large.payload as { list: { at: number }[] }).list;
  assert.equal(list.length, 20000);
  assert.deepEqual(list[19999], { at: 19999 });
  assert.deepEqual(shared.payload, Array.from({ length: 100 }, () => ({ v: 1 })));
});

test('a DOM node and a window in a payload are marked and not walked', async () => {
  const [event] = await emitted(`
    const el = document.createElement('button');
    el.__fiber$x = { stateNode: el, random: Math.random() };
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const foreign = document.createElement('iframe');
    foreign.sandbox = '';
    document.body.append(foreign);
    window.__aa.emit('x', {
      el, text: document.createTextNode('t'), page: document, source: window,
      inner: frame.contentWindow.document.body, other: frame.contentWindow, foreign: foreign.contentWindow, n: 1,
    });
  `);
  const node = (name: string) => ({ $aa: 'node', name });
  const view = { $aa: 'window' };
  assert.deepEqual(event.payload, {
    el: node('BUTTON'), text: node('#text'), page: node('#document'), source: view,
    inner: node('BODY'), other: view, foreign: view, n: 1,
  });
  assert.deepEqual((await emitted(`window.__aa.emit('x', window)`))[0].payload, view);
});

test('a getter or a toJSON that throws is marked where it is, and the other fields stay', async () => {
  const [event] = await emitted(`
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    window.__aa.emit('x', {
      get g() { throw new Error('no'); },
      list: Object.defineProperty([1, 2], 1, { get() { throw 1; } }),
      json: { toJSON() { throw 1; } },
      revoked: revoked.proxy,
      error: Object.defineProperty(new Error('m'), 'message', { get() { throw 1; } }),
      set: Object.assign(new Set([1]), { [Symbol.iterator]() { throw 1; } }),
      n: 1,
    });
  `);
  const thrown = { $aa: 'throws' };
  assert.deepEqual(event.payload, {
    g: thrown,
    list: [1, thrown],
    json: thrown,
    revoked: thrown,
    error: { $aa: 'Error', name: 'Error', message: thrown },
    set: { $aa: 'Set', values: thrown },
    n: 1,
  });
  const payload = async (expression: string) => (await emitted(`window.__aa.emit('x', ${expression})`))[0];
  const same = async (a: string, b: string) => eventDifferences([await payload(a)], [await payload(b)]).length === 0;
  assert.equal(await same('{ get g() { throw 1; }, n: 1 }', '{ get g() { throw 1; }, n: 2 }'), false);
});

test('what a toJSON returns is read like any other value', async () => {
  const [event] = await emitted(`
    const p = { n: 1 };
    p.back = { toJSON: () => p };
    window.__aa.emit('x', { p, body: { toJSON: () => document.body }, view: { toJSON: () => window } });
  `);
  assert.deepEqual(event.payload, { p: { n: 1, back: { $aa: 'circular' } }, body: { $aa: 'node', name: 'BODY' }, view: { $aa: 'window' } });
});

test('the fields, the cause and the list of errors of an Error are part of it', async () => {
  const payload = async (expression: string) => (await emitted(`window.__aa.emit('x', ${expression})`))[0];
  const same = async (a: string, b: string) => eventDifferences([await payload(a)], [await payload(b)]).length === 0;
  const failed = (status: number) => `Object.assign(new Error('failed'), { status: ${status} })`;
  assert.deepEqual((await payload(failed(404))).payload, { $aa: 'Error', name: 'Error', message: 'failed', status: 404 });
  assert.equal(await same(failed(404), failed(500)), false, 'a field');
  assert.equal(await same(failed(404), failed(404)), true);
  const subclass = (code: string, id: number) => `new (class H extends Error { constructor() { super('x'); this.code = '${code}'; this.details = { id: ${id} }; } })()`;
  assert.equal(await same(subclass('E1', 1), subclass('E2', 1)), false, 'a field of a subclass');
  assert.equal(await same(subclass('E1', 1), subclass('E1', 2)), false, 'a nested field of a subclass');
  assert.equal(await same("new Error('x', { cause: 'a' })", "new Error('x', { cause: 'b' })"), false, 'the cause');
  assert.equal(await same("new AggregateError([new Error('a')], 'm')", "new AggregateError([new Error('b')], 'm')"), false, 'the errors');
  assert.equal(await same("Object.assign(new Error('a'), { name: 'X' })", "Object.assign(new Error('a'), { name: 'Y' })"), false, 'an own name');
  assert.deepEqual((await payload("(() => { const e = new Error('a'); e.self = e; return e; })()")).payload, {
    $aa: 'Error', name: 'Error', message: 'a', self: { $aa: 'circular' },
  });
});

test('a payload is read as JSON reads it where JSON can hold the value', async () => {
  const [event, bare, nothing] = await emitted(`
    window.__aa.emit('x', {
      boxed: [new Number(2), new String('s'), new Boolean(false)], fn() {}, list: [() => 1, Symbol('s')], sym: Symbol('s'),
      json: { toJSON(key) { return { key }; } }, parsed: JSON.parse('{"__proto__":{"a":1}}'),
      wrapped: (() => { const w = { toJSON() { return { back: w }; } }; return w; })(),
      quote: 'a"\\n',
    });
    window.__aa.emit('x');
    window.__aa.emit('x', () => 1);
  `);
  assert.deepEqual(event.payload, JSON.parse('{"boxed":[2,"s",false],"list":[null,null],"json":{"key":"json"},"parsed":{"__proto__":{"a":1}},"wrapped":{"back":{"$aa":"circular"}},"quote":"a\\"\\n"}'));
  assert.deepEqual(bare, { name: 'x', payload: null });
  assert.deepEqual(nothing, { name: 'x' });
});
