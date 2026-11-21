import type { Browser, Page, Request } from 'playwright';
import { describeStep } from './case.ts';
import type { Case, Step } from './case.ts';
import { LAYERS } from './compare.ts';
import type { Observation } from './compare.ts';
import { capturePage, initPage } from './page.ts';

const CLOCK_START = '2026-01-01T00:00:00Z';
const QUIET_MS = 50;
const SETTLE_TIMEOUT_MS = 5000;
const ACTION_TIMEOUT_MS = 5000;

export type StepRun = { observation: Observation; screenshot: Buffer; settleMs: number; captures: number };

// On an error the run stops, and steps holds the steps that finished before it.
export type CaseRun = { steps: StepRun[]; error?: string };

// requestEvents counts every request that started and every request that ended.
type Log = { events: Observation['events']; requests: Request[]; inFlight: Set<Request>; requestEvents: number };

function canonicalBody(body: string | null): unknown {
  if (body === null) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function observe(page: Page, base: URL, log: Log) {
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
  return { observation, mutations: captured.mutations, seen: { events: events.length, requests: requests.length } };
}

async function quietPeriod(page: Page): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
}

// Returns the observation once two observations in a row are identical and, from the start of the first to the
// end of the second, no request was in flight, started or ended and the DOM did not mutate.
// Throws after SETTLE_TIMEOUT_MS.
async function settle(page: Page, base: URL, log: Log) {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let previous: (Awaited<ReturnType<typeof observe>> & { json: string; requestEvents: number }) | undefined;
  for (let captures = 1; ; captures++) {
    const requestEvents = log.requestEvents;
    const observed = await observe(page, base, log);
    const current = { ...observed, requestEvents, json: JSON.stringify(observed.observation) };
    if (
      previous &&
      log.inFlight.size === 0 &&
      log.requestEvents === previous.requestEvents &&
      current.mutations === previous.mutations &&
      current.json === previous.json
    ) {
      return { ...current, captures };
    }
    if (Date.now() > deadline) {
      const before = previous?.observation;
      const changing = LAYERS.filter(
        (layer) => before && JSON.stringify(before[layer]) !== JSON.stringify(current.observation[layer]),
      );
      throw new Error(
        `never settled in ${SETTLE_TIMEOUT_MS} ms: ${log.inFlight.size} requests in flight, ` +
          `layers still changing: ${changing.join(', ') || 'none'}`,
      );
    }
    previous = current;
    await quietPeriod(page);
  }
}

// Returns the screenshot once two in a row, one quiet period apart, are identical.
// After SETTLE_TIMEOUT_MS it returns the last one.
async function stableScreenshot(page: Page): Promise<Buffer> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let previous = await page.screenshot();
  for (;;) {
    await quietPeriod(page);
    const current = await page.screenshot();
    if (current.equals(previous) || Date.now() > deadline) return current;
    previous = current;
  }
}

async function act(page: Page, step: Step, base: URL): Promise<void> {
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
      await page.clock.runFor(step.ms);
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
  const log: Log = { events: [], requests: [], inFlight: new Set(), requestEvents: 0 };
  const steps: StepRun[] = [];
  try {
    context.setDefaultTimeout(ACTION_TIMEOUT_MS);
    await context.exposeBinding('__aaEmit', (_source, json: string) => {
      log.events.push(JSON.parse(json));
    });
    await context.addInitScript(initPage);
    await context.clock.install({ time: CLOCK_START });
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

    for (const step of testCase.steps) {
      try {
        await act(page, step, base);
        const started = performance.now();
        const settled = await settle(page, base, log);
        const settleMs = Math.round(performance.now() - started);
        log.events.splice(0, settled.seen.events);
        log.requests.splice(0, settled.seen.requests);
        steps.push({
          observation: settled.observation,
          screenshot: await stableScreenshot(page),
          settleMs,
          captures: settled.captures,
        });
      } catch (error) {
        const message = (error as Error).message.split('\n')[0];
        return { steps, error: `step ${steps.length + 1} (${describeStep(step)}): ${message}` };
      }
    }
    return { steps };
  } finally {
    await context.close();
  }
}
