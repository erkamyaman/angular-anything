import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import type { Case } from '../src/case.ts';
import type { DomNode } from '../src/page.ts';
import { runCase } from '../src/run.ts';

const enter = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Enter</title>
<style>
  @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
  .a-enter { animation: fade 300ms linear }
  .moving { transition: opacity 300ms linear; opacity: 0 }
  .moving.go { opacity: 1 }
</style></head>
<body><button id="add" type="button">Add</button> <button id="slide" type="button">Slide</button><div id="host"></div><p id="fade" class="moving">Fade</p>
<script>
let count = 0;
document.getElementById('add').addEventListener('click', () => {
  const item = document.createElement('div');
  item.textContent = 'Item ' + ++count;
  document.getElementById('host').append(item);
  item.classList.add('a-enter');
  let ended = false;
  const onend = (event) => {
    if (event.target !== item) return;
    ended = true;
    item.classList.remove('a-enter');
  };
  item.addEventListener('animationstart', (event) => {
    if (event.target === item) item.addEventListener('animationend', onend);
  });
  requestAnimationFrame(() => {
    const running = item.getAnimations().length > 0 || parseFloat(getComputedStyle(item).animationDuration) > 0;
    if (!ended && !running) item.classList.remove('a-enter');
  });
});
document.getElementById('slide').addEventListener('click', () => {
  const target = document.getElementById('fade');
  let started = false;
  target.addEventListener('transitionstart', () => {
    started = true;
  });
  target.addEventListener('transitionend', () => {
    target.dataset.done = started ? 'after a start' : 'without a start';
  });
  target.classList.add('go');
});
</script></body></html>`;

let browser: Browser;
let base: URL;
let close: () => void;

before(async () => {
  const server = createServer((request, response) => {
    request.resume();
    if (request.url !== '/enter') return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(enter);
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

function find(node: DomNode, id: string): Exclude<DomNode, string> | undefined {
  if (typeof node === 'string') return undefined;
  if (node.attrs?.id === id) return node;
  for (const child of node.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return undefined;
}

const classes = (node: DomNode): string[] =>
  typeof node === 'string' ? [] : [node.attrs?.class ?? '', ...(node.children ?? []).flatMap(classes)];

test('an element that enters with a script that waits for the start of its animation keeps no class', { timeout: 60_000 }, async () => {
  const steps: Case['steps'] = [click('Add'), click('Add'), click('Add')];
  const testCase: Case = {
    format: 'angular-anything/case@1',
    id: 'enter',
    viewport: { width: 600, height: 400 },
    steps: [{ action: 'goto', path: '/enter' }, ...steps],
  };
  for (let run = 0; run < 3; run++) {
    const result = await runCase(browser, testCase, base);
    assert.equal(result.error, undefined);
    for (const step of result.steps) {
      const host = find(step.observation.dom, 'host');
      assert.ok(host);
      assert.deepEqual(classes(host).filter((name) => name.includes('a-enter')), []);
    }
    assert.equal(find(result.steps[3].observation.dom, 'host')?.children?.length, 3);
  }
});

test('a transition is announced before it is finished, so a page that waits for its start and its end sees both', async () => {
  const testCase: Case = {
    format: 'angular-anything/case@1',
    id: 'slide',
    viewport: { width: 600, height: 400 },
    steps: [{ action: 'goto', path: '/enter' }, click('Slide')],
  };
  const result = await runCase(browser, testCase, base);
  assert.equal(result.error, undefined);
  assert.equal(find(result.steps[1].observation.dom, 'fade')?.attrs?.['data-done'], 'after a start');
});
