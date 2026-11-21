import type { Browser, CDPSession, Page, Request } from 'playwright';
import { describeStep, FRAME_MS } from './case.ts';
import type { Case, Step } from './case.ts';
import { LAYERS } from './compare.ts';
import type { Observation } from './compare.ts';
import { adoptPage, browserFrame, capturePage, clampIntervals, initPage, restPage } from './page.ts';

const CLOCK_START = '2026-01-01T00:00:00Z';
const SETTLE_FRAMES = 300;
const REST_ROUNDS = 100;
const QUIET_MS = 50;
const POLL_MS = 5;
const WAIT_TIMEOUT_MS = 5000;
const ACTION_TIMEOUT_MS = 5000;
const SETTLE_TIMEOUT_MS = 30_000;

export type StepRun = { observation: Observation; screenshot: Buffer; settleMs: number; captures: number };

// On an error the run stops, and steps holds the steps that finished before it.
export type CaseRun = { steps: StepRun[]; error?: string };

// requestEvents counts every request that started and every request that ended.
type Log = {
  events: Observation['events'];
  requests: Request[];
  inFlight: Set<Request>;
  requestEvents: number;
  held: Map<Request, () => void>;
  sent: WeakSet<Request>;
  synchronous: Set<string>;
  navigation?: Request;
  loaded: boolean;
  waiting: string;
};

type Observed = { observation: Observation; seen: { events: number; requests: number } };

export type FramePage = { rest(): Promise<string>; tick(): Promise<void>; observe(): Promise<Observed> };

export type Requests = { inFlight(): number; events(): number; first(): string; idle(): Promise<void> };

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

function canonicalBody(body: string | null): unknown {
  if (body === null) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function observe(page: Page, base: URL, log: Log): Promise<Observed> {
  const tree = (await page.ariaSnapshotJSON()) as unknown[];
  const captured = await page.evaluate(capturePage);
  const events = log.events.slice();
  const requests = log.requests.slice();
  const pageUrl = new URL(captured.href);
  for (const [key, value] of base.searchParams) pageUrl.searchParams.delete(key, value);
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
          url: local(request.url(), base),
          body: canonicalBody(request.postData()),
        })),
      gets: [
        ...new Set(
          requests
            .filter((request) => request.method() === 'GET' && ['fetch', 'xhr'].includes(request.resourceType()))
            .map((request) => local(request.url(), base)),
        ),
      ].sort(),
      storage: captured.storage,
      url: (pageUrl.origin === base.origin ? '' : pageUrl.origin) + pageUrl.pathname + pageUrl.search + pageUrl.hash,
      title: captured.title,
      focus: captured.focus,
    },
  };
  return { observation, seen: { events: events.length, requests: requests.length } };
}

async function rest(page: FramePage, requests: Requests): Promise<void> {
  for (let batch = 0; ; batch++) {
    for (let round = 0, quiet = 0, last = ''; quiet < 2; round++) {
      if (round === REST_ROUNDS) {
        throw new Error(`the page did not come to rest in ${REST_ROUNDS} rounds, the last to move: ${last}`);
      }
      const moved = await page.rest();
      quiet = moved ? 0 : quiet + 1;
      last = moved || last;
    }
    if (requests.inFlight() === 0) return;
    if (batch === REST_ROUNDS) {
      throw new Error(
        `${requests.inFlight()} requests in flight after ${REST_ROUNDS} batches of answers, the first: ${requests.first()}`,
      );
    }
    await requests.idle();
  }
}

export async function frame(page: FramePage, requests: Requests): Promise<void> {
  await rest(page, requests);
  await page.tick();
}

export async function settle(page: FramePage, requests: Requests, limit = SETTLE_FRAMES) {
  let previous: (Observed & { json: string; requestEvents: number }) | undefined;
  for (let frames = 0; ; frames++) {
    await rest(page, requests);
    const observed = await page.observe();
    const current = { ...observed, json: JSON.stringify(observed.observation), requestEvents: requests.events() };
    if (previous && current.requestEvents === previous.requestEvents && current.json === previous.json) {
      return { ...current, frames };
    }
    if (frames === limit) {
      const before = previous?.observation;
      const changing = LAYERS.filter(
        (layer) => before && JSON.stringify(before[layer]) !== JSON.stringify(current.observation[layer]),
      );
      throw new Error(
        `never settled in ${limit} frames: ${requests.inFlight()} requests in flight, ` +
          `layers still changing: ${changing.join(', ') || 'none'}`,
      );
    }
    previous = current;
    await frame(page, requests);
  }
}

const named = (request: Request, base: URL) => `${request.method()} ${local(request.url(), base)}`;

async function idle(log: Log, base: URL): Promise<void> {
  const batch = [...log.inFlight];
  for (const request of batch) {
    log.sent.add(request);
    log.held.get(request)?.();
    log.held.delete(request);
  }
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const left = batch.filter((request) => log.inFlight.has(request));
    if (left.length === 0) return;
    log.waiting = `the answer to ${named(left[0], base)}`;
    if (Date.now() > deadline) {
      throw new Error(
        `${left.length} requests still in flight after ${WAIT_TIMEOUT_MS} ms, the first: ${named(left[0], base)}`,
      );
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

// Returns the screenshot once two in a row, one quiet period apart, are identical.
// After WAIT_TIMEOUT_MS it returns the last one.
async function stableScreenshot(page: Page): Promise<Buffer> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let previous = await page.screenshot();
  for (;;) {
    await pause(QUIET_MS);
    await page.evaluate(browserFrame);
    const current = await page.screenshot();
    if (current.equals(previous) || Date.now() > deadline) return current;
    previous = current;
  }
}

async function act(page: Page, step: Step, base: URL, advance: () => Promise<void>): Promise<void> {
  switch (step.action) {
    case 'goto': {
      const url = new URL(step.path, base);
      for (const [key, value] of base.searchParams) url.searchParams.append(key, value);
      await page.goto(url.href);
      return;
    }
    case 'reload':
      await page.reload();
      return;
    case 'advance':
      for (let frames = 0; frames < step.frames; frames++) await advance();
      return;
  }
  const { role, name } = step.target;
  const target = page.getByRole(role as Parameters<Page['getByRole']>[0], { name, exact: true });
  const count = await target.count();
  if (count !== 1) throw new Error(`the target matches ${count} elements`);
  switch (step.action) {
    case 'click':
      await target.click();
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

// Runs one case in a fresh browser context and captures one observation and one screenshot per step.
export async function runCase(browser: Browser, testCase: Case, base: URL, limit = SETTLE_TIMEOUT_MS): Promise<CaseRun> {
  const context = await browser.newContext({
    viewport: testCase.viewport,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const log: Log = {
    events: [],
    requests: [],
    inFlight: new Set(),
    requestEvents: 0,
    held: new Map(),
    sent: new WeakSet(),
    synchronous: new Set(),
    loaded: false,
    waiting: '',
  };
  const steps: StepRun[] = [];
  try {
    context.setDefaultTimeout(ACTION_TIMEOUT_MS);
    await context.exposeBinding('__aaEmit', (_source, json: string) => {
      log.events.push(JSON.parse(json));
    });
    await context.exposeBinding('__aaSync', (_source, request: string, waiting: boolean) => {
      if (waiting) log.synchronous.add(request);
      else log.synchronous.delete(request);
    });
    await context.addInitScript(initPage);
    await context.clock.pauseAt(CLOCK_START);
    await context.addInitScript(clampIntervals);
    await context.route('**/*', async (route, request) => {
      const passes =
        log.sent.has(request) ||
        log.synchronous.has(`${request.method()} ${request.url()}`) ||
        (log.navigation !== undefined && !['fetch', 'xhr'].includes(request.resourceType()));
      if (!passes) await new Promise<void>((resolve) => log.held.set(request, resolve));
      await route.continue().catch(() => {});
    });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    page.on('request', (request) => {
      log.requests.push(request);
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
      observe() {
        log.waiting = 'the observation';
        return observe(page, base, log);
      },
    };
    const requests: Requests = {
      inFlight: () => log.inFlight.size,
      events: () => log.requestEvents,
      first: () => named([...log.inFlight][0], base),
      idle: () => idle(log, base),
    };

    const late = () => `no end after ${limit} ms, the last wait was for ${log.waiting}`;
    for (const step of testCase.steps) {
      try {
        log.waiting = `the ${step.action}`;
        await act(page, step, base, () => within(frame(frames, requests), late, limit));
        const started = performance.now();
        const settled = await within(settle(frames, requests), late, limit);
        const settleMs = Math.round(performance.now() - started);
        log.events.splice(0, settled.seen.events);
        log.requests.splice(0, settled.seen.requests);
        log.waiting = 'the screenshot';
        steps.push({
          observation: settled.observation,
          screenshot: await within(stableScreenshot(page), late, limit),
          settleMs,
          captures: settled.frames + 1,
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
