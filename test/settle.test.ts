import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Observation } from '../src/compare.ts';
import type { Due } from '../src/page.ts';
import { frame, idle, newRun, probeChange, recordFrames, replayFrames, rest, settle, STILL_MS, wait, witness } from '../src/run.ts';
import type { FramePage, Log, Requests } from '../src/run.ts';

const shown = (text: string): Observation => ({
  accessibility: { tree: [], attributes: {} },
  dom: { tag: 'p', children: [text] },
  style: {},
  events: [],
  effects: { requests: [], gets: [], storage: {}, url: { path: [''], query: {}, fragment: '' }, title: '', focus: null, popups: [] },
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
  moved: (boolean | string)[];
  due(world: World): Due | null;
  browserFrames: number;
  show(world: World): string;
  onBrowserFrame(world: World): void;
  frameDelay: number;
  frameWord: (world: World) => string;
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
    due: () => null,
    browserFrames: 0,
    show: (world) => world.text,
    onBrowserFrame: () => {},
    frameDelay: 0,
    frameWord: () => '',
    ...start,
  };
  const page: FramePage = {
    async begin() {},
    async timers() {
      world.calls.push('timers');
      return world.due(world);
    },
    async rest() {
      world.calls.push('rest');
      const moved = world.moved.shift();
      return typeof moved === 'string' ? moved : moved ? 'the text' : '';
    },
    async tick() {
      world.calls.push('tick');
      if (world.inFlight > 0) world.ticksInFlight++;
      world.time += 16;
      world.onTick(world);
    },
    async browserFrame() {
      world.calls.push('browser frame');
      world.browserFrames++;
      world.onBrowserFrame(world);
      if (world.frameDelay > 0) await new Promise((resolve) => setTimeout(resolve, world.frameDelay));
      return world.frameWord(world);
    },
    async probe() {
      world.calls.push('probe');
      return world.show(world);
    },
    async observe() {
      world.calls.push('observe');
      return { observation: shown(world.show(world)), unread: [], seen: { events: 0, requests: 0, popups: 0 } };
    },
  };
  const requests: Requests = {
    inFlight: () => world.inFlight,
    events: () => world.requestEvents,
    first: () => 'GET /answer',
    last: () => 'GET /answer',
    begin() {},
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

test('a page at rest is settled after 4 quiet frames in a row', async () => {
  const { world: state, page, requests } = world({});
  const settled = await settle(page, requests);
  assert.equal(text(settled.observation), 'ready');
  assert.equal(settled.frames, 4);
  assert.equal(state.calls.filter((call) => call === 'tick').length, 4);
  assert.equal(state.calls.filter((call) => call === 'observe').length, 5);
  assert.equal(state.time, 64);
});

test('a page that changes in a frame is observed for 4 more quiet frames', async () => {
  const { world: state, page, requests } = world({
    onTick: (world) => {
      if (world.time === 16) world.text = 'changed';
    },
  });
  const settled = await settle(page, requests);
  assert.equal(text(settled.observation), 'changed');
  assert.equal(settled.frames, 5);
  assert.equal(state.time, 80);
});

test('a change in the middle of the quiet frames starts the count again', async () => {
  const { world: state, page, requests } = world({
    onTick: (world) => {
      if (world.time === 48) world.text = 'late';
    },
  });
  const settled = await settle(page, requests);
  assert.equal(text(settled.observation), 'late');
  assert.equal(settled.frames, 7);
  assert.equal(state.time, 112);
});

test('an animation that was finished in a frame is no quiet frame, a held one is', async () => {
  const finished = world({ onTick: (world) => world.time === 16 && world.moved.push('an animation') });
  assert.equal((await settle(finished.page, finished.requests)).frames, 5);
  const svg = world({ onTick: (world) => world.time === 16 && world.moved.push('an SVG animation') });
  assert.equal((await settle(svg.page, svg.requests)).frames, 5);
  const held = world({ onTick: (world) => world.time === 16 && world.moved.push('a held animation') });
  assert.equal((await settle(held.page, held.requests)).frames, 4);
});

test('a one-shot timer that is due within 500 ms keeps the step open until it has fired', async () => {
  const { world: state, page, requests } = world({
    due: (world) => (world.time < 400 ? { delay: 800, left: 400 - world.time } : null),
  });
  const settled = await settle(page, requests);
  assert.equal(settled.frames, 28);
  assert.equal(state.time, 448);
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
  assert.equal(settled.frames, 4);
  assert.deepEqual(state.calls.slice(0, 6), ['rest', 'rest', 'idle', 'rest', 'rest', 'probe']);
});

test('a request that starts or ends in a frame is no quiet frame', async () => {
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
  assert.equal(settled.frames, 6);
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
    /^Error: 1 requests in flight after 100 rounds of answers, the first: GET \/answer$/,
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
    /^Error: never settled in 5 frames: 0 requests in flight, the last frame was not quiet: the page changed \(DOM\)$/,
  );
  assert.equal(state.time, 5 * 16);
});

test('a request that is still in flight after every wait fails the step before any observation', { timeout: 10_000 }, async () => {
  const { world: state, page, requests } = world({ inFlight: 1, requestEvents: 1 });
  await assert.rejects(
    settle(page, requests, 3),
    /^Error: 1 requests in flight after 100 rounds of answers, the first: GET \/answer$/,
  );
  assert.equal(state.calls.includes('observe'), false);
  assert.equal(state.time, 0);
});

test('replay runs exactly the stored frames and compares then', async () => {
  const { world: state, page, requests } = world({});
  const run = await replayFrames(page, requests, 7);
  assert.equal(run.frames, 7);
  assert.equal(state.calls.filter((call) => call === 'tick').length, 7);
  assert.equal(state.calls.filter((call) => call === 'observe').length, 2);
  assert.equal(state.time, 112);
});

test('replay does not settle on its own: a change in the last frame fails the step', async () => {
  const { world: state, page, requests } = world({
    onTick: (world) => {
      if (world.time === 80) world.text = 'changed';
    },
  });
  await assert.rejects(
    replayFrames(page, requests, 5),
    /^Error: not settled within the frames of the original \(5 frames\), the last frame was not quiet: the page changed \(DOM\)$/,
  );
  assert.equal(state.time, 80);
});

test('replay accepts a port whose last change fell one or two frames before the end', async () => {
  for (const at of [48, 64]) {
    const { page, requests } = world({
      onTick: (world) => {
        if (world.time === at) world.text = 'changed';
      },
    });
    assert.equal(text((await replayFrames(page, requests, 5)).observation), 'changed');
  }
});

test('replay names a one-shot timer that is due within 500 ms, an animation and a request that are not quiet', async () => {
  const timer = world({ due: () => ({ delay: 800, left: 256 }) });
  await assert.rejects(
    replayFrames(timer.page, timer.requests, 3),
    /last frame was not quiet: a one-shot timer of 800 ms is due in 256 ms of page time$/,
  );
  const animated = world({ onTick: (world) => world.moved.push('an animation') });
  await assert.rejects(replayFrames(animated.page, animated.requests, 3), /not quiet: an animation was finished$/);
  const asked = world({
    onTick: (world) => {
      send(world);
      world.onAnswer = answer;
    },
    onAnswer: answer,
  });
  await assert.rejects(replayFrames(asked.page, asked.requests, 3), /not quiet: a request started or ended$/);
});

const ramp = (start: number, end: number, tail = 0) => (world: World) => {
  const moved = Math.min(Math.max(world.browserFrames - start, 0), end - start);
  const done = tail > 0 && world.browserFrames >= end + tail ? ' and over' : '';
  return `${world.text} y${moved}${done}`;
};

test('an observation counts only when the page has stopped changing in real time', async () => {
  const { world: state, page, requests } = world({ show: ramp(1, 13) });
  const settled = await settle(page, requests);
  assert.equal(text(settled.observation), 'ready y12');
  assert.equal(state.calls.filter((call) => call === 'tick').length, 4);
  assert.equal(settled.frames, 4);
  assert.equal(state.time, 64);
});

test('how many frames a step takes does not depend on how long motion without page time lasts', async () => {
  const runs = new Set<string>();
  for (const length of [3, 12, 40, 160]) {
    const { world: state, page, requests } = world({ show: ramp(1, 1 + length) });
    const settled = await settle(page, requests);
    runs.add(`${settled.frames} ${state.time}`);
    assert.equal(text(settled.observation), `ready y${length}`);
  }
  assert.equal(runs.size, 1);
});

test('motion that shows only at the third browser frame, or ends with an event two frames later, is waited out', async () => {
  const late = world({ show: ramp(3, 20) });
  assert.equal(text((await settle(late.page, late.requests)).observation), 'ready y17');
  const lagging = world({ show: ramp(1, 10, 2) });
  const settled = await settle(lagging.page, lagging.requests);
  assert.equal(text(settled.observation), 'ready y9 and over');
  assert.equal(settled.frames, 4);
});

test('the page is waited for before the first frame of a step and before each observation, 4 probes in 4 browser frames in a row', async () => {
  const { world: state, page, requests } = world({});
  await replayFrames(page, requests, 1);
  assert.equal(state.calls.filter((call) => call === 'browser frame').length, 9);
  assert.equal(state.calls.filter((call) => call === 'probe').length, 14);
  assert.equal(state.calls.filter((call) => call === 'observe').length, 2);
});

test('replay waits out motion without page time before each of its two observations', async () => {
  const { world: state, page, requests } = world({ show: ramp(1, 30) });
  const run = await replayFrames(page, requests, 6);
  assert.equal(text(run.observation), 'ready y29');
  assert.equal(run.frames, 6);
  assert.equal(state.calls.filter((call) => call === 'tick').length, 6);
  assert.equal(state.time, 96);
});

test('motion without page time that does not stop fails the step by name and moves no page time', { timeout: 10_000 }, async () => {
  const { world: state, page, requests } = world({ show: (world) => `${world.browserFrames}`, frameDelay: 5 });
  await assert.rejects(
    settle(page, requests, 300, newRun(300)),
    /^Error: the page moves without page time: still changing after 300 ms of real time \(DOM\)$/,
  );
  assert.equal(state.time, 0);
  const replayed = world({ show: (world) => `${world.browserFrames}`, frameDelay: 5 });
  await assert.rejects(
    replayFrames(replayed.page, replayed.requests, 3, (work) => work, newRun(300)),
    /^Error: the page moves without page time: still changing after 300 ms of real time \(DOM\)$/,
  );
});

test('after the stable screenshot the step is observed again, and motion that began meanwhile is waited out', async () => {
  const shots = () => state.calls.filter((call) => call === 'shoot').length;
  const { world: state, page, requests } = world({ show: (world) => `${world.text} ${shots() > 0 ? 'late' : 'early'}` });
  const settled = await settle(page, requests);
  const shot = await witness(page, requests, newRun(), settled, async () => {
    state.calls.push('shoot');
    return Buffer.from(String(shots()));
  });
  assert.equal(text(shot.looked.observation), 'ready late');
  assert.equal(shot.screenshot.toString(), '2');
  assert.equal(shots(), 2);
  assert.equal(state.time, 64);
  const between = state.calls.slice(state.calls.indexOf('shoot'), state.calls.lastIndexOf('shoot'));
  assert.equal(between.filter((call) => call === 'browser frame').length, 3);
  assert.equal(between.filter((call) => call === 'probe').length, 5);
});

test('a step whose observation is the same after the screenshot takes one screenshot and one more observation', async () => {
  const { world: state, page, requests } = world({});
  const settled = await settle(page, requests);
  const before = state.calls.filter((call) => call === 'observe').length;
  const shot = await witness(page, requests, newRun(), settled, async () => Buffer.from('shot'));
  assert.equal(shot.screenshot.toString(), 'shot');
  assert.equal(state.calls.filter((call) => call === 'observe').length, before + 1);
});

test('motion that goes on after the screenshots fails the step by name', { timeout: 10_000 }, async () => {
  let shots = 0;
  const { world: state, page, requests } = world({ show: () => `shot ${shots}`, frameDelay: 5 });
  const settled = await settle(page, requests);
  await assert.rejects(
    witness(page, requests, newRun(300), settled, async () => {
      shots++;
      return Buffer.from('shot');
    }),
    /^Error: the page moves without page time: still changing after 300 ms of real time \(DOM\)$/,
  );
  assert.equal(state.time, 64);
});

const fakeRequest = (name: string) =>
  ({ method: () => 'GET', url: () => `http://localhost:1/api/${name}` }) as unknown as import('playwright').Request;

function fakeLog(...names: string[]) {
  const requests = names.map(fakeRequest);
  const released: string[] = [];
  const log = {
    inFlight: new Set(requests),
    held: new Map(requests.map((request, index) => [request, () => released.push(names[index])])),
    sent: new WeakSet(),
    waiting: '',
    window: undefined,
  } as unknown as Log;
  return { log, requests, released };
}

const base = new URL('http://localhost:1');
const later = (ms: number, work: () => void) => new Promise<void>((resolve) => setTimeout(() => (work(), resolve()), ms));

test('answers reach the page one at a time, in the order in which the requests were sent', async () => {
  const { log, requests, released } = fakeLog('slow', 'fast', 'last');
  const first = idle(log, base);
  await later(40, () => {});
  assert.deepEqual(released, ['slow']);
  log.inFlight.delete(requests[0]);
  await first;
  const second = idle(log, base);
  await later(40, () => {});
  assert.deepEqual(released, ['slow', 'fast']);
  log.inFlight.delete(requests[1]);
  await second;
  const third = idle(log, base);
  await later(10, () => log.inFlight.delete(requests[2]));
  await third;
  assert.deepEqual(released, ['slow', 'fast', 'last']);
});

test('a request that was let go and is not answered yet is waited for before the next one is let go', async () => {
  const { log, requests, released } = fakeLog('slow', 'next');
  log.sent.add(requests[0]);
  log.held.delete(requests[0]);
  const waiting = idle(log, base);
  await later(40, () => {});
  assert.deepEqual(released, []);
  log.inFlight.delete(requests[0]);
  await waiting;
});

test('the requests that are in flight together share one window of real time, and the request is named', async () => {
  const { log, requests } = fakeLog('a', 'b');
  const started = Date.now();
  const first = idle(log, base, 600);
  await later(400, () => log.inFlight.delete(requests[0]));
  await first;
  await assert.rejects(idle(log, base, 600), /^Error: 1 requests still in flight after 600 ms, the first: GET \/api\/b$/);
  assert.ok(Date.now() - started < 800, 'the second request had a window of its own');
});

test('a request that comes after the window has closed gets a window of its own', async () => {
  const { log, requests } = fakeLog('a');
  const first = idle(log, base, 100);
  await later(20, () => log.inFlight.delete(requests[0]));
  await first;
  await later(150, () => {});
  const next = fakeRequest('b');
  log.inFlight.add(next);
  log.held.set(next, () => {});
  const second = idle(log, base, 100);
  await later(50, () => log.inFlight.delete(next));
  await second;
});

test('the request that was sent first is let go first, also when the runner hears of it later', async () => {
  const { log, requests, released } = fakeLog('second', 'first');
  log.order = { sorted: async (list) => list, next: async () => requests[1] };
  const waiting = idle(log, base);
  await later(40, () => {});
  assert.deepEqual(released, ['first']);
  log.inFlight.delete(requests[1]);
  await waiting;
});

test('a request that is chosen before the runner holds it is let go when it is held', async () => {
  const { log, requests, released } = fakeLog('a');
  const hold = log.held.get(requests[0])!;
  log.held.delete(requests[0]);
  const waiting = idle(log, base, 600);
  await later(40, () => log.held.set(requests[0], hold));
  await later(40, () => {});
  assert.deepEqual(released, ['a']);
  log.inFlight.delete(requests[0]);
  await waiting;
});

test('a request that came while the first one was looked for, and does not end, is named', async () => {
  const { log, requests } = fakeLog('b');
  const early = fakeRequest('a');
  log.order = {
    sorted: async (list) => list,
    async next() {
      log.inFlight.delete(requests[0]);
      log.inFlight.add(early);
      return early;
    },
  };
  await assert.rejects(idle(log, base, 100), /^Error: 1 requests still in flight after 100 ms, the first: GET \/api\/a$/);
});

test('a page with 12 answers one after another comes to rest', async () => {
  const twelve = world({ inFlight: 1, requestEvents: 1 });
  let answers = 0;
  twelve.world.onAnswer = (world) => {
    answer(world);
    if (++answers < 12) send(world);
  };
  const run = newRun();
  assert.deepEqual(await rest(twelve.page, twelve.requests, run), []);
  assert.equal(answers, 12);
  assert.equal(run.answers, 12);
});

test('the rounds of answers and the rounds in which the page moved are counted per step, not per rest', async () => {
  const asking = world({ inFlight: 1, requestEvents: 1 });
  let answers = 0;
  asking.world.onAnswer = (world) => {
    answer(world);
    if (++answers < 60) send(world);
  };
  const run = newRun();
  await rest(asking.page, asking.requests, run);
  asking.world.onAnswer = (world) => {
    answer(world);
    if (++answers < 120) send(world);
  };
  send(asking.world);
  await assert.rejects(
    rest(asking.page, asking.requests, run),
    /^Error: 1 requests in flight after 100 rounds of answers, the first: GET \/answer$/,
  );

  const moving = world({ moved: Array(60).fill(true) });
  const again = newRun();
  await rest(moving.page, moving.requests, again);
  moving.world.moved.push(...Array(60).fill(true));
  await assert.rejects(
    rest(moving.page, moving.requests, again),
    /^Error: the page did not come to rest in 100 rounds, the last to move: the text$/,
  );
});

test('the rounds are counted again once the clock has moved, so a long advance is no step that cannot rest', async () => {
  const moving = world({ onTick: (world) => world.moved.push(...Array(60).fill(true)) });
  const run = newRun();
  for (let tick = 0; tick < 4; tick++) await frame(moving.page, moving.requests, run);
  assert.equal(moving.world.time, 64);
});

test('a change that begins between the last probe and the observation is not missed', async () => {
  const { world: state, page, requests } = world({
    show: (world) => `${world.text}${world.calls.includes('observe') ? ' moved' : ''}`,
  });
  page.observe = async () => {
    const observation = shown(state.show(state));
    state.calls.push('observe');
    return { observation, unread: [], seen: { events: 0, requests: 0, popups: 0 } };
  };
  const settled = await settle(page, requests);
  assert.equal(text(settled.observation), 'ready moved');
  assert.equal(settled.frames, 4);
});

test('motion that the action starts is waited out at the page time of the action, when recording and on the port', async () => {
  const ends = async (run: (page: FramePage, requests: Requests) => Promise<unknown>) => {
    let ended = -1;
    const { world: state, page, requests } = world({
      show: ramp(1, 20),
      onBrowserFrame: (world) => {
        if (world.browserFrames === 20) ended = world.time;
      },
    });
    await run(page, requests);
    assert.ok(state.browserFrames >= 20);
    return ended;
  };
  assert.equal(await ends((page, requests) => recordFrames(page, requests, 0)), 0);
  assert.equal(await ends((page, requests) => recordFrames(page, requests, 5)), 0);
  assert.equal(await ends((page, requests) => replayFrames(page, requests, 6)), 0);
});

test('recording an advance moves the page clock one frame at a time, then settles', async () => {
  const { world: state, page, requests } = world({});
  const run = await recordFrames(page, requests, 3);
  assert.equal(run.frames, 7);
  assert.equal(state.time, 112);
});

test('the wait for motion without page time is 5000 ms in real time', () => {
  assert.equal(STILL_MS, 5000);
  assert.equal(newRun().stillMs, 5000);
});

test('a browser frame that ended in a navigation is followed by the page coming to rest, any other is not', async () => {
  const plain = world({});
  await wait(plain.page, plain.requests, newRun());
  assert.deepEqual(plain.world.calls, ['probe', 'browser frame', 'probe', 'browser frame', 'probe', 'browser frame', 'probe']);
  const moved = world({ frameWord: (state) => (state.browserFrames === 2 ? 'a navigation' : '') });
  await wait(moved.page, moved.requests, newRun());
  assert.deepEqual(moved.world.calls, [
    'probe',
    'browser frame',
    'probe',
    'browser frame',
    'rest',
    'rest',
    'probe',
    'browser frame',
    'probe',
  ]);
});

test('a frame of the clock restarts the counts of answers and of rounds in which the page moved', async () => {
  const { page, requests } = world({});
  const run = newRun();
  run.answers = 60;
  run.moving = 60;
  await frame(page, requests, run);
  assert.equal(run.answers, 0);
  assert.equal(run.moving, 0);
});

test('a batch of answers restarts the count of rounds in which the page moved', async () => {
  const asking = world({ inFlight: 1, requestEvents: 1, moved: Array(60).fill(true), onAnswer: answer });
  const run = newRun();
  const originalRest = asking.page.rest;
  let rounds = 0;
  asking.page.rest = async () => {
    const moved = await originalRest();
    if (++rounds === 62 && asking.world.moved.length === 0) asking.world.moved.push(...Array(60).fill(true));
    return moved;
  };
  assert.deepEqual((await rest(asking.page, asking.requests, run)).length, 120);
  assert.equal(run.answers, 1);
});

test('recording looks 4 times after a frame of an advance and once after a step that moves no clock', async () => {
  const frames = (advanced: number) => {
    const { world: state, page, requests } = world({});
    return recordFrames(page, requests, advanced).then(() => ({
      browserFrames: state.calls.filter((call) => call === 'browser frame').length,
      probes: state.calls.filter((call) => call === 'probe').length,
    }));
  };
  assert.deepEqual(await frames(0), { browserFrames: 15, probes: 26 });
  assert.deepEqual(await frames(1), { browserFrames: 18, probes: 29 });
});

test('a failure of the wait names the part of the probe that moved when the observations are the same', async () => {
  const names = (before: unknown[], after: unknown[]) => probeChange(`${JSON.stringify(before)}|3|4`, `${JSON.stringify(after)}|3|4`);
  const base = [5, '/', [0, 0], [1, 2, 3, 4], [], ''];
  assert.equal(names(base, [6, ...base.slice(1)]), 'DOM');
  assert.equal(names(base, [5, '/next', ...base.slice(2)]), 'the address');
  assert.equal(names(base, [5, '/', [0, 9], ...base.slice(3)]), 'the scroll position');
  assert.equal(names(base, [5, '/', [0, 0], [1, 2, 3, 5], '', ''].map((value, index) => (index === 4 ? [] : value))), 'the boxes of elements');
  assert.equal(names(base, [5, '/', [0, 0], [1, 2, 3, 4], [4, 10, 0], '']), 'the scroll offsets of elements');
  assert.equal(names(base, [5, '/', [0, 0], [1, 2, 3, 4], [], '{"a":"b"}']), 'local storage');
  assert.equal(probeChange(`${JSON.stringify(base)}|3|4`, `${JSON.stringify(base)}|4|5`), 'events, requests');
  assert.equal(probeChange(`${JSON.stringify([6, ...base.slice(1)])}|3|4`, `${JSON.stringify(base)}|3|5`), 'DOM, requests');
  assert.equal(probeChange(`${JSON.stringify(base)}|3:0|4`, `${JSON.stringify(base)}|3:1|4`), 'dialogs and windows');
  assert.equal(probeChange(`${JSON.stringify(base)}|3:1|4`, `${JSON.stringify(base)}|4:1|4`), 'events');
  assert.equal(probeChange(`${JSON.stringify(base)}|3:1|4`, `${JSON.stringify(base)}|4:2|5`), 'events, dialogs and windows, requests');

  let probes = 0;
  const { page, requests } = world({});
  page.probe = async () => JSON.stringify([5, '/', [0, probes++ % 2 === 0 ? 0 : 7], [], [], '']) + '|0|0';
  await assert.rejects(wait(page, requests, newRun(60)), /^Error: the page moves without page time: still changing after 60 ms of real time \(the scroll position\)$/);
});
