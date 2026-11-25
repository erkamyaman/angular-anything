import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compile } from '../src/noise.ts';
import { bodyParts, urlParts } from '../src/parts.ts';
import { maskedOutside, maskRequest, player, readNotes, requestKey } from '../src/tape.ts';
import type { Asked, TapeEntry } from '../src/tape.ts';

const base = new URL('http://localhost:4104/');

function asked(method: string, path: string, body?: string, credentials: string[] = [], type = 'application/json'): Asked {
  return {
    method,
    url: urlParts(new URL(path, base).href, base, 'request'),
    body: bodyParts(body === undefined ? null : Buffer.from(body), type),
    credentials,
  };
}

const entry = (step: number, epoch: number, request: Asked, answer: string): TapeEntry => ({
  step,
  epoch,
  ...request,
  answer: { status: 200, headers: { 'content-type': 'text/plain' }, body: answer },
});

const list = asked('GET', '/api/list?tag=x&q=a+b');
const add = asked('POST', '/api/list', '{"title":"Milk","done":false}');

const tape: TapeEntry[] = [
  entry(1, 0, list, 'first'),
  entry(1, 0, list, 'second'),
  entry(3, 0, list, 'third'),
  entry(4, 0, add, 'added'),
  entry(4, 1, list, 'with milk'),
  entry(5, 1, add, 'added again'),
  entry(6, 3, asked('GET', '/api/late'), 'late'),
];

const body = (found?: TapeEntry) => found?.answer?.body;

test('the Nth read of a step gets the Nth answer of that step in the same epoch, and the last one repeats', () => {
  const play = player(tape);
  assert.deepEqual([1, 2, 3].map(() => body(play.take(list, 1, 0))), ['first', 'second', 'second']);
  assert.deepEqual(play.findings, []);
});

test('the epoch is part of the state of a read', () => {
  const play = player(tape);
  assert.equal(body(play.take(list, 4, 1)), 'with milk');
  assert.equal(body(play.take(list, 4, 0)), 'third');
  assert.deepEqual(play.findings, []);
});

test('the step is part of the state of a read', () => {
  const play = player(tape);
  assert.equal(body(play.take(list, 3, 0)), 'third');
  assert.equal(body(play.take(list, 1, 0)), 'first');
});

test('a step that recorded no answer gets the latest of an earlier step of the epoch, and else the first of the epoch', () => {
  const play = player([entry(2, 0, list, 'a'), entry(2, 0, list, 'b'), entry(5, 0, list, 'c')]);
  assert.equal(body(play.take(list, 4, 0)), 'b');
  assert.equal(body(play.take(list, 9, 0)), 'c');
  assert.equal(body(play.take(list, 1, 0)), 'a');
  assert.deepEqual(play.findings, []);
});

test('a read in an epoch without its key gets the nearest earlier state, else the next one, and is a finding', () => {
  const play = player(tape);
  assert.equal(body(play.take(list, 7, 2)), 'with milk');
  assert.deepEqual(play.findings, [
    {
      step: 7,
      request: 'GET /api/list?tag=x&q=a b',
      expected: 'an answer on the tape for this state',
      actual: 'the tape has no answer for this state: the case needs a step in which the original asks',
    },
  ]);
  assert.equal(body(player(tape).take(asked('GET', '/api/late'), 1, 0)), 'late');
  const earlier = player([entry(1, 0, list, 'a'), entry(1, 0, list, 'b'), entry(2, 2, list, 'c'), entry(2, 2, list, 'd')]);
  assert.equal(body(earlier.take(list, 3, 1)), 'b', 'the last answer of the earlier epoch');
  const later = player([entry(2, 3, list, 'e'), entry(2, 2, list, 'c'), entry(2, 2, list, 'd')]);
  assert.equal(body(later.take(list, 1, 0)), 'c', 'the first answer of the next epoch');
});

test('a read whose key the tape does not hold gets nothing and is a finding', () => {
  const play = player(tape);
  assert.equal(play.take(asked('GET', '/api/list?q=b&tag=x'), 1, 0), undefined);
  assert.deepEqual(play.findings, [
    { step: 1, request: 'GET /api/list?q=b&tag=x', expected: 'a request that the tape holds', actual: 'the tape does not hold it, so it was aborted', differs: ['gets[*].query.q[0]'] },
  ]);
});

test('the order of query names, and + against %20, are no part of the key', () => {
  assert.equal(requestKey(asked('GET', '/api/list?q=a%20b&tag=x')), requestKey(list));
  assert.notEqual(requestKey(asked('GET', '/api/list?tag=x&tag=y')), requestKey(asked('GET', '/api/list?tag=y&tag=x')));
});

test('the order of JSON keys and of form fields is no part of the key, the order of an array is', () => {
  assert.equal(requestKey(asked('POST', '/api/list', '{"done":false,"title":"Milk"}')), requestKey(add));
  assert.equal(requestKey(asked('POST', '/a', '{"a":{"c":1,"b":2}}')), requestKey(asked('POST', '/a', '{"a":{"b":2,"c":1}}')));
  assert.notEqual(requestKey(asked('POST', '/a', '[1,2]')), requestKey(asked('POST', '/a', '[2,1]')));
  const form = (text: string) => requestKey(asked('POST', '/a', text, [], 'application/x-www-form-urlencoded'));
  assert.equal(form('a=1&b=2'), form('b=2&a=1'));
});

test('no body and an empty object are two keys, and so are two methods, two paths and two origins', () => {
  const keys = [
    asked('POST', '/a'),
    asked('POST', '/a', '{}'),
    asked('PUT', '/a'),
    asked('POST', '/a/'),
    asked('POST', 'http://other.test/a'),
  ].map((each) => requestKey(each));
  assert.equal(new Set(keys).size, keys.length);
});

test('headers are no part of the key, and a credential header that differs in presence is a finding', () => {
  const play = player([entry(1, 0, asked('GET', '/a', undefined, ['authorization']), 'ok')]);
  assert.equal(body(play.take(asked('GET', '/a', undefined, ['authorization']), 1, 0)), 'ok');
  assert.deepEqual(play.findings, []);
  assert.equal(body(play.take(asked('GET', '/a'), 1, 0)), 'ok', 'it is still answered');
  assert.equal(body(play.take(asked('GET', '/a', undefined, ['authorization', 'x-xsrf-token']), 1, 0)), 'ok');
  assert.deepEqual(play.findings, [
    { step: 1, request: 'GET /a', expected: 'with the header authorization', actual: 'without the header authorization' },
    { step: 1, request: 'GET /a', expected: 'without the header x-xsrf-token', actual: 'with the header x-xsrf-token' },
  ]);
});

test('a mutation gets the Nth answer of its key, and one more than recorded is aborted', () => {
  const play = player(tape);
  assert.equal(body(play.take(add, 4, 0)), 'added');
  assert.equal(body(play.take(add, 4, 1)), 'added again');
  assert.equal(play.take(add, 4, 2), undefined);
  assert.deepEqual(play.findings, [
    { step: 4, request: 'POST /api/list', expected: 'sent 2 times', actual: 'sent once more, so it was aborted', differs: [] },
  ]);
});

test('a changed mutation gets the next unused one with the same method and path, and the two bodies are reported', () => {
  const other = asked('POST', '/api/list', '{"title":"Eggs","done":false}');
  const play = player(tape);
  assert.equal(body(play.take(add, 4, 0)), 'added');
  assert.equal(body(play.take(other, 5, 1)), 'added again');
  assert.deepEqual(play.findings, [
    {
      step: 5,
      request: 'POST /api/list (changed mutation)',
      expected: { url: add.url, body: add.body },
      actual: { url: other.url, body: other.body },
      differs: ['requests[*].body.title'],
    },
  ]);
  assert.equal(play.take(other, 5, 2), undefined, 'none is left');
  assert.equal(play.findings[1].actual, 'the tape does not hold it, so it was aborted');
  assert.equal(player(tape).take(asked('PUT', '/api/list', '{}'), 4, 0), undefined, 'another method');
  assert.equal(player(tape).take(asked('POST', '/api/other', '{}'), 4, 0), undefined, 'another path');
});

test('the second run of record gets the closest recorded read for one that the tape does not hold, and it stays a finding', () => {
  const play = player([entry(1, 0, asked('GET', '/a?n=1&m=1'), 'one'), entry(1, 0, asked('GET', '/a?n=2&m=2'), 'two')], [], true);
  assert.equal(body(play.take(asked('GET', '/a?n=2&m=3'), 1, 0)), 'two');
  assert.deepEqual(play.findings[0].differs, ['gets[*].query.m[0]']);
});

test('a part that the case names as noise is not part of the key, of a read and of a mutation', () => {
  const noise = compile([
    { layer: 'effects', path: 'gets[0].query.cb[0]' },
    { layer: 'effects', path: 'requests[1].body.id' },
  ]);
  const read = (cb: string) => asked('GET', `/a?cb=${cb}`);
  const write = (id: string) => asked('POST', '/a', `{"id":"${id}"}`);
  assert.equal(requestKey(read('1'), noise), requestKey(read('2'), noise));
  assert.equal(requestKey(write('1'), noise), requestKey(write('2'), noise));
  assert.notEqual(requestKey(read('1')), requestKey(read('2')));
  assert.notEqual(requestKey(write('1'), noise), requestKey(asked('POST', '/a', '{"id":7}'), noise), 'the kind stays');
  const play = player([entry(1, 0, read('1'), 'r'), entry(1, 0, write('1'), 'w')], noise);
  assert.equal(body(play.take(read('2'), 1, 0)), 'r');
  assert.equal(body(play.take(write('2'), 1, 0)), 'w');
  assert.deepEqual(play.findings, []);
  const stored = maskRequest(write('1'), noise);
  assert.deepEqual(stored.body, { id: { $aa: 'noise', kind: 'string' } });
  assert.deepEqual(maskRequest(read('1'), noise).url.query, { cb: [{ $aa: 'noise', kind: 'string' }] });
  const masked = [entry(1, 0, maskRequest(read('1'), noise), 'r'), entry(1, 0, stored, 'w')];
  assert.equal(body(player(masked, noise).take(write('9'), 1, 0)), 'w');
  assert.deepEqual(maskedOutside(masked, noise), []);
  assert.deepEqual(maskedOutside(masked, []), ['gets[0].query.cb[0]', 'requests[0].body.id']);
});

test('an answer that the original did not get is not invented, and it is no finding', () => {
  const play = player([{ step: 1, epoch: 0, ...list, answer: null }]);
  assert.equal(play.take(list, 1, 0)?.answer, null);
  assert.deepEqual(play.findings, []);
});

test('every request that was taken is listed with its step', () => {
  const play = player(tape);
  play.take(list, 1, 0);
  play.take(asked('GET', '/api/none'), 2, 0);
  assert.deepEqual(play.taken.map((each) => [each.step, each.url.path.join('/')]), [
    [1, 'api/list'],
    [2, 'api/none'],
  ]);
});

test('reads that the port sends more often, less often or in another order are noted, mutations are not', () => {
  const [a, b] = [asked('GET', '/a'), asked('GET', '/b')];
  const original = [entry(2, 0, a, ''), entry(2, 0, b, ''), entry(2, 0, add, '')];
  const notes = (...reads: Asked[]) => readNotes(original, reads.map((read) => ({ ...read, step: 2 })), 2);
  assert.deepEqual(notes(a, b), []);
  assert.deepEqual(notes(a, a, b), ['GET /a: the original sent it 1 time, the port 2 times']);
  assert.deepEqual(notes(a), ['GET /b: the original sent it 1 time, the port 0 times']);
  assert.deepEqual(notes(b, a), ['the order of the reads differs: the original GET /a, GET /b, the port GET /b, GET /a']);
  assert.deepEqual(notes(b, a, a), [
    'GET /a: the original sent it 1 time, the port 2 times',
    'the order of the reads differs: the original GET /a, GET /b, the port GET /b, GET /a',
  ]);
  assert.deepEqual(notes(a, b, asked('GET', '/c')), ['GET /c: the original sent it 0 times, the port 1 time']);
  assert.deepEqual(readNotes(original, [{ ...a, step: 1 }], 2).length, 2, 'only the reads of the step count');
});
