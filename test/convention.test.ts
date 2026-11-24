import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { compareCase } from '../src/compare.ts';
import type { Observation } from '../src/compare.ts';
import { capturePage } from '../src/page.ts';
import type { DomNode } from '../src/page.ts';
import { finish, stepReport, summarize } from '../src/report.ts';
import type { Report } from '../src/report.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const row = (attrs: Record<string, string>, text = 'Buy milk'): DomNode => ({ tag: 'li', attrs, children: [text] });

function observation(...items: DomNode[]): Observation {
  return {
    accessibility: { tree: [], attributes: {} },
    dom: { tag: 'html', children: [{ tag: 'body', children: [{ tag: 'ul', children: items }] }] },
    style: {},
    events: [],
    effects: { requests: [], gets: [], storage: {}, url: { path: [''], query: {}, fragment: '' }, title: 'Tasks', focus: null, popups: [] },
  };
}

const li = 'html[1]/body[1]/ul[1]/li[1]';

function reportOf(port: DomNode, unread: { path: string; attribute: string }[], original = row({ class: 'task' })): Report {
  const layers = compareCase([observation(original)], [observation(port)])[0];
  return finish({
    format: 'angular-anything/report@1',
    command: 'gate',
    suite: 'fixture',
    source: 'react',
    url: 'http://localhost:4104/',
    original: 'http://localhost:4101/',
    playwright: '1.65.1',
    browser: 'chromium 159.0.8154.6',
    result: 'fail',
    cases: [
      {
        id: 'initial-render',
        result: 'fail',
        stepCount: 1,
        steps: [stepReport(1, 'goto /', { settleMs: 50, captures: 2, frames: 4 }, 'identical', layers, unread)],
      },
    ],
  });
}

const naming = /empty attributes? that only the port has/;
const convention = /selector that the original element already matches\s+\(tag and class such as li\.task, or an existing attribute such as \[id=root\]\), else an input alias that is bound/;

test('the summary names the convention when the only DOM differences are empty attributes that only the port has and the browser does not read', () => {
  const report = reportOf(row({ apptaskrow: '', class: 'task' }), [{ path: li, attribute: 'apptaskrow' }]);
  assert.equal(report.result, 'fail');
  assert.deepEqual(report.cases[0].steps[0].convention, ['apptaskrow']);
  const text = summarize(report);
  assert.match(text, naming);
  assert.match(text, convention);
  assert.match(text, /does not read on that element: apptaskrow\.\n/);
  assert.match(text, /DOM: 1 difference, the first at html\[1\]\/body\[1\]\/ul\[1\]\/li\[1\]\.attrs\.apptaskrow/);
});

test('the same attribute on two rows is named once, and two attributes are named in order', () => {
  const layers = compareCase(
    [observation(row({ class: 'task' }), row({ class: 'task' }))],
    [observation(row({ b: '', class: 'task' }), row({ a: '', b: '', class: 'task' }))],
  )[0];
  const step = stepReport(1, 'goto /', { settleMs: 1, captures: 1, frames: 1 }, 'identical', layers, [
    { path: li, attribute: 'b' },
    { path: 'html[1]/body[1]/ul[1]/li[2]', attribute: 'b' },
    { path: 'html[1]/body[1]/ul[1]/li[2]', attribute: 'a' },
  ]);
  assert.deepEqual(step.convention, ['a', 'b']);
});

test('the line does not appear for any other DOM difference of the step', () => {
  const unread = [{ path: li, attribute: 'apptaskrow' }];
  const cases: [string, Report][] = [
    ['another text next to the attribute', reportOf(row({ apptaskrow: '', class: 'task' }, 'Buy bread'), unread)],
    ['another class next to the attribute', reportOf(row({ apptaskrow: '', class: 'task is-done' }), unread)],
    ['a value that is not empty', reportOf(row({ apptaskrow: 'x', class: 'task' }), [{ path: li, attribute: 'apptaskrow' }])],
    ['an attribute the browser reads', reportOf(row({ class: 'task', hidden: '' }), [])],
    ['an attribute that only the original has', reportOf(row({ class: 'task' }), unread, row({ apptaskrow: '', class: 'task' }))],
    ['an attribute that is not listed as unread', reportOf(row({ apptaskrow: '', class: 'task' }), [])],
    ['an attribute listed for another element', reportOf(row({ apptaskrow: '', class: 'task' }), [{ path: 'html[1]/body[1]/ul[1]/li[2]', attribute: 'apptaskrow' }])],
    ['an attribute that the original has with a value', reportOf(row({ apptaskrow: '', class: 'task' }), unread, row({ apptaskrow: 'x', class: 'task' }))],
    ['an attribute with another name', reportOf(row({ apptaskrow: '', class: 'task' }), [{ path: li, attribute: 'other' }])],
  ];
  for (const [name, report] of cases) {
    assert.equal(report.result, 'fail', name);
    assert.deepEqual(report.cases[0].steps[0].convention, [], name);
    assert.doesNotMatch(summarize(report), convention, name);
    assert.doesNotMatch(summarize(report), naming, name);
  }
});

test('an element that has no attributes in the original is named too, and only when every attribute of the port there is empty and unread', () => {
  const bare: DomNode = { tag: 'li', children: ['Buy milk'] };
  const names = (port: DomNode, unread: { path: string; attribute: string }[]) =>
    reportOf(port, unread, bare).cases[0].steps[0].convention;
  assert.deepEqual(names(row({ apptaskrow: '' }), [{ path: li, attribute: 'apptaskrow' }]), ['apptaskrow']);
  assert.deepEqual(
    names(row({ b: '', a: '' }), [
      { path: li, attribute: 'a' },
      { path: li, attribute: 'b' },
    ]),
    ['a', 'b'],
  );
  assert.deepEqual(names(row({ apptaskrow: '', class: 'task' }), [{ path: li, attribute: 'apptaskrow' }]), [], 'a class that the original lacks');
  assert.deepEqual(names(row({ apptaskrow: 'x' }), [{ path: li, attribute: 'apptaskrow' }]), [], 'a value');
  assert.deepEqual(names(row({ apptaskrow: '', hidden: '' }), [{ path: li, attribute: 'apptaskrow' }]), [], 'an attribute that is not listed');
  assert.deepEqual(names(row({ apptaskrow: '' }), []), []);
  assert.deepEqual(names(row({ apptaskrow: '' }), [{ path: 'html[1]/body[1]/ul[1]/li[2]', attribute: 'apptaskrow' }]), [], 'another element');
});

test('a step without a difference in the DOM has no line, and a pass has none', () => {
  const passed = reportOf(row({ class: 'task' }), []);
  assert.equal(passed.result, 'pass');
  assert.deepEqual(passed.cases[0].steps[0].convention, []);
  assert.doesNotMatch(summarize(passed), convention);
});

let browser: Browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
});

async function unreadOn(html: string) {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    return (await page.evaluate(capturePage)).unread;
  } finally {
    await page.close();
  }
}

test('the capture lists an empty attribute that the browser does not read on that element, and none that it reads', async () => {
  const html = (attrs: string) => `<ul><li ${attrs}>x</li></ul>`;
  const at = 'html[1]/body[1]/ul[1]/li[1]';
  assert.deepEqual(await unreadOn(html('apptaskrow=""')), [{ path: at, attribute: 'apptaskrow' }]);
  assert.deepEqual(await unreadOn(html('hidden')), [], 'hidden');
  assert.deepEqual(await unreadOn(html('title=""')), [], 'title');
  assert.deepEqual(await unreadOn(html('tabindex=""')), [], 'tabindex');
  assert.deepEqual(await unreadOn(html('aria-label=""')), [], 'aria-label');
  assert.deepEqual(await unreadOn(html('role=""')), [], 'role');
  assert.deepEqual(await unreadOn(html('apptaskrow="1"')), [], 'an attribute with a value is not listed');
  assert.deepEqual(await unreadOn(html('apptaskrow')), [{ path: at, attribute: 'apptaskrow' }], 'no value is the empty value');
  assert.deepEqual(await unreadOn('<div><span selected></span><input disabled><vaadin-tabs selected></vaadin-tabs></div>'), [
    { path: 'html[1]/body[1]/div[1]/span[1]', attribute: 'selected' },
    { path: 'html[1]/body[1]/div[1]/vaadin-tabs[1]', attribute: 'selected' },
  ]);
});

const originalPage = '<!doctype html><html lang="en"><head><title>Tasks</title></head><body><ul><li class="task">Buy milk</li></ul><p>Count</p></body></html>';
const portPage = (row: string, count = '<p>Count</p>') =>
  `<!doctype html><html lang="en"><head><title>Tasks</title></head><body><ul>${row}</ul>${count}</body></html>`;

let root: string;
let original: string;
const closers: (() => void)[] = [];

async function serve(html: string): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function run(...args: string[]): Promise<{ status: number | string; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ status: error ? (error.code ?? 'killed') : 0, output: stdout + stderr });
    });
  });
}

test('gate: a port with a plain attribute selector fails and the summary names the convention, any other difference fails without it', async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-convention-'));
  try {
    await mkdir(join(root, 'cases', 'tasks', 'initial'), { recursive: true });
    await writeFile(
      join(root, 'cases', 'tasks', 'initial', 'case.json'),
      JSON.stringify({ format: 'angular-anything/case@1', id: 'initial', viewport: { width: 800, height: 600 }, steps: [{ action: 'goto', path: '/' }] }),
    );
    original = await serve(originalPage);
    const recorded = await run('record', 'tasks', '--source', 'original', '--url', original);
    assert.equal(recorded.status, 0, recorded.output);
    const gate = async (row: string, count?: string) =>
      run('gate', 'tasks', '--source', 'original', '--url', await serve(portPage(row, count)));

    const same = await gate('<li class="task">Buy milk</li>');
    assert.equal(same.status, 0, same.output);
    assert.doesNotMatch(same.output, convention);

    const plain = await gate('<li apptaskrow="" class="task">Buy milk</li>');
    assert.equal(plain.status, 1, plain.output);
    assert.match(plain.output, naming);
    assert.match(plain.output, convention);
    assert.match(plain.output, /does not read on that element: apptaskrow\.\n/);

    const bare = await gate('<li class="task">Buy milk</li>', '<p appcount="">Count</p>');
    assert.equal(bare.status, 1, bare.output);
    assert.match(bare.output, /does not read on that element: appcount\.\n/);

    const hidden = await gate('<li class="task" hidden="">Buy milk</li>');
    assert.equal(hidden.status, 1, hidden.output);
    assert.doesNotMatch(hidden.output, convention);
    assert.doesNotMatch(hidden.output, naming);

    const mixed = await gate('<li apptaskrow="" class="task">Buy bread</li>');
    assert.equal(mixed.status, 1, mixed.output);
    assert.doesNotMatch(mixed.output, convention);

    const valued = await gate('<li apptaskrow="x" class="task">Buy milk</li>');
    assert.equal(valued.status, 1, valued.output);
    assert.doesNotMatch(valued.output, convention);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

after(() => {
  for (const close of closers) close();
});
