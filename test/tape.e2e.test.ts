import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import type { Case } from '../src/case.ts';
import { runCase } from '../src/run.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const doc = (body: string, script: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tape</title></head><body><main>${body}</main><script>
const v = new URLSearchParams(location.search).get('v') ?? '';
const $ = (id) => document.getElementById(id);
const on = (id, work) => $(id).addEventListener('click', work);
${script}
</script></body></html>`;

const pages: Record<string, string> = {
  '/list': doc(
    `<ul id="items" aria-label="Items"></ul><p id="count"></p><button id="add">Add</button><button id="drop">Delete</button>`,
    `async function get(url) {
  const sent = [fetch(url)];
  if (v === 'twice' || (v === 'list-twice' && url.includes('items'))) sent.push(fetch(url));
  const answers = await Promise.all(sent);
  return answers.at(-1).json();
}
const viaXhr = (url) => new Promise((done) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.onload = () => done(JSON.parse(xhr.responseText));
  xhr.send();
});
async function load() {
  const list = v === 'query-order' ? '/api/items?limit=10&filter=all' : '/api/items?filter=all&limit=10';
  const urls = v === 'swap' ? ['/api/count', list] : [list, '/api/count'];
  const answers = await Promise.all(urls.map(v === 'xhr' ? viaXhr : get));
  if (v === 'swap') answers.reverse();
  const [items, count] = answers;
  $('items').replaceChildren(...items.map((text) => Object.assign(document.createElement('li'), { textContent: text })));
  $('count').textContent = count + ' items';
}
on('add', async () => {
  const item = v === 'body-order' ? { done: false, title: 'Milk' } : { title: v === 'changed' ? 'Eggs' : 'Milk', done: false };
  const send = () => fetch('/api/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) });
  await send();
  if (v === 'post-twice') await send();
  if (v === 'unknown') await fetch('/api/unknown').catch(() => {});
  await load();
});
on('drop', async () => {
  await fetch('/api/items/0', { method: 'DELETE' });
  $('items').firstElementChild.remove();
  if (v === 'refetch') await load().catch(() => {});
});
load();`,
  ),
  '/poll': doc(
    `<p id="job">?</p><button id="advance">Advance</button>`,
    `const every = v === 'fast' ? 496 : v === 'slow' ? 2992 : 992;
const poll = async () => { $('job').textContent = await (await fetch('/api/job')).json(); };
poll();
setInterval(poll, every);
on('advance', () => fetch('/api/job/advance'));`,
  ),
  '/ids': doc(
    `<p id="id">?</p><button id="load">Load</button>`,
    `on('load', async () => {
  const { id } = await (await fetch('/api/id')).json();
  $('id').textContent = v === 'other' ? 'id-0' : id;
});`,
  ),
  '/query': doc(
    `<p id="out">?</p><button id="go">Go</button>`,
    `on('go', async () => {
  const query = v === 'recoded' ? '?q=a%20b&tag=x' : v === 'other' ? '?tag=x&q=b' : '?tag=x&q=a+b';
  const first = await (await fetch('/api/echo' + query)).text();
  const posted = v === 'post-other' ? '?tag=x&q=b' : query;
  const second = await (await fetch('/api/echo' + posted, { method: 'POST' })).text();
  $('out').textContent = first + ' ' + second;
});`,
  ),
  '/auth': doc(
    `<p id="out">?</p><button id="go">Go</button>`,
    `const secret = v === 'value' ? 'Bearer anothervalue0000' : 'Bearer s3cretvalue123456';
on('go', async () => {
  await (await fetch('/api/echo?n=1', { headers: { Authorization: secret } })).text();
  const headers = {};
  if (v !== 'drop' && v !== 'both') headers.Authorization = secret;
  if (v === 'xsrf') headers['X-XSRF-TOKEN'] = 'xsrfvalue';
  await (await fetch('/api/echo?n=2', { headers })).text();
  await (await fetch('/api/echo', { method: 'POST', headers: v === 'post' || v === 'both' ? { Authorization: secret } : {} })).text();
  $('out').textContent = 'done';
});`,
  ),
  '/order': doc(
    `<p id="out">?</p><button id="go">Go</button>`,
    `on('go', () => {
  for (const name of ['first', 'second']) fetch('/api/late?name=' + name).then((r) => r.text()).then((text) => { $('out').textContent = text; });
});`,
  ),
  '/write': doc(
    `<p id="out">?</p><button id="go">Go</button>`,
    `on('go', async () => {
  const written = fetch('/api/slow-write', { method: 'POST' });
  if (v === 'waits') await written;
  $('out').textContent = await (await fetch('/api/written')).text();
});`,
  ),
  '/timer': doc(
    `<p id="out"></p>`,
    `const log = (word) => { $('out').textContent += word + ';'; };
setTimeout(() => log('timer'), 0);
fetch('/api/echo').then(() => log('answer'));
document.body.append(Object.assign(new Image(), { src: '/slow.gif', alt: '' }));`,
  ),
  '/extra': doc(
    `<p id="out">?</p><button id="go">Go</button>`,
    `on('go', async () => {
  const own = await fetch('/api/headers', { method: 'HEAD' });
  const made = await fetch('/api/echo', { method: 'PUT', body: 'x' });
  const sync = new XMLHttpRequest();
  sync.open('GET', '/api/echo?sync=1', false);
  sync.send();
  const bytes = new Uint8Array(await (await fetch('/api/bytes')).arrayBuffer());
  const gone = await fetch('/api/gone').then(() => 'there', () => 'gone');
  $('out').textContent = [own.status, made.status, made.headers.get('location'), made.headers.get('x-secret'), sync.responseText, [...bytes].join(','), gone].join(' ');
});`,
  ),
  '/socket': doc(`<button id="go">Go</button>`, `on('go', () => { new WebSocket('ws://' + location.host + '/api/socket?key=socketvalue'); });`),
  '/stream': doc(`<button id="go">Go</button>`, `on('go', () => { new EventSource('/api/stream?key=streamvalue'); });`),
  '/stream-fetch': doc(`<button id="go">Go</button>`, `on('go', () => { fetch('/api/stream?key=streamvalue').then((r) => r.text()); });`),
  '/foreign': doc(
    `<button id="go">Go</button>`,
    `on('go', () => { fetch('http://localhost:' + location.port + '/api/echo?key=foreignvalue', { method: 'POST', body: 'bodyvalue' }).catch(() => {}); });`,
  ),
  '/cookie': doc(`<button id="go">Go</button>`, `on('go', () => fetch('/api/cookie?key=queryvalue'));`),
  '/redirect': doc(`<button id="go">Go</button>`, `on('go', () => fetch('/api/redirect?key=queryvalue'));`),
};

let root: string;
let url: string;
let server: Server;
let browser: Browser;
let off = false;
let hits: string[] = [];
let items: string[] = [];
let job = 0;
let ids = 0;
let written = false;

function api(request: IncomingMessage, response: ServerResponse) {
  const { pathname, search, searchParams } = new URL(request.url!, 'http://localhost');
  const chunks: Buffer[] = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    hits.push(`${request.method} ${pathname}${search}`);
    if (off || pathname === '/api/gone') return void request.socket.destroy();
    const json = (value: unknown, status = 200) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    if (pathname === '/api/items' && request.method === 'POST') return void json(items.push(JSON.parse(Buffer.concat(chunks).toString()).title), 201);
    if (pathname === '/api/items') return void json(items);
    if (pathname.startsWith('/api/items/')) return void json(items.shift());
    if (pathname === '/api/count') return void json(items.length);
    if (pathname === '/api/job') return void json(['waiting', 'running', 'done'][job]);
    if (pathname === '/api/job/advance') return void json(++job);
    if (pathname === '/api/id') return void json({ id: `id-${++ids}` });
    if (pathname === '/api/late') return void setTimeout(() => json(searchParams.get('name')), searchParams.get('name') === 'first' ? 200 : 0);
    if (pathname === '/api/slow-write') return void setTimeout(() => ((written = true), json(1, 201)), 200);
    if (pathname === '/api/written') return void json(written ? 'new' : 'old');
    if (pathname === '/api/bytes') return void response.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.from([0, 255, 128]));
    if (pathname === '/api/headers') return void response.writeHead(204).end();
    if (pathname === '/api/stream') return void response.writeHead(200, { 'content-type': 'text/event-stream' }).write('data: 1\n\n');
    if (pathname === '/api/cookie') return void response.writeHead(200, { 'set-cookie': 'sid=cookievalue' }).end();
    if (pathname === '/api/redirect') return void response.writeHead(302, { location: 'http://elsewhere.test/api/echo?to=targetvalue' }).end();
    if (pathname === '/api/moved') return void response.writeHead(searchParams.has('keep') ? 307 : 302, { location: '/api/target' }).end();
    if (pathname === '/api/target') return void json(`${request.method} ${Buffer.concat(chunks)}`);
    if (request.method === 'PUT') return void response.writeHead(201, { location: '/api/made', 'x-secret': 'headervalue', 'www-authenticate': 'challengevalue' }).end();
    json('echo');
  });
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-tape-'));
  server = createServer((request, response) => {
    const { pathname } = new URL(request.url!, 'http://localhost');
    if (pathname.startsWith('/api/')) return api(request, response);
    request.resume();
    if (pathname === '/slow.gif') return void setTimeout(() => response.writeHead(404).end(), 500);
    const html = pages[pathname];
    if (html === undefined) return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  server.close();
  server.closeAllConnections();
  await rm(root, { recursive: true, force: true });
});

type Step = Record<string, unknown>;
const click = (name: string): Step => ({ action: 'click', target: { role: 'button', name } });
const advance = (frames: number): Step => ({ action: 'advance', frames });
const reload: Step = { action: 'reload' };

async function suite(name: string, path: string, steps: Step[], extra: Record<string, unknown> = {}) {
  const folder = join(root, 'cases', name, name);
  await mkdir(folder, { recursive: true });
  const testCase = {
    format: 'angular-anything/case@1',
    id: name,
    viewport: { width: 800, height: 600 },
    steps: [{ action: 'goto', path }, ...steps],
    ...extra,
  };
  await writeFile(join(folder, 'case.json'), JSON.stringify(testCase));
  return testCase as unknown as Case;
}

function run(...args: string[]): Promise<{ status: number | string; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ status: error ? (error.code ?? 'killed') : 0, output: stdout + stderr });
    });
  });
}

function reset(state: { items?: string[] } = {}) {
  off = false;
  hits = [];
  items = state.items ?? ['Bread'];
  job = 0;
  written = false;
}

const record = (name: string, variant = '') => {
  reset();
  return run('record', name, '--source', name, '--url', variant ? `${url}/?v=${variant}` : url);
};

async function gate(name: string, variant = '', ...more: string[]) {
  off = true;
  hits = [];
  const result = await run('gate', name, '--source', name, '--url', variant ? `${url}/?v=${variant}` : url, ...more);
  assert.deepEqual(hits, [], `no request of the tape reaches the backend\n${result.output}`);
  return result;
}

const passes = async (name: string, variant = '', ...more: string[]) => {
  const result = await gate(name, variant, ...more);
  assert.equal(result.status, 0, `${variant}\n${result.output}`);
  return result.output;
};

const fails = async (name: string, variant: string, ...expected: (string | RegExp)[]) => {
  const result = await gate(name, variant);
  assert.equal(result.status, 1, `${variant}\n${result.output}`);
  for (const text of expected) {
    if (typeof text === 'string') assert.ok(result.output.includes(text), `${variant}: ${text}\n${result.output}`);
    else assert.match(result.output, text);
  }
  return result.output;
};

const file = (name: string, ...path: string[]) => join(root, 'recordings', name, name, ...path);
const tapeOf = async (name: string) => JSON.parse(await readFile(file(name, 'tape.json'), 'utf8'));
const reportOf = async (name: string) => JSON.parse(await readFile(join(root, 'reports', name, 'report.json'), 'utf8'));
const exists = (path: string) => access(path).then(() => true, () => false);

test('record stores the tape under the lock, asks the backend once per case and takes the GETs out of the observation', async () => {
  await suite('list', '/list', [click('Add'), reload]);
  const recorded = await record('list');
  assert.equal(recorded.status, 0, recorded.output);
  assert.match(recorded.output, /^ok {4}list .*masked: 0,/m);
  assert.equal(hits.length, 7, hits.join('\n'));
  const tape = await tapeOf('list');
  assert.deepEqual(
    tape.map((entry: any) => [entry.step, entry.epoch, entry.method, entry.url.path.join('/')]),
    [
      [1, 0, 'GET', 'api/items'],
      [1, 0, 'GET', 'api/count'],
      [2, 0, 'POST', 'api/items'],
      [2, 1, 'GET', 'api/items'],
      [2, 1, 'GET', 'api/count'],
      [3, 1, 'GET', 'api/items'],
      [3, 1, 'GET', 'api/count'],
    ],
  );
  assert.deepEqual(tape[2], {
    step: 2,
    epoch: 0,
    method: 'POST',
    url: { path: ['api', 'items'], query: {} },
    body: { title: 'Milk', done: false },
    credentials: [],
    answer: { status: 201, headers: { 'content-type': 'application/json' }, body: '2' },
  });
  const lock = JSON.parse(await readFile(file('list', 'lock.json'), 'utf8'));
  assert.ok(Object.keys(lock.files).includes('tape.json'));
  assert.equal(JSON.parse(await readFile(file('list', 'recording.json'), 'utf8')).format, 'angular-anything/recording@4');
  const observation = JSON.parse(await readFile(file('list', '02.json'), 'utf8'));
  assert.equal('gets' in observation.effects, false);
  assert.equal(observation.effects.requests.length, 1);
});

test('the list page records again with 0 masks though the backend is never reset, and gates with the backend off', async () => {
  off = false;
  const again = await run('record', 'list', '--source', 'list', '--url', url);
  assert.equal(again.status, 0, again.output);
  assert.match(again.output, /masked: 0,/);
  for (let attempt = 0; attempt < 2; attempt++) await passes('list');
  await passes('list', '', '--original-url', url);
});

test('ports that read twice, in another order, or write the same body and query in another order pass', async () => {
  assert.equal((await record('list')).status, 0);
  const twice = await passes('list', 'twice');
  assert.match(twice, /^ {6}note: step 1: GET \/api\/count: the original sent it 1 time, the port 2 times$/m);
  const swapped = await passes('list', 'swap');
  assert.match(swapped, /note: step 1: the order of the reads differs/);
  await passes('list', 'body-order');
  await passes('list', 'query-order');
  await passes('list', 'xhr');
  assert.equal((await record('list', 'list-twice')).status, 0);
  const once = await passes('list');
  assert.match(once, /GET \/api\/items\?filter=all&limit=10: the original sent it 2 times, the port 1 time/);
});

test('a changed body, a mutation sent once more and a request the tape does not hold fail in the side effects', async () => {
  assert.equal((await record('list')).status, 0);
  await fails('list', 'changed', /side effects: \d+ differences, the first at tape POST \/api\/items \(changed mutation\)/, '"title":"Eggs"', '"title":"Milk"');
  await fails('list', 'post-twice', 'tape POST /api/items', 'sent once more, so it was aborted');
  await fails('list', 'unknown', 'tape GET /api/unknown', 'the tape does not hold it, so it was aborted');
});

test('a read after a delete that the original did not make has no answer for that state, until a step asks', async () => {
  await suite('drop', '/list', [click('Delete')]);
  assert.equal((await record('drop')).status, 0);
  await fails('drop', 'refetch', 'tape GET /api/items?filter=all&limit=10', 'the tape has no answer for this state');
  await suite('drop', '/list', [click('Delete'), reload]);
  assert.equal((await record('drop')).status, 0);
  const output = (await gate('drop', 'refetch')).output;
  assert.equal(output.includes('no answer for this state'), false, output);
});

test('a port that polls twice as often or a third as often as the original passes', async () => {
  await suite('poll', '/poll', [advance(190), click('Advance'), advance(190), click('Advance'), advance(190)]);
  const recorded = await record('poll');
  assert.equal(recorded.status, 0, recorded.output);
  for (const variant of ['', 'fast', 'slow']) await passes('poll', variant);
});

test('an API that answers with a new id on every call records with 0 masks, and a port that shows another id fails', async () => {
  await suite('ids', '/ids', [click('Load')]);
  const recorded = await record('ids');
  assert.equal(recorded.status, 0, recorded.output);
  assert.match(recorded.output, /masked: 0,/);
  await passes('ids');
  await fails('ids', 'other', 'id-0');
});

test('query order and the writing of a space do not count for a GET and a POST, another value does', async () => {
  await suite('query', '/query', [click('Go')]);
  assert.equal((await record('query')).status, 0);
  await passes('query', 'recoded');
  await fails('query', 'other', 'tape GET /api/echo?tag=x&q=b');
  await fails('query', 'post-other', 'tape POST /api/echo?tag=x&q=b (changed mutation)');
});

test('the presence of a credential header is compared, its value is neither stored nor compared', async () => {
  await suite('auth', '/auth', [click('Go')]);
  const recorded = await record('auth');
  assert.equal(recorded.status, 0, recorded.output);
  const stored: string[] = [];
  for (const name of ['tape.json', 'recording.json', 'lock.json', '01.json', '02.json']) stored.push(await readFile(file('auth', name), 'utf8'));
  for (const value of ['Bearer s3cretvalue123456', 's3cretvalue123456']) {
    assert.equal(stored.join('').includes(value), false);
    assert.equal(stored.join('').includes(createHash('sha256').update(value).digest('hex')), false);
    assert.equal(recorded.output.includes(value), false);
  }
  assert.deepEqual((await tapeOf('auth')).map((entry: any) => entry.credentials), [['authorization'], ['authorization'], []]);
  await fails('auth', 'drop', 'tape GET /api/echo?n=2', 'with the header authorization', 'without the header authorization');
  await fails('auth', 'post', 'tape POST /api/echo', 'with the header authorization');
  await fails('auth', 'xsrf', 'tape GET /api/echo?n=2', 'with the header x-xsrf-token');
  await fails('auth', 'both', 'the first at tape GET /api/echo?n=2', 'also at step 2, tape POST /api/echo: expected');
  const other = await passes('auth', 'value');
  assert.match(other, /^Values of credential headers \(authorization\) were not compared\.$/m);
  assert.deepEqual((await reportOf('auth')).cases[0].credentials, ['authorization']);
});

test('two answers reach the page in the order of the requests, whatever the server does', async () => {
  await suite('order', '/order', [click('Go')]);
  const roots = new Set<string>();
  for (let attempt = 0; attempt < 3; attempt++) {
    const recorded = await record('order');
    assert.equal(recorded.status, 0, recorded.output);
    roots.add(/root: (\w+)/.exec(recorded.output)![1]);
  }
  assert.equal(roots.size, 1);
  assert.match(await readFile(file('order', '02.json'), 'utf8'), /"second"|\\"second\\"/);
  await passes('order');
});

test('a read sent together with a mutation is recorded after it, and a port that waits for the mutation passes', async () => {
  await suite('write', '/write', [click('Go')]);
  const recorded = await record('write');
  assert.equal(recorded.status, 0, recorded.output);
  assert.match(await readFile(file('write', '02.json'), 'utf8'), /\\"new\\"/);
  assert.deepEqual((await tapeOf('write')).map((entry: any) => [entry.method, entry.epoch]), [
    ['POST', 0],
    ['GET', 1],
  ]);
  await passes('write', 'waits');
});

test('an answer from the tape reaches the page after the timers that are due have run', async () => {
  await suite('timer', '/timer', []);
  assert.equal((await record('timer')).status, 0);
  assert.match(await readFile(file('timer', '01.json'), 'utf8'), /timer;answer;/);
  for (let attempt = 0; attempt < 2; attempt++) await passes('timer');
});

test('an answer keeps its status, body, content-type and location only, and bytes, HEAD, synchronous XHR and a failed request are replayed', async () => {
  await suite('extra', '/extra', [click('Go')]);
  const recorded = await record('extra');
  assert.equal(recorded.status, 0, recorded.output);
  const text = await readFile(file('extra', 'tape.json'), 'utf8');
  for (const value of ['headervalue', 'challengevalue', 'x-secret', 'www-authenticate']) assert.equal(text.includes(value), false, value);
  const tape = JSON.parse(text);
  assert.deepEqual(tape[1].answer, { status: 201, headers: { location: '/api/made' }, body: '' });
  assert.deepEqual(tape[3].answer, { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: 'AP+A', base64: true });
  assert.deepEqual([tape[2].method, tape[2].epoch], ['GET', 1], 'the synchronous request has the epoch of its moment');
  assert.equal(tape[4].answer, null);
  const observation = JSON.parse(await readFile(file('extra', '02.json'), 'utf8'));
  assert.deepEqual(observation.effects.requests.map((request: any) => request.method), ['PUT'], 'a HEAD is a read');
  assert.match(JSON.stringify(observation.dom), /204 201 \/api\/made \\"echo\\" 0,255,128 gone/);
  await passes('extra');
});

test('gate refuses a recording with one changed byte of a stored answer, and passes after the byte is back', async () => {
  assert.equal((await record('list')).status, 0);
  const tape = await readFile(file('list', 'tape.json'), 'utf8');
  await writeFile(file('list', 'tape.json'), tape.replace('Bread', 'Broad'));
  await fails('list', '', 'lock: tape.json does not match its SHA-256 in lock.json');
  await writeFile(file('list', 'tape.json'), tape);
  await passes('list');
});

test('an original run again is answered from the same tape and its tape findings fail the check', async () => {
  assert.equal((await record('list')).status, 0);
  await passes('list', '', '--original-url', url);
  const bad = await gate('list', '', '--original-url', `${url}/?v=unknown`);
  assert.equal(bad.status, 1, bad.output);
  assert.match(bad.output, /the original at .* does not match its recording: .*GET \/api\/unknown/);
});

test('replay refuses a tape that is not a list and one that masks what the case does not name', async () => {
  assert.equal((await record('list')).status, 0);
  const tape = await tapeOf('list');
  await writeFile(file('list', 'tape.json'), '{}');
  const none = await run('replay', 'list', '--source', 'list', '--url', url);
  assert.match(none.output, /its tape is not a list, so it has to be recorded again/);
  tape[2].body.title = { $aa: 'noise', kind: 'string' };
  await writeFile(file('list', 'tape.json'), JSON.stringify(tape));
  const masked = await run('replay', 'list', '--source', 'list', '--url', url);
  assert.equal(masked.status, 1, masked.output);
  assert.match(masked.output, /it masks values that the case does not name as noise \(tape: requests\[0\]\.body\.title\)/);
});

test('a read whose key differs between the two runs of record is named in the form the case needs, then masked on the tape', async () => {
  pages['/random'] = doc(
    `<p id="out">?</p><button id="go">Go</button>`,
    `on('go', async () => {
  await (await fetch('/api/echo?cb=r' + String(Math.random()).slice(2))).text();
  await (await fetch('/api/echo', { method: 'POST', body: JSON.stringify({ id: 'r' + String(Math.random()).slice(2) }) })).text();
  $('out').textContent = 'done';
});`,
  );
  await suite('random', '/random', [click('Go')]);
  const failed = await record('random');
  assert.equal(failed.status, 1, failed.output);
  for (const path of ['gets[0].query.cb[0]', 'requests[0].body.id']) {
    assert.ok(failed.output.includes(JSON.stringify({ layer: 'effects', path })), `${path}\n${failed.output}`);
  }
  assert.match(failed.output, /the second run sent GET \/api\/echo, which does not fit the tape of the first run: .*gets\[\*\]\.query\.cb\[0\]/);
  assert.doesNotMatch(failed.output, /r\d{6}/, 'no value of the request is printed');
  assert.equal(await exists(file('random')), false);
  await suite('random', '/random', [click('Go')], {
    noise: [
      { layer: 'effects', path: 'gets[*].query.cb[0]' },
      { layer: 'effects', path: 'requests[0].body.id' },
    ],
  });
  const recorded = await record('random');
  assert.equal(recorded.status, 0, recorded.output);
  assert.doesNotMatch(await readFile(file('random', 'tape.json'), 'utf8'), /r\d{6}/);
  await passes('random');
});

test('a request that only the second run sends fails record and is named, also when the step then fails', async () => {
  let loads = 0;
  pages['/once'] = doc(`<p id="out">?</p>`, `fetch('/api/echo?first=1').then(() => { $('out').textContent = 'done'; });`);
  const second = doc(`<p id="out">?</p>`, `fetch('/api/other?key=hidden', { method: 'DELETE' }).then(() => { $('out').textContent = 'done'; });`);
  const first = pages['/once'];
  Object.defineProperty(pages, '/once', { configurable: true, get: () => (loads++ === 0 ? first : second) });
  await suite('once', '/once', []);
  const failed = await record('once');
  assert.equal(failed.status, 1, failed.output);
  assert.match(failed.output, /the second run sent DELETE \/api\/other, which does not fit the tape of the first run/);
  assert.equal(failed.output.includes('hidden'), false, failed.output);
  assert.equal(await exists(file('once')), false);
});

const refused: [string, string, RegExp][] = [
  ['socket', '/socket', /the page opens a WebSocket: ws:\/\/127\.0\.0\.1:\d+\/api\/socket$/m],
  ['stream', '/stream', /1 requests still in flight after 5000 ms, the first: GET \/api\/stream$/m],
  ['stream-fetch', '/stream-fetch', /1 requests still in flight after 5000 ms, the first: GET \/api\/stream$/m],
  ['foreign', '/foreign', /the page sends a request to another origin: POST http:\/\/localhost:\d+\/api\/echo$/m],
  ['cookie', '/cookie', /the answer sets a cookie: GET \/api\/cookie$/m],
  ['redirect', '/redirect', /the answer redirects to another origin: GET \/api\/redirect$/m],
];

for (const [name, path, message] of refused) {
  test(`record refuses ${path} by name and prints no value of the request or of the answer`, async () => {
    await suite(name, path, [click('Go')]);
    const result = await record(name);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, message);
    assert.doesNotMatch(result.output, /value/);
    assert.equal(await exists(file(name)), false);
  });
}

test('gate fails the step of a port that opens a WebSocket', async () => {
  await suite('quiet', '/quiet', [click('Go')]);
  pages['/quiet'] = doc(`<button id="go">Go</button>`, `if (v === 'socket') on('go', () => { new WebSocket('ws://' + location.host + '/api/socket'); });`);
  assert.equal((await record('quiet')).status, 0);
  await passes('quiet');
  off = true;
  const result = await run('gate', 'quiet', '--source', 'quiet', '--url', `${url}/?v=socket`);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /step 2 of 2[\s\S]*tape WebSocket ws:\/\/127\.0\.0\.1:\d+\/api\/socket/);
});

test('a finding of a step that fails is in the error of the case', async () => {
  await suite('stuck', '/stuck', [click('Go')]);
  pages['/stuck'] = doc(
    `<button id="go">Go</button>`,
    `if (v === 'stuck') on('go', () => { fetch('/api/unknown').catch(() => { $('go').remove(); new EventSource('/api/stream'); }); });`,
  );
  assert.equal((await record('stuck')).status, 0);
  const result = await run('gate', 'stuck', '--source', 'stuck', '--url', `${url}/?v=stuck`);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /error: step 2 .*still in flight.*; tape: GET \/api\/unknown: the tape does not hold it, so it was aborted/);
});

test('without a tape a case is run against the backend and its tape is returned', async () => {
  reset();
  const testCase = await suite('direct', '/list', []);
  const done = await runCase(browser, testCase, new URL(url));
  assert.equal(done.error, undefined);
  assert.equal(done.tape.length, 2);
  hits = [];
  const again = await runCase(browser, testCase, new URL(url), undefined, undefined, undefined, { entries: done.tape });
  assert.equal(again.error, undefined);
  assert.deepEqual(hits, []);
  assert.deepEqual(again.findings, []);
});

test('a redirect on the origin of the page is followed by record and stored as the answer of the request', async () => {
  pages['/moved'] = doc(
    `<p id="out">?</p><button id="go">Go</button>`,
    `on('go', async () => {
  const send = async (url, options) => (await fetch(url, options)).json();
  const answers = [await send('/api/moved'), await send('/api/moved', { method: 'POST', body: 'a' }), await send('/api/moved?keep', { method: 'POST', body: 'b' })];
  $('out').textContent = answers.join(',');
});`,
  );
  await suite('moved', '/moved', [click('Go')]);
  const recorded = await record('moved');
  assert.equal(recorded.status, 0, recorded.output);
  assert.deepEqual((await tapeOf('moved')).map((entry: any) => [entry.method, entry.url.path.join('/'), entry.answer.status, JSON.parse(entry.answer.body)]), [
    ['GET', 'api/moved', 200, 'GET '],
    ['POST', 'api/moved', 200, 'GET '],
    ['POST', 'api/moved', 200, 'POST b'],
  ]);
  await passes('moved');
});

test('a finding of the tape in the second run fails record also when both runs observe the same', async () => {
  let loads = 0;
  const variants = ['{ headers: { Authorization: "Bearer only-in-the-first-run" } }', '{}'].map((options) =>
    doc(`<p id="out">?</p>`, `fetch('/api/echo', ${options}).then(() => { $('out').textContent = 'done'; });`),
  );
  Object.defineProperty(pages, '/flip', { configurable: true, get: () => variants[loads++ === 0 ? 0 : 1] });
  await suite('flip', '/flip', []);
  const failed = await record('flip');
  assert.equal(failed.status, 1, failed.output);
  assert.match(failed.output, /^ {6}step 1: the second run sent GET \/api\/echo, which does not fit the tape of the first run: without the header authorization$/m);
  assert.equal(failed.output.includes('only-in-the-first-run'), false);
  assert.equal(await exists(file('flip')), false);
});
