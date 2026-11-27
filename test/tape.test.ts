import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compile } from '../src/noise.ts';
import { bodyParts, urlParts } from '../src/parts.ts';
import { agreedTape, maskedOutside, maskRequest, player, readNotes, requestKey } from '../src/tape.ts';
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
  const play = player([entry(1, 0, asked('GET', '/a?n=1&m=1'), 'one'), entry(1, 0, asked('GET', '/a?n=2&m=2'), 'two')], true);
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
  const play = player([entry(1, 0, maskRequest(read('1'), noise), 'r'), entry(1, 0, maskRequest(write('1'), noise), 'w')]);
  assert.equal(body(play.take(read('2'), 1, 0)), 'r');
  assert.equal(body(play.take(write('2'), 1, 0)), 'w');
  assert.deepEqual(play.findings, []);
  const stored = maskRequest(write('1'), noise);
  assert.deepEqual(stored.body, { id: { $aa: 'noise', kind: 'string' } });
  assert.deepEqual(maskRequest(read('1'), noise).url.query, { cb: [{ $aa: 'noise', kind: 'string' }] });
  const masked = [entry(1, 0, maskRequest(read('1'), noise), 'r'), entry(1, 0, stored, 'w')];
  assert.equal(body(player(masked).take(write('9'), 1, 0)), 'w');
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

test('a taped mutation of a step that ran and that nothing took is a finding of that step', () => {
  const play = player(tape);
  play.take(add, 4, 0);
  assert.deepEqual(play.unsent(3), []);
  assert.deepEqual(play.unsent(4), []);
  assert.deepEqual(play.unsent(6), [
    {
      step: 5,
      request: 'POST /api/list',
      expected: 'sent in this step',
      actual: 'the page did not send it, or cancelled it before it was let go',
      differs: [],
      absent: true,
    },
  ]);
});

test('a changed mutation takes the one it stands for, so that one is not missing as well', () => {
  const play = player(tape);
  play.take(asked('POST', '/api/list', '{"title":"Eggs","done":false}'), 4, 0);
  assert.deepEqual(play.unsent(4), []);
});

const noisy = compile([
  { layer: 'effects', path: 'gets[0].path[2]' },
  { layer: 'effects', path: 'gets[0].query.r[0]' },
  { layer: 'effects', path: 'requests[0].url.path[2]' },
  { layer: 'effects', path: 'requests[0].body.id' },
  { layer: 'effects', path: 'requests[0].body.n' },
  { layer: 'effects', path: 'requests[0].body.big' },
]);
const mask = { $aa: 'noise', kind: 'string' };
const user = (id: string, r = 'x') => asked('GET', `/api/user/${id}?r=${r}`);
const save = (id: string, body: string) => asked('POST', `/api/user/${id}`, body);
const never = () => false;
const agreed = (first: Asked[], again: Asked[], withheld: (text: string, names: string[]) => boolean = never) =>
  agreedTape(
    first.map((request, at) => entry(1, 0, request, `${at}`)),
    again.map((request) => ({ ...request, step: 1 })),
    noisy,
    withheld,
  );

test('at a noise path the tape keeps what the two runs of record agree on, request by request in any order', () => {
  const kept = agreed(
    [user('1', 'same'), user('rand1', 'same'), user('2', 'q1'), save('7', '{"id":"a1","n":5,"t":"x"}')],
    [save('7', '{"id":"b2","n":5,"t":"x"}'), user('2', 'q2'), user('rand2', 'same'), user('1', 'same')],
  );
  assert.deepEqual(
    kept.map((each) => [each.url.path[2], each.url.query.r?.[0], each.body, each.answer?.body]),
    [
      ['1', 'same', null, '0'],
      [mask, 'same', null, '1'],
      ['2', mask, null, '2'],
      ['7', undefined, { id: mask, n: 5, t: 'x' }, '3'],
    ],
  );
});

test('each request of the first run is held against one request of the second, its exact one first', () => {
  const parts = (first: Asked[], again: Asked[]) => agreed(first, again).map((each) => [each.url.path[2], each.url.query.r[0]]);
  assert.deepEqual(parts([user('rand1'), user('1')], [user('1'), user('rand2')]), [[mask, 'x'], ['1', 'x']]);
  assert.deepEqual(parts([user('1', 'a'), user('1', 'z')], [user('1', 'a'), user('2', 'y')]), [['1', 'a'], [mask, mask]]);
  assert.deepEqual(
    parts([user('1', 'a'), user('1', 'a'), user('1', 'z')], [user('1', 'a'), user('1', 'a'), user('2', 'y')]),
    [['1', 'a'], ['1', 'a'], [mask, mask]],
  );
  assert.deepEqual(parts([user('x1', 'a'), user('x2', 'a')], [user('y', 'a'), user('z', 'b')]), [[mask, 'a'], [mask, mask]]);
});

test('a request that the second run did not send is masked at every noise path, and one sent less often keeps what the other one shows', () => {
  const [alone] = agreed([user('1')], []);
  assert.deepEqual([alone.url.path[2], alone.url.query.r], [mask, [mask]]);
  assert.deepEqual(agreed([user('1'), user('1')], [user('1')]).map((each) => each.url.path[2]), ['1', '1']);
  const [other] = agreed([user('1')], [asked('GET', '/api/group/1?r=x')]);
  assert.deepEqual(other.url.path[2], mask);
  const [early] = agreedTape([entry(2, 0, user('1'), '')], [{ ...user('9'), step: 1 }, { ...user('1'), step: 3 }], noisy, never);
  assert.equal(early.url.path[2], '1');
  const [same] = agreedTape([entry(2, 0, user('1'), '')], [{ ...user('1'), step: 1 }, { ...user('9'), step: 2 }], noisy, never);
  assert.deepEqual(same.url.path[2], mask);
});

test('a value that is withheld is never kept, and it is asked about with the names on its path', () => {
  const asks: [string, string[]][] = [];
  const [read, write] = agreed([user('1', 'hidden'), save('7', '{"id":"hidden","n":12345}')], [user('1', 'hidden'), save('7', '{"id":"hidden","n":12345}')], (text, names) => {
    asks.push([text, names]);
    return text === 'hidden' || text === '12345';
  });
  assert.deepEqual([read.url.path[2], read.url.query.r], ['1', [mask]]);
  assert.deepEqual(write.body, { id: mask, n: { $aa: 'noise', kind: 'number' } });
  assert.deepEqual(asks.find(([text]) => text === '12345')?.[1], ['requests', 'body', 'n']);
  const large = save('7', '{"big":12345678901234567890}');
  agreed([large], [large], (text) => (asks.push([text, []]), false));
  assert.ok(asks.some(([text]) => text === '12345678901234567890'), JSON.stringify(asks));
});

test('the gate checks a kept part and lets a masked one be anything of its kind', () => {
  const tape = agreed(
    [user('1'), user('rand1'), save('7', '{"id":"a1","n":5}')],
    [user('1'), user('rand2'), save('7', '{"id":"b2","n":5}')],
  );
  const play = player(tape);
  assert.equal(body(play.take(user('whatever'), 1, 0)), '1');
  assert.equal(body(play.take(user('1'), 1, 0)), '0');
  assert.equal(body(play.take(save('7', '{"id":"c3","n":5}'), 1, 0)), '2');
  assert.deepEqual(play.findings, []);
  for (const wrong of [save('8', '{"id":"c3","n":5}'), save('7', '{"id":"c3","n":6}'), save('7', '{"id":3,"n":5}')]) {
    const other = player(tape);
    other.take(wrong, 1, 0);
    assert.equal(other.findings.length, 1, JSON.stringify(wrong));
  }
  const changed = player(tape);
  changed.take(save('7', '{"id":"c3","n":6}'), 1, 0);
  assert.deepEqual(changed.findings[0].differs, ['requests[*].body.n']);
  assert.deepEqual(changed.findings[0].actual, { url: tape[2].url, body: { id: mask, n: 6 } });
  const only = player([tape[0]]);
  assert.equal(only.take(user('999'), 1, 0), undefined);
  assert.deepEqual(only.findings[0].differs, ['gets[*].path[2]']);
});

test('kept parts that differ only at noise paths have their own answers and counts', () => {
  const requests = [user('1'), user('1'), user('2')];
  const reads = player(agreed(requests, requests));
  assert.deepEqual([user('2'), user('1'), user('1')].map((each) => body(reads.take(each, 1, 0))), ['2', '0', '1']);
  const writes = [save('7', '{"id":"a","n":1}'), save('8', '{"id":"a","n":1}')];
  const play = player(agreed(writes, writes));
  assert.deepEqual([writes[1], writes[0]].map((each) => body(play.take(each, 1, 0))), ['1', '0']);
  assert.deepEqual(play.findings, []);
});

test('the entry that keeps the most is the one that answers, and the next one takes what is left', () => {
  const tape = agreed([user('rand1'), user('1')], [user('rand2'), user('1')]);
  assert.equal(body(player(tape).take(user('1'), 1, 0)), '1');
  const writes = agreed([save('rand1', '{}'), save('1', '{}')], [save('rand2', '{}'), save('1', '{}')]);
  const play = player(writes);
  assert.deepEqual([save('1', '{}'), save('1', '{}')].map((each) => body(play.take(each, 1, 0))), ['1', '0']);
  assert.deepEqual(play.findings, []);
});

test('what differs from the tape is told without the parts that the nearest request stores as their kind', () => {
  const tape = agreed(
    [asked('GET', '/api/group/9?r=c'), user('5', 'a')],
    [asked('GET', '/api/group/9?r=c'), user('5', 'b')],
  );
  const play = player(tape);
  play.take(user('999', 'c'), 1, 0);
  assert.deepEqual(play.findings[0].differs, ['gets[*].path[2]']);
});

test('a changed mutation is also found where its path stores a part as its kind', () => {
  const play = player(agreed([save('rand1', '{"t":1}')], [save('rand2', '{"t":1}')]));
  play.take(save('rand3', '{"t":2}'), 1, 0);
  assert.equal(play.findings[0].request, 'POST /api/user/rand3 (changed mutation)');
  assert.deepEqual(play.findings[0].differs, ['requests[*].body.t']);
});
