import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, compareMasked, noiseMask } from '../src/compare.ts';
import type { Layer, Observation } from '../src/compare.ts';
import { finish, stepReport, summarize } from '../src/report.ts';
import type { Report } from '../src/report.ts';

const count = 'body[1]/main[1]/p[1]';
const button = 'body[1]/main[1]/button[1]';

function observation(): Observation {
  return {
    accessibility: {
      tree: [
        {
          role: 'main',
          children: [
            { role: 'button', name: 'Details', expanded: true },
            { role: 'paragraph', text: '1 task left' },
          ],
        },
      ],
      attributes: { [button]: { 'aria-controls': 'details', 'aria-expanded': 'true' } },
    },
    dom: {
      tag: 'body',
      children: [
        {
          tag: 'main',
          attrs: { class: 'app' },
          children: [
            { tag: 'button', attrs: { 'aria-controls': 'details', 'aria-expanded': 'true' }, children: ['Details'] },
            { tag: 'p', attrs: { class: 'count' }, children: ['1 task left'] },
          ],
        },
      ],
    },
    style: {
      [count]: { style: { 'margin-left': '0px', color: 'rgb(75, 85, 99)' }, box: { x: 288, y: 304.59, width: 448, height: 21 } },
    },
    events: [{ name: 'taskToggled', payload: { id: 1, done: true } }],
    effects: {
      requests: [{ method: 'POST', url: '/api/tasks', body: { title: 'Call mom', priority: 1 } }],
      gets: ['/api/suggestions'],
      storage: { tasks: '[{"id":1}]' },
      url: '/',
      focus: button,
    },
  };
}

// Compares the base observation with a changed copy and returns the layers that differ.
function differences(change: (port: Observation) => void) {
  const port = observation();
  change(port);
  const result = compare(observation(), port);
  return Object.fromEntries(Object.entries(result).filter(([, list]) => list.length > 0));
}

test('equal observations have no differences', () => {
  assert.deepEqual(differences(() => {}), {});
  assert.deepEqual(
    differences((port) => {
      port.effects.requests[0].body = { priority: 1, title: 'Call mom' };
    }),
    {},
    'the key order of a JSON body does not matter',
  );
});

test('each layer reports the path and both values', () => {
  assert.deepEqual(
    differences((port) => port.events.push({ name: 'taskToggled', payload: { id: 1, done: true } })),
    { events: [{ path: '[1]', expected: undefined, actual: { name: 'taskToggled', payload: { id: 1, done: true } } }] },
  );
  assert.deepEqual(
    differences((port) => {
      (port.events[0].payload as { done: boolean }).done = false;
    }),
    { events: [{ path: '[0].payload.done', expected: true, actual: false }] },
  );
  assert.deepEqual(
    differences((port) => {
      port.effects.requests[0].body = { priority: 1 };
      delete port.effects.storage.tasks;
      port.effects.focus = 'body[1]';
      port.effects.url = '/?x=1';
      port.effects.gets = [];
    }),
    {
      effects: [
        { path: 'requests[0].body.title', expected: 'Call mom', actual: undefined },
        { path: 'gets[0]', expected: '/api/suggestions', actual: undefined },
        { path: 'storage.tasks', expected: '[{"id":1}]', actual: undefined },
        { path: 'url', expected: '/', actual: '/?x=1' },
        { path: 'focus', expected: button, actual: 'body[1]' },
      ],
    },
  );
  assert.deepEqual(
    differences((port) => {
      (port.accessibility.tree[0] as { children: { expanded?: boolean }[] }).children[0].expanded = undefined;
      port.accessibility.attributes[button]['aria-expanded'] = 'false';
    }),
    {
      accessibility: [
        { path: 'tree/main[1]/button[1].expanded', expected: true, actual: undefined },
        { path: `attributes.${button}.aria-expanded`, expected: 'true', actual: 'false' },
      ],
    },
  );
});

test('the DOM is compared node by node', () => {
  const main = (port: Observation) => (port.dom as { children: { attrs: Record<string, string>; children: unknown[] }[] }).children[0];
  assert.deepEqual(
    differences((port) => {
      main(port).attrs.class = 'app dark';
      (main(port).children[1] as { children: string[] }).children[0] = '1 tasks left';
    }),
    {
      dom: [
        { path: 'body[1]/main[1].attrs.class', expected: 'app', actual: 'app dark' },
        { path: `${count}/text()[1]`, expected: '1 task left', actual: '1 tasks left' },
      ],
    },
  );
  assert.deepEqual(
    differences((port) => main(port).children.push({ tag: 'p', children: ['extra'] })),
    { dom: [{ path: 'body[1]/main[1]/p[2]', expected: undefined, actual: { tag: 'p' } }] },
  );
  assert.deepEqual(
    differences((port) => {
      main(port).children[1] = { tag: 'app-count', children: [main(port).children[1]] };
    }),
    { dom: [{ path: count, expected: { tag: 'p', attrs: { class: 'count' } }, actual: { tag: 'app-count' } }] },
    'a wrapper element is one difference and its subtree is not compared',
  );
});

test('geometry has a 0.5 px tolerance, computed style has none', () => {
  assert.deepEqual(
    differences((port) => {
      port.style[count].box = { x: 288.5, y: 304.09, width: 448.4, height: 20.75 };
    }),
    {},
  );
  assert.deepEqual(
    differences((port) => {
      port.style[count].box.x = 288.51;
      port.style[count].style['margin-left'] = '0.2px';
    }),
    {
      style: [
        { path: `${count}.style.margin-left`, expected: '0px', actual: '0.2px' },
        { path: `${count}.box.x`, expected: 288, actual: 288.51 },
      ],
    },
  );
  assert.deepEqual(
    differences((port) => {
      delete port.style[count];
    }),
    { style: [{ path: count, expected: observation().style[count], actual: undefined }] },
  );
});

test('what differs between two runs of the original is masked, and only that', () => {
  const first = observation();
  const second = observation();
  second.style[count].style.color = 'rgb(0, 0, 0)';
  (second.dom as { children: { attrs: Record<string, string> }[] }).children[0].attrs['data-nonce'] = '2';
  (first.dom as { children: { attrs: Record<string, string> }[] }).children[0].attrs['data-nonce'] = '1';
  second.effects.requests[0].body = { title: 'Call mom', priority: 1, sent: { at: 2 } };
  first.effects.requests[0].body = { title: 'Call mom', priority: 1, sent: { at: 1 } };

  const masked = noiseMask([observation(), first], [observation(), second]);
  assert.deepEqual(masked, [
    { step: 2, layer: 'dom', path: 'body[1]/main[1].attrs.data-nonce' },
    { step: 2, layer: 'style', path: `${count}.style.color` },
    { step: 2, layer: 'effects', path: 'requests[0].body.sent.at' },
  ]);

  const port = observation();
  port.style[count].style.color = 'rgb(9, 9, 9)';
  port.style[count].style['margin-left'] = '3px';
  (port.dom as { children: { attrs: Record<string, string> }[] }).children[0].attrs['data-nonce'] = '3';
  port.effects.requests[0].body = { title: 'Call mom', priority: 2, sent: { at: 3 } };

  const atStep2 = compareMasked(first, port, masked, 2);
  assert.deepEqual(atStep2.dom, { differences: [], masked: 1 });
  assert.deepEqual(atStep2.style, {
    differences: [{ path: `${count}.style.margin-left`, expected: '0px', actual: '3px' }],
    masked: 1,
  });
  assert.deepEqual(atStep2.effects, {
    differences: [{ path: 'requests[0].body.priority', expected: 1, actual: 2 }],
    masked: 1,
  });

  const atStep1 = compareMasked(first, port, masked, 1);
  assert.equal(atStep1.dom.differences.length, 1, 'a mask belongs to one step');
  assert.equal(atStep1.dom.masked, 0);

  const subtree = compareMasked(first, port, [{ step: 2, layer: 'effects', path: 'requests[0]' }], 2);
  assert.deepEqual(subtree.effects, { differences: [], masked: 2 }, 'a masked path covers everything below it');
  const sibling = compareMasked(first, port, [{ step: 2, layer: 'effects', path: 'requests[0].body.s' }], 2);
  assert.equal(sibling.effects.differences.length, 2, 'a mask is not a text prefix');
});

function report(change: (port: Observation) => void, screenshot: 'identical' | 'different' = 'identical'): Report {
  const port = observation();
  change(port);
  const layers = compareMasked(observation(), port, [], 1);
  return finish({
    format: 'angular-anything/report@0',
    command: 'gate',
    suite: 'fixture',
    source: 'react',
    url: 'http://localhost:4104/',
    playwright: '1.65.1',
    browser: 'chromium 159.0.8154.6',
    result: 'fail',
    cases: [
      {
        id: 'details',
        result: 'fail',
        stepCount: 1,
        steps: [stepReport(1, 'click button "Details"', { settleMs: 80, captures: 2 }, screenshot, layers)],
      },
    ],
  });
}

test('the summary names the failing layer, the step, the first differing path and both values', () => {
  const failed = report((port) => {
    port.effects.focus = 'body[1]';
    delete port.effects.storage.tasks;
    port.style[count].style['margin-left'] = '3px';
    port.style[count].box.x = 291;
  });
  assert.equal(failed.result, 'fail');
  assert.equal(failed.cases[0].steps[0].layers.style.differences, 2);
  assert.equal(
    summarize(failed),
    `angular-anything gate: FAIL
suite fixture, source react, url http://localhost:4104/
Playwright 1.65.1, chromium 159.0.8154.6

FAIL  details
      step 1 of 1: click button "Details"
        style and geometry: 2 differences, the first at ${count}.style.margin-left
          expected: "0px"
          actual:   "3px"
        side effects: 2 differences, the first at storage.tasks
          expected: "[{\\"id\\":1}]"
          actual:   nothing

1 of 1 cases failed. 1 of 1 compared steps differ.
Differences ignored because the original itself varied between its two recording runs: 0.
Screenshots (soft, they never fail the gate): 1 identical, 0 different, 0 masked.`,
  );
});

test('a report passes only when every step of every case ran and matched', () => {
  const passed = report(() => {});
  assert.equal(passed.result, 'pass');
  assert.match(summarize(passed), /^angular-anything gate: PASS\n[^]*\nPASS {2}details {2}1 step\n/);

  const different = report(() => {}, 'different');
  assert.equal(different.result, 'pass', 'a screenshot never fails the gate');
  assert.match(summarize(different), /0 identical, 1 different, 0 masked\.$/);

  const unfinished = report(() => {});
  unfinished.cases[0].stepCount = 2;
  unfinished.cases[0].error = 'step 2 (click button "Add"): the target matches 0 elements';
  assert.equal(finish(unfinished).result, 'fail');
  assert.match(summarize(unfinished), /FAIL {2}details\n {6}error: step 2 \(click button "Add"\): the target matches 0 elements/);

  const tampered = report(() => {});
  tampered.cases[0].steps = [];
  tampered.cases[0].lock = ['02.json does not match its SHA-256 in lock.json'];
  assert.equal(finish(tampered).result, 'fail');
  assert.match(summarize(tampered), /FAIL {2}details\n {6}lock: 02\.json does not match its SHA-256 in lock\.json/);

  const empty = report(() => {});
  empty.cases = [];
  assert.equal(finish(empty).result, 'fail');
  assert.match(summarize(empty), /FAIL {2}the suite fixture has no cases/);

  const layers: Layer[] = ['accessibility', 'dom', 'style', 'events', 'effects'];
  assert.deepEqual(Object.keys(passed.cases[0].steps[0].layers), layers);
});
