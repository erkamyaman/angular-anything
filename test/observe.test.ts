import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import type { Case } from '../src/case.ts';
import { runCase } from '../src/run.ts';

const doc = (body: string, script = '', css = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Observe</title>
<style>body { margin: 0; font: 16px/20px sans-serif; } ${css}</style></head>
<body><main>${body}</main><script>${script}</script></body></html>`;

const pages: Record<string, string> = {
  '/obs': doc(
    `<link rel="stylesheet" href="/missing.css"><script src="/missing.js"></script><img src="/missing.png" alt="" style="position: absolute; width: 1px; height: 1px">
<div id="box">box</div><p id="tail">tail</p><output id="size"></output><button id="go" type="button">Go</button>`,
    `document.getElementById('size').textContent = innerWidth + ' x ' + innerHeight;
document.getElementById('go').addEventListener('click', () => {
  window.__aa?.emit('clicked', { n: 1 });
  fetch('/api/a?x=1');
  fetch('/api/put', { method: 'PUT', body: '{"a":1}' });
  fetch('/api/del', { method: 'DELETE' });
  fetch('/api/patch', { method: 'PATCH', body: '{"b":2}' });
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/x?y=2');
  xhr.send();
  history.replaceState(null, '', '/obs?step=2&flag=on#frag');
});`,
    '#box { margin-top: 50px; height: 30px; width: 100px; } #tail { font-weight: 700; } #tail::after { content: "y"; color: rgb(1, 2, 3); }',
  ),
  '/names': doc(
    `<button id="a" type="button">Add</button><button id="b" type="button">Add all</button><output id="out">idle</output>`,
    `document.getElementById('a').addEventListener('click', () => { document.getElementById('out').textContent = 'one'; });
document.getElementById('b').addEventListener('click', () => { document.getElementById('out').textContent = 'all'; });`,
  ),
  '/failed': doc(
    `<button id="go" type="button">Go</button><output id="out">idle</output>`,
    `document.getElementById('go').addEventListener('click', () => {
  fetch('/api/reset').catch(() => { document.getElementById('out').textContent = 'failed'; });
});`,
  ),
  '/steps': doc(
    `<canvas id="c" width="32" height="32"></canvas>`,
    `const context = document.getElementById('c').getContext('2d');
const worker = new Worker(URL.createObjectURL(new Blob(['let n = 0; const timer = setInterval(() => { postMessage(n++); if (n > 20) clearInterval(timer); }, 50);'])));
worker.onmessage = ({ data }) => { context.fillStyle = 'rgb(' + data * 10 + ', 0, 0)'; context.fillRect(0, 0, 32, 32); };`,
  ),
  '/final': doc(
    `<canvas id="c" width="32" height="32"></canvas>`,
    `const context = document.getElementById('c').getContext('2d');
context.fillStyle = 'rgb(200, 0, 0)';
context.fillRect(0, 0, 32, 32);`,
  ),
  '/pixels': doc(
    `<canvas id="c" width="32" height="32"></canvas>`,
    `const context = document.getElementById('c').getContext('2d');
const worker = new Worker(URL.createObjectURL(new Blob(['let n = 0; setInterval(() => postMessage(++n), 10);'])));
worker.onmessage = ({ data }) => { context.fillStyle = 'rgb(' + (data % 256) + ', 0, 0)'; context.fillRect(0, 0, 32, 32); };`,
  ),
};

let browser: Browser;
let base: URL;
let close: () => void;

before(async () => {
  const server = createServer((request, response) => {
    request.resume();
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/reset') return void request.socket.destroy();
    if (url.pathname.startsWith('/api/')) return void response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    const html = pages[url.pathname];
    if (html === undefined) return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  close = () => {
    server.close();
    server.closeAllConnections();
  };
  base = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/?flag=on`);
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  close();
});

const go = { action: 'click', target: { role: 'button', name: 'Go' } } as const;
const make = (path: string, steps: Case['steps'] = [], viewport = { width: 640, height: 480 }): Case => ({
  format: 'angular-anything/case@1',
  id: 'observe',
  viewport,
  steps: [{ action: 'goto', path }, ...steps],
});

test('the viewport of the case is the size of the page', async () => {
  const run = await runCase(browser, make('/obs', [], { width: 500, height: 400 }), base);
  assert.equal(run.error, undefined);
  assert.ok(JSON.stringify(run.steps[0].observation.dom).includes('500 x 400'));
});

test('the box of an element holds its x, y, width and height', async () => {
  const run = await runCase(browser, make('/obs'), base);
  assert.equal(run.error, undefined);
  const { style } = run.steps[0].observation;
  assert.deepEqual(style['html[1]/body[1]/main[1]/div[1]'].box, { x: 0, y: 50, width: 100, height: 30 });
  assert.deepEqual(style['html[1]/body[1]/main[1]/p[1]'].box, { x: 0, y: 96, width: 640, height: 20 });
});

test('the document, scripts, styles and images that a page loads are no GET of the page', async () => {
  const run = await runCase(browser, make('/obs'), base);
  assert.deepEqual(run.steps[0].observation.effects.gets, []);
  assert.deepEqual(run.steps[0].observation.effects.requests, []);
});

test('a ::after with content is captured next to its element and one without content is not', async () => {
  const run = await runCase(browser, make('/obs'), base);
  const { style } = run.steps[0].observation;
  assert.equal(style['html[1]/body[1]/main[1]/p[1]/::after'].style.content, '"y"');
  assert.equal(style['html[1]/body[1]/main[1]/p[1]/::after'].style.color, 'rgb(1, 2, 3)');
  assert.equal(style['html[1]/body[1]/main[1]/p[1]'].style['font-weight'], '700');
  assert.equal(style['html[1]/body[1]/main[1]/p[1]/::after'].style['font-weight'], undefined, 'the pseudo-element lists what differs from its element');
  assert.equal(style['html[1]/body[1]/main[1]/div[1]/::after'], undefined);
  assert.equal(style['html[1]/body[1]/main[1]/p[1]/::before'], undefined);
});

test('the requests of a step keep their method, and the GETs of fetch and XHR are listed apart from the page URL', async () => {
  const run = await runCase(browser, make('/obs', [go]), base);
  assert.equal(run.error, undefined);
  const { effects } = run.steps[1].observation;
  assert.deepEqual(
    effects.requests.map((request) => [request.method, request.url.path.join('/')]),
    [
      ['PUT', 'api/put'],
      ['DELETE', 'api/del'],
      ['PATCH', 'api/patch'],
    ],
  );
  assert.deepEqual(effects.requests[0].body, { a: 1 });
  assert.deepEqual(effects.gets.map((get) => [get.path.join('/'), get.query]).sort(), [
    ['api/a', { x: ['1'] }],
    ['api/x', { y: ['2'] }],
  ]);
  assert.deepEqual(effects.url, { path: ['obs'], query: { step: ['2'] }, fragment: 'frag' });
});

test('the events and requests of a step belong to that step and are not reported again', async () => {
  const run = await runCase(browser, make('/obs', [go, { action: 'advance', frames: 2 }]), base);
  assert.equal(run.error, undefined);
  assert.deepEqual(run.steps[1].observation.events, [{ name: 'clicked', payload: { n: 1 } }]);
  assert.equal(run.steps[1].observation.effects.requests.length, 3);
  assert.deepEqual(run.steps[2].observation.events, []);
  assert.deepEqual(run.steps[2].observation.effects.requests, []);
  assert.deepEqual(run.steps[2].observation.effects.gets, []);
});

test('a request that fails does not stay in flight', { timeout: 60_000 }, async () => {
  const run = await runCase(browser, make('/failed', [go]), base);
  assert.equal(run.error, undefined);
  assert.ok(JSON.stringify(run.steps[1].observation.dom).includes('failed'));
});

test('pixels that never rest cost the wait of the screenshot and no more', { timeout: 60_000 }, async () => {
  const started = Date.now();
  const run = await runCase(browser, make('/pixels'), base);
  assert.equal(run.error, undefined);
  assert.equal(run.steps.length, 1);
  assert.ok(Date.now() - started < 30_000);
});

test('a target is the accessible name as it is written, not a part of one', async () => {
  const run = await runCase(browser, make('/names', [{ action: 'click', target: { role: 'button', name: 'Add' } }]), base);
  assert.equal(run.error, undefined);
  assert.ok(JSON.stringify(run.steps[1].observation.dom).includes('one'));
  const none = await runCase(browser, make('/names', [{ action: 'click', target: { role: 'button', name: 'Add a' } }]), base);
  assert.match(none.error ?? '', /^step 2 \(click button "Add a"\): the target matches 0 elements, the button elements here: "Add", "Add all"$/);
});

test('the screenshot of a step is the one that the page ends on, not one from the middle of a repaint', { timeout: 60_000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' });
  const tab = await context.newPage();
  await tab.goto(new URL('/final', base).href);
  const final = await tab.screenshot();
  await context.close();
  for (let round = 0; round < 3; round++) {
    const run = await runCase(browser, make('/steps'), base);
    assert.equal(run.error, undefined);
    assert.ok(run.steps[0].screenshot.equals(final), `round ${round + 1}`);
  }
});
