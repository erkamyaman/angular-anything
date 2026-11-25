import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, compareCase } from '../src/compare.ts';
import type { Layer, Observation } from '../src/compare.ts';
import { finish, stepReport, summarize } from '../src/report.ts';
import type { Report } from '../src/report.ts';
import type { UrlParts } from '../src/parts.ts';

const url = (path: string, query: Record<string, string[]> = {}): UrlParts => ({ path: path.split('/').slice(1), query });

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
      requests: [{ method: 'POST', url: url('/api/tasks'), body: { title: 'Call mom', priority: 1 } }],
      gets: [url('/api/suggestions')],
      storage: { tasks: '[{"id":1}]' },
      url: url('/'),
      title: 'Tasks',
      focus: button,
      popups: [],
    },
  };
}

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
      port.effects.url = url('/', { x: ['1'] });
      port.effects.title = 'Task list';
      port.effects.gets = [];
    }),
    {
      effects: [
        { path: 'requests[0].body.title', expected: 'Call mom', actual: undefined },
        { path: 'gets[0]', expected: url('/api/suggestions'), actual: undefined },
        { path: 'storage.tasks', expected: '[{"id":1}]', actual: undefined },
        { path: 'url.query.x', expected: undefined, actual: ['1'] },
        { path: 'title', expected: 'Tasks', actual: 'Task list' },
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

test('box numbers are compared exactly', () => {
  assert.deepEqual(
    differences((port) => {
      port.style[count].box = { x: 288.5, y: 304.09, width: 448.4, height: 20.75 };
    }),
    {
      style: [
        { path: `${count}.box.x`, expected: 288, actual: 288.5 },
        { path: `${count}.box.y`, expected: 304.59, actual: 304.09 },
        { path: `${count}.box.width`, expected: 448, actual: 448.4 },
        { path: `${count}.box.height`, expected: 21, actual: 20.75 },
      ],
    },
  );
  assert.deepEqual(
    differences((port) => {
      port.style[count].box!.width = 448.4;
    }),
    { style: [{ path: `${count}.box.width`, expected: 448, actual: 448.4 }] },
    'a box 0.4 px wider differs',
  );
  assert.deepEqual(
    differences((port) => {
      port.style[count].box!.y = 304.84;
    }),
    { style: [{ path: `${count}.box.y`, expected: 304.59, actual: 304.84 }] },
    'two boxes 0.25 px apart differ',
  );
  assert.deepEqual(
    differences((port) => {
      port.style[count].box!.height = 21.01;
    }),
    { style: [{ path: `${count}.box.height`, expected: 21, actual: 21.01 }] },
    'two boxes 0.01 px apart differ',
  );
});

test('numbers in events, requests and boxes that differ by less than 1e-9 differ', () => {
  assert.deepEqual(
    differences((port) => {
      port.events[0].payload = { id: 1 + 5e-10, done: true };
    }),
    { events: [{ path: '[0].payload.id', expected: 1, actual: 1 + 5e-10 }] },
  );
  assert.deepEqual(
    differences((port) => {
      port.effects.requests[0].body = { title: 'Call mom', priority: 1 + 5e-10 };
    }),
    { effects: [{ path: 'requests[0].body.priority', expected: 1, actual: 1 + 5e-10 }] },
  );
  assert.deepEqual(
    differences((port) => {
      port.style[count].box!.x = 288 + 5e-10;
    }),
    { style: [{ path: `${count}.box.x`, expected: 288, actual: 288 + 5e-10 }] },
  );
});

test('computed style has no tolerance either', () => {
  assert.deepEqual(
    differences((port) => {
      port.style[count].box!.x = 288.51;
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

test('an element has the longhands it lists and those of its parent', () => {
  const main = 'body[1]/main[1]';
  const withParent = (color: string, pseudo: Record<string, string>): Observation => {
    const result = observation();
    result.style = {
      [main]: { style: { color, display: 'flex' }, box: { x: 288, y: 0, width: 448, height: 400 } },
      [count]: result.style[count],
      [`${count}/::before`]: { style: pseudo },
    };
    delete result.style[count].style.color;
    return result;
  };
  assert.deepEqual(compare(withParent('rgb(0, 0, 0)', {}), withParent('rgb(0, 0, 0)', {})).style, []);
  assert.deepEqual(compare(withParent('rgb(0, 0, 0)', {}), withParent('rgb(9, 9, 9)', { content: '"x"' })).style, [
    { path: `${main}.style.color`, expected: 'rgb(0, 0, 0)', actual: 'rgb(9, 9, 9)' },
    { path: `${count}.style.color`, expected: 'rgb(0, 0, 0)', actual: 'rgb(9, 9, 9)' },
    { path: `${count}/::before.style.color`, expected: 'rgb(0, 0, 0)', actual: 'rgb(9, 9, 9)' },
    { path: `${count}/::before.style.content`, expected: undefined, actual: '"x"' },
  ]);
  assert.deepEqual(
    compare(withParent('rgb(0, 0, 0)', {}), withParent('rgb(0, 0, 0)', { display: 'block' })).style,
    [{ path: `${count}/::before.style.display`, expected: 'flex', actual: 'block' }],
    'a value that only one side lists is compared with the inherited one',
  );
});

function report(change: (port: Observation) => void, screenshot: 'identical' | 'different' = 'identical'): Report {
  const port = observation();
  change(port);
  const layers = compareCase([observation()], [port])[0];
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
        id: 'details',
        result: 'fail',
        stepCount: 1,
        steps: [stepReport(1, 'click button "Details"', { settleMs: 80, captures: 2, frames: 4 }, screenshot, layers)],
      },
    ],
  });
}

test('the summary names the failing layer, the step, the first differing path and both values', () => {
  const failed = report((port) => {
    port.effects.focus = 'body[1]';
    delete port.effects.storage.tasks;
    port.style[count].style['margin-left'] = '3px';
    port.style[count].box!.x = 291;
  });
  assert.equal(failed.result, 'fail');
  assert.equal(failed.cases[0].steps[0].layers.style.differences, 2);
  assert.equal(
    summarize(failed),
    `angular-anything gate: FAIL
suite fixture, source react, url http://localhost:4104/, original http://localhost:4101/
Playwright 1.65.1, chromium 159.0.8154.6

FAIL  details
      step 1 of 1: click button "Details" (4 frames)
        style and geometry: 2 differences, the first at ${count}.style.margin-left
          expected: "0px"
          actual:   "3px"
        side effects: 2 differences, the first at storage.tasks
          expected: "[{\\"id\\":1}]"
          actual:   nothing

1 of 1 cases failed. 1 of 1 compared steps differ.
Values not compared because the case names them as noise: 0.
Screenshots (soft, they never fail the gate): 1 identical, 0 different, 0 masked, 0 not compared.`,
  );
});

test('a report passes only when every step of every case ran and matched', () => {
  const passed = report(() => {});
  assert.equal(passed.result, 'pass');
  assert.match(summarize(passed), /^angular-anything gate: PASS\n[^]*\nPASS {2}details {2}1 step, frames: 4\n/);

  const different = report(() => {}, 'different');
  assert.equal(different.result, 'pass', 'a screenshot never fails the gate');
  assert.match(summarize(different), /0 identical, 1 different, 0 masked, 0 not compared\.$/);

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

test('dialogs and windows are a list in the order in which they happened, with every field they carry', () => {
  const alert = { kind: 'alert', message: 'Task added' } as const;
  const open = { kind: 'open', url: url('/popup', { n: ['1'] }), target: 'side', features: 'width=300' } as const;
  const base = (port: Observation) => {
    port.effects.popups = [alert, open];
  };
  const expected = observation();
  expected.effects.popups = [alert, open];
  const changed = (change: (port: Observation) => void) => {
    const port = observation();
    port.effects.popups = structuredClone([alert, open]);
    change(port);
    return Object.fromEntries(Object.entries(compare(expected, port)).filter(([, list]) => list.length > 0));
  };
  assert.deepEqual(changed(base), {});
  assert.deepEqual(
    changed((port) => {
      port.effects.popups = [];
    }),
    {
      effects: [
        { path: 'popups[0]', expected: alert, actual: undefined },
        { path: 'popups[1]', expected: open, actual: undefined },
      ],
    },
    'a port that never calls them',
  );
  assert.deepEqual(
    changed((port) => port.effects.popups.push(alert)),
    { effects: [{ path: 'popups[2]', expected: undefined, actual: alert }] },
    'a port that calls one more',
  );
  assert.deepEqual(
    changed((port) => port.effects.popups.reverse()),
    {
      effects: [
        { path: 'popups[0].kind', expected: 'alert', actual: 'open' },
        { path: 'popups[0].message', expected: 'Task added', actual: undefined },
        { path: 'popups[0].url', expected: undefined, actual: open.url },
        { path: 'popups[0].target', expected: undefined, actual: 'side' },
        { path: 'popups[0].features', expected: undefined, actual: 'width=300' },
        { path: 'popups[1].kind', expected: 'open', actual: 'alert' },
        { path: 'popups[1].url', expected: open.url, actual: undefined },
        { path: 'popups[1].target', expected: 'side', actual: undefined },
        { path: 'popups[1].features', expected: 'width=300', actual: undefined },
        { path: 'popups[1].message', expected: undefined, actual: 'Task added' },
      ],
    },
    'the order counts',
  );
  const one = (change: (entry: Record<string, unknown>) => void, index: number, path: string, was: unknown, now: unknown) =>
    assert.deepEqual(
      changed((port) => change(port.effects.popups[index] as Record<string, unknown>)),
      { effects: [{ path: `popups[${index}].${path}`, expected: was, actual: now }] },
    );
  one((entry) => (entry.message = 'Task added!'), 0, 'message', 'Task added', 'Task added!');
  one((entry) => (entry.kind = 'confirm'), 0, 'kind', 'alert', 'confirm');
  one((entry) => (entry.target = '_blank'), 1, 'target', 'side', '_blank');
  one((entry) => (entry.features = ''), 1, 'features', 'width=300', '');
  one((entry) => ((entry.url as UrlParts).path = ['other']), 1, 'url.path[0]', 'popup', 'other');
  one((entry) => ((entry.url as UrlParts).query = { n: ['2'] }), 1, 'url.query.n[0]', '1', '2');
});

test('a prompt has a default value that counts', () => {
  const prompt = { kind: 'prompt', message: 'Name?', default: 'Ada' } as const;
  const expected = observation();
  expected.effects.popups = [prompt];
  const port = observation();
  port.effects.popups = [{ ...prompt, default: '' }];
  assert.deepEqual(compare(expected, port).effects, [{ path: 'popups[0].default', expected: 'Ada', actual: '' }]);
});

test('each of the four box numbers differs on its own, also where the port is smaller', () => {
  for (const [key, expected, smaller] of [
    ['x', 288, 287.99],
    ['y', 304.59, 304.58],
    ['width', 448, 447.99],
    ['height', 21, 20.99],
  ] as const) {
    const found = differences((port) => {
      (port.style[count].box as Record<string, number>)[key] = smaller;
    });
    assert.deepEqual(found, { style: [{ path: `${count}.box.${key}`, expected, actual: smaller }] }, key);
  }
});

test('a number in an event or a request that is smaller than the recorded one differs', () => {
  assert.deepEqual(
    differences((port) => {
      port.events[0].payload = { id: 0, done: true };
    }),
    { events: [{ path: '[0].payload.id', expected: 1, actual: 0 }] },
  );
  assert.deepEqual(
    differences((port) => {
      port.effects.requests[0].body = { title: 'Call mom', priority: 0 };
    }),
    { effects: [{ path: 'requests[0].body.priority', expected: 1, actual: 0 }] },
  );
});

test('the last child of a node, the last event and the last request count', () => {
  const found = differences((port) => {
    (port.dom as { children: { children: unknown[] }[] }).children[0].children.pop();
    (port.accessibility.tree[0] as { children: unknown[] }).children.pop();
    port.events.pop();
    port.effects.requests.pop();
    port.effects.gets.pop();
  });
  assert.deepEqual(Object.keys(found).sort(), ['accessibility', 'dom', 'effects', 'events']);
  assert.equal(found.dom?.[0].path, `${count}`);
  assert.equal(found.accessibility?.[0].path, 'tree/main[1]/paragraph[1]');
  assert.equal(found.events?.[0].path, '[0]');
  assert.deepEqual(found.effects?.map((entry) => entry.path), ['requests[0]', 'gets[0]']);
});

test('the method and the URL of a request differ, whatever the method is', () => {
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    assert.deepEqual(
      differences((port) => {
        port.effects.requests[0].method = method;
      }),
      { effects: [{ path: 'requests[0].method', expected: 'POST', actual: method }] },
      method,
    );
  }
  assert.deepEqual(
    differences((port) => {
      port.effects.requests[0].url = url('/api/tasks/1', { q: ['a'] });
    }),
    {
      effects: [
        { path: 'requests[0].url.path[2]', expected: undefined, actual: '1' },
        { path: 'requests[0].url.query.q', expected: undefined, actual: ['a'] },
      ],
    },
  );
});

test('the two names that browsers report for the Mac system font are one font, in font-family only', () => {
  const linux = observation();
  const mac = observation();
  linux.style[count].style['font-family'] = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI"';
  mac.style[count].style['font-family'] = 'ui-sans-serif, -apple-system, "system-ui", "Segoe UI"';
  assert.deepEqual(compare(linux, mac).style, []);
  assert.deepEqual(compare(mac, linux).style, []);
  mac.style[count].style['font-family'] = 'ui-sans-serif, -apple-system, "Segoe UI"';
  assert.equal(compare(linux, mac).style.length, 1);
  mac.style[count].style['font-family'] = 'ui-sans-serif, -apple-system, system-ui, "Segoe UI"';
  assert.equal(compare(linux, mac).style.length, 1);
  const left = observation();
  const right = observation();
  left.events[0].payload = { font: 'BlinkMacSystemFont' };
  right.events[0].payload = { font: '"system-ui"' };
  assert.equal(compare(left, right).events.length, 1);
});
