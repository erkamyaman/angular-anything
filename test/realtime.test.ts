import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import type { Case } from '../src/case.ts';
import type { Observation } from '../src/compare.ts';
import type { DomNode } from '../src/page.ts';
import { runCase } from '../src/run.ts';

const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Real time</title>
<style>body { margin: 0; font: 16px/1.5 sans-serif; } #bar { position: fixed; top: 0; left: 0; background: white; }
#tall { height: 4000px; } #log { margin: 0; }</style></head><body>`;

const pages: Record<string, string> = {
  '/scroll': `${head}<main><div id="bar"><button type="button" id="go">Scroll</button> <output id="pos">0</output>
<ol id="log" aria-label="Log"></ol></div><div id="tall"></div></main><script>
const byId = (id) => document.getElementById(id);
addEventListener('scroll', () => { byId('pos').textContent = String(Math.round(scrollY)); });
addEventListener('scrollend', () => {
  const item = document.createElement('li');
  item.textContent = 'scrollend ' + Math.round(scrollY) + ' at ' + Math.round(performance.now());
  byId('log').append(item);
});
byId('go').addEventListener('click', () => scrollTo({ top: 1500, behavior: 'smooth' }));
</script></body></html>`,
  '/endless': `${head}<main><div id="bar"><button type="button" id="go">Scroll</button></div><div id="tall"></div></main><script>
let down = true;
addEventListener('scrollend', () => { down = !down; scrollTo({ top: down ? 3000 : 0, behavior: 'smooth' }); });
document.getElementById('go').addEventListener('click', () => scrollTo({ top: 3000, behavior: 'smooth' }));
</script></body></html>`,
  '/answers': `${head}<main><button type="button" id="both">Both</button> <output id="last"></output> <output id="order"></output></main><script>
const byId = (id) => document.getElementById(id);
byId('both').addEventListener('click', () => {
  const seen = [];
  const note = (name) => () => { seen.push(name); byId('last').textContent = name; byId('order').textContent = seen.join(' then '); };
  fetch('/api/slow').then(note('slow'));
  fetch('/api/fast').then(note('fast'));
});
</script></body></html>`,
  '/chain': `${head}<main><button type="button" id="twelve">Twelve</button> <button type="button" id="forever">Forever</button> <output id="n"></output></main><script>
const byId = (id) => document.getElementById(id);
const next = (count, limit) => fetch('/api/n?i=' + count).then(() => {
  byId('n').textContent = String(count);
  if (count < limit) return next(count + 1, limit);
});
byId('twelve').addEventListener('click', () => next(1, 12));
byId('forever').addEventListener('click', () => next(1, Infinity));
</script></body></html>`,
  '/animations': `${head}<style>@keyframes slide { to { transform: translateX(10px); } } .box { width: 10px; height: 10px; background: red; }</style>
<main><button type="button" id="twelve">Twelve</button> <button type="button" id="forever">Forever</button> <output id="n"></output><div id="stage"></div></main><script>
const byId = (id) => document.getElementById(id);
const chain = (count, limit) => {
  const box = document.createElement('div');
  box.className = 'box';
  byId('stage').replaceChildren(box);
  byId('n').textContent = String(count);
  const animation = box.animate([{ opacity: 1 }, { opacity: 0.5 }], 100);
  animation.onfinish = () => { if (count < limit) chain(count + 1, limit); };
};
byId('twelve').addEventListener('click', () => chain(1, 12));
byId('forever').addEventListener('click', () => chain(1, Infinity));
</script></body></html>`,
};

let browser: Browser;
let base: URL;
let close: () => void;

before(async () => {
  const server = createServer((request, response) => {
    request.resume();
    const url = new URL(request.url ?? '/', 'http://localhost');
    const json = (body: string, delay = 0) =>
      setTimeout(() => response.writeHead(200, { 'content-type': 'application/json' }).end(body), delay);
    if (url.pathname === '/api/slow') return void json('"slow"', 300);
    if (url.pathname === '/api/fast') return void json('"fast"');
    if (url.pathname === '/api/n') return void json('{}');
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

const click = (name: string): Case['steps'][number] => ({ action: 'click', target: { role: 'button', name } });
const make = (path: string, ...steps: Case['steps']): Case => ({
  format: 'angular-anything/case@1',
  id: 'realtime',
  viewport: { width: 600, height: 400 },
  steps: [{ action: 'goto', path }, ...steps],
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
const text = (observation: Observation, id: string) => JSON.stringify(find(observation.dom, id)?.children ?? []);
const key = (run: Awaited<ReturnType<typeof runCase>>) =>
  JSON.stringify([run.error, run.steps.map((step) => [step.observation, step.frames])]);

test('a page that scrolls smoothly on a click ends at the same place, with the same frames, in every run', { timeout: 120_000 }, async () => {
  const testCase = make('/scroll', click('Scroll'));
  const runs = [];
  for (let index = 0; index < 4; index++) runs.push(await runCase(browser, testCase, base));
  assert.equal(runs[0].error, undefined);
  assert.equal(new Set(runs.map(key)).size, 1);
  const last = runs[0].steps[1].observation;
  assert.equal(text(last, 'pos'), '["1500"]');
  assert.match(text(last, 'log'), /scrollend 1500 at \d+/);
  assert.equal(runs[0].steps[1].frames, 4);
});

test('a page that moves without page time and never stops fails the step by name', { timeout: 60_000 }, async () => {
  const started = Date.now();
  const run = await runCase(browser, make('/endless', click('Scroll')), base, undefined, undefined, 1500);
  assert.match(run.error ?? '', /^step 2 \(click button "Scroll"\): the page moves without page time: still changing after 1500 ms of real time \(/);
  assert.ok(Date.now() - started < 20_000);
});

test('two requests at once are answered one at a time, in the order they were sent', { timeout: 120_000 }, async () => {
  const testCase = make('/answers', click('Both'));
  const runs = [];
  for (let index = 0; index < 4; index++) runs.push(await runCase(browser, testCase, base));
  assert.equal(runs[0].error, undefined);
  assert.equal(new Set(runs.map(key)).size, 1);
  assert.equal(text(runs[0].steps[1].observation, 'order'), '["slow then fast"]');
  assert.equal(text(runs[0].steps[1].observation, 'last'), '["fast"]');
});

test('12 answers one after another can be recorded, and a page that asks again at once fails by name', { timeout: 120_000 }, async () => {
  const twelve = await runCase(browser, make('/chain', click('Twelve')), base);
  assert.equal(twelve.error, undefined);
  assert.equal(text(twelve.steps[1].observation, 'n'), '["12"]');
  const started = Date.now();
  const forever = await runCase(browser, make('/chain', click('Forever')), base);
  assert.match(forever.error ?? '', /^step 2 \(click button "Forever"\): 1 requests in flight after 100 rounds of answers, the first: GET \/api\/n\?i=\d+$/);
  assert.ok(Date.now() - started < 60_000);
});

test('a chain of 12 animations ends, and one that starts the next without end fails by name', { timeout: 120_000 }, async () => {
  const runs = [];
  for (let index = 0; index < 3; index++) runs.push(await runCase(browser, make('/animations', click('Twelve')), base));
  assert.equal(runs[0].error, undefined);
  assert.equal(new Set(runs.map(key)).size, 1);
  assert.equal(text(runs[0].steps[1].observation, 'n'), '["12"]');
  const started = Date.now();
  const forever = await runCase(browser, make('/animations', click('Forever')), base);
  assert.equal(
    forever.error,
    'step 2 (click button "Forever"): the page did not come to rest in 100 rounds, the last to move: an animation',
  );
  assert.ok(Date.now() - started < 30_000);
});
