import type { Browser, CDPSession, Locator, Page, Request, Response } from 'playwright';
import { describeStep, describeTarget, FRAME_MS } from './case.ts';
import type { Case, Step, Target } from './case.ts';
import { LAYERS, LAYER_NAMES } from './compare.ts';
import type { Observation, Popup } from './compare.ts';
import {
  adoptPage,
  beginStep,
  browserFrame,
  capturePage,
  clampIntervals,
  dueTimers,
  initPage,
  probePage,
  restPage,
  trackTimers,
} from './page.ts';
import type { Due, Unread } from './page.ts';
import { bodyParts, storageValue, urlParts } from './parts.ts';
import type { UrlParts } from './parts.ts';

const CLOCK_START = '2026-01-01T00:00:00Z';
export const QUIET_FRAMES = 4;
export const LOOKAHEAD_MS = 500;
const SETTLE_FRAMES = 300;
const REST_ROUNDS = 100;
const ANSWER_ROUNDS = 100;
export const STILL_MS = 5000;
const STILL_PROBES = 4;
const QUIET_MS = 50;
const POLL_MS = 5;
const OBSERVE_ATTEMPTS = 5;
const WAIT_TIMEOUT_MS = 5000;
const WINDOW_WAIT_MS = 200;
const ACTION_TIMEOUT_MS = 5000;
const SETTLE_TIMEOUT_MS = 30_000;

export type StepRun = { observation: Observation; unread: Unread; screenshot: Buffer; settleMs: number; captures: number; frames: number };

export type CaseRun = { steps: StepRun[]; error?: string };

export type Log = {
  events: Observation['events'];
  popups: Record<string, unknown>[];
  windows: Page[];
  windowsAsked: number;
  windowsSeen: number;
  requests: Request[];
  inFlight: Set<Request>;
  lastRequest: string;
  requestEvents: number;
  held: Map<Request, () => void>;
  sent: WeakSet<Request>;
  synchronous: Set<string>;
  navigation?: Request;
  loaded: boolean;
  loads: number;
  waiting: string;
  observations: number;
  window?: { deadline: number; members: Set<Request> };
};

type Observed = { observation: Observation; unread: Unread; seen: { events: number; requests: number; popups: number } };

export type FramePage = {
  begin(): Promise<void>;
  rest(): Promise<string>;
  tick(): Promise<void>;
  browserFrame(): Promise<string>;
  probe(): Promise<string>;
  observe(): Promise<Observed>;
  timers(): Promise<Due | null>;
};

export type Requests = {
  inFlight(): number;
  events(): number;
  first(): string;
  last(): string;
  begin(): void;
  idle(): Promise<void>;
};

export type Run = { moving: number; answers: number; stillMs: number; progress: number };

export const newRun = (stillMs = STILL_MS): Run => ({ moving: 0, answers: 0, stillMs, progress: Date.now() });

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const local = (href: string, base: URL): string => {
  const url = new URL(href);
  return url.origin === base.origin ? url.pathname + url.search : url.href;
};

export function within<T>(work: Promise<T>, late: () => string, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(late())), ms);
  });
  work.catch(() => {});
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

export function unmoved<T>(work: Promise<T>, late: () => string, ms: number, run: Run): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    const check = () => {
      const left = ms - (Date.now() - run.progress);
      if (left <= 0) reject(new Error(late()));
      else timer = setTimeout(check, left);
    };
    timer = setTimeout(check, ms);
  });
  work.catch(() => {});
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

export function popupOf(entry: Record<string, unknown>, base: URL): Popup {
  if (entry.kind === 'open') {
    const href = String(entry.url);
    const { protocol } = new URL(href);
    const url: UrlParts =
      protocol === 'http:' || protocol === 'https:'
        ? urlParts(href, base, 'page')
        : { origin: protocol, path: [href.slice(protocol.length)], query: {}, fragment: '' };
    return { kind: 'open', url, target: String(entry.target), features: String(entry.features) };
  }
  return entry as Popup;
}

async function observe(page: Page, base: URL, log: Log): Promise<Observed> {
  const tree = (await page.ariaSnapshotJSON()) as unknown[];
  const captured = await page.evaluate(capturePage);
  const events = log.events.slice();
  const popups = log.popups.slice();
  const requests = log.requests.slice();
  const pageUrl = new URL(captured.href);
  for (const [key, value] of base.searchParams) pageUrl.searchParams.delete(key, value);
  const reads = new Map<string, UrlParts>();
  for (const request of requests) {
    if (request.method() !== 'GET' || !['fetch', 'xhr'].includes(request.resourceType())) continue;
    const parts = urlParts(request.url(), base, 'request');
    reads.set(JSON.stringify(parts), parts);
  }
  const observation: Observation = {
    accessibility: { tree, attributes: captured.aria },
    dom: captured.dom,
    style: captured.style,
    events,
    effects: {
      requests: requests
        .filter((request) => request.method() !== 'GET')
        .map((request) => ({
          method: request.method(),
          url: urlParts(request.url(), base, 'request'),
          body: bodyParts(request.postDataBuffer(), request.headers()['content-type'] ?? ''),
        })),
      gets: [...reads.values()],
      storage: Object.fromEntries(Object.entries(captured.storage).map(([name, value]) => [name, storageValue(value)])),
      url: urlParts(pageUrl.href, base, 'page'),
      title: captured.title,
      focus: captured.focus,
      popups: popups.map((popup) => popupOf(popup, base)),
    },
  };
  return { observation, unread: captured.unread, seen: { events: events.length, requests: requests.length, popups: popups.length } };
}

export async function rest(page: FramePage, requests: Requests, run: Run = newRun()): Promise<string[]> {
  const words: string[] = [];
  for (;;) {
    for (let quiet = 0, last = ''; quiet < 2; ) {
      const moved = await page.rest();
      quiet = moved ? 0 : quiet + 1;
      last = moved || last;
      if (moved) {
        words.push(moved);
        if (++run.moving === REST_ROUNDS) {
          throw new Error(`the page did not come to rest in ${REST_ROUNDS} rounds, the last to move: ${last}`);
        }
      }
    }
    if (requests.inFlight() === 0) return words;
    if (run.answers === ANSWER_ROUNDS) {
      throw new Error(
        `${requests.inFlight()} requests in flight after ${ANSWER_ROUNDS} rounds of answers, the first: ${requests.first()}`,
      );
    }
    run.answers++;
    run.moving = 0;
    await requests.idle();
  }
}

export async function frame(page: FramePage, requests: Requests, run: Run = newRun()): Promise<string[]> {
  const words = await rest(page, requests, run);
  await page.tick();
  run.moving = 0;
  run.answers = 0;
  run.progress = Date.now();
  return words;
}

const FINISHED = new Set(['an animation', 'an SVG animation']);

function unquiet(before: string, current: Observed, words: string[], started: number, requests: Requests, due: Due | null) {
  const reasons: string[] = [];
  if (JSON.stringify(current.observation) !== before) reasons.push('the page changed');
  if (words.some((word) => FINISHED.has(word))) reasons.push('an animation was finished');
  if (requests.events() !== started) reasons.push('a request started or ended');
  if (due) reasons.push(`a one-shot timer of ${due.delay} ms is due in ${due.left} ms of page time`);
  return reasons;
}

export type Looked = Observed & { json: string };

const PROBE_PARTS = [
  'DOM',
  'the address',
  'the scroll position',
  'the boxes of elements',
  'the scroll offsets of elements',
  'local storage',
];

export function probeChange(before: string, after: string): string {
  const split = (probe: string) => {
    const parts = probe.split('|');
    const requests = parts.pop();
    const [events, popups = '0'] = (parts.pop() ?? '').split(':');
    return { seen: parts.join('|'), events, popups, requests };
  };
  const [a, b] = [split(before), split(after)];
  const names: string[] = [];
  if (a.seen !== b.seen) {
    try {
      const [from, to] = [JSON.parse(a.seen) as unknown[], JSON.parse(b.seen) as unknown[]];
      PROBE_PARTS.forEach((name, index) => {
        if (JSON.stringify(from[index]) !== JSON.stringify(to[index])) names.push(name);
      });
    } catch {}
  }
  if (a.events !== b.events) names.push('events');
  if (a.popups !== b.popups) names.push('dialogs and windows');
  if (a.requests !== b.requests) names.push('requests');
  return names.join(', ');
}

const moving = (before: Observation, after: Observation, ms: number, probes?: [string, string]) =>
  new Error(
    `the page moves without page time: still changing after ${ms} ms of real time (${
      changing(before, after) || (probes ? probeChange(...probes) : '')
    })`,
  );

async function still(page: FramePage, requests: Requests, run: Run, deadline: number, needed = STILL_PROBES) {
  const failed = async (probes?: [string, string]): Promise<Error> => {
    const before = await page.observe();
    await page.browserFrame();
    const after = await page.observe();
    return moving(before.observation, after.observation, run.stillMs, probes);
  };
  let last = await page.probe();
  for (let equal = 1; equal < needed; ) {
    if ((await page.browserFrame()) !== '') await rest(page, requests, run);
    const next = await page.probe();
    if (next === last) {
      equal++;
    } else {
      if (Date.now() > deadline) throw await failed([last, next]);
      equal = 1;
    }
    last = next;
  }
  return { last, failed };
}

export async function wait(page: FramePage, requests: Requests, run: Run): Promise<void> {
  await still(page, requests, run, Date.now() + run.stillMs);
}

async function look(page: FramePage, requests: Requests, run: Run, waited = false): Promise<Looked> {
  const deadline = Date.now() + run.stillMs;
  for (let needed = waited ? 1 : STILL_PROBES; ; needed = STILL_PROBES) {
    const { last, failed } = await still(page, requests, run, deadline, needed);
    const observed = await page.observe();
    const now = await page.probe();
    if (now === last) return { ...observed, json: JSON.stringify(observed.observation) };
    if (Date.now() > deadline) throw await failed([last, now]);
  }
}

export async function witness(
  page: FramePage,
  requests: Requests,
  run: Run,
  settled: Looked,
  shoot: () => Promise<Buffer>,
): Promise<{ looked: Looked; screenshot: Buffer }> {
  const deadline = Date.now() + run.stillMs;
  let looked = settled;
  for (;;) {
    const screenshot = await shoot();
    const after = await page.observe();
    const json = JSON.stringify(after.observation);
    if (json === looked.json) return { looked: { ...after, json }, screenshot };
    if (Date.now() > deadline) throw moving(looked.observation, after.observation, run.stillMs);
    looked = await look(page, requests, run);
  }
}

async function lastFrame(page: FramePage, requests: Requests, previous: Looked, run: Run) {
  const started = requests.events();
  const words = [...(await frame(page, requests, run)), ...(await rest(page, requests, run))];
  const current = await look(page, requests, run);
  const reasons = unquiet(previous.json, current, words, started, requests, await page.timers());
  return { current, reasons };
}

function changing(before: Observation, after: Observation): string {
  const layers = LAYERS.filter((layer) => JSON.stringify(before[layer]) !== JSON.stringify(after[layer]));
  return layers.map((layer) => LAYER_NAMES[layer]).join(', ');
}

export async function settle(
  page: FramePage,
  requests: Requests,
  limit = SETTLE_FRAMES,
  run: Run = newRun(),
  waited = false,
) {
  await rest(page, requests, run);
  let previous = await look(page, requests, run, waited);
  for (let frames = 1, quiet = 0; ; frames++) {
    const { current, reasons } = await lastFrame(page, requests, previous, run);
    quiet = reasons.length === 0 ? quiet + 1 : 0;
    if (quiet === QUIET_FRAMES) return { ...current, frames };
    if (frames === limit) {
      throw new Error(
        `never settled in ${limit} frames: ${requests.inFlight()} requests in flight, ` +
          (reasons.length > 0
            ? `the last frame was not quiet: ${reasons.join(', ')}`
            : `${QUIET_FRAMES} quiet frames in a row did not come`) +
          (reasons.includes('the page changed') ? ` (${changing(previous.observation, current.observation)})` : '') +
          (reasons.includes('a request started or ended') && requests.last()
            ? `, the last request was ${requests.last()}, a page that sends one in every few frames never rests`
            : ''),
      );
    }
    previous = current;
  }
}

type Guard = <T>(work: Promise<T>) => Promise<T>;

export async function recordFrames(
  page: FramePage,
  requests: Requests,
  advanced: number,
  guard: Guard = (work) => work,
  run: Run = newRun(),
) {
  await guard(rest(page, requests, run));
  await guard(wait(page, requests, run));
  for (let tick = 0; tick < advanced; tick++) await guard(frame(page, requests, run));
  const result = await guard(settle(page, requests, SETTLE_FRAMES, run, advanced === 0));
  return { ...result, frames: result.frames + advanced };
}

export async function replayFrames(
  page: FramePage,
  requests: Requests,
  count: number,
  guard: Guard = (work) => work,
  run: Run = newRun(),
) {
  await guard(rest(page, requests, run));
  await guard(wait(page, requests, run));
  for (let frames = 1; frames < count; frames++) await guard(frame(page, requests, run));
  const { previous, current, reasons } = await guard(
    (async () => {
      await rest(page, requests, run);
      const previous = await look(page, requests, run);
      return { previous, ...(await lastFrame(page, requests, previous, run)) };
    })(),
  );
  if (reasons.length > 0) {
    throw new Error(
      `not settled within the frames of the original (${count} frames), the last frame was not quiet: ${reasons.join(', ')}` +
        (reasons.includes('the page changed') ? ` (${changing(previous.observation, current.observation)})` : ''),
    );
  }
  return { ...current, frames: count };
}

function ownerOf(request: Request): Page | undefined {
  try {
    return request.frame().page();
  } catch {
    return undefined;
  }
}

export async function closeWindows(log: Log, arriveMs = WINDOW_WAIT_MS, closeMs = WAIT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + arriveMs;
  while (log.windowsSeen < log.windowsAsked && Date.now() < deadline) await pause(POLL_MS);
  log.windowsAsked = 0;
  log.windowsSeen = 0;
  const windows = log.windows.splice(0);
  await within(Promise.all(windows.map((window) => window.close().catch(() => {}))), () => `waited ${closeMs} ms to close a window`, closeMs);
}

const named = (request: Request, base: URL) => `${request.method()} ${local(request.url(), base)}`;

export async function idle(log: Log, base: URL, waitMs = WAIT_TIMEOUT_MS): Promise<void> {
  if (!log.window || ![...log.window.members].some((request) => log.inFlight.has(request))) {
    log.window = { deadline: Date.now() + waitMs, members: new Set(log.inFlight) };
  }
  const { deadline, members } = log.window;
  const next = [...log.inFlight][0];
  if (next === undefined) return;
  if (log.held.has(next)) {
    log.sent.add(next);
    log.held.get(next)?.();
    log.held.delete(next);
  }
  while (log.inFlight.has(next)) {
    log.waiting = `the answer to ${named(next, base)}`;
    if (Date.now() > deadline) {
      const left = [...members].filter((request) => log.inFlight.has(request));
      throw new Error(`${left.length} requests still in flight after ${waitMs} ms, the first: ${named(left[0], base)}`);
    }
    await pause(POLL_MS);
  }
}

type Listed = { backendNodeId: number; shadowRootType?: string; shadowRoots?: Listed[]; children?: Listed[] };

async function adopt(session: CDPSession): Promise<void> {
  const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
  await session.send('DOM.disable');
  const closed: number[] = [];
  const walk = (node: Listed) => {
    for (const shadow of node.shadowRoots ?? []) {
      if (shadow.shadowRootType === 'closed') closed.push(shadow.backendNodeId);
      walk(shadow);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  if (closed.length === 0) return;
  const roots = await Promise.all(closed.map((backendNodeId) => session.send('DOM.resolveNode', { backendNodeId })));
  await session.send('Runtime.callFunctionOn', {
    objectId: roots[0].object.objectId,
    functionDeclaration: String(adoptPage),
    arguments: roots.map(({ object }) => ({ objectId: object.objectId })),
  });
}

const unloaded = (navigation: Request, base: URL) =>
  `the navigation to ${local(navigation.url(), base)} did not load in ${WAIT_TIMEOUT_MS} ms`;

async function arrive(log: Log, base: URL): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (log.navigation) {
    log.waiting = `the page of the navigation to ${local(log.navigation.url(), base)}`;
    if (Date.now() > deadline) throw new Error(unloaded(log.navigation, base));
    await pause(POLL_MS);
  }
}

const replaced = (error: unknown) => (error as Error).message.includes('Execution context was destroyed');

async function survive<T>(log: Log, base: URL, work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const navigating = log.navigation !== undefined;
    const loads = log.loads;
    try {
      return await work();
    } catch (error) {
      const moved = replaced(error) || navigating || log.navigation !== undefined || log.loads !== loads;
      if (!moved || attempt === OBSERVE_ATTEMPTS) throw error;
      await arrive(log, base);
      await pause(POLL_MS);
    }
  }
}

async function stableScreenshot(page: Page, log: Log, base: URL): Promise<Buffer> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let previous = await survive(log, base, () => page.screenshot());
  for (;;) {
    await pause(QUIET_MS);
    await survive(log, base, () => page.evaluate(browserFrame));
    const current = await survive(log, base, () => page.screenshot());
    if (current.equals(previous) || Date.now() > deadline) return current;
    previous = current;
  }
}

export function gotoUrl(path: string, base: URL): string {
  const url = new URL(path, base);
  const added = base.search.slice(1);
  if (added !== '') url.search = url.search === '' ? added : `${url.search.slice(1)}&${added}`;
  return url.href;
}

async function present(scope: Page | Locator, role: Parameters<Page['getByRole']>[0]): Promise<string> {
  const names: string[] = [];
  let unnamed = 0;
  for (const element of await scope.getByRole(role).all()) {
    const quoted = /^- [^\s"]+ ("(?:[^"\\]|\\.)*")/.exec(await element.ariaSnapshot().catch(() => ''))?.[1];
    if (quoted === undefined) unnamed++;
    else names.push(JSON.stringify(JSON.parse(quoted)));
  }
  if (names.length === 0 && unnamed === 0) return `there is no ${role} here`;
  const listed = [...new Set(names)].slice(0, 10);
  const parts = [...listed, ...(names.length > listed.length ? ['and more'] : []), ...(unnamed > 0 ? [`${unnamed} without a name`] : [])];
  return `the ${role} elements here: ${parts.join(', ')}`;
}

async function locate(page: Page, target: Target, label: string): Promise<Locator> {
  const scope = target.within ? await locate(page, target.within, `the container ${describeTarget(target.within)}`) : page;
  const role = target.role as Parameters<Page['getByRole']>[0];
  const matches = scope.getByRole(role, target.name === undefined ? {} : { name: target.name, exact: true });
  const count = await matches.count();
  if (count === 0) throw new Error(`${label} matches 0 elements, ${await present(scope, role)}`);
  if (target.index === undefined) {
    if (count !== 1) throw new Error(`${label} matches ${count} elements`);
    return matches;
  }
  if (count < target.index) throw new Error(`${label} matches ${count} elements, so there is no #${target.index}`);
  return matches.nth(target.index - 1);
}

function answered(response: Response | null): void {
  if (response && response.status() >= 400) throw new Error(`the page answered ${`${response.status()} ${response.statusText()}`.trim()}`);
}

async function act(page: Page, step: Step, base: URL): Promise<void> {
  switch (step.action) {
    case 'goto':
      answered(await page.goto(gotoUrl(step.path, base)));
      return;
    case 'reload':
      answered(await page.reload());
      return;
    case 'advance':
      return;
  }
  const target = await locate(page, step.target, 'the target');
  switch (step.action) {
    case 'click':
      await target.click();
      break;
    case 'dblclick':
      await target.dblclick();
      break;
    case 'hover':
      await target.hover();
      break;
    case 'check':
      await target.check();
      break;
    case 'uncheck':
      await target.uncheck();
      break;
    case 'fill':
      await target.fill(step.value);
      break;
    case 'press':
      await target.press(step.key);
      break;
  }
}

export async function runCase(
  browser: Browser,
  testCase: Case,
  base: URL,
  limit = SETTLE_TIMEOUT_MS,
  stored?: number[],
  stillMs = STILL_MS,
): Promise<CaseRun> {
  const context = await browser.newContext({
    viewport: testCase.viewport,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
  });
  const log: Log = {
    events: [],
    popups: [],
    windows: [],
    windowsAsked: 0,
    windowsSeen: 0,
    requests: [],
    inFlight: new Set(),
    lastRequest: '',
    requestEvents: 0,
    held: new Map(),
    sent: new WeakSet(),
    synchronous: new Set(),
    loaded: false,
    loads: 0,
    waiting: '',
    observations: 0,
  };
  const steps: StepRun[] = [];
  try {
    context.setDefaultTimeout(ACTION_TIMEOUT_MS);
    let main: Page | undefined;
    await context.exposeBinding('__aaEmit', (source, json: string) => {
      if (source.page === main) log.events.push(JSON.parse(json));
    });
    await context.exposeBinding('__aaPopup', (source, json: string, opened: boolean) => {
      if (source.page !== main) return;
      log.popups.push(JSON.parse(json));
      if (opened) log.windowsAsked++;
    });
    await context.exposeBinding('__aaSync', (_source, request: string, waiting: boolean) => {
      if (waiting) log.synchronous.add(request);
      else log.synchronous.delete(request);
    });
    await context.addInitScript(initPage);
    await context.clock.pauseAt(CLOCK_START);
    await context.addInitScript(clampIntervals);
    await context.addInitScript(trackTimers);
    await context.route('**/*', async (route, request) => {
      if (ownerOf(request) !== main) {
        await route.abort().catch(() => {});
        return;
      }
      const passes =
        log.sent.has(request) ||
        log.synchronous.has(`${request.method()} ${request.url()}`) ||
        (log.navigation !== undefined && !['fetch', 'xhr'].includes(request.resourceType()));
      if (!passes) await new Promise<void>((resolve) => log.held.set(request, resolve));
      await route.continue().catch(() => {});
    });
    const page = await context.newPage();
    main = page;
    context.on('page', (opened) => {
      log.windows.push(opened);
      log.windowsSeen++;
    });
    const session = await context.newCDPSession(page);
    page.on('request', (request) => {
      log.requests.push(request);
      log.lastRequest = named(request, base);
      log.inFlight.add(request);
      log.requestEvents++;
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) log.navigation = request;
    });
    const ended = (request: Request) => {
      log.inFlight.delete(request);
      log.requestEvents++;
    };
    page.on('requestfinished', ended);
    page.on('requestfailed', (request) => {
      ended(request);
      if (request === log.navigation) log.navigation = undefined;
    });
    page.on('load', () => {
      log.loaded = true;
      log.loads++;
      log.navigation = undefined;
    });

    const wait = <T>(work: Promise<T>, what: string): Promise<T> => {
      log.waiting = what;
      const late = () => (log.navigation ? unloaded(log.navigation, base) : `waited ${WAIT_TIMEOUT_MS} ms for ${what}`);
      return within(work, late, WAIT_TIMEOUT_MS);
    };
    const gone = (error: Error): string => {
      if (!error.message.includes('Execution context was destroyed')) throw error;
      return 'a navigation';
    };
    const frames: FramePage = {
      async begin() {
        await wait(page.evaluate(beginStep).catch(() => {}), 'the page to begin the step');
      },
      async timers() {
        return wait(page.evaluate(dueTimers, LOOKAHEAD_MS).catch(() => null), 'the timers of the page');
      },
      async rest() {
        await arrive(log, base);
        if (log.loaded) {
          log.loaded = false;
          await wait(adopt(session).catch(() => {}), 'the closed shadow roots of the page');
        }
        await wait(page.clock.runFor(0).catch(() => {}), 'the timers of the page that are due');
        return wait(page.evaluate(restPage).catch(gone), 'the page to come to rest');
      },
      async tick() {
        await wait(page.clock.runFor(FRAME_MS).catch(() => {}), 'a frame of the page clock');
      },
      async browserFrame() {
        await arrive(log, base);
        const gone = await wait(
          page.evaluate(browserFrame).then(
            () => '',
            (error: Error) => {
              if (!error.message.includes('Execution context was destroyed')) throw error;
              return 'a navigation';
            },
          ),
          'a frame of the browser',
        );
        return gone;
      },
      async probe() {
        const seen = await wait(page.evaluate(probePage).catch(() => ''), 'the page to be probed');
        return `${seen}|${log.events.length}:${log.popups.length}|${log.requestEvents}`;
      },
      observe() {
        log.waiting = 'the observation';
        log.observations++;
        return survive(log, base, () => observe(page, base, log));
      },
    };
    const requests: Requests = {
      inFlight: () => log.inFlight.size,
      events: () => log.requestEvents,
      first: () => named([...log.inFlight][0], base),
      last: () => log.lastRequest,
      begin: () => {
        log.window = undefined;
      },
      idle: () => idle(log, base),
    };

    const late = () => `no frame of the page in ${limit} ms, the last wait was for ${log.waiting}`;
    for (const [index, step] of testCase.steps.entries()) {
      try {
        log.waiting = `the ${step.action}`;
        requests.begin();
        const run = newRun(stillMs);
        const observed = log.observations;
        await frames.begin();
        await act(page, step, base);
        const started = performance.now();
        run.progress = Date.now();
        const guard: Guard = (work) => unmoved(work, late, limit, run);
        const settled = stored
          ? await replayFrames(frames, requests, stored[index], guard, run)
          : await recordFrames(frames, requests, step.action === 'advance' ? step.frames : 0, guard, run);
        const settleMs = Math.round(performance.now() - started);
        log.waiting = 'the screenshot';
        run.progress = Date.now();
        const shot = await unmoved(
          witness(frames, requests, run, settled, () => stableScreenshot(page, log, base)),
          late,
          limit,
          run,
        );
        log.events.splice(0, shot.looked.seen.events);
        log.popups.splice(0, shot.looked.seen.popups);
        log.requests.splice(0, shot.looked.seen.requests);
        await closeWindows(log);
        steps.push({
          observation: shot.looked.observation,
          unread: shot.looked.unread,
          screenshot: shot.screenshot,
          settleMs,
          captures: log.observations - observed,
          frames: settled.frames,
        });
      } catch (error) {
        const message = (error as Error).message.split('\n')[0];
        const leaving =
          log.navigation && !message.includes('navigation')
            ? `, the navigation to ${local(log.navigation.url(), base)} had not loaded`
            : '';
        return { steps, error: `step ${steps.length + 1} (${describeStep(step)}): ${message}${leaving}` };
      }
    }
    return { steps };
  } finally {
    for (const release of log.held.values()) release();
    await context.close();
  }
}
