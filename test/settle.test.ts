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
      return world.moved.shift() ?? false;
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

test('the page rests until nothing moves in two rounds in a row, for ten rounds at most', async () => {
  const twice = world({ moved: [true, false, true] });
  await frame(twice.page, twice.requests);
  assert.deepEqual(twice.world.calls, ['rest', 'rest', 'rest', 'rest', 'rest', 'tick']);

  const restless = world({ moved: Array(50).fill(true) });
  await frame(restless.page, restless.requests);
  assert.deepEqual(restless.world.calls, [...Array(10).fill('rest'), 'tick']);
});

test('a page that changes in every frame fails the step at the limit of frames', async () => {
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

test('a request that is still in flight after the wait keeps the step from settling', async () => {
  const { page, requests } = world({ inFlight: 1, requestEvents: 1 });
  await assert.rejects(
    settle(page, requests, 3),
    /^Error: never settled in 3 frames: 1 requests in flight, layers still changing: none$/,
  );
});
