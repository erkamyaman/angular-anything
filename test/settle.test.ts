import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Observation } from '../src/compare.ts';
import { frame, settle } from '../src/run.ts';
import type { FramePage, Requests } from '../src/run.ts';

const shown = (text: string): Observation => ({
  accessibility: { tree: [], attributes: {} },
  dom: { tag: 'p', children: [text] },
  style: {},
  events: [],
  effects: { requests: [], gets: [], storage: {}, url: '/', title: '', focus: null },
});

const text = (observation: Observation) => (observation.dom as { children: string[] }).children[0];

type World = {
  text: string;
  time: number;
  inFlight: number;
  requestEvents: number;
  calls: string[];
  ticksInFlight: number;
  onTick(world: World): void;
  onAnswer(world: World): void;
  moved: boolean[];
};

function world(start: Partial<World>): { world: World; page: FramePage; requests: Requests } {
  const world: World = {
    text: 'ready',
    time: 0,
    inFlight: 0,
    requestEvents: 0,
    calls: [],
    ticksInFlight: 0,
    onTick: () => {},
    onAnswer: () => {},
    moved: [],
    ...start,
  };
  const page: FramePage = {
    async rest() {
      world.calls.push('rest');
      return world.moved.shift() ? 'the text' : '';
    },
    async tick() {
      world.calls.push('tick');
      if (world.inFlight > 0) world.ticksInFlight++;
      world.time += 16;
      world.onTick(world);
    },
    async observe() {
      world.calls.push('observe');
      return { observation: shown(world.text), seen: { events: 0, requests: 0 } };
    },
  };
  const requests: Requests = {
    inFlight: () => world.inFlight,
    events: () => world.requestEvents,
    first: () => 'GET /answer',
    async idle() {
      world.calls.push('idle');
      world.onAnswer(world);
    },
  };
  return { world, page, requests };
}

const send = (world: World) => {
  world.inFlight++;
  world.requestEvents++;
};
const answer = (world: World) => {
  world.inFlight--;
  world.requestEvents++;
};

test('a page at rest is settled after two identical observations one frame apart', async () => {
  const { world: state, page, requests } = world({});
  const settled = await settle(page, requests);
  assert.equal(text(settled.observation), 'ready');
  assert.equal(settled.frames, 1);
  assert.deepEqual(state.calls, ['rest', 'rest', 'observe', 'rest', 'rest', 'tick', 'rest', 'rest', 'observe']);
  assert.equal(state.time, 16);
});

test('a page that changes in a frame is observed again one frame later', async () => {
  const { world: state, page, requests } = world({
    onTick: (world) => {
      if (world.time === 16) world.text = 'changed';
    },
  });
  const settled = await settle(page, requests);
  assert.equal(text(settled.observation), 'changed');
  assert.equal(settled.frames, 2);
  assert.equal(state.time, 32);
});

test('while a request is in flight the runner waits and does not move the clock', async () => {
  const { world: state, page, requests } = world({
    text: 'loading',
    inFlight: 1,
    requestEvents: 1,
    onAnswer: (world) => {
      answer(world);
      world.text = 'loaded';
    },
  });
  const settled = await settle(page, requests);
  assert.equal(text(settled.observation), 'loaded');
  assert.equal(state.ticksInFlight, 0);
  assert.equal(settled.frames, 1);
  assert.deepEqual(state.calls.slice(0, 6), ['rest', 'rest', 'idle', 'rest', 'rest', 'observe']);
});

test('a request between two identical observations starts the comparison again', async () => {
  let answered = false;
  const { world: state, page, requests } = world({
    text: 'idle',
    onTick: (world) => {
      if (world.time === 16) send(world);
      else if (answered) world.text = 'loaded';
    },
    onAnswer: (world) => {
      answer(world);
      answered = true;
    },
  });
  const settled = await settle(page, requests);
  assert.equal(text(settled.observation), 'loaded');
  assert.equal(state.ticksInFlight, 0);
  assert.equal(settled.frames, 3);
});

test('an advance waits for a request before each frame', async () => {
  const { world: state, page, requests } = world({ inFlight: 1, requestEvents: 1, onAnswer: answer });
  await frame(page, requests);
  await frame(page, requests);
  assert.deepEqual(state.calls, ['rest', 'rest', 'idle', 'rest', 'rest', 'tick', 'rest', 'rest', 'tick']);
  assert.equal(state.ticksInFlight, 0);
  assert.equal(state.time, 32);
});

test('the page rests until nothing moves in two rounds in a row', async () => {
  const twice = world({ moved: [true, false, true] });
  await frame(twice.page, twice.requests);
  assert.deepEqual(twice.world.calls, ['rest', 'rest', 'rest', 'rest', 'rest', 'tick']);

  const long = world({ moved: Array(98).fill(true) });
  await frame(long.page, long.requests);
  assert.deepEqual(long.world.calls, [...Array(100).fill('rest'), 'tick']);
});

test('a page that moves in every round fails the step after 100 rounds, without a frame', async () => {
  const restless = world({ moved: Array(500).fill(true) });
  await assert.rejects(
    frame(restless.page, restless.requests),
    /^Error: the page did not come to rest in 100 rounds, the last to move: the text$/,
  );
  assert.deepEqual(restless.world.calls, Array(100).fill('rest'));
  assert.equal(restless.world.time, 0);
});

test('the page rests again after every batch of answers, before the clock moves', async () => {
  let answers = 0;
  const { world: state, page, requests } = world({
    inFlight: 1,
    requestEvents: 1,
    onAnswer: (world) => {
      answer(world);
      if (++answers < 4) send(world);
    },
  });
  await frame(page, requests);
  assert.deepEqual(state.calls, [...Array(4).fill(['rest', 'rest', 'idle']).flat(), 'rest', 'rest', 'tick']);
  assert.equal(state.ticksInFlight, 0);
});

test('a page that asks again after every answer fails the step after 100 batches, and the request is named', async () => {
  const { world: state, page, requests } = world({
    inFlight: 1,
    requestEvents: 1,
    onAnswer: (world) => {
      answer(world);
      send(world);
    },
  });
  await assert.rejects(
    frame(page, requests),
    /^Error: 1 requests in flight after 100 batches of answers, the first: GET \/answer$/,
  );
  assert.equal(state.calls.filter((call) => call === 'idle').length, 100);
  assert.equal(state.time, 0);
});

test('a page that changes in every frame fails the step at the limit of frames', { timeout: 10_000 }, async () => {
  const { world: state, page, requests } = world({
    onTick: (world) => {
      world.text = String(world.time);
    },
  });
  await assert.rejects(
    settle(page, requests, 5),
    /^Error: never settled in 5 frames: 0 requests in flight, layers still changing: dom$/,
  );
  assert.equal(state.time, 5 * 16);
});

test('a request that is still in flight after every wait fails the step before any observation', { timeout: 10_000 }, async () => {
  const { world: state, page, requests } = world({ inFlight: 1, requestEvents: 1 });
  await assert.rejects(
    settle(page, requests, 3),
    /^Error: 1 requests in flight after 100 batches of answers, the first: GET \/answer$/,
  );
  assert.equal(state.calls.includes('observe'), false);
  assert.equal(state.time, 0);
});
