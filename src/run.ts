import type { Browser, Page, Request } from 'playwright';
import { describeStep, FRAME_MS } from './case.ts';
import type { Case, Step } from './case.ts';
import { LAYERS } from './compare.ts';
import type { Observation } from './compare.ts';
import { browserFrame, capturePage, clampIntervals, initPage, restPage } from './page.ts';

const CLOCK_START = '2026-01-01T00:00:00Z';
const SETTLE_FRAMES = 300;
const REST_ROUNDS = 10;
const QUIET_MS = 50;
const WAIT_TIMEOUT_MS = 5000;
const ACTION_TIMEOUT_MS = 5000;

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
  loading: boolean;
};

type Observed = { observation: Observation; seen: { events: number; requests: number } };

export type FramePage = { rest(): Promise<boolean>; tick(): Promise<void>; observe(): Promise<Observed> };

export type Requests = { inFlight(): number; events(): number; idle(): Promise<void> };

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
  const local = (href: string) => {
    const url = new URL(href);
    return url.origin === base.origin ? url.pathname + url.search : url.href;
  };
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
          url: local(request.url()),
          body: canonicalBody(request.postData()),
        })),
      gets: [
        ...new Set(
          requests
            .filter((request) => request.method() === 'GET' && ['fetch', 'xhr'].includes(request.resourceType()))
            .map((request) => local(request.url())),
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
  for (let batch = 0; batch < REST_ROUNDS; batch++) {
    for (let round = 0, quiet = 0; round < REST_ROUNDS && quiet < 2; round++) {
      quiet = (await page.rest()) ? 0 : quiet + 1;
    }
    if (requests.inFlight() === 0) return;
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
    if (
      previous &&
      requests.inFlight() === 0 &&
      current.requestEvents === previous.requestEvents &&
      current.json === previous.json
    ) {
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

async function idle(log: Log): Promise<void> {
  const batch = [...log.inFlight];
  for (const request of batch) {
    log.sent.add(request);
    log.held.get(request)?.();
    log.held.delete(request);
  }
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const left = batch.filter((request) => log.inFlight.has(request)).length;
    if (left === 0) return;
    if (Date.now() > deadline) throw new Error(`${left} requests still in flight after ${WAIT_TIMEOUT_MS} ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// Returns the screenshot once two in a row, one quiet period apart, are identical.
// After WAIT_TIMEOUT_MS it returns the last one.
async function stableScreenshot(page: Page): Promise<Buffer> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let previous = await page.screenshot();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
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
export async function runCase(browser: Browser, testCase: Case, base: URL): Promise<CaseRun> {
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
    loading: false,
  };
  const steps: StepRun[] = [];
  try {
    context.setDefaultTimeout(ACTION_TIMEOUT_MS);
    await context.exposeBinding('__aaEmit', (_source, json: string) => {
      log.events.push(JSON.parse(json));
    });
    await context.addInitScript(initPage);
    await context.clock.pauseAt(CLOCK_START);
    await context.addInitScript(clampIntervals);
    await context.route('**/*', async (route, request) => {
      const passes = log.sent.has(request) || (log.loading && !['fetch', 'xhr'].includes(request.resourceType()));
      if (!passes) await new Promise<void>((resolve) => log.held.set(request, resolve));
      await route.continue().catch(() => {});
    });
    const page = await context.newPage();
    page.on('request', (request) => {
      log.requests.push(request);
      log.inFlight.add(request);
      log.requestEvents++;
    });
    const ended = (request: Request) => {
      log.inFlight.delete(request);
      log.requestEvents++;
    };
    page.on('requestfinished', ended);
    page.on('requestfailed', ended);

    const frames: FramePage = {
      async rest() {
        await page.clock.runFor(0).catch(() => {});
        return page.evaluate(restPage);
      },
      async tick() {
        await page.clock.runFor(FRAME_MS).catch(() => {});
      },
      observe: () => observe(page, base, log),
    };
    const requests: Requests = {
      inFlight: () => log.inFlight.size,
      events: () => log.requestEvents,
      idle: () => idle(log),
    };

    for (const step of testCase.steps) {
      try {
        log.loading = step.action === 'goto' || step.action === 'reload';
        await act(page, step, base, () => frame(frames, requests)).finally(() => {
          log.loading = false;
        });
        const started = performance.now();
        const settled = await settle(frames, requests);
        const settleMs = Math.round(performance.now() - started);
        log.events.splice(0, settled.seen.events);
        log.requests.splice(0, settled.seen.requests);
        steps.push({
          observation: settled.observation,
          screenshot: await stableScreenshot(page),
          settleMs,
          captures: settled.frames + 1,
        });
      } catch (error) {
        const message = (error as Error).message.split('\n')[0];
        return { steps, error: `step ${steps.length + 1} (${describeStep(step)}): ${message}` };
      }
    }
    return { steps };
  } finally {
    for (const release of log.held.values()) release();
    await context.close();
  }
}
