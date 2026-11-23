import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import type { Case } from '../src/case.ts';
import { browserFrame } from '../src/page.ts';
import { runCase } from '../src/run.ts';

const page = (script: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Limits</title></head>
<body><button id="start" type="button">Start</button><output id="out">idle</output>
<script>
const out = document.getElementById('out');
${script}
</script></body></html>`;

const pages: Record<string, string> = {
  '/frames': page(`
document.getElementById('start').addEventListener('click', () => {
  let count = 0;
  const step = () => {
    out.textContent = 'frame ' + ++count;
    if (count < 80) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});`),
  '/forever': page(`
document.getElementById('start').addEventListener('click', () => {
  let count = 0;
  const step = () => {
    out.textContent = 'frame ' + ++count;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});`),
  '/poll': page(`
document.getElementById('start').addEventListener('click', () => {
  let count = 0;
  const next = () => fetch('/api/n?i=' + ++count).then(() => setTimeout(next, 50));
  next();
});`),
  '/plain': page(`
document.getElementById('start').addEventListener('click', () => {
  out.textContent = 'clicked';
});`),
  '/worker-alert': page(`
document.getElementById('start').addEventListener('click', () => {
  const source = 'setInterval(() => postMessage(1), 20);';
  new Worker(URL.createObjectURL(new Blob([source]))).onmessage = () => alert('tick');
});`),
  '/worker-fetch': page(`
document.getElementById('start').addEventListener('click', () => {
  const source = 'setInterval(() => fetch(location.origin + "/api/n"), 20);';
  new Worker(URL.createObjectURL(new Blob([source])));
});`),
  '/worker-attribute': page(`
document.getElementById('start').addEventListener('click', () => {
  const source = 'let n = 0; setInterval(() => postMessage(++n), 20);';
  new Worker(URL.createObjectURL(new Blob([source]))).onmessage = ({ data }) => {
    out.setAttribute('data-n', String(data));
  };
});`),
  '/worker-text': page(`
out.textContent = 'text';
document.getElementById('start').addEventListener('click', () => {
  const source = 'let n = 0; setInterval(() => postMessage(++n), 20);';
  new Worker(URL.createObjectURL(new Blob([source]))).onmessage = ({ data }) => {
    out.firstChild.data = 'message ' + data;
  };
});`),
  '/worker': page(`
document.getElementById('start').addEventListener('click', () => {
  const source = 'let n = 0; setInterval(() => postMessage(++n), 20);';
  new Worker(URL.createObjectURL(new Blob([source]))).onmessage = ({ data }) => {
    out.textContent = 'message ' + data;
  };
});`),
};

let browser: Browser;
let base: URL;
let close: () => void;

before(async () => {
  const server = createServer((request, response) => {
    request.resume();
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/n') return void response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    const html = pages[url.pathname];
    if (html === undefined) return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  close = () => {
    server.close();
    server.closeAllConnections();
  };
  base = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  close();
});

const start = (path: string): Case => ({
  format: 'angular-anything/case@1',
  id: 'limits',
  viewport: { width: 600, height: 400 },
  steps: [
    { action: 'goto', path },
    { action: 'click', target: { role: 'button', name: 'Start' } },
  ],
});

test('a step that needs many frames is not cut off by the time it takes, as long as the frames keep coming', { timeout: 120_000 }, async () => {
  const runs = [await runCase(browser, start('/frames'), base, 1500), await runCase(browser, start('/frames'), base, 1500)];
  for (const run of runs) {
    assert.equal(run.error, undefined);
    assert.ok(run.steps[1].settleMs > 1500, `the step took ${run.steps[1].settleMs} ms`);
  }
  assert.equal(runs[0].steps[1].frames, runs[1].steps[1].frames);
  assert.ok(runs[0].steps[1].frames >= 80);
});

test('a page that changes in every frame fails with the limit of frames, however long a frame takes', { timeout: 120_000 }, async () => {
  const run = await runCase(browser, start('/forever'), base, 1500);
  assert.match(
    run.error ?? '',
    /^step 2 \(click button "Start"\): never settled in 300 frames: 0 requests in flight, the last frame was not quiet: the page changed \((accessibility, )?DOM\)$/,
  );
});

test('a page that sends its next request in every few frames fails with the limit of frames and names the request', { timeout: 120_000 }, async () => {
  const run = await runCase(browser, start('/poll'), base, 1500);
  assert.match(
    run.error ?? '',
    /^step 2 \(click button "Start"\): never settled in 300 frames: 0 requests in flight, the last frame was not quiet: .*, the last request was GET \/api\/n\?i=\d+, a page that sends one in every few frames never rests$/,
  );
});

test('motion without page time that only the probe sees is named by the part that moved', { timeout: 60_000 }, async () => {
  const run = await runCase(browser, start('/worker'), base, 30_000, undefined, 500);
  assert.match(run.error ?? '', /^step 2 \(click button "Start"\): the page moves without page time: still changing after 500 ms of real time \((accessibility|DOM|accessibility, DOM)\)$/);
});

test('dialogs that a worker causes outside page time are seen by the wait', { timeout: 60_000 }, async () => {
  const run = await runCase(browser, start('/worker-alert'), base, 30_000, undefined, 500);
  assert.match(run.error ?? '', /^step 2 \(click button "Start"\): the page moves without page time: still changing after 500 ms of real time \((side effects|dialogs and windows)\)$/);
});

test('requests that a worker sends outside page time are seen by the wait', { timeout: 60_000 }, async () => {
  const run = await runCase(browser, start('/worker-fetch'), base, 30_000, undefined, 500);
  assert.match(run.error ?? '', /^step 2 \(click button "Start"\): the page moves without page time: still changing after 500 ms of real time \(.*requests/);
});

test('a change of an attribute outside page time is seen by the wait', { timeout: 60_000 }, async () => {
  const run = await runCase(browser, start('/worker-attribute'), base, 30_000, undefined, 500);
  assert.match(run.error ?? '', /^step 2 \(click button "Start"\): the page moves without page time: still changing after 500 ms of real time \((accessibility, )?DOM/);
});

test('a change of the data of a text node outside page time is seen by the wait', { timeout: 60_000 }, async () => {
  const run = await runCase(browser, start('/worker-text'), base, 30_000, undefined, 500);
  assert.match(run.error ?? '', /^step 2 \(click button "Start"\): the page moves without page time: still changing after 500 ms of real time \((accessibility, )?DOM/);
});

function losing(browser: Browser, failures: { frame: number; shot: number; observe: number; late?: number; reload?: boolean }) {
  const thrown = { frame: 0, shot: 0, observe: 0, late: 0 };
  const wrapped = {
    async newContext(...args: Parameters<Browser['newContext']>) {
      const context = await browser.newContext(...args);
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        const evaluate = page.evaluate.bind(page) as (fn: unknown, arg?: unknown) => Promise<unknown>;
        const screenshot = page.screenshot.bind(page);
        let shots = 0;
        const gone = () => new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation');
        page.evaluate = (async (fn: unknown, arg?: unknown) => {
          if (fn === browserFrame && shots > 0 && thrown.frame++ < failures.frame) throw gone();
          if (String(fn).includes('ignoredTags') && shots > 0 && thrown.observe++ < failures.observe) throw gone();
          return evaluate(fn, arg);
        }) as typeof page.evaluate;
        page.screenshot = (async (...shot: Parameters<typeof page.screenshot>) => {
          shots++;
          if (shots === 2 && thrown.late++ < (failures.late ?? 0)) {
            throw new Error('page.screenshot: Execution context was destroyed, most likely because of a navigation');
          }
          if (thrown.shot++ < failures.shot) {
            if (failures.reload) await page.reload();
            throw new Error('page.screenshot: Timeout 5000ms exceeded.');
          }
          return screenshot(...shot);
        }) as typeof page.screenshot;
        return page;
      };
      return context;
    },
  } as unknown as Browser;
  return { browser: wrapped, thrown };
}

test('a page that is replaced while the screenshot or the last observation is taken is waited for, not an error', { timeout: 60_000 }, async () => {
  const lost = losing(browser, { frame: 2, shot: 0, observe: 1, late: 1 });
  const run = await runCase(lost.browser, start('/plain'), base);
  assert.equal(run.error, undefined);
  assert.ok(lost.thrown.frame > 2, 'the frame of the screenshot loop was lost twice and asked for again');
  assert.ok(lost.thrown.observe > 1, 'the observation was lost once and asked for again');
  assert.equal(lost.thrown.late, 1, 'the second screenshot was lost once and taken again');
  assert.equal(run.steps.length, 2);
});

test('a screenshot that fails while no navigation is under way is still an error of the step', { timeout: 60_000 }, async () => {
  const stuck = await runCase(losing(browser, { frame: 0, shot: 1, observe: 0 }).browser, start('/plain'), base);
  assert.match(stuck.error ?? '', /^step 1 \(goto \/plain\): page\.screenshot: Timeout 5000ms exceeded\.$/);
});

test('a screenshot that fails because the page loaded another document meanwhile is taken again', { timeout: 60_000 }, async () => {
  const lost = losing(browser, { frame: 0, shot: 1, observe: 0, reload: true });
  const run = await runCase(lost.browser, start('/plain'), base);
  assert.equal(run.error, undefined);
  assert.equal(lost.thrown.shot >= 2, true);
});
