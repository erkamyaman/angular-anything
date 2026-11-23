import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { compare } from '../src/compare.ts';
import type { Observation } from '../src/compare.ts';
import { bodyParts, storageValue, urlParts } from '../src/parts.ts';

const base = new URL('http://localhost:4104/');

const blank = (): Observation => ({
  accessibility: { tree: [], attributes: {} },
  dom: { tag: 'html' },
  style: {},
  events: [],
  effects: { requests: [], gets: [], storage: {}, url: urlParts('http://localhost:4104/', base, 'page'), title: '', focus: null, popups: [] },
});

const stored = (...values: unknown[]) => {
  const [left, right] = values;
  const a = blank();
  const b = blank();
  a.effects.storage = { key: left };
  b.effects.storage = { key: right };
  return compare(a, b).effects;
};

const sameText = (left: string, right: string) => stored(storageValue(left), storageValue(right));

test('a stored value is taken apart only when it parses to an object or a list', () => {
  assert.deepEqual(storageValue('[1,2]'), [1, 2]);
  assert.deepEqual(storageValue('{"a":1}'), { a: 1 });
  for (const text of ['https://example.com/a?b=1&b=2', '/api/items?cb=1', 'a=1&b=2', '7', '"seven"', 'true', 'null', 'plain text', '', '{broken', '[1,', '0x10', 'NaN']) {
    assert.equal(storageValue(text), text, `${JSON.stringify(text)} is a string`);
  }
  const deep = '['.repeat(100000) + ']'.repeat(100000);
  assert.equal(storageValue(deep), deep, 'a text too deep to parse is a string, not a crash');
});

test('a stored value that parses on one side and not on the other is a difference at its key', () => {
  assert.deepEqual(sameText('[{"id":1}]', '[{"id":1}'), [
    { path: 'storage.key', expected: [{ id: 1, }], actual: '[{"id":1}' },
  ]);
  assert.deepEqual(sameText('plain', '{"a":1}').map((difference) => difference.path), ['storage.key']);
  assert.deepEqual(sameText('7', '"7"').map((difference) => difference.path), ['storage.key']);
  assert.deepEqual(sameText('7', '7'), []);
});

test('a stored JSON value is compared by its parts, spaces and escapes do not count', () => {
  assert.deepEqual(sameText('{"a": 1, "b": [1, 2]}', '{"a":1,"b":[1,2]}'), []);
  assert.deepEqual(sameText('{"a":"A"}', '{"a":"\\u0041"}'), []);
  assert.deepEqual(
    sameText('[{"id":"x","done":false}]', '[{"id":"x","done":true}]').map(({ path, expected, actual }) => [path, expected, actual]),
    [['storage.key[0].done', false, true]],
  );
});

test('inside a stored JSON value the order of the keys counts, in every object', () => {
  const differences = sameText('{"id":1,"text":"a"}', '{"text":"a","id":1}');
  assert.equal(differences.length, 1);
  assert.equal(differences[0].path, 'storage.key.$order');
  assert.deepEqual(differences[0].expected, ['id', 'text']);
  assert.equal(sameText('[{"a":1,"b":{"x":1,"y":2}}]', '[{"a":1,"b":{"y":2,"x":1}}]')[0].path, 'storage.key[0].b.$order');
  assert.deepEqual(sameText('{"a":1,"b":2}', '{"a":1,"b":2}'), []);
  assert.deepEqual(sameText('{"only":1}', '{"only":1}'), []);
  assert.deepEqual(sameText('{"b":1,"2":1,"1":1}', '{"b":1,"1":1,"2":1}'), [], 'keys of integer form are ordered by the engine: their order among themselves is not told');
  assert.equal(sameText('{"b":1,"2":1,"1":1}', '{"2":1,"b":1,"1":1}').length, 0, 'the same limit');
  assert.equal(sameText('{"a":1,"b":1,"2":1}', '{"b":1,"a":1,"2":1}').length, 1, 'keys of other forms are told');
});

test('a number in a stored value is compared as it is written', () => {
  assert.equal(sameText('{"price":1.1}', '{"price":1.10}')[0].path, 'storage.key.price');
  assert.equal(sameText('[1e2]', '[100]')[0].path, 'storage.key[0]');
  assert.equal(sameText('[12345678901234567890]', '[12345678901234567891]')[0].path, 'storage.key[0]');
  assert.deepEqual(sameText('{"price":1.5,"n":0}', '{"price":1.5,"n":0}'), []);
  assert.equal(sameText('{"price":"1.1"}', '{"price":1.1}')[0].path, 'storage.key.price', 'a string is not a number');
  assert.equal(sameText('[1.10]', '["1.10"]')[0].path, 'storage.key[0]');
});

test('keys that this tool uses itself, and keys that every object has, are plain keys', () => {
  assert.deepEqual(sameText('{"$aa":"x","$order":1}', '{"$aa":"x","$order":1}'), []);
  assert.equal(sameText('{"$aa":"x"}', '{"$aa":"y"}').length, 1);
  assert.deepEqual(Object.keys(storageValue('{"$order":1,"b":2}') as object).sort(), ['$$order', '$order', 'b']);
  assert.deepEqual(sameText('{}', '{"__proto__":{}}').map((difference) => difference.path), ['storage.key.__proto__'], 'a missing key is not the prototype');
  assert.deepEqual(sameText('{"__proto__":{"x":1}}', '{}').map((difference) => difference.path), ['storage.key.__proto__'], 'a key named __proto__ is a key');
  assert.equal(sameText('{"constructor":1}', '{}').length, 1, 'a key named constructor is not found on an empty object');
  assert.equal(sameText('{"toString":"x"}', '{"toString":"x"}').length, 0);
});

test('the parts of a request URL: the path as sent, the query decoded', () => {
  const parts = (href: string) => urlParts(href, base, 'request');
  assert.deepEqual(parts('http://localhost:4104/api/items?tag=a&tag=b&q=x+y'), {
    path: ['api', 'items'],
    query: { tag: ['a', 'b'], q: ['x y'] },
  });
  assert.deepEqual(parts('http://localhost:4104/api/items?q=x%20y').query, parts('http://localhost:4104/api/items?q=x+y').query);
  assert.deepEqual(parts('http://localhost:4104/a?q=a%2Bb').query, { q: ['a+b'] }, '%2B is a plus');
  assert.deepEqual(parts('http://localhost:4104/a?x=1&y=2').query, parts('http://localhost:4104/a?y=2&x=1').query);
  assert.notDeepEqual(parts('http://localhost:4104/a?tag=a&tag=b').query, parts('http://localhost:4104/a?tag=b&tag=a').query);
  assert.deepEqual(parts('http://localhost:4104/a%2Fb').path, ['a%2Fb'], 'the path counts as sent');
  assert.notDeepEqual(parts('http://localhost:4104/a%20b').path, parts('http://localhost:4104/a-b').path);
  assert.notDeepEqual(parts('http://localhost:4104/a%7Eb').path, parts('http://localhost:4104/a~b').path, 'a request path is not decoded');
  assert.equal(parts('http://other.test/x').origin, 'http://other.test');
  assert.equal(parts('http://localhost:4104/x').origin, undefined);
  assert.deepEqual(parts('http://localhost:4104/a?flag').query, { flag: [''] });
  assert.deepEqual(parts('http://localhost:4104/a?__proto__=1').query, { ['__proto__']: ['1'] });
});

test('the parts of the URL of the page: segments decoded, query like a request, fragment as sent', () => {
  const page = (href: string) => urlParts(href, base, 'page');
  assert.deepEqual(page('http://localhost:4104/a%20b/c?x=1#top'), { path: ['a b', 'c'], query: { x: ['1'] }, fragment: 'top' });
  assert.deepEqual(page('http://localhost:4104/a%20b').path, page('http://localhost:4104/a b').path);
  assert.notDeepEqual(page('http://localhost:4104/a%2Fb').path, page('http://localhost:4104/a/b').path, 'a slash in a segment stays one');
  assert.deepEqual(page('http://localhost:4104/a%7Eb').path, page('http://localhost:4104/a~b').path);
  assert.deepEqual(page('http://localhost:4104/%E0%A4%A').path, ['%E0%A4%A'], 'a segment that does not decode stays as it is');
  assert.notEqual(page('http://localhost:4104/#a').fragment, page('http://localhost:4104/#b').fragment);
  assert.equal(page('http://localhost:4104/#A%20B').fragment, 'A%20B', 'the fragment is as sent');
  assert.equal(page('http://localhost:4104/').fragment, '');
});

const buffer = (text: string) => Buffer.from(text, 'latin1');
const multipart = (boundary: string, ...parts: string[]) =>
  buffer(`${parts.map((part) => `--${boundary}\r\n${part}\r\n`).join('')}--${boundary}--\r\n`);
const field = (name: string, value: string) => `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}`;
const file = (name: string, filename: string, type: string, content: string) =>
  `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n${content}`;

test('a body is taken apart by its content type: JSON, form and multipart', () => {
  assert.deepEqual(bodyParts(Buffer.from('{"b":1,"a":[1,2]}'), 'application/json'), { b: 1, a: [1, 2] });
  assert.deepEqual(bodyParts(Buffer.from('{"a":1}'), 'text/plain;charset=UTF-8'), { a: 1 }, 'fetch sends JSON text as text/plain');
  assert.deepEqual(bodyParts(Buffer.from('{"a":1}'), ''), { a: 1 });
  assert.equal(bodyParts(Buffer.from('5'), 'application/json'), '5', 'a body that is no object or list is a string');
  assert.equal(bodyParts(Buffer.from('{"a"'), 'application/json'), '{"a"');
  assert.equal(bodyParts(null, ''), null);
  assert.deepEqual(bodyParts(Buffer.from('b=2&a=1&a=0&c=x+y'), 'application/x-www-form-urlencoded'), {
    $aa: 'form',
    fields: { b: ['2'], a: ['1', '0'], c: ['x y'] },
  });
  assert.deepEqual(bodyParts(Buffer.from('{"$aa":"form","fields":{}}'), 'application/json'), { $$aa: 'form', fields: {} });
});

test('a form body: the order of fields with different names does not count, the order of repeated names does', () => {
  const form = (text: string) => bodyParts(Buffer.from(text), 'application/x-www-form-urlencoded');
  assert.deepEqual(form('a=1&b=2'), form('b=2&a=1'));
  assert.deepEqual(form('q=x+y'), form('q=x%20y'));
  assert.notDeepEqual(form('a=1&a=2'), form('a=2&a=1'));
  assert.notDeepEqual(form('a=1'), form('c=1'));
  assert.notDeepEqual(form('a=1'), bodyParts(Buffer.from('a=1'), 'text/plain'), 'a form is not a string');
});

test('a multipart body is compared by the names, file names, types and contents of its parts, never by the boundary', () => {
  const type = (boundary: string) => `multipart/form-data; boundary=${boundary}`;
  const a = bodyParts(multipart('----X1', field('title', 'Report'), field('kind', 'pdf')), type('----X1'));
  const b = bodyParts(multipart('----Y2', field('title', 'Report'), field('kind', 'pdf')), type('----Y2'));
  assert.deepEqual(a, b);
  assert.deepEqual(a, {
    $aa: 'multipart',
    fields: { title: [{ content: 'Report' }], kind: [{ content: 'pdf' }] },
  });
  const reordered = bodyParts(multipart('----Y2', field('kind', 'pdf'), field('title', 'Report')), type('----Y2'));
  assert.deepEqual(a, reordered, 'parts with different names are in no order');
  const repeated = (...values: string[]) => bodyParts(multipart('B', ...values.map((value) => field('tag', value))), type('B'));
  assert.notDeepEqual(repeated('1', '2'), repeated('2', '1'), 'parts with one name keep their order');
  assert.notDeepEqual(a, bodyParts(multipart('B', field('title', 'WRONG'), field('kind', 'pdf')), type('B')));
  assert.notDeepEqual(a, bodyParts(multipart('B', field('title', 'Report'), field('other', 'pdf')), type('B')));
  assert.notDeepEqual(a, bodyParts(multipart('B', field('title', 'Report')), type('B')), 'a missing part');
  assert.notDeepEqual(a, bodyParts(multipart('B', field('title', 'Report'), field('kind', 'pdf'), field('x', '1')), type('B')));
  assert.deepEqual(bodyParts(multipart('----X1', field('title', 'Report'), field('kind', 'pdf')), ''), a, 'the boundary is found without the header');
});

test('a file part is compared by file name, type, size and content', () => {
  const type = 'multipart/form-data; boundary=B';
  const one = (filename: string, mime: string, content: string) => bodyParts(multipart('B', file('upload', filename, mime, content)), type);
  const sha = createHash('sha256').update('hello').digest('hex');
  assert.deepEqual(one('a.txt', 'text/plain', 'hello'), {
    $aa: 'multipart',
    fields: { upload: [{ filename: 'a.txt', type: 'text/plain', size: 5, content: `sha256:${sha}` }] },
  });
  assert.deepEqual(one('a.txt', 'text/plain', 'hello'), one('a.txt', 'text/plain', 'hello'));
  assert.notDeepEqual(one('a.txt', 'text/plain', 'hello'), one('b.txt', 'text/plain', 'hello'), 'the file name');
  assert.notDeepEqual(one('a.txt', 'text/plain', 'hello'), one('a.txt', 'text/csv', 'hello'), 'the type');
  assert.notDeepEqual(one('a.txt', 'text/plain', 'hello'), one('a.txt', 'text/plain', 'hellp'), 'the content');
  assert.notDeepEqual(one('a.txt', 'text/plain', 'hello'), one('a.txt', 'text/plain', 'hello!'), 'the size');
  const binary = bodyParts(Buffer.concat([buffer('--B\r\n'), buffer('Content-Disposition: form-data; name="f"; filename="x.bin"\r\n\r\n'), Buffer.from([0, 255, 254, 1]), buffer('\r\n--B--\r\n')]), type);
  assert.equal((binary as { fields: Record<string, { size: number }[]> }).fields.f[0].size, 4);
  const empty = bodyParts(multipart('B', 'Content-Disposition: form-data; name="f"; filename=""\r\nContent-Type: application/octet-stream\r\n\r\n'), type);
  assert.equal((empty as { fields: Record<string, { size: number }[]> }).fields.f[0].size, 0, 'no file chosen');
});

test('a text part with bytes that are not UTF-8 is compared by its bytes, and a damaged multipart body is a string', () => {
  const type = 'multipart/form-data; boundary=B';
  const bytes = Buffer.concat([buffer('--B\r\nContent-Disposition: form-data; name="t"\r\n\r\n'), Buffer.from([0xff, 0xfe]), buffer('\r\n--B--\r\n')]);
  const parsed = bodyParts(bytes, type) as { fields: Record<string, { content: string }[]> };
  assert.equal(parsed.fields.t[0].content, 'base64://4=');
  assert.equal(typeof bodyParts(buffer('--B\r\nContent-Disposition: form-data; name="t"\r\n\r\nno end'), type), 'string');
  assert.equal(typeof bodyParts(buffer('not multipart at all'), type), 'string');
  const unicode = bodyParts(Buffer.from('--B\r\nContent-Disposition: form-data; name="näme"\r\n\r\nvälue\r\n--B--\r\n', 'utf8'), type) as {
    fields: Record<string, { content: string }[]>;
  };
  assert.deepEqual(Object.keys(unicode.fields), ['näme']);
  assert.equal(unicode.fields['näme'][0].content, 'välue');
});

test('a percent sequence that is not UTF-8 is kept as bytes, so another byte is a difference', () => {
  const query = (search: string) => urlParts(`http://localhost:4104/a${search}`, base, 'request').query;
  const page = (search: string) => urlParts(`http://localhost:4104/a${search}`, base, 'page').query;
  for (const read of [query, page]) {
    assert.notDeepEqual(read('?q=%ff'), read('?q=%fe'));
    assert.deepEqual(read('?q=%FF'), read('?q=%ff'), 'the case of the hex digits does not count');
    assert.deepEqual(read('?q=%ff'), { q: ['base64:/w=='] });
    assert.deepEqual(read('?q=a%ffb'), { q: ['base64:Yf9i'] });
    assert.notDeepEqual(read('?q=%C3%A9'), read('?q=e%CC%81'), 'two spellings of one letter are two values');
    assert.deepEqual(read('?q=%C3%A9'), { q: ['é'] });
    assert.deepEqual(read('?q=%C3%A9'), read('?q=%c3%a9'));
    assert.deepEqual(read('?q=%zz'), { q: ['%zz'] });
    assert.notDeepEqual(read('?q=%zz'), read('?q=%zy'));
    assert.deepEqual(read('?q=%4'), { q: ['%4'] });
    assert.deepEqual(read('?a+b=c+d&e&&=f'), { 'a b': ['c d'], e: [''], '': ['f'] });
    assert.deepEqual(read('?%ff=1'), { 'base64:/w==': ['1'] }, 'a name is read the same way');
  }
  const form = (text: string) => bodyParts(Buffer.from(text, 'latin1'), 'application/x-www-form-urlencoded');
  assert.notDeepEqual(form('a=%ff'), form('a=%fe'));
  assert.deepEqual(form('a=%ff'), { $aa: 'form', fields: { a: ['base64:/w=='] } });
  assert.deepEqual(form('a=%C3%A9'), { $aa: 'form', fields: { a: ['é'] } });
});

test('a JSON number of a request body keeps the digits that a double does not hold', () => {
  const json = (text: string) => bodyParts(Buffer.from(text), 'application/json');
  const left = blank();
  const right = blank();
  const request = (body: unknown) => ({ method: 'POST', url: urlParts('http://localhost:4104/x', base, 'request'), body });
  const differences = (a: string, b: string) => {
    left.effects.requests = [request(json(a))] as never;
    right.effects.requests = [request(json(b))] as never;
    return compare(left, right).effects.map((difference) => difference.path);
  };
  assert.deepEqual(differences('{"id":12345678901234567890}', '{"id":12345678901234567890}'), []);
  assert.equal(differences('{"id":12345678901234567890}', '{"id":12345678901234567891}').length, 1);
  assert.equal(differences('{"p":0.1000000000000000055511151231257827}', '{"p":0.1}').length, 1);
  assert.deepEqual(differences('{"id":1.0}', '{"id":1}'), [], 'a trailing zero is the same number');
  assert.deepEqual(differences('{"id":1e2}', '{"id":100}'), [], 'an exponent is the same number');
  assert.deepEqual(differences('{"id":100.50}', '{"id":100.5}'), []);
  assert.deepEqual(differences('{"id":-0}', '{"id":0}'), []);
  assert.deepEqual(differences('{"id":12345678901234567890}', '{"id":1.234567890123456789e19}'), [], 'the same digits, another form');
  assert.equal(differences('{"id":5e-10}', '{"id":0}').length, 1);
  assert.equal(differences('{"id":1}', '{"id":"1"}').length, 1);
  assert.deepEqual(json('[12345678901234567890]'), json('[12345678901234567890]'));
  assert.deepEqual(json('{"id":7,"list":[1.5,2]}'), { id: 7, list: [1.5, 2] }, 'a number that a double holds stays a number');
});

test('a boundary written in quotes is read, and so is one that is not', () => {
  const body = multipart('a b', field('title', 'Report'));
  const quoted = bodyParts(body, 'multipart/form-data; boundary="a b"');
  assert.deepEqual(quoted, { $aa: 'multipart', fields: { title: [{ content: 'Report' }] } });
  assert.deepEqual(bodyParts(multipart('plain', field('title', 'Report')), 'multipart/form-data; boundary=plain; charset=utf-8'), quoted);
});
