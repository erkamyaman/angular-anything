import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CDPSession, Request } from 'playwright';
import { sendOrder } from '../src/order.ts';

type Seen = { method?: string; headers?: Record<string, string>; body?: string };

function fake() {
  const listeners = new Map<string, (event: unknown) => void>();
  const late: (() => void)[] = [];
  const emit = (name: string, event: unknown) => listeners.get(name)!(event);
  const session = {
    on: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
    async send(method: string) {
      if (method === 'Runtime.evaluate') for (const each of late.splice(0)) each();
    },
  } as unknown as CDPSession;
  let ids = 0;
  const sends = (name: string, { method = 'GET', headers = {}, body }: Seen = {}, parts?: { bytes?: string }[]) => {
    const requestId = String(++ids);
    const postDataEntries = parts ?? (body === undefined ? undefined : [{ bytes: Buffer.from(body).toString('base64') }]);
    emit('Network.requestWillBeSent', { requestId, request: { method, url: `http://h/${name}`, headers, postDataEntries } });
    return requestId;
  };
  const ends = (requestId: string, name = 'Network.loadingFinished') => emit(name, { requestId });
  return { session, sends, ends, late };
}

const request = (name: string, { method = 'GET', headers = {}, body }: Seen = {}) =>
  ({
    method: () => method,
    url: () => `http://h/${name}`,
    headers: () => headers,
    postDataBuffer: () => (body === undefined ? null : Buffer.from(body)),
  }) as unknown as Request;

test('requests are put in the order in which the page sent them, also when the page has only now said so', async () => {
  const { session, sends, late } = fake();
  const order = await sendOrder(session);
  const [a, b, c] = [request('a'), request('b', { method: 'POST' }), request('c')];
  late.push(() => {
    sends('a');
    sends('b', { method: 'POST' });
    sends('c');
  });
  assert.deepEqual(await order.sorted([c, b, a]), [a, b, c]);
});

test('requests with one URL are told apart by their method, their body and their headers', async () => {
  const { session, sends } = fake();
  const order = await sendOrder(session);
  const sent: Seen[] = [
    { method: 'PUT', body: 'one' },
    { method: 'POST', body: 'one' },
    { method: 'POST', body: 'two' },
    { headers: { Accept: '*/*', Authorization: 'x' } },
    { headers: { Accept: '*/*' } },
    { headers: { Accept: '*/*', 'X-Page': '1' } },
  ];
  for (const each of sent) sends('same', each);
  const arrived = sent.map((each) =>
    request('same', {
      ...each,
      headers: Object.fromEntries(Object.entries(each.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])),
    }),
  );
  assert.deepEqual(await order.sorted(arrived.toReversed()), arrived);
});

test('a body that the page does not show whole fits any body', async () => {
  const { session, sends } = fake();
  const order = await sendOrder(session);
  sends('file', { method: 'POST' }, [{ bytes: Buffer.from('head').toString('base64') }, {}]);
  sends('b');
  const [file, b] = [request('file', { method: 'POST', body: 'head and file' }), request('b')];
  assert.deepEqual(await order.sorted([b, file]), [file, b]);
});

test('a request that the page did not announce keeps the place in which it came', async () => {
  const { session, sends } = fake();
  const order = await sendOrder(session);
  sends('a');
  sends('b');
  const [a, worker, b] = [request('a'), request('worker'), request('b')];
  assert.deepEqual(await order.sorted([b, worker, a]), [a, worker, b]);
});

test('the next request waits for one that was sent before it and has not arrived', async () => {
  const { session, sends } = fake();
  const order = await sendOrder(session);
  sends('a');
  sends('b');
  const [a, b] = [request('a'), request('b')];
  const requests = [b];
  const inFlight = new Set(requests);
  setTimeout(() => {
    requests.push(a);
    inFlight.add(a);
  }, 50);
  assert.equal(await order.next(requests, inFlight), a);
});

for (const event of ['Network.loadingFinished', 'Network.loadingFailed']) {
  test(`the next request does not wait for an earlier one after ${event}`, async () => {
    const { session, sends, ends } = fake();
    const order = await sendOrder(session, 60_000);
    ends(sends('a'), event);
    sends('b');
    const b = request('b');
    assert.equal(await order.next([b], new Set([b])), b);
  });
}

test('an earlier request that never arrives is waited for once, for a limited time', async () => {
  const { session, sends } = fake();
  const order = await sendOrder(session, 100);
  sends('never');
  sends('b');
  sends('c');
  const [b, c] = [request('b'), request('c')];
  let started = Date.now();
  assert.equal(await order.next([b, c], new Set([b, c])), b);
  assert.ok(Date.now() - started >= 100);
  started = Date.now();
  assert.equal(await order.next([b, c], new Set([c])), c);
  assert.ok(Date.now() - started < 90);
});

test('a request that has ended keeps its own place among requests with the same URL', async () => {
  const { session, sends, ends } = fake();
  const order = await sendOrder(session);
  ends(sends('a'));
  sends('b');
  sends('a');
  const [first, b, again] = [request('a'), request('b'), request('a')];
  assert.equal(await order.next([first, again, b], new Set([again, b])), b);
});

test('a request that is in flight and no longer in the list of the step is still chosen', async () => {
  const { session, sends } = fake();
  const order = await sendOrder(session);
  sends('a');
  const a = request('a');
  assert.equal(await order.next([], new Set([a])), a);
});

test('a request keeps the place it was first given', async () => {
  const { session, sends } = fake();
  const order = await sendOrder(session);
  sends('a');
  sends('b');
  sends('a');
  const [first, b, again] = [request('a'), request('b'), request('a')];
  await order.sorted([first, b, again]);
  assert.deepEqual(await order.sorted([again, b, first]), [first, b, again]);
});

test('there is no next request when none is in flight', async () => {
  const { session } = fake();
  const order = await sendOrder(session);
  assert.equal(await order.next([request('a')], new Set()), undefined);
});

const broken: [string, () => Promise<never>][] = [
  ['fails', () => Promise.reject(new Error('closed'))],
  ['does not come back', () => new Promise<never>(() => {})],
];

for (const [name, evaluate] of broken) {
  test(`requests are sorted when asking the page ${name}`, { timeout: 5000 }, async () => {
    const { session, sends } = fake();
    const send = session.send.bind(session);
    session.send = ((method: 'Network.enable') =>
      (method as string) === 'Runtime.evaluate' ? evaluate() : send(method)) as CDPSession['send'];
    const order = await sendOrder(session);
    sends('a');
    sends('b');
    const [a, b] = [request('a'), request('b')];
    assert.deepEqual(await order.sorted([b, a]), [a, b]);
  });
}
