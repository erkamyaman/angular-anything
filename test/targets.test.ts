import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import type { Case, Step } from '../src/case.ts';
import type { DomNode } from '../src/page.ts';
import { runCase } from '../src/run.ts';

const list = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>List</title>
<style>
  li { display: flex; gap: 8px; width: 300px }
  li span { flex: 1 }
  li .delete { display: none }
  li:hover .delete { display: inline }
</style></head>
<body><ul aria-label="Items">
  <li><input type="checkbox"><span>One</span><button class="delete" type="button" aria-label="Delete"></button></li>
  <li><input type="checkbox"><span>Two</span><button class="delete" type="button" aria-label="Delete"></button></li>
</ul><output id="out">none</output>
<script>
for (const item of document.querySelectorAll('li')) {
  const text = item.querySelector('span');
  item.querySelector('input').addEventListener('change', (event) => item.classList.toggle('done', event.target.checked));
  item.querySelector('.delete').addEventListener('click', () => item.remove());
  text.addEventListener('dblclick', () => (document.getElementById('out').textContent = 'editing ' + text.textContent));
  text.addEventListener('click', () => (document.getElementById('out').textContent = 'clicked ' + text.textContent));
}
</script></body></html>`;

let browser: Browser;
let base: URL;
let close: () => void;

before(async () => {
  const server = createServer((request, response) => {
    request.resume();
    if (request.url !== '/list') return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(list);
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

const run = (...steps: Step[]) => {
  const testCase: Case = {
    format: 'angular-anything/case@1',
    id: 'list',
    viewport: { width: 600, height: 400 },
    steps: [{ action: 'goto', path: '/list' }, ...steps],
  };
  return runCase(browser, testCase, base);
};

const texts = (node: DomNode): string[] => (typeof node === 'string' ? [node] : (node.children ?? []).flatMap(texts));
const items = (node: DomNode): { class?: string; text: string }[] => {
  if (typeof node === 'string') return [];
  if (node.tag === 'li') return [{ class: node.attrs?.class, text: texts(node).join('') }];
  return (node.children ?? []).flatMap(items);
};
const output = (node: DomNode): string => {
  if (typeof node === 'string') return '';
  if (node.tag === 'output') return texts(node).join('');
  return (node.children ?? []).map(output).join('');
};

test('a target without a name is picked by its index, also inside another target', async () => {
  const result = await run({ action: 'check', target: { role: 'checkbox', within: { role: 'listitem', index: 2 } } });
  assert.equal(result.error, undefined);
  assert.deepEqual(items(result.steps[1].observation.dom), [{ class: undefined, text: 'One' }, { class: 'done', text: 'Two' }]);
  const second = await run({ action: 'check', target: { role: 'checkbox', index: 2 } });
  assert.deepEqual(items(second.steps[1].observation.dom), items(result.steps[1].observation.dom));
});

test('a button that shows only while its row is hovered is reached by a hover step', async () => {
  const hidden = await run({ action: 'click', target: { role: 'button', name: 'Delete', within: { role: 'listitem', index: 1 } } });
  assert.equal(hidden.error, 'step 2 (click button "Delete" in listitem #1): the target matches 0 elements');
  const result = await run(
    { action: 'hover', target: { role: 'listitem', index: 1 } },
    { action: 'click', target: { role: 'button', name: 'Delete', within: { role: 'listitem', index: 1 } } },
  );
  assert.equal(result.error, undefined);
  assert.deepEqual(items(result.steps[1].observation.dom).map((item) => item.text), ['One', 'Two']);
  assert.deepEqual(items(result.steps[2].observation.dom).map((item) => item.text), ['Two']);
});

test('a double click is one step, and it is no single click', async () => {
  const result = await run({ action: 'dblclick', target: { role: 'listitem', index: 2 } });
  assert.equal(result.error, undefined);
  assert.equal(output(result.steps[1].observation.dom), 'editing Two');
  const single = await run({ action: 'click', target: { role: 'listitem', index: 2 } });
  assert.equal(output(single.steps[1].observation.dom), 'clicked Two');
});

test('a target that is not one element names how many it matched, and so does its container', async () => {
  const many = await run({ action: 'check', target: { role: 'checkbox' } });
  assert.equal(many.error, 'step 2 (check checkbox): the target matches 2 elements');
  const past = await run({ action: 'check', target: { role: 'checkbox', index: 3 } });
  assert.equal(past.error, 'step 2 (check checkbox #3): the target matches 2 elements, so there is no #3');
  const outer = await run({ action: 'check', target: { role: 'checkbox', within: { role: 'listitem' } } });
  assert.equal(outer.error, 'step 2 (check checkbox in listitem): the container listitem matches 2 elements');
});
