import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCase } from '../src/case.ts';
import { compareCase } from '../src/compare.ts';
import type { Layer, Observation } from '../src/compare.ts';
import { audit, compile, maskObservations, normalize, parseNoise, placeholdersOutside } from '../src/noise.ts';
import type { Noise } from '../src/noise.ts';
import { storageValue, urlParts } from '../src/parts.ts';
import { formatPath, keyPath, matcher, parsePath } from '../src/path.ts';

const base = new URL('http://localhost:4104/');

const blank = (): Observation => ({
  accessibility: { tree: [], attributes: {} },
  dom: { tag: 'html', children: [{ tag: 'body', children: [] }] },
  style: {},
  events: [],
  effects: { requests: [], gets: [], storage: {}, url: urlParts('http://localhost:4104/', base, 'page'), title: '', focus: null, popups: [] },
});

const withStorage = (storage: Record<string, string>): Observation => {
  const result = blank();
  result.effects.storage = Object.fromEntries(Object.entries(storage).map(([key, value]) => [key, storageValue(value)]));
  return result;
};

const effects = (path: string): Noise => ({ layer: 'effects', path });

function record(noise: Noise[], first: Observation[], second: Observation[] = first) {
  const entries = compile(noise);
  const left = first.map((observation) => normalize(observation, entries));
  const right = second.map((observation) => normalize(observation, entries));
  const audited = audit(entries, left, right);
  return { entries, audited, ...maskObservations(entries, left, right) };
}

function gate(noise: Noise[], recorded: Observation[], actual: Observation[]) {
  const entries = compile(noise);
  const results = compareCase(recorded, actual.map((observation) => normalize(observation, entries)));
  return results.map((result) => Object.fromEntries((Object.keys(result) as Layer[]).map((layer) => [layer, result[layer].differences])));
}

const paths = (differences: { path: string }[]) => differences.map((difference) => difference.path);

test('a key with . / [ ] * a quote or a space is written quoted and cannot be taken for a child path', () => {
  assert.equal(keyPath('storage', 'visit'), 'storage.visit');
  assert.equal(keyPath('storage', 'visit.count'), 'storage["visit.count"]');
  assert.equal(keyPath('storage', 'visit/last'), 'storage["visit/last"]');
  assert.equal(keyPath('storage', 'visit[0]'), 'storage["visit[0]"]');
  assert.equal(keyPath('', 'a]b'), '["a]b"]');
  assert.equal(keyPath('storage', '*'), 'storage["*"]');
  assert.equal(keyPath('storage', 'a b'), 'storage["a b"]');
  assert.equal(keyPath('storage', 'say "x"'), 'storage["say \\"x\\""]');
  assert.equal(keyPath('storage', ''), 'storage[""]');
  for (const key of ['visit', 'visit.count', 'visit/last', 'visit[0]', 'a]b', '*', 'a b', 'say "x"', '', 'back\\slash', 'line\nbreak', 'ünï', '[*]']) {
    const path = keyPath('storage', key);
    assert.deepEqual(parsePath(path), [{ key: 'storage' }, { key }], `${JSON.stringify(key)} comes back as one key`);
    assert.equal(formatPath(parsePath(path)), path);
  }
});

test('a path is written and read the same way, with a star for any index', () => {
  for (const path of ['html[1]/body[1]/main[1].attrs.data-nonce', 'tree/main[1]/text()[2]', '[0].payload.id', 'gets[*].query.cb[0]', 'html[1]/body[1]/::before.style.content']) {
    assert.equal(formatPath(parsePath(path)), path);
  }
  for (const bad of ['', '.a', 'a.', 'a..b', 'a[', 'a[x]', 'a[-1]', 'a[01]', 'a b', '/a', 'a/', 'a//b', 'a[1]b', 'a["x"', 'a["x"]y', 'a.["x"]', 'a*']) {
    assert.throws(() => parsePath(bad), /is not a path/, `${JSON.stringify(bad)} is refused`);
  }
});

test('a noise path names one value: it matches that path and nothing that only begins like it', () => {
  const visit = matcher(parsePath('storage.visit'));
  assert.equal(visit.matches('storage.visit'), true);
  for (const other of ['storage.visit.count', 'storage["visit.count"]', 'storage["visit/last"]', 'storage["visit[0]"]', 'storage.visitor', 'storage.visit[0]', 'storage']) {
    assert.equal(visit.matches(other), false, other);
  }
  const star = matcher(parsePath('gets[*].query.cb[0]'));
  assert.equal(star.matches('gets[0].query.cb[0]'), true);
  assert.equal(star.matches('gets[12].query.cb[0]'), true);
  assert.equal(star.matches('gets[0].query.cb[1]'), false);
  assert.equal(star.matches('gets[0].query.cb[0].more'), false, 'a path that goes on is another path');
  assert.equal(star.matches('gets[0].query.cb[0][1]'), false);
  assert.equal(star.matches('x.gets[0].query.cb[0]'), false);
  assert.equal(star.matches('gets.x.query.cb[0]'), false);
  assert.equal(star.matches('gets[0].query["*"][0]'), false);
  assert.equal(matcher(parsePath('storage["*"]')).matches('storage.x'), false, 'a key named * is a key');
  assert.equal(matcher(parsePath('storage["*"]')).matches('storage["*"]'), true);
  assert.equal(matcher(parsePath('a["b"]')).matches('a.b'), true, 'a name is written the same either way');
});

test('a mask at one storage key does not hide the keys that only begin like it', () => {
  const original = (visit: string) =>
    withStorage({ visit, 'visit.count': '1', 'visit/last': 'ann', 'visit[0]': 'first', visitor: 'A' });
  const { observations } = record([effects('storage.visit')], [original('aaaa')], [original('bbbb')]);
  const gateWith = (change: Record<string, string>) => {
    const port = original('cccc');
    Object.assign(port.effects.storage, change);
    return paths(gate([effects('storage.visit')], observations, [port])[0].effects);
  };
  assert.deepEqual(gateWith({}), []);
  assert.deepEqual(gateWith({ visit: 'zzzzzz' }), []);
  assert.deepEqual(gateWith({ 'visit.count': '99' }), ['storage["visit.count"]']);
  assert.deepEqual(gateWith({ 'visit/last': 'bob' }), ['storage["visit/last"]']);
  assert.deepEqual(gateWith({ 'visit[0]': 'x' }), ['storage["visit[0]"]']);
  assert.deepEqual(gateWith({ visitor: 'B' }), ['storage.visitor']);
});

test('a mask never hides a missing value, and the port must have a value of the same kind', () => {
  const { observations } = record([effects('storage.notes')], [withStorage({ notes: 'abc' })], [withStorage({ notes: 'xyz' })]);
  const on = (storage: Record<string, string>) => gate([effects('storage.notes')], observations, [withStorage(storage)])[0].effects;
  assert.deepEqual(on({ notes: 'anything' }), []);
  assert.deepEqual(on({ notes: '7' }), [], 'a number as text is a string');
  assert.deepEqual(paths(on({})), ['storage.notes'], 'a missing key');
  assert.deepEqual(paths(on({ notes: '' })), ['storage.notes'], 'an empty string is not a string with text');
  assert.deepEqual(paths(on({ notes: '[1]' })), ['storage.notes'], 'a list is not a string');
  assert.deepEqual(paths(on({ notes: '{"a":1}' })), ['storage.notes'], 'an object is not a string');
  assert.equal(on({})[0].expected, 'a masked string');
  assert.equal(on({})[0].actual, undefined);
});

test('a masked number, boolean and empty string need the same kind', () => {
  const make = (value: unknown): Observation => {
    const result = blank();
    result.events = [{ name: 'e', payload: { value } }];
    return result;
  };
  const noise: Noise[] = [{ layer: 'events', path: '[0].payload.value' }];
  const on = (recorded: unknown, run: unknown, port: unknown) => {
    const { observations } = record(noise, [make(recorded)], [make(run)]);
    return paths(gate(noise, observations, [make(port)])[0].events);
  };
  assert.deepEqual(on(1, 2, 3), []);
  assert.deepEqual(on(1, 2, '3'), ['[0].payload.value']);
  assert.deepEqual(on(1, 2, true), ['[0].payload.value']);
  assert.deepEqual(on(1, 2, null), ['[0].payload.value']);
  assert.deepEqual(on(1, 2, undefined), ['[0].payload.value']);
  assert.deepEqual(on(true, false, false), []);
  assert.deepEqual(on(true, false, 0), ['[0].payload.value']);
  assert.deepEqual(on('', '', ''), []);
  assert.deepEqual(on('', '', 'x'), ['[0].payload.value']);
  assert.deepEqual(on('x', 'y', ''), ['[0].payload.value']);
  assert.deepEqual(on('x', 'y', { a: 1 }), ['[0].payload.value']);
});

test('a star never hides a missing element or another length of a list', () => {
  const list = (...ids: string[]): Observation => {
    const result = blank();
    result.events = ids.map((id) => ({ name: 'added', payload: { id } }));
    return result;
  };
  const noise: Noise[] = [{ layer: 'events', path: '[*].payload.id' }];
  const { observations, counts } = record(noise, [list('aaaaaaaa', 'bbbbbbbb')], [list('cccccccc', 'dddddddd')]);
  assert.deepEqual(counts, [2]);
  const on = (...ids: string[]) => paths(gate(noise, observations, [list(...ids)])[0].events);
  assert.deepEqual(on('1', '2'), []);
  assert.deepEqual(on('1'), ['[1]'], 'one element less');
  assert.deepEqual(on('1', '2', '3'), ['[2]'], 'one element more');
  assert.deepEqual(on(), ['[0]', '[1]'], 'no element');
  const other = blank();
  other.events = [{ name: 'added', payload: {} }, { name: 'added', payload: { id: 'x' } }];
  assert.deepEqual(paths(gate(noise, observations, [other])[0].events), ['[0].payload.id'], 'an element without the value');
});

test('record: what differs between the two runs and the case does not name is listed in the form the case needs', () => {
  const run = (cart: string, token: string, other: string) => {
    const result = withStorage({ cart, 'cart.items': '2', 'a/b[0]*': other });
    result.events = [{ name: 'e', payload: { token } }];
    return result;
  };
  const { audited } = record([], [run('aaaa1111', 't1', 'x')], [run('bbbb2222', 't2', 'y')]);
  assert.deepEqual(audited.problems, []);
  assert.deepEqual(audited.unnamed, [
    { layer: 'events', path: '[0].payload.token' },
    { layer: 'effects', path: 'storage.cart' },
    { layer: 'effects', path: 'storage["a/b[0]*"]' },
  ].sort((a, b) => (a.layer === b.layer ? 0 : a.layer === 'events' ? -1 : 1)));
  const named = record(audited.unnamed, [run('aaaa1111', 't1', 'x')], [run('bbbb2222', 't2', 'y')]);
  assert.deepEqual(named.audited, { problems: [], unnamed: [], agreed: [] }, 'the printed entries are accepted as they are');
  assert.doesNotThrow(() => parseNoise(JSON.parse(JSON.stringify(audited.unnamed))));
  assert.deepEqual(named.counts, [1, 1, 1]);
});

test('record: a value that exists in one run only or has another kind is no noise, with or without a noise entry', () => {
  const noise = [effects('storage.cart')];
  const only = record(noise, [withStorage({ cart: 'abc' })], [withStorage({})]);
  assert.deepEqual(only.audited.problems, ['step 1, side effects: storage.cart exists in the first run only']);
  const second = record([], [withStorage({})], [withStorage({ cart: 'abc' })]);
  assert.deepEqual(second.audited.problems, ['step 1, side effects: storage.cart exists in the second run only']);
  assert.deepEqual(second.audited.unnamed, []);
  const kinds = record(noise, [withStorage({ cart: 'abc' })], [withStorage({ cart: '[1]' })]);
  assert.equal(kinds.audited.problems[0], 'step 1, side effects: storage.cart is a string in the first run and an array in the second');
  const empty = record(noise, [withStorage({ cart: '' })], [withStorage({ cart: 'abc' })]);
  assert.deepEqual(empty.audited.problems, ['step 1, side effects: storage.cart is an empty string in the first run and a string in the second']);
  const number = record([{ layer: 'events', path: '[0].payload.n' }], [{ ...blank(), events: [{ name: 'e', payload: { n: 1 } }] }], [{ ...blank(), events: [{ name: 'e', payload: { n: '1' } }] }]);
  assert.equal(number.audited.problems.length, 1);
  const list = (n: number): Observation => ({ ...blank(), events: Array.from({ length: n }, () => ({ name: 'e', payload: {} })) });
  assert.deepEqual(record([], [list(1)], [list(2)]).audited.problems, ['step 1, events: [1] exists in the second run only']);
  const element = (rows: number): Observation => {
    const result = blank();
    (result.dom as { children: { children: unknown[] }[] }).children[0].children = Array.from({ length: rows }, () => ({ tag: 'li' }));
    return result;
  };
  const retagged = (tag: string): Observation => {
    const result = blank();
    (result.dom as { children: unknown[] }).children = [{ tag, children: ['x'] }];
    return result;
  };
  assert.deepEqual(record([], [retagged('b')], [retagged('i')]).audited.problems, ['step 1, DOM: html[1]/b[1] is another element or object in each run']);
  const rows = record([], [element(2)], [element(3)]);
  assert.deepEqual(rows.audited.problems, ['step 1, DOM: html[1]/body[1]/li[3] exists in the second run only']);
});

test('record: a noise entry names one value, matches something and is listed when the runs agree', () => {
  const same = [withStorage({ cart: 'abcdefgh', fixed: 'x' })];
  const agreed = record([effects('storage.cart')], same);
  assert.deepEqual(agreed.audited, { problems: [], unnamed: [], agreed: [effects('storage.cart')] });
  assert.deepEqual(agreed.counts, [1]);
  assert.deepEqual(
    record([effects('storage.cart'), effects('storage.fixed')], [withStorage({ cart: 'a', fixed: 'x' })], [withStorage({ cart: 'b', fixed: 'x' })]).audited.agreed,
    [effects('storage.fixed')],
  );
  assert.deepEqual(record([effects('storage.nothing')], same).audited.problems, ['the noise entry side effects storage.nothing matches nothing in any step']);
  assert.deepEqual(record([effects('storage.cart[0]')], same).audited.problems, ['the noise entry side effects storage.cart[0] matches nothing in any step']);
  const object = record([effects('storage.cart')], [withStorage({ cart: '{"a":1}' })]);
  assert.match(object.audited.problems[0], /^the noise entry side effects storage\.cart names an object at storage\.cart \(step 1, side effects\), not one value$/);
  const list = record([effects('storage.cart')], [withStorage({ cart: '[1]' })]);
  assert.match(list.audited.problems[0], /names an array/);
});

test('a noise entry masks the value in every step where it exists, also where the two runs agree', () => {
  const step = (cart?: string) => withStorage(cart === undefined ? {} : { cart });
  const { observations, counts } = record([effects('storage.cart')], [step(), step('same-value'), step('other-value')], [step(), step('same-value'), step('different')]);
  assert.deepEqual(counts, [2]);
  assert.equal(JSON.stringify(observations).includes('same-value'), false, 'the recording holds no value at a masked path');
  assert.equal(JSON.stringify(observations).includes('other-value'), false);
  assert.deepEqual(observations[1].effects.storage.cart, { $aa: 'noise', kind: 'string' });
  assert.deepEqual(observations[0].effects.storage, {}, 'a step without the path has nothing masked');
  const on = (...values: (string | undefined)[]) => gate([effects('storage.cart')], observations, values.map(step)).map((layers) => paths(layers.effects));
  assert.deepEqual(on(undefined, 'q', 'r'), [[], [], []]);
  assert.deepEqual(on(undefined, undefined, 'r'), [[], ['storage.cart'], []], 'a value that exists in the recording has to exist on the port');
  assert.deepEqual(on('s', 'q', 'r'), [['storage.cart'], [], []], 'a value that the recording does not have is a difference');
});

const tied = (): { noise: Noise[]; make: (id: string, same: string, short: string, short2: string) => Observation } => ({
  noise: [
    { layer: 'events', path: '[0].payload.id' },
    effects('storage.notes[0].id'),
    effects('storage.other'),
    { layer: 'events', path: '[0].payload.a' },
    { layer: 'events', path: '[0].payload.b' },
  ],
  make: (id, other, a, b) => {
    const result = withStorage({ notes: JSON.stringify([{ id }]), other });
    result.events = [{ name: 'e', payload: { id, a, b } }];
    return result;
  },
});

test('masked strings of 8 or more characters that were equal in both runs have to stay equal on the port', () => {
  const { noise, make } = tied();
  const { observations } = record(noise, [make('abcdef12', 'zzzzzzzz1', '1', '1')], [make('12345678', 'yyyyyyyy2', '2', '2')]);
  const events = observations[0].events[0].payload as { id: { group?: number }; a: { group?: number }; b: { group?: number } };
  const storage = (observations[0].effects.storage.notes as { id: { group?: number } }[])[0].id;
  assert.equal(events.id.group, 1);
  assert.equal(storage.group, 1, 'across layers');
  assert.equal((observations[0].effects.storage.other as { group?: number }).group, undefined, 'a value that is alone is tied to nothing');
  assert.equal(events.a.group, undefined, 'short values are not tied together');
  assert.equal(events.b.group, undefined);
  const on = (port: Observation) => gate(noise, observations, [port])[0];
  assert.deepEqual(paths(on(make('aaaaaaaa', 'q', 'x', 'y')).events), []);
  assert.deepEqual(paths(on(make('aaaaaaaa', 'q', 'x', 'y')).effects), []);
  const bad = on(make('aaaaaaaa', 'q', '3', '4'));
  const wrongEvent = (() => {
    const port = make('aaaaaaaa', 'q', 'x', 'y');
    port.events[0].payload = { ...(port.events[0].payload as object), id: 'bbbbbbbb' };
    return on(port);
  })();
  assert.deepEqual(bad.effects, []);
  assert.deepEqual(paths(wrongEvent.effects), ['storage.notes[0].id']);
  assert.match(String(wrongEvent.effects[0].expected), /^the same value as .*$/);
  assert.equal(wrongEvent.effects[0].actual, 'aaaaaaaa');
});

test('a masked value that is the same in two steps has to be the same on the port', () => {
  const step = (id: string): Observation => withStorage({ note: id });
  const noise = [effects('storage.note')];
  const { observations } = record(noise, [step('abcdef12'), step('abcdef12')], [step('12345678'), step('12345678')]);
  const on = (...ids: string[]) => gate(noise, observations, ids.map(step)).map((layers) => paths(layers.effects));
  assert.deepEqual(on('qqqqqqqq', 'qqqqqqqq'), [[], []]);
  assert.deepEqual(on('qqqqqqqq', 'rrrrrrrr'), [[], ['storage.note']]);
  const apart = record(noise, [step('abcdef12'), step('abcdef12')], [step('12345678'), step('87654321')]);
  assert.deepEqual(gate(noise, apart.observations, [step('q'), step('r')]).map((layers) => paths(layers.effects)), [[], []], 'not equal in the second run, so not tied');
  const short = record(noise, [step('abc'), step('abc')], [step('xyz'), step('xyz')]);
  assert.deepEqual(gate(noise, short.observations, [step('q'), step('r')]).map((layers) => paths(layers.effects)), [[], []], 'under 8 characters');
  const seven = record(noise, [step('abcdefg'), step('abcdefg')], [step('1234567'), step('1234567')]);
  assert.deepEqual(gate(noise, seven.observations, [step('q'), step('r')]).map((layers) => paths(layers.effects)), [[], []], '7 characters');
  const eight = record(noise, [step('abcdefgh'), step('abcdefgh')], [step('12345678'), step('12345678')]);
  assert.deepEqual(gate(noise, eight.observations, [step('q'), step('r')]).map((layers) => paths(layers.effects)), [[], ['storage.note']], '8 characters');
  const numbers = (value: number): Observation => ({ ...blank(), events: [{ name: 'e', payload: { value } }] });
  const nn: Noise[] = [{ layer: 'events', path: '[0].payload.value' }];
  const numeric = record(nn, [numbers(11111111), numbers(11111111)], [numbers(22222222), numbers(22222222)]);
  assert.deepEqual(gate(nn, numeric.observations, [numbers(1), numbers(2)]).map((layers) => paths(layers.events)), [[], []], 'only strings are tied');
});

test('a mask on an inherited style value follows the value of the parent', () => {
  const styled = (color: string, childColor?: string): Observation => {
    const result = blank();
    result.style = {
      'html[1]': { style: { color, display: 'block' } },
      'html[1]/body[1]': { style: childColor === undefined ? {} : { color: childColor } },
    };
    return result;
  };
  const noise: Noise[] = [{ layer: 'style', path: 'html[1].style.color' }];
  const { observations } = record(noise, [styled('rgb(1, 1, 1)')], [styled('rgb(2, 2, 2)')]);
  assert.deepEqual(observations[0].style['html[1]'].style.color, { $aa: 'noise', kind: 'string' });
  const on = (port: Observation) => paths(gate(noise, observations, [port])[0].style);
  assert.deepEqual(on(styled('rgb(9, 9, 9)')), []);
  assert.deepEqual(on(styled('rgb(9, 9, 9)', 'rgb(5, 5, 5)')), ['html[1]/body[1].style.color'], 'the child has to keep the value of its parent');
  assert.deepEqual(on(styled('rgb(9, 9, 9)', 'rgb(9, 9, 9)')), []);
});

test('the gets of one step are in an order that does not depend on a masked value', () => {
  const get = (path: string, cb: string, id?: string) => ({ ...urlParts(`http://localhost:4104${path}?cb=${cb}${id ? `&id=${id}` : ''}`, base, 'request') });
  const step = (cb1: string, cb2: string, reverse = false): Observation => {
    const result = blank();
    const gets = [get('/api/x', cb1, '1'), get('/api/x', cb2, '2')];
    result.effects.gets = reverse ? gets.reverse() : gets;
    return result;
  };
  const noise = [effects('gets[1].query.cb[0]')];
  const entries = compile(noise);
  const first = normalize(step('zzz', 'aaa'), entries);
  const second = normalize(step('aaa', 'zzz'), entries);
  assert.deepEqual(first.effects.gets.map((each) => each.query.id), [['1'], ['2']]);
  assert.deepEqual(second.effects.gets.map((each) => each.query.id), [['1'], ['2']]);
  assert.deepEqual(normalize(step('aaa', 'zzz', true), entries).effects.gets.map((each) => each.query.id), [['1'], ['2']], 'the order of arrival does not count');
  const plain = normalize(step('zzz', 'aaa'), []);
  assert.deepEqual(plain.effects.gets.map((each) => each.query.id), [['2'], ['1']], 'without noise the whole URL orders the list');
});

test('a text node of the DOM and of the accessibility tree can be noise, and an element cannot take its place', () => {
  const page = (text: string, extra = false): Observation => {
    const result = blank();
    (result.dom as { children: unknown[] }).children = [{ tag: 'p', children: [text, ...(extra ? [{ tag: 'b' }] : [])] }];
    result.accessibility.tree = [{ role: 'paragraph', children: [text] }];
    return result;
  };
  const noise: Noise[] = [
    { layer: 'dom', path: 'html[1]/p[1]/text()[1]' },
    { layer: 'accessibility', path: 'tree/paragraph[1]/text()[1]' },
  ];
  const { observations, counts } = record(noise, [page('one thing')], [page('another')]);
  assert.deepEqual(counts, [1, 1]);
  assert.deepEqual((observations[0].dom as { children: { children: unknown[] }[] }).children[0].children, [{ $aa: 'noise', kind: 'string' }]);
  const on = (port: Observation) => gate(noise, observations, [port])[0];
  assert.deepEqual(on(page('whatever')), { accessibility: [], dom: [], style: [], events: [], effects: [] });
  assert.deepEqual(paths(on(page('x', true)).dom), ['html[1]/p[1]/b[1]'], 'an element next to the masked text is a difference');
  const element = page('x');
  (element.dom as { children: { children: unknown[] }[] }).children[0].children = [{ tag: 'b' }];
  assert.deepEqual(paths(on(element).dom), ['html[1]/p[1]/text()[1]'], 'an element is no text');
});

test('the gate refuses a recording that masks what the case does not name', () => {
  const { observations } = record([effects('storage.cart')], [withStorage({ cart: 'a' })], [withStorage({ cart: 'b' })]);
  assert.deepEqual(placeholdersOutside(compile([effects('storage.cart')]), observations), []);
  assert.deepEqual(placeholdersOutside([], observations), ['step 1, side effects: storage.cart']);
  assert.deepEqual(placeholdersOutside(compile([effects('storage.other')]), observations), ['step 1, side effects: storage.cart']);
});

const caseText = (extra: Record<string, unknown>) =>
  JSON.stringify({
    format: 'angular-anything/case@1',
    id: 'c',
    viewport: { width: 800, height: 600 },
    steps: [{ action: 'goto', path: '/' }],
    ...extra,
  });

test('a case may list noise, a case without noise is as before, and a key that is not known is refused', () => {
  assert.equal(parseCase(caseText({}), 'c').noise, undefined);
  assert.deepEqual(parseCase(caseText({ noise: [] }), 'c').noise, []);
  assert.deepEqual(parseCase(caseText({ noise: [{ layer: 'effects', path: 'storage.cart' }] }), 'c').noise, [{ layer: 'effects', path: 'storage.cart' }]);
  assert.throws(() => parseCase(caseText({ noyse: [] }), 'c'), /the key "noyse" is not known, a case has format, id, description, viewport, steps, noise/);
  assert.throws(() => parseCase(caseText({ extra: 1 }), 'c'), /the key "extra" is not known/);
  assert.equal(parseCase(caseText({ description: 'x' }), 'c').id, 'c');
});

test('a noise entry that is broken is refused when the case is read', () => {
  const refused = (noise: unknown, message: RegExp) => assert.throws(() => parseCase(caseText({ noise }), 'c'), message);
  refused('storage.cart', /"noise" must be a list/);
  refused({}, /"noise" must be a list/);
  refused(['x'], /noise entry 1 is not an object/);
  refused([{ layer: 'effects' }], /noise entry 1 needs a "path"/);
  refused([{ path: 'storage.x' }], /noise entry 1 needs a "layer"/);
  refused([{ layer: 'network', path: 'x' }], /noise entry 1 needs a "layer" of accessibility, dom, style, events, effects/);
  refused([{ layer: 'screenshot', path: '' }], /a screenshot is never compared by the gate/);
  refused([{ layer: 'effects', path: 'storage.x', reason: 'y' }], /noise entry 1 has the unknown key "reason"/);
  refused([{ layer: 'effects', path: 'storage..x' }], /noise entry 1: "storage..x" is not a path/);
  refused([{ layer: 'effects', path: '' }], /noise entry 1: "" is not a path: it is empty/);
  refused([{ layer: 'effects', path: 'storage.a' }, { layer: 'effects', path: 'storage["a"]' }], /noise entry 2 is listed twice: effects storage.a/);
});

test('a noise path to an object, a list or an element is refused when the case is read', () => {
  const refused = (layer: Layer, path: string, message: RegExp) =>
    assert.throws(() => parseNoise([{ layer, path }]), message, `${layer} ${path}`);
  const accepted = (layer: Layer, path: string) => assert.doesNotThrow(() => parseNoise([{ layer, path }]), `${layer} ${path}`);
  for (const path of ['storage', 'requests', 'gets', 'url', 'requests[0]', 'requests[*]', 'gets[0]', 'gets[*]', 'requests[0].url', 'url.path', 'url.query', 'url.query.a', 'gets[0].query', 'gets[0].path', 'requests[0].url.query.q', 'requests[0].foo', 'other', 'title.x']) {
    refused('effects', path, /not one value|is not|names|has no parts/);
  }
  for (const path of ['title', 'focus', 'storage.cart', 'storage["a.b"].c[0]', 'url.path[1]', 'url.fragment', 'url.origin', 'url.query.q[0]', 'gets[0].path[*]', 'gets[*].query.cb[0]', 'requests[0].method', 'requests[0].body', 'requests[0].body.fields.a[0].content', 'requests[*].url.query.x[0]', 'requests[0].url.origin', 'popups[0].message', 'popups[*].default', 'popups[1].target', 'popups[1].features', 'popups[1].url.query.n[0]', 'popups[1].url.path[0]', 'popups[1].url.origin']) {
    accepted('effects', path);
  }
  for (const path of ['popups', 'popups[0]', 'popups[*]', 'popups[0].kind', 'popups[0].url', 'popups[0].url.query', 'popups[0].message.x', 'popups.message']) {
    refused('effects', path, /not one value|is not|names|has no parts|a part of a URL/);
  }
  for (const path of ['html[1]', 'html[1]/body[1]', 'html[1].tag', 'html[1].attrs', 'html[1].children', 'html[1].attrs.a.b', 'text()[1].x', 'html[1]/text()', 'body']) {
    refused('dom', path, /./);
  }
  for (const path of ['html[1]/body[1]/main[1].attrs.data-nonce', 'html[1]/body[1]/text()[2]', 'html[1].props.value', 'html[1]/li[*].inline.color', 'html[*]/body[1]/li[*]/label[1].attrs.for']) {
    accepted('dom', path);
  }
  for (const path of ['tree', 'tree/main[1]', 'tree/main[1].children', 'attributes', 'attributes.html[1]', 'other/x[1].name', 'tree/text()[1].x']) {
    refused('accessibility', path, /./);
  }
  for (const path of ['tree/main[1]/button[1].name', 'tree/main[1]/text()[1]', 'attributes.html[1]/body[1].aria-label']) accepted('accessibility', path);
  for (const path of ['html[1]', 'html[1].style', 'html[1].box', 'html[1].box.z', 'html[1].style.color.x', 'html[1].other.color']) refused('style', path, /./);
  for (const path of ['html[1].style.color', 'html[1]/body[1].box.width', 'html[1]/body[1]/::before.style.content']) accepted('style', path);
  for (const path of ['[0]', 'payload', '[0].other', '[0].name.x', '.name']) refused('events', path, /./);
  for (const path of ['[0].name', '[0].payload', '[0].payload.id', '[*].payload.items[2].id']) accepted('events', path);
});

test('the printed form of every path is accepted by the case as it is', () => {
  const keys = ['cart', 'a.b', 'a/b', 'a[0]', 'a]', '*', '[*]', 'x y', 'q"q', 'b\\s', '', 'ü', '$order', '__proto__'];
  const printed = keys.map((key) => ({ layer: 'effects' as const, path: keyPath('storage', key) }));
  const text = caseText({ noise: JSON.parse(JSON.stringify(printed)) });
  const parsed = parseCase(text, 'c');
  assert.deepEqual(parsed.noise, printed);
  const entries = compile(parsed.noise!);
  keys.forEach((key, at) => {
    assert.equal(entries[at].matcher.matches(keyPath('storage', key)), true, key);
    keys.forEach((other, to) => {
      if (at !== to) assert.equal(entries[at].matcher.matches(keyPath('storage', other)), false, `${key} against ${other}`);
    });
  });
});
