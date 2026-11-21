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
import { runCase, within } from '../src/run.ts';

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
  <p><button type="button" id="later">Later</button> <output id="seen"></output></p>
  <p><button type="button" id="twice">Twice</button> <output id="both"></output></p>
  <p><button type="button" id="flash">Flash</button> <output id="flashed"></output></p>
  <p><button type="button" id="picture">Picture</button> <output id="shown"></output></p>
  <p><button type="button" id="chain">Chain</button> <output id="chained"></output></p>
  <p id="stamps"></p>
</main>
<script>
  const loaded = Date.now();
  const byId = (id) => document.getElementById(id);
  const stamp = (name) => {
    byId('stamps').textContent += name + ' at ' + (Date.now() - loaded) + ', ';
  };
  byId('stamps').textContent = 'loaded at ' + performance.now() + ' on ' + new Date().toISOString() + ', ';

  let ready = false;
  setTimeout(() => {
    ready = true;
  }, 0);
  setTimeout(() => {
    throw new Error('a timer of the page that is due at once throws');
  }, 0);
  fetch('/api/echo', { method: 'POST', body: '{}' }).then(() => stamp(ready ? 'answer' : 'early answer'));

  byId('host').attachShadow({ mode: 'open' }).innerHTML =
    '<style>@keyframes turn { to { transform: rotate(360deg) } } i { display: block; width: 12px; height: 12px; ' +
    'border: 2px solid; border-top-color: transparent; border-radius: 50%; animation: turn 900ms linear infinite }</style><i></i>';

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

  byId('later').addEventListener('click', () => {
    const clicked = Date.now();
    setTimeout(async () => {
      await (await fetch('/api/echo', { method: 'POST', body: '{}' })).json();
      byId('seen').textContent = 'answer seen ' + (Date.now() - clicked) + ' ms after the click';
    }, 100);
  });

  byId('twice').addEventListener('click', async () => {
    await (await fetch('/api/data')).json();
    byId('both').textContent = 'answer 1';
    setTimeout(async () => {
      await (await fetch('/api/data')).json();
      requestAnimationFrame(() => {
        byId('both').textContent = 'answer 2';
      });
    }, 16);
  });

  byId('flash').addEventListener('click', () => {
    byId('flashed').animate([{ opacity: 0 }, { opacity: 1 }], 600000).onfinish = () => {
      byId('flashed').textContent = 'flashed';
    };
  });

  byId('picture').addEventListener('click', () => {
    let due = false;
    setTimeout(() => {
      due = true;
    }, 0);
    const picture = new Image();
    picture.onload = () => {
      byId('shown').textContent = due ? 'shown' : 'shown early';
    };
    picture.src = '/dot.png';
  });

  byId('chain').addEventListener('click', () => {
    const link = (left) => {
      byId('chained').animate([{ opacity: 0 }, { opacity: 1 }], 600000).onfinish = () => {
        if (left > 0) link(left - 1);
        else byId('chained').textContent = 'chained';
      };
    };
    link(2);
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

const interval = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Interval</title></head>
<body>
<main><h1>Interval</h1></main>
<script>
  window.spins = 0;
  setInterval(() => {
    window.spins++;
  }, 0);
</script>
</body>
</html>
`;

const first = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>First</title></head>
<body>
<main>
  <h1>First</h1>
  <p>
    <a href="/second">Next</a> <a href="/api/nothing">Nothing</a> <a href="/gallery">Gallery</a>
    <a href="/routed">Routed</a> <a href="#part">Part</a>
  </p>
  <form action="/second" method="get"><button type="submit">Submit</button></form>
  <p>
    <button type="button" id="assign">Assign</button>
    <button type="button" id="reload">Reload</button>
    <button type="button" id="signin">Sign in</button>
    <button type="button" id="later">Later</button>
    <button type="button" id="task">Task</button>
    <button type="button" id="hang">Hang</button>
    <button type="button" id="soon">Hang soon</button>
    <button type="button" id="stop">Stop</button>
    <button type="button" id="push">Push</button>
  </p>
  <p id="loads"></p>
  <p id="part"></p>
</main>
<script>
  const byId = (id) => document.getElementById(id);
  sessionStorage.setItem('loads', String(Number(sessionStorage.getItem('loads') ?? 0) + 1));
  byId('loads').textContent = 'load ' + sessionStorage.getItem('loads');
  byId('assign').addEventListener('click', () => location.assign('/second'));
  byId('reload').addEventListener('click', () => location.reload());
  byId('signin').addEventListener('click', async () => {
    await (await fetch('/api/data')).json();
    location.assign('/second');
  });
  byId('later').addEventListener('click', () => {
    setTimeout(() => location.assign('/second'), 100);
  });
  byId('task').addEventListener('click', () => {
    setTimeout(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => location.assign('/second?late');
      channel.port2.postMessage(null);
    }, 0);
  });
  byId('hang').addEventListener('click', () => location.assign('/api/never'));
  byId('soon').addEventListener('click', () => {
    setTimeout(() => location.assign('/api/never'), 32);
  });
  byId('stop').addEventListener('click', () => {
    location.assign('/second?late');
    stop();
  });
  byId('push').addEventListener('click', () => {
    history.pushState({}, '', '/pushed');
    byId('part').textContent += 'pushed, ';
  });
  navigation.addEventListener('navigate', (event) => {
    if (event.hashChange || new URL(event.destination.url).pathname !== '/routed') return;
    event.intercept({
      async handler() {
        byId('part').textContent += 'routed, ';
      },
    });
  });
  addEventListener('hashchange', () => {
    byId('part').textContent += 'at ' + location.hash + ', ';
  });
</script>
</body>
</html>
`;

const second = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Second</title><link rel="stylesheet" href="/second.css"></head>
<body>
<main><h1>Second</h1><p id="out">waiting</p></main>
<script src="/second.js"></script>
</body>
</html>
`;

const secondScript = `
const started = Date.now() - Date.UTC(2026, 0, 1);
let due = false;
setTimeout(() => {
  due = true;
}, 0);
fetch('/api/data')
  .then((response) => response.json())
  .then((data) => {
    document.getElementById('out').textContent =
      'started at ' + started + ', loaded ' + data.value + (due ? '' : ' early') + ', margin ' + getComputedStyle(document.body).marginLeft;
  });
`;

const hop = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Hop</title></head>
<body>
<main><h1>Hop</h1><img src="/dot.png?late" alt="Dot"></main>
<script>
  location.replace('/second?late');
</script>
</body>
</html>
`;

const gallery = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Gallery</title></head>
<body>
<main><h1>Gallery</h1><img src="/api/never" alt="Never"></main>
</body>
</html>
`;

const synchronous = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Synchronous</title></head>
<body>
<main><h1>Synchronous</h1><p id="first"></p><p><button type="button" id="load">Load</button> <output id="again"></output></p></main>
<script>
  const ask = (path) => {
    const request = new XMLHttpRequest();
    request.open('GET', path, false);
    request.send();
    return 'loaded ' + JSON.parse(request.responseText).value;
  };
  document.getElementById('first').textContent = ask('/api/data');
  document.getElementById('load').addEventListener('click', () => {
    document.getElementById('again').textContent = ask('/api/moved') + ' after a redirect';
  });
</script>
</body>
</html>
`;

const stuck = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Stuck</title></head>
<body>
<main>
  <h1>Stuck</h1>
  <p>
    <button type="button" id="ask">Ask</button>
    <button type="button" id="drop">Drop</button>
    <button type="button" id="poll">Poll</button>
    <button type="button" id="soon">Poll soon</button>
    <button type="button" id="spin">Spin</button>
    <button type="button" id="freeze">Freeze</button>
    <output id="out">idle</output>
  </p>
  <canvas id="noise" width="40" height="40"></canvas>
</main>
<script>
  const byId = (id) => document.getElementById(id);
  byId('ask').addEventListener('click', () => fetch('/api/never'));
  byId('drop').addEventListener('click', async () => {
    const response = await fetch('/api/unread');
    byId('out').textContent = 'answered ' + response.status;
  });
  const poll = () => fetch('/api/slow').then((response) => response.json()).then(poll);
  byId('poll').addEventListener('click', poll);
  byId('soon').addEventListener('click', () => {
    setTimeout(poll, 32);
  });
  byId('freeze').addEventListener('click', () => {
    const source = 'let n = 0; setInterval(() => postMessage(++n), 20);';
    const paint = byId('noise').getContext('2d');
    new Worker(URL.createObjectURL(new Blob([source]))).onmessage = ({ data }) => {
      paint.fillStyle = 'rgb(0, ' + data + ', 0)';
      paint.fillRect(0, 0, 40, 40);
      while (data > 60) {}
    };
  });
  byId('spin').addEventListener('click', () => {
    setTimeout(() => {
      for (;;) {}
    }, 32);
  });
</script>
</body>
</html>
`;

const vector = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Vector</title></head>
<body>
<main>
  <h1>Vector</h1>
  <svg width="40" height="40" viewBox="0 0 40 40" role="img" aria-label="Fading in">
    <circle id="finite" cx="20" cy="20" r="10"><animate attributeName="opacity" from="0" to="0.8" dur="600s" fill="freeze"></animate></circle>
  </svg>
  <svg width="40" height="40" viewBox="0 0 40 40" role="img" aria-label="Busy">
    <circle id="endless" cx="20" cy="20" r="10"><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"></animate></circle>
  </svg>
  <svg width="40" height="40" viewBox="0 0 40 40" role="img" aria-label="Started by a click">
    <circle id="started" cx="20" cy="20" r="10"><animate id="grow" attributeName="r" from="2" to="15" begin="indefinite" dur="600s" fill="freeze"></animate></circle>
  </svg>
  <p><button type="button" id="start">Start</button></p>
</main>
<script>
  document.getElementById('start').addEventListener('click', () => document.getElementById('grow').beginElement());
</script>
</body>
</html>
`;

const closed = (animation: string, declared = false) => {
  const content = `<style>@keyframes grow { 50% { height: 60px } } i { display: block; width: 40px; height: 20px; ${animation} }</style><i></i>`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Closed</title></head>
<body>
<main>
  <h1>Closed</h1>
  <div id="host">${declared ? `<template shadowrootmode="closed">${content}</template>` : ''}</div>
  <p id="below">below the component</p>
</main>
<script>
  if (${!declared}) document.getElementById('host').attachShadow({ mode: 'closed' }).innerHTML = '${content}';
</script>
</body>
</html>
`;
};

const scrubbed = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Scrubbed</title>
<style>
  body { margin: 0; }
  @keyframes fill { from { width: 0 } to { width: 400px } }
  #bar { position: fixed; top: 0; left: 0; height: 4px; background: teal; animation: fill linear both; animation-timeline: scroll(root); }
  #tall { height: 2000px; }
</style>
</head>
<body>
<main><h1>Scrubbed</h1><div id="bar"></div><p id="box">scrubbed by hand</p><p><button type="button" id="half">Half</button></p><div id="tall"></div></main>
<script>
  const animation = document.getElementById('box').animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 1000, fill: 'both' });
  animation.playbackRate = 0;
  animation.currentTime = 250;
  document.getElementById('half').addEventListener('click', () => {
    scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2);
  });
</script>
</body>
</html>
`;

const pages: Record<string, string> = {
  '/spinner': spinner,
  '/interval': interval,
  '/first': first,
  '/second': second,
  '/second?': second,
  '/second?late': second,
  '/hop': hop,
  '/gallery': gallery,
  '/synchronous': synchronous,
  '/stuck': stuck,
  '/vector': vector,
  '/closed': closed('animation: grow 40ms steps(2) infinite'),
  '/closed-still': closed(''),
  '/declared': closed('animation: grow 40ms steps(2) infinite', true),
  '/declared-still': closed('', true),
  '/scrubbed': scrubbed,
};

const dot = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

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
    { action: 'click', target: button('Later') },
    { action: 'advance', frames: 10 },
    { action: 'click', target: button('Twice') },
    { action: 'click', target: button('Flash') },
    { action: 'click', target: button('Picture') },
    { action: 'click', target: button('Chain') },
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
    const send = (type: string, body: string | Buffer, headers = {}) =>
      response.writeHead(200, { 'content-type': type, ...headers }).end(body);
    if (request.method === 'POST') return send('application/json', '{}');
    switch (request.url) {
      case '/api/never':
        return;
      case '/api/nothing':
        return void response.writeHead(204).end();
      case '/api/moved':
        return void response.writeHead(302, { location: '/api/data' }).end();
      case '/dot.png?late':
        return void setTimeout(() => send('image/png', dot), 50);
      case '/second?late':
        return void setTimeout(() => send('text/html; charset=utf-8', second), 200);
      case '/api/data':
        return send('application/json', '{"value":7}');
      case '/api/unread':
        return send('application/json', '{"value":7}', { 'cache-control': 'no-store' });
      case '/api/slow':
        return void setTimeout(() => send('application/json', '{}'), 30);
      case '/dot.png':
        return send('image/png', dot);
      case '/second.js':
        return send('text/javascript', secondScript);
      case '/second.css':
        return send('text/css', 'body { margin-left: 40px; }');
    }
    send('text/html; charset=utf-8', pages[request.url ?? ''] ?? page);
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
  assert.equal(text(steps[0], 'stamps'), 'loaded at 0 on 2026-01-01T00:00:00.000Z, answer at 0, ');
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
  assert.equal(
    text(steps[10], 'stamps'),
    'loaded at 0 on 2026-01-01T00:00:00.000Z, answer at 0, inc at 16, show at 368, send at 4544, ',
  );
  assert.equal(text(steps[11], 'seen'), '');
  assert.equal(text(steps[12], 'seen'), 'answer seen 112 ms after the click');
  assert.equal(text(steps[13], 'both'), 'answer 2');
  assert.deepEqual(steps[13].effects.gets, ['/api/data']);
  assert.equal(text(steps[14], 'flashed'), 'flashed');
  assert.equal(text(steps[15], 'shown'), 'shown');
  assert.equal(text(steps[16], 'chained'), 'chained');
  assert.deepEqual(
    runs[0].steps.map((step) => step.captures),
    testCase.steps.map((step) => (step.action === 'click' && step.target.name === 'Twice' ? 4 : 2)),
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

test('a zero-delay interval of the page does not stop a frame', { timeout: 60_000 }, async () => {
  const steps: Case['steps'] = [{ action: 'goto', path: '/interval' }, { action: 'advance', frames: 3 }];
  const run = await runCase(browser, { ...testCase, id: 'interval', steps }, base);
  assert.equal(run.error, undefined);
  assert.equal(run.steps.length, 2);
});

test('a page counts as at rest only after the browser had a frame since it changed', async () => {
  const context = await browser.newContext();
  try {
    await context.addInitScript(initPage);
    const tab = await context.newPage();
    await tab.goto(base.href);
    while (await tab.evaluate(restPage));
    assert.equal(await tab.evaluate(restPage), '');
    const state = await tab.evaluate(`(async () => {
      const send = document.getElementById('send');
      send.focus();
      send.disabled = true;
      const moved = await (${restPage})();
      return { moved, focus: document.activeElement.localName };
    })()`);
    assert.deepEqual(state, { moved: 'the DOM', focus: 'body' });
  } finally {
    await context.close();
  }
});

const visit = (path: string, ...steps: Case['steps']) =>
  runCase(browser, { ...testCase, id: 'visit', steps: [{ action: 'goto', path }, ...steps] }, base);

const state = (run: Awaited<ReturnType<typeof runCase>>) =>
  JSON.stringify([run.error, run.steps.map((step) => [step.observation, step.captures])]);

test('a page that leaves by itself is followed to the page it loads', { timeout: 120_000 }, async () => {
  const ways: [string, Case['steps'], string][] = [
    ['a link', [{ action: 'click', target: { role: 'link', name: 'Next' } }], 'started at 16, loaded 7, margin 40px'],
    ['a form', [{ action: 'click', target: button('Submit') }], 'started at 16, loaded 7, margin 40px'],
    ['a script', [{ action: 'click', target: button('Assign') }], 'started at 16, loaded 7, margin 40px'],
    ['an answer', [{ action: 'click', target: button('Sign in') }], 'started at 16, loaded 7, margin 40px'],
    ['a task', [{ action: 'click', target: button('Task') }], 'started at 16, loaded 7, margin 40px'],
    [
      'a timer',
      [
        { action: 'click', target: button('Later') },
        { action: 'advance', frames: 10 },
      ],
      'started at 128, loaded 7, margin 40px',
    ],
  ];
  for (const [way, steps, shown] of ways) {
    const runs = [await visit('/first', ...steps), await visit('/first', ...steps), await visit('/first', ...steps)];
    assert.equal(new Set(runs.map(state)).size, 1, way);
    assert.equal(runs[0].error, undefined, way);
    const last = runs[0].steps.at(-1)!.observation;
    assert.equal(last.effects.title, 'Second', way);
    assert.equal(text(last, 'out'), shown, way);
    assert.deepEqual(last.effects.gets, ['/api/data'], way);
  }

  const again = await visit('/first', { action: 'click', target: button('Reload') });
  assert.equal(again.error, undefined);
  assert.equal(text(again.steps[0].observation, 'loads'), 'load 1');
  assert.equal(text(again.steps[1].observation, 'loads'), 'load 2');

  const hopped = await visit('/hop');
  assert.equal(hopped.error, undefined);
  assert.equal(hopped.steps[0].observation.effects.title, 'Second');
  assert.equal(text(hopped.steps[0].observation, 'out'), 'started at 0, loaded 7, margin 40px');
});

test('a navigation that ends without a new page leaves the page as it is', async () => {
  const run = await visit(
    '/first',
    { action: 'click', target: { role: 'link', name: 'Nothing' } },
    { action: 'click', target: button('Assign') },
  );
  assert.equal(run.error, undefined);
  assert.deepEqual(
    run.steps.map((step) => step.observation.effects.title),
    ['First', 'First', 'Second'],
  );

  const inside = await visit(
    '/first',
    { action: 'click', target: { role: 'link', name: 'Routed' } },
    { action: 'click', target: { role: 'link', name: 'Part' } },
    { action: 'click', target: button('Push') },
  );
  assert.equal(inside.error, undefined);
  assert.equal(text(inside.steps[3].observation, 'part'), 'routed, at #part, pushed, ');
  assert.deepEqual(
    inside.steps.map((step) => step.observation.effects.url),
    ['/first', '/routed', '/routed#part', '/pushed'],
  );

  const stopped = await visit(
    '/first',
    { action: 'click', target: button('Stop') },
    { action: 'click', target: button('Assign') },
  );
  assert.equal(stopped.error, undefined);
  assert.deepEqual(
    stopped.steps.map((step) => step.observation.effects.title),
    ['First', 'First', 'Second'],
  );
});

test('a synchronous request is answered at once, while the page loads and in a click', async () => {
  const run = await visit('/synchronous', { action: 'click', target: button('Load') });
  assert.equal(run.error, undefined);
  assert.equal(text(run.steps[0].observation, 'first'), 'loaded 7');
  assert.equal(text(run.steps[1].observation, 'again'), 'loaded 7 after a redirect');
  assert.deepEqual(run.steps[1].observation.effects.gets, ['/api/data', '/api/moved']);
});

test('an answer that the page does not read ends its request', async () => {
  const run = await visit('/stuck', { action: 'click', target: button('Drop') });
  assert.equal(run.error, undefined);
  assert.equal(text(run.steps[1].observation, 'out'), 'answered 200');
});

test('a wait that does not end fails the step after 5000 ms and names what was waited for', { timeout: 60_000 }, async () => {
  const [request, picture, navigation, later, clock] = await Promise.all([
    visit('/stuck', { action: 'click', target: button('Ask') }),
    visit('/first', { action: 'click', target: { role: 'link', name: 'Gallery' } }),
    visit('/first', { action: 'click', target: button('Hang') }),
    visit('/first', { action: 'click', target: button('Hang soon') }, { action: 'advance', frames: 5 }),
    visit('/stuck', { action: 'click', target: button('Spin') }, { action: 'advance', frames: 5 }),
  ]);
  assert.equal(
    request.error,
    'step 2 (click button "Ask"): 1 requests still in flight after 5000 ms, the first: GET /api/never',
  );
  assert.equal(picture.error, 'step 2 (click link "Gallery"): the navigation to /gallery did not load in 5000 ms');
  assert.equal(
    navigation.error,
    'step 2 (click button "Hang"): locator.click: Timeout 5000ms exceeded., the navigation to /api/never had not loaded',
  );
  assert.equal(later.error, 'step 3 (advance 5 frames): the navigation to /api/never did not load in 5000 ms');
  assert.equal(clock.error, 'step 3 (advance 5 frames): waited 5000 ms for a frame of the page clock');
});

test('a step has a limit in real time, and a wait is cut off with the message of that moment', { timeout: 60_000 }, async () => {
  const steps: Case['steps'] = [
    { action: 'goto', path: '/stuck' },
    { action: 'click', target: button('Poll') },
  ];
  const soon: Case['steps'] = [
    { action: 'goto', path: '/stuck' },
    { action: 'click', target: button('Poll soon') },
    { action: 'advance', frames: 5 },
  ];
  const frozen: Case['steps'] = [
    { action: 'goto', path: '/stuck' },
    { action: 'click', target: button('Freeze') },
  ];
  const started = Date.now();
  const [settling, advancing, shooting] = await Promise.all(
    [steps, soon, frozen].map((list) => runCase(browser, { ...testCase, id: 'limit', steps: list }, base, 2000)),
  );
  assert.match(settling.error ?? '', /^step 2 \(click button "Poll"\): no end after 2000 ms, the last wait was for /);
  assert.match(advancing.error ?? '', /^step 3 \(advance 5 frames\): no end after 2000 ms, the last wait was for /);
  assert.equal(shooting.error, 'step 2 (click button "Freeze"): no end after 2000 ms, the last wait was for the screenshot');
  assert.ok(Date.now() - started < 15_000);

  let waited = 'the first thing';
  const cut = within(new Promise(() => {}), () => `gave up on ${waited}`, 20);
  waited = 'the second thing';
  await assert.rejects(cut, /^Error: gave up on the second thing$/);
  assert.equal(await within(Promise.resolve(7), () => 'late', 20), 7);
  await assert.rejects(within(Promise.reject(new Error('its own error')), () => 'late', 20), /^Error: its own error$/);
});

test('an SVG animation is finished when it ends and held at one point when it does not', async () => {
  const steps: Case['steps'] = [{ action: 'click', target: button('Start') }];
  const runs = [await visit('/vector', ...steps), await visit('/vector', ...steps), await visit('/vector', ...steps)];
  assert.equal(new Set(runs.map(state)).size, 1);
  assert.equal(runs[0].error, undefined);
  const [loaded, started] = runs[0].steps.map((step) => step.observation);
  const circle = (svg: number) => `html[1]/body[1]/main[1]/svg[${svg}]/circle[1]`;
  assert.equal(longhand(loaded, circle(1), 'opacity'), '0.8');
  assert.equal(longhand(loaded, circle(2), 'opacity'), '1');
  assert.equal(longhand(loaded, circle(3), 'r'), '10px');
  assert.equal(longhand(started, circle(3), 'r'), '15px');
  assert.equal(longhand(started, circle(2), 'opacity'), '1');
});

for (const [kind, path] of [
  ['that a script attached', '/closed'],
  ['that the markup declares', '/declared'],
]) {
  test(`an endless animation inside a closed shadow root ${kind} is held as well`, async () => {
    const steps: Case['steps'] = [1, 2, 3, 4, 5].map(() => ({ action: 'advance', frames: 2 }));
    const below = (run: Awaited<ReturnType<typeof runCase>>) =>
      run.steps.map((step) => step.observation.style['html[1]/body[1]/main[1]/p[1]'].box);
    const still = await visit(`${path}-still`, ...steps);
    assert.equal(still.error, undefined);
    for (const run of [await visit(path, ...steps), await visit(path, ...steps), await visit(path, ...steps)]) {
      assert.equal(run.error, undefined);
      assert.deepEqual(below(run), below(still));
    }
  });
}

test('an animation that the page scrubs by hand or ties to the scroll position is left alone', async () => {
  const run = await visit('/scrubbed', { action: 'click', target: button('Half') });
  assert.equal(run.error, undefined);
  const [loaded, scrolled] = run.steps.map((step) => step.observation);
  const main = 'html[1]/body[1]/main[1]';
  assert.equal(longhand(loaded, `${main}/p[1]`, 'opacity'), '0.4');
  assert.equal(longhand(scrolled, `${main}/p[1]`, 'opacity'), '0.4');
  assert.equal(longhand(loaded, `${main}/div[1]`, 'width'), '0px');
  assert.ok(Math.abs(parseFloat(longhand(scrolled, `${main}/div[1]`, 'width') ?? '') - 200) < 1);
});
