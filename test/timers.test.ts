import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { beginStep, clampIntervals, dueTimers, initPage, probePage, trackTimers } from '../src/page.ts';
import { LOOKAHEAD_MS } from '../src/run.ts';

const shell = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Timers</title>
<style>body { margin: 0 } #tall { height: 3000px } #pane { width: 100px; height: 50px; overflow: auto } #inner { height: 400px } #wide { width: 50vw; height: 10px }</style></head>
<body><div id="tall"></div><div id="pane"><div id="inner"></div></div><div id="wide"></div><div id="host" style="display:block;width:100px;height:20px;overflow:hidden"></div>
<script>
const root = document.getElementById('host').attachShadow({ mode: 'closed' });
root.innerHTML = '<div style="width:50vw;height:10px"></div>';
</script></body></html>`;

let browser: Browser;
let base: URL;
let close: () => void;

before(async () => {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(shell);
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

async function open(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await context.addInitScript(initPage);
  await context.clock.pauseAt('2026-01-01T00:00:00Z');
  await context.addInitScript(clampIntervals);
  await context.addInitScript(trackTimers);
  const page = await context.newPage();
  await page.goto(base.href);
  return { context, page };
}

const due = (page: Page) => page.evaluate(dueTimers, 500);

test('the look-ahead is 500 ms and reaches a timer that is due in exactly 500 ms but not one in 501 ms', async () => {
  assert.equal(LOOKAHEAD_MS, 500);
  const { context, page } = await open();
  try {
    assert.equal(await due(page), null);
    await page.evaluate(() => void setTimeout(() => {}, 501));
    assert.equal(await due(page), null);
    await page.evaluate(() => void setTimeout(() => {}, 500));
    assert.deepEqual(await due(page), { delay: 500, left: 500 });
  } finally {
    await context.close();
  }
});

test('the look-ahead names the nearest timer, counts a timer of 0 ms as 0 and forgets a timer that was cleared', async () => {
  const { context, page } = await open();
  try {
    await page.evaluate(() => {
      setTimeout(() => {}, 400);
      setTimeout(() => {}, 100);
      const gone = setTimeout(() => {}, 50);
      clearTimeout(gone);
    });
    assert.deepEqual(await due(page), { delay: 100, left: 100 });
    await page.evaluate(() => void setTimeout(() => {}, 0));
    assert.deepEqual(await due(page), { delay: 0, left: 0 });
    await page.evaluate(() => {
      const w = window as unknown as { __aaPending: Map<unknown, unknown> };
      w.__aaPending.clear();
      const cleared = setTimeout(() => {}, 10);
      clearTimeout(cleared);
      const interval = setInterval(() => {}, 20);
      clearInterval(interval);
    });
    assert.equal(await due(page), null);
  } finally {
    await context.close();
  }
});

test('a timer that arms itself again stops counting once timers with its delay fired at two page times, per delay', async () => {
  const { context, page } = await open();
  try {
    await page.evaluate(() => {
      let count = 0;
      const again = () => {
        if (++count < 10) setTimeout(again, 100);
      };
      setTimeout(again, 100);
    });
    assert.deepEqual(await due(page), { delay: 100, left: 100 });
    await page.clock.runFor(100);
    assert.deepEqual(await due(page), { delay: 100, left: 100 });
    await page.clock.runFor(100);
    assert.equal(await due(page), null);
    await page.evaluate(beginStep);
    assert.deepEqual(await due(page), { delay: 100, left: 100 });
  } finally {
    await context.close();
  }
});

test('a timer of another delay still counts after the timers of one delay fired twice', async () => {
  const { context, page } = await open();
  try {
    await page.evaluate(() => {
      let count = 0;
      const again = () => {
        if (++count < 10) setTimeout(again, 100);
      };
      setTimeout(again, 100);
      setTimeout(() => {}, 300);
    });
    await page.clock.runFor(200);
    assert.deepEqual(await due(page), { delay: 300, left: 100 });
  } finally {
    await context.close();
  }
});

test('timers that fire at the same page time count as one firing', async () => {
  const { context, page } = await open();
  try {
    await page.evaluate(() => {
      setTimeout(() => setTimeout(() => {}, 50), 50);
      setTimeout(() => {}, 50);
    });
    await page.clock.runFor(50);
    assert.deepEqual(await due(page), { delay: 50, left: 50 });
  } finally {
    await context.close();
  }
});

const parts = async (page: Page) => JSON.parse(await page.evaluate(probePage)) as unknown[];

async function onlyThisMoved(change: (page: Page) => Promise<void>, index: number) {
  const { context, page } = await open();
  try {
    const before = await parts(page);
    await change(page);
    const after = await parts(page);
    const moved = before.map((_, at) => JSON.stringify(before[at]) !== JSON.stringify(after[at]));
    assert.equal(moved[0], false, 'the DOM did not change');
    assert.equal(moved[index], true);
    assert.equal(moved.filter(Boolean).length >= 1, true);
    return moved;
  } finally {
    await context.close();
  }
}

test('the probe sees a scroll of the page that changes nothing in the DOM', async () => {
  await onlyThisMoved((page) => page.evaluate(() => scrollTo(0, 120)), 2);
});

test('the probe sees a box that moves without a change in the DOM', async () => {
  await onlyThisMoved((page) => page.setViewportSize({ width: 500, height: 600 }), 3);
});

test('the probe sees a box inside a closed shadow root', async () => {
  const { context, page } = await open();
  try {
    const before = (await parts(page))[3] as number[];
    await page.setViewportSize({ width: 500, height: 600 });
    const after = (await parts(page))[3] as number[];
    const host = (await page.evaluate(() => document.getElementById('host')!.getBoundingClientRect().width)) as number;
    assert.equal(host, 100);
    assert.equal(after.length, before.length);
    assert.ok(before.length >= 4 * 7, `${before.length} numbers for the boxes of the page and its shadow root`);
    assert.notDeepEqual(before.slice(-4), after.slice(-4));
  } finally {
    await context.close();
  }
});

test('the probe sees the scroll offset of an element and the content of local storage', async () => {
  await onlyThisMoved((page) => page.evaluate(() => void (document.getElementById('pane')!.scrollTop = 40)), 4);
  await onlyThisMoved((page) => page.evaluate(() => localStorage.setItem('key', 'value')), 5);
  await onlyThisMoved((page) => page.evaluate(() => localStorage.setItem('length', 'value')), 5);
});
