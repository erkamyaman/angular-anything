import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import type { Case } from '../src/case.ts';
import type { Observation } from '../src/compare.ts';
import { initPage, restPage } from '../src/page.ts';
import type { DomNode } from '../src/page.ts';
import { runCase } from '../src/run.ts';

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Clock</title>
<style>
  body { margin: 16px; font: 16px/1.5 sans-serif; }
  @keyframes blink { 50% { opacity: 0; } }
  @keyframes turn { to { transform: rotate(360deg); } }
  @keyframes item-in { from { opacity: 0; transform: translateX(-16px); } }
  @keyframes item-out { to { opacity: 0; transform: translateX(16px); } }
  .cursor { animation: blink 1s step-end infinite; }
  .ring { display: inline-block; animation: turn 1.3s linear infinite; }
  .toast { transition: opacity 200ms linear; }
  .toast.closing { opacity: 0; }
  .item { animation: item-in 200ms linear; }
  .item.leaving { animation: item-out 200ms linear forwards; }
</style>
</head>
<body>
<main>
  <h1>Clock<span class="cursor">|</span><span class="ring">o</span></h1>
  <div id="host"></div>
  <p><button type="button" id="inc">Increment</button> <output id="count">0</output></p>
  <p><label for="q">Search</label> <input id="q" type="text"> <output id="found"></output></p>
  <p><button type="button" id="show">Show toast</button></p>
  <div id="region"></div>
  <p><button type="button" id="add">Add</button> <button type="button" id="remove">Remove first</button></p>
  <ul id="items" aria-label="Items"></ul>
  <p><button type="button" id="send">Send</button> <output id="sent"></output></p>
  <p id="stamps"></p>
</main>
<script>
  const loaded = Date.now();
  const byId = (id) => document.getElementById(id);
  const stamp = (name) => {
    byId('stamps').textContent += name + ' at ' + (Date.now() - loaded) + ', ';
  };
  byId('stamps').textContent = 'loaded at ' + performance.now() + ', ';

  let ready = false;
  setTimeout(() => {
    ready = true;
  }, 0);
  fetch('/api/echo', { method: 'POST', body: '{}' }).then(() => stamp(ready ? 'answer' : 'early answer'));

  byId('host').attachShadow({ mode: 'open' }).innerHTML =
    '<style>@keyframes turn { to { transform: rotate(360deg) } } i { display: block; width: 12px; height: 12px; ' +
    'border: 2px solid; border-top-color: transparent; border-radius: 50%; animation: turn 900ms linear infinite }</style><i></i>';

  let spins = 0;
  const spin = setInterval(() => {
    if (++spins === 3) clearInterval(spin);
  }, 0);
  setTimeout(() => {
    throw new Error('a timer of the page throws');
  }, 40);

  byId('inc').addEventListener('click', () => {
    byId('count').textContent = String(Number(byId('count').textContent) + 1);
    stamp('inc');
  });

  let debounce;
  byId('q').addEventListener('input', () => {
    const typed = Date.now();
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      byId('found').textContent = byId('q').value + ' after ' + (Date.now() - typed) + ' ms';
    }, 300);
  });

  byId('show').addEventListener('click', () => {
    const shown = Date.now();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    const count = () => {
      toast.textContent = 'Saved, ' + Math.ceil((shown + 4000 - Date.now()) / 1000) + ' s left';
    };
    count();
    byId('region').append(toast);
    const countdown = setInterval(count, 1000);
    setTimeout(() => {
      clearInterval(countdown);
      toast.classList.add('closing');
    }, 4000);
    toast.addEventListener('transitionend', () => toast.remove());
    stamp('show');
  });

  let next = 1;
  byId('add').addEventListener('click', () => {
    const item = document.createElement('li');
    item.className = 'item';
    item.textContent = 'Item ' + next++;
    byId('items').append(item);
  });
  byId('remove').addEventListener('click', () => {
    const item = document.querySelector('.item:not(.leaving)');
    item.classList.add('leaving');
    item.addEventListener('animationend', () => item.remove());
  });

  byId('send').addEventListener('click', async () => {
    const sent = Date.now();
    stamp('send');
    setTimeout(() => {
      byId('send').disabled = true;
    }, 0);
    const response = await fetch('/api/echo', { method: 'POST', body: '{}' });
    await response.json();
    byId('send').disabled = false;
    byId('sent').textContent = 'answered after ' + (Date.now() - sent) + ' ms';
  });
</script>
</body>
</html>
`;

const spinner = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Spinner</title></head>
<body>
<main><h1>Spinner</h1><div id="host"></div></main>
<script>
  document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML =
    '<style>@keyframes turn { to { transform: rotate(360deg) } } i { display: block; width: 40px; height: 40px; ' +
    'border: 4px solid; border-top-color: transparent; border-radius: 50%; animation: turn 900ms linear infinite }</style><i></i>';
</script>
</body>
</html>
`;

const button = (name: string) => ({ role: 'button', name });

const testCase: Case = {
  format: 'angular-anything/case@1',
  id: 'clock',
  viewport: { width: 800, height: 600 },
  steps: [
    { action: 'goto', path: '/' },
    { action: 'click', target: button('Increment') },
    { action: 'fill', target: { role: 'textbox', name: 'Search' }, value: 'abc' },
    { action: 'advance', frames: 19 },
    { action: 'click', target: button('Show toast') },
    { action: 'advance', frames: 115 },
    { action: 'advance', frames: 140 },
    { action: 'click', target: button('Add') },
    { action: 'click', target: button('Add') },
    { action: 'click', target: button('Remove first') },
    { action: 'click', target: button('Send') },
  ],
};

const RUNS = 20;
const AT_ONCE = 4;

let browser: Browser;
let base: URL;
let close: () => void;

before(async () => {
  const server = createServer((request, response) => {
    request.resume();
    if (request.method === 'POST') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    } else {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(request.url === '/spinner' ? spinner : page);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  close = () => server.close();
  base = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  close();
});

function find(node: DomNode, id: string): Exclude<DomNode, string> | undefined {
  if (typeof node === 'string') return undefined;
  if (node.attrs?.id === id) return node;
  for (const child of node.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return undefined;
}

const text = (observation: Observation, id: string) => (find(observation.dom, id)?.children ?? []).join('');

function longhand(observation: Observation, path: string, property: string): string | undefined {
  for (;;) {
    const value = observation.style[path].style[property];
    if (value !== undefined || !path.includes('/')) return value;
    path = path.slice(0, path.lastIndexOf('/'));
  }
}

test('one case run 20 times gives one end state', { timeout: 300_000 }, async () => {
  const runs: Awaited<ReturnType<typeof runCase>>[] = [];
  const next = async (): Promise<void> => {
    if (runs.length >= RUNS) return;
    const index = runs.length;
    runs.length++;
    runs[index] = await runCase(browser, testCase, base);
    return next();
  };
  await Promise.all(Array.from({ length: AT_ONCE }, next));

  for (const run of runs) assert.equal(run.error, undefined);
  const states = new Set(runs.map((run) => JSON.stringify(run.steps.map((step) => [step.observation, step.captures]))));
  assert.equal(states.size, 1);

  const steps = runs[0].steps.map((step) => step.observation);
  assert.equal(steps.length, testCase.steps.length);
  const heading = 'html[1]/body[1]/main[1]/h1[1]';
  for (const step of steps) {
    assert.equal(longhand(step, `${heading}/span[1]`, 'opacity'), '1');
    assert.equal(longhand(step, `${heading}/span[2]`, 'transform'), 'matrix(1, 0, 0, 1, 0, 0)');
  }
  assert.equal(text(steps[0], 'stamps'), 'loaded at 0, answer at 0, ');
  assert.equal(text(steps[1], 'count'), '1');
  assert.equal(text(steps[2], 'found'), '');
  assert.equal(text(steps[3], 'found'), 'abc after 300 ms');
  assert.deepEqual(find(steps[4].dom, 'region')?.children, [
    { tag: 'div', attrs: { class: 'toast', role: 'status' }, children: ['Saved, 4 s left'] },
  ]);
  assert.deepEqual(find(steps[5].dom, 'region')?.children, [
    { tag: 'div', attrs: { class: 'toast', role: 'status' }, children: ['Saved, 3 s left'] },
  ]);
  assert.equal(find(steps[6].dom, 'region')?.children, undefined);
  assert.deepEqual(find(steps[8].dom, 'items')?.children, [
    { tag: 'li', attrs: { class: 'item' }, children: ['Item 1'] },
    { tag: 'li', attrs: { class: 'item' }, children: ['Item 2'] },
  ]);
  const items = 'html[1]/body[1]/main[1]/ul[1]';
  assert.equal(longhand(steps[8], `${items}/li[2]`, 'opacity'), '1');
  assert.equal(longhand(steps[8], `${items}/li[2]`, 'transform'), 'none');
  assert.deepEqual(find(steps[9].dom, 'items')?.children, [{ tag: 'li', attrs: { class: 'item' }, children: ['Item 2'] }]);
  assert.equal(text(steps[10], 'sent'), 'answered after 0 ms');
  assert.deepEqual(find(steps[10].dom, 'send')?.attrs, { id: 'send', type: 'button' });
  assert.equal(steps[10].effects.focus, 'html[1]/body[1]');
  assert.deepEqual(steps[10].effects.requests, [{ method: 'POST', url: '/api/echo', body: {} }]);
  assert.equal(text(steps[10], 'stamps'), 'loaded at 0, answer at 0, inc at 16, show at 368, send at 4544, ');
  assert.deepEqual(
    runs[0].steps.map((step) => step.captures),
    testCase.steps.map(() => 2),
  );
});

test('an endless animation inside a shadow root is held as well', async () => {
  const shadow: Case = { ...testCase, id: 'spinner', steps: [{ action: 'goto', path: '/spinner' }] };
  const first = await runCase(browser, shadow, base);
  const second = await runCase(browser, shadow, base);
  assert.equal(first.error, undefined);
  assert.equal(second.error, undefined);
  assert.ok(first.steps[0].screenshot.equals(second.steps[0].screenshot));
});

test('a page counts as at rest only after the browser had a frame since it changed', async () => {
  const context = await browser.newContext();
  try {
    await context.addInitScript(initPage);
    const tab = await context.newPage();
    await tab.goto(base.href);
    while (await tab.evaluate(restPage));
    assert.equal(await tab.evaluate(restPage), false);
    const state = await tab.evaluate(`(async () => {
      const send = document.getElementById('send');
      send.focus();
      send.disabled = true;
      const moved = await (${restPage})();
      return { moved, focus: document.activeElement.localName };
    })()`);
    assert.deepEqual(state, { moved: true, focus: 'body' });
  } finally {
    await context.close();
  }
});
