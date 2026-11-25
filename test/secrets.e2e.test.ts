import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const fake = (name: string) => `Fake${name}0123456789abcdefghijklmnop`.slice(0, 32);
const word = fake('Word');
const jwt = ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJmYWtlIn0', 'ZmFrZXNpZ25hdHVyZQ'].join('.');
const five = ['Auth', 'ApiKey', 'Xsrf', 'Cookie', 'Challenge'].map(fake);
const typed = 'fake-typed-pass-9731';

const doc = (body: string, script = '', head = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Secrets</title>${head}</head><body><main>${body}</main><script>
const query = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const on = (id, work) => $(id).addEventListener('click', work);
${script}
</script></body></html>`;

const places = doc(
  `<p id="text">words</p><p id="attr">attr</p><input id="hidden" type="hidden" value="nothing">`,
  `const at = query.get('at');
const t = query.get('t');
const token = t === 'jwt' ? '${jwt}' : t === 'plain' ? '${word}' : 'nothing';
const here = (name) => at === name || at === 'all';
if (t === 'plain') fetch('/api/ping', { headers: { Authorization: 'Bearer ' + token } });
if (here('text')) $('text').textContent = token;
if (here('attr')) $('attr').setAttribute('data-ref', token);
if (here('hidden')) $('hidden').value = token;
if (here('css')) document.head.append(Object.assign(document.createElement('style'), { textContent: '#text { --ref: ' + token + '; }' }));
if (here('storage-value')) localStorage.setItem('ref', token);
if (here('storage-key')) localStorage.setItem(token, '1');
if (here('url')) history.replaceState(null, '', location.pathname + location.search + '&ref=' + token);
if (here('request')) fetch('/api/ping?ref=' + token);
if (here('body')) fetch('/api/ping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: token }) });
if (here('event')) window.__aa.emit('sent', { ref: token });
if (here('answer')) fetch('/api/answer?t=' + t);`,
);

const pages: Record<string, string> = {
  '/places': places,
  '/plain': doc(
    `<p>123e4567-e89b-12d3-a456-426614174000</p>
<p>9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08</p>
<img alt="Dot" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
<p>A token is a word</p><p>dark</p>`,
    `document.cookie = 'theme=dark';`,
  ),
  '/headers': doc(
    `<p id="out">?</p>`,
    `document.cookie = 'sid=${five[3]}';
fetch('/api/challenge', { headers: { Authorization: 'Bearer ${five[0]}', 'X-Api-Key': '${five[1]}', 'X-XSRF-TOKEN': '${five[2]}' } })
  .then((answer) => answer.text()).then(() => { $('out').textContent = 'done'; });`,
  ),
  '/login': doc(
    `<label>Name <input id="name"></label><label>Password <input id="pass" type="password"></label>
<label>Card <input id="card" autocomplete="section-a CC-Number"></label><label>Code <textarea id="code" autocomplete="one-time-code"></textarea></label>
<label role="note" aria-label="Pin label" for="pin">Pin</label><input id="pin" autocomplete="new-password">
<h1>Sign in</h1>`,
    `if (query.get('v') === 'filled') $('pass').value = '${typed}';
if (query.get('v') === 'focused') $('pass').focus();`,
  ),
  '/shadow-focus': doc(
    `<div id="host"></div><h1>Sign in</h1>`,
    `const root = $('host').attachShadow({ mode: 'closed' });
root.innerHTML = '<input type="password" aria-label="Hidden pass">';
root.querySelector('input').focus();`,
  ),
  '/marked': doc(`<p id="out" data-session="abcdefgh12345678">marked</p>`),
  '/rolling': doc(
    `<input id="csrf" type="hidden"><p>rolling</p>`,
    `const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('') + 'a1';
$('csrf').value = token;
fetch('/api/ping', { headers: { Authorization: 'Bearer ' + token } });`,
  ),
  '/server-cookie': doc(
    `<p id="out">?</p>`,
    `$('out').textContent = document.cookie.split('=')[1];
document.cookie = 'sid=; max-age=0';`,
  ),
  '/script-cookie': doc(
    `<p id="out">?</p><button id="set">Set</button><button id="drop">Drop</button>`,
    `on('set', () => { document.cookie = 'sid=${word}'; $('out').textContent = '${word}'; });
on('drop', () => { document.cookie = 'sid=; max-age=0'; $('out').textContent = '?'; });`,
  ),
  '/stuck-cookie': doc(
    `<button id="go">Go</button>`,
    `on('go', () => { document.cookie = 'sid=${word}'; fetch('/api/never/${word}'); });`,
  ),
  '/upload': doc(
    `<p>upload</p>`,
    `const form = new FormData();
form.append('file', new Blob(['${word}']), 'a.txt');
fetch('/api/ping', { method: 'POST', headers: { Authorization: 'Bearer ${word}' }, body: form });`,
  ),
  '/uses-query': doc(`<p>uses</p>`, `fetch('/api/ping', { headers: { 'X-CSRF-TOKEN': query.get('k') } });`),
  '/ignores-query': doc(`<p>ignores</p>`),
};

let root: string;
let temp: string;
let url: string;
let server: Server;
let changing = 0;
let rolled: string[] = [];

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'aa-secrets-'));
  temp = join(root, 'temp');
  await mkdir(temp);
  server = createServer((request, response) => {
    request.resume();
    const { pathname, searchParams } = new URL(request.url!, 'http://localhost');
    const json = (value: unknown, headers: Record<string, string> = {}) =>
      response.writeHead(200, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(value));
    if (pathname.startsWith('/api/never')) return;
    if (pathname === '/api/answer') {
      return void json({ ref: searchParams.get('t') === 'jwt' ? jwt : searchParams.get('t') === 'plain' ? word : 'nothing' });
    }
    if (pathname === '/api/challenge') return void json(1, { 'www-authenticate': `Digest nonce="${five[4]}"` });
    if (pathname.startsWith('/api/')) {
      if (request.headers.authorization) rolled.push(request.headers.authorization.split(' ')[1]);
      return void json(1);
    }
    const html =
      pathname === '/changing'
        ? doc(`<label>Field <input type="${changing++ === 0 ? 'text' : 'password'}"></label>`)
        : pages[pathname];
    if (html === undefined) return void response.writeHead(404).end();
    const cookie: Record<string, string> = pathname === '/server-cookie' ? { 'set-cookie': `sid=${word}; Path=/` } : {};
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...cookie }).end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  server.closeAllConnections();
  await rm(root, { recursive: true, force: true });
});

type Step = Record<string, unknown>;
const click = (name: string): Step => ({ action: 'click', target: { role: 'button', name } });
const fill = (name: string, value = typed, role = 'textbox'): Step => ({ action: 'fill', target: { role, name }, value });
const press = (name: string, key = 'a', role = 'textbox'): Step => ({ action: 'press', target: { role, name }, key });

async function suite(name: string, path: string, steps: Step[] = [], extra: Record<string, unknown> = {}, id = name) {
  const folder = join(root, 'cases', name, id);
  await mkdir(folder, { recursive: true });
  const testCase = {
    format: 'angular-anything/case@1',
    id,
    viewport: { width: 800, height: 600 },
    steps: [{ action: 'goto', path }, ...steps],
    ...extra,
  };
  await writeFile(join(folder, 'case.json'), JSON.stringify(testCase));
}

function run(...args: string[]): Promise<{ status: number | string; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, TMPDIR: temp } }, (error, stdout, stderr) => {
      resolve({ status: error ? (error.code ?? 'killed') : 0, output: stdout + stderr });
    });
  });
}

const record = (name: string, address = url) => run('record', name, '--source', name, '--url', address);
const exists = (path: string) => access(path).then(() => true, () => false);
const recordingOf = (name: string, id = name) => join(root, 'recordings', name, id);

async function contents(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true }).catch(() => []);
  const texts = await Promise.all(
    entries.filter((entry) => entry.isFile()).map((entry) => readFile(join(entry.parentPath, entry.name), 'latin1').catch(() => '')),
  );
  return [...entries.map((entry) => entry.name), ...texts].join('\n');
}

async function absent(output: string, ...secrets: string[]) {
  const written = [output, await contents(join(root, 'recordings')), await contents(join(root, 'reports')), await contents(temp)].join('\n');
  for (const secret of secrets) {
    for (const form of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64').replace(/=+$/, '')]) {
      assert.ok(!written.includes(form), `${form} is written or printed\n${output}`);
    }
  }
}

async function gatedAway(name: string, ...secrets: string[]) {
  const result = await run('gate', name, '--source', name, '--url', url);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /lock: no readable lock\.json: record the case first/);
  await absent(result.output, ...secrets);
}

async function refused(name: string, secret: string, ...expected: (string | RegExp)[]) {
  const result = await record(name);
  assert.equal(result.status, 1, result.output);
  for (const text of expected) {
    if (typeof text === 'string') assert.ok(result.output.includes(text), `${text}\n${result.output}`);
    else assert.match(result.output, text);
  }
  assert.equal(await exists(recordingOf(name)), false);
  await absent(result.output, secret);
  await gatedAway(name, secret);
  return result.output;
}

const recorded = async (name: string) => {
  const result = await record(name);
  assert.equal(result.status, 0, result.output);
  return result.output;
};

const found = (output: string) => [...output.matchAll(/^ {6}step \d+, layer .*: ([a-z-]+)$/gm)].map((match) => match[1]);

const paths: Record<string, RegExp> = {
  text: /step 1, layer dom, path html\[1\]\/body\[1\]\/main\[1\]\/p\[1\]\/text\(\)\[1\]: /,
  attr: /step 1, layer dom, path html\[1\]\/body\[1\]\/main\[1\]\/p\[2\]\["attrs"\]\["data-ref"\]: /,
  hidden: /step 1, layer dom, path html\[1\]\/body\[1\]\/main\[1\]\/input\[1\]\["props"\]\["value"\]: /,
  css: /step 1, layer style, path html\[1\]\/body\[1\]\/main\[1\]\/p\[1\]\["style"\]\["--ref"\]: /,
  'storage-value': /step 1, layer effects, path storage\["ref"\]: /,
  'storage-key': /step 1, layer effects, path storage\["<(jwt|credential)>"\]: /,
  url: /step 1, layer effects, path url\["query"\]\["ref"\]\[0\]: /,
  request: /step 1, layer tape, path \[\d\]\["url"\]\["query"\]\["ref"\]\[0\]: /,
  body: /step 1, layer tape, path \[\d\]\["body"\]\["ref"\]: /,
  event: /step 1, layer events, path \[0\]\["payload"\]\["ref"\]: /,
  answer: /step 1, layer tape, path \[\d\]\["answer"\]\["body"\]\["ref"\]: /,
};

test('a token in each of 11 places is refused with its case, step, layer and path, as a JWT and as a credential, 22 of 22', { timeout: 300_000 }, async () => {
  const runs = Object.keys(paths).flatMap((place) => ['jwt', 'plain'].map((kind) => ({ place, kind, name: `${place}-${kind}` })));
  for (const { place, kind, name } of runs) await suite(name, `/places?at=${place}&t=${kind}`);
  const results: { status: number | string; output: string }[] = [];
  for (let at = 0; at < runs.length; at += 4) results.push(...(await Promise.all(runs.slice(at, at + 4).map(({ name }) => record(name)))));
  for (const [at, { place, kind, name }] of runs.entries()) {
    const { status, output } = results[at];
    assert.equal(status, 1, `${name}\n${output}`);
    assert.ok(output.includes(`FAIL  ${name}\n`), output);
    assert.match(output, paths[place], name);
    const expected = kind === 'jwt' ? 'jwt' : 'credential';
    assert.deepEqual([...new Set(found(output))], [expected], `${name}\n${output}`);
    assert.equal(await exists(recordingOf(name)), false, name);
    await absent(output, kind === 'jwt' ? jwt : word);
    await gatedAway(name, kind === 'jwt' ? jwt : word);
  }
});

test('the same page without a token, and a page of values that only look alike, record with no finding', { timeout: 120_000 }, async () => {
  await suite('without', '/places?at=all&t=none');
  await suite('alike', '/plain');
  for (const name of ['without', 'alike']) {
    const output = await recorded(name);
    assert.deepEqual(found(output), []);
    assert.ok(!output.includes('accepted'), output);
  }
});

test('the values of credential headers and a cookie that show nowhere else are not in the recording', async () => {
  await suite('headers', '/headers');
  const output = await recorded('headers');
  await absent(output, ...five);
});

test('a case that types into a secret field is refused before it types, by step and target', { timeout: 120_000 }, async () => {
  const variants: [string, Step, string][] = [
    ['type-password', fill('Password'), 'textbox "Password"'],
    ['type-card', fill('Card'), 'textbox "Card"'],
    ['type-code', fill('Code'), 'textbox "Code"'],
    ['type-label', fill('Pin label', typed, 'note'), 'note "Pin label"'],
    ['press-password', press('Password'), 'textbox "Password"'],
  ];
  for (const [name, step, target] of variants) {
    await suite(name, '/login', [fill('Name', 'Ada'), step]);
    const output = await refused(name, typed, `step 3, the case types into a password, one-time code or card field: ${target}`);
    assert.ok(!output.includes('with "'), output);
  }
  await suite('press-focused', '/login?v=focused', [press('Sign in', 'a', 'heading')]);
  await refused('press-focused', typed, 'step 2, the case types into a password, one-time code or card field: heading "Sign in"');
  await suite('press-shadow', '/shadow-focus', [press('Sign in', 'a', 'heading')]);
  await refused('press-shadow', typed, 'step 2, the case types into a password');
});

test('a case that presses a key elsewhere while a password field has the focus records', async () => {
  await suite('press-elsewhere', '/login?v=focused', [press('Name')]);
  await recorded('press-elsewhere');
});

test('a field that turns into a password field in the second run is refused as well', async () => {
  changing = 0;
  await suite('changing', '/changing', [fill('Field')]);
  await refused('changing', typed, 'step 2, the case types into a password');
});

test('a password that the page fills in is refused, an empty password field is not', async () => {
  await suite('empty-field', '/login', [fill('Name', 'Ada')]);
  await recorded('empty-field');
  await suite('empty-field', '/login?v=filled', [fill('Name', 'Ada')]);
  await refused('empty-field', typed, 'step 1, layer dom, path html[1]/body[1]/main[1]/label[2]/input[1]["props"]["value"]: secret-field');
});

test('a fill value that is itself a secret is left out of the line about its failed step', async () => {
  await suite('missing', '/login', [fill('No such field', jwt)]);
  const result = await record('missing');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /a line is left out, it holds a detected secret: jwt/);
  assert.ok(!result.output.includes(jwt), result.output);
});

test('a token in the query of --url fails record before the first line, and removes the recordings of the suite', async () => {
  await suite('query', '/ignores-query');
  await recorded('query');
  for (const query of [`?token=${word}`, `?t=${jwt}`]) {
    const result = await record('query', `${url}/${query}`);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /^FAIL {2}query\n {6}refused, a detected secret:\n {6}--url, layer url, path query\["(token|t)"\]\[0\]: (named-value|jwt)$/m);
    assert.ok(!result.output.includes('angular-anything record'), result.output);
    assert.equal(await exists(recordingOf('query')), false);
    await absent(result.output, word, jwt);
  }
});

test('a value of the query that a later case sends as a credential refuses every recording of the run', async () => {
  await suite('carried', '/ignores-query', [], {}, 'a-first');
  await suite('carried', '/uses-query', [], {}, 'b-second');
  await suite('carried', '/ignores-query', [], {}, 'c-third');
  const result = await record('carried', `${url}/?k=${word}`);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /--url, layer url, path query\["k"\]\[0\]: credential/);
  assert.match(result.output, /Recorded 0 of 3 cases/);
  for (const id of ['a-first', 'b-second', 'c-third']) assert.equal(await exists(recordingOf('carried', id)), false, id);
  await absent(result.output, word);
  const quiet = await record('carried', `${url}/?bug=words`);
  assert.equal(quiet.status, 0, quiet.output);
  assert.ok(!quiet.output.includes('bug=words'), quiet.output);
});

test('a user name or a password in --url or --original-url is a usage error that does not repeat the address', async () => {
  const secret = 'fake-url-pass-5512';
  const address = url.replace('//', `//ada:${secret}@`);
  const calls = [
    ['record', 'query', '--source', 'query', '--url', address],
    ['record', 'query', '--source', 'query', '--url', url.replace('//', '//ada-fake-user@')],
    ['record', 'query', '--source', 'query', '--url', url.replace('//', `//:${secret}@`)],
    ['replay', 'query', '--source', 'query', '--url', address],
    ['gate', 'query', '--source', 'query', '--url', url, '--original-url', address],
    ['gate', 'query', '--source', 'query', '--url', `${address}/path`],
  ];
  for (const call of calls) {
    const result = await run(...call);
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /must not hold a user name or a password/);
    assert.ok(!result.output.includes(secret) && !result.output.includes('ada-fake-user'), result.output);
  }
});

test('an accepted path records with exit 0 and prints the finding without its value, another path does not accept it', async () => {
  const path = 'html[1]/body[1]/main[1]/p[1].attrs["data-session"]';
  const entry = { layer: 'dom', path, kind: 'named-value', reason: 'a made-up value' };
  await suite('marked', '/marked', [], { accept: [entry] });
  const output = await recorded('marked');
  assert.match(output, /^ {6}accepted: step 1, layer dom, path html\[1\]\/body\[1\]\/main\[1\]\/p\[1\]\["attrs"\]\["data-session"\]: named-value$/m);
  assert.ok(!output.includes('abcdefgh12345678'), output);
  await suite('marked', '/marked');
  await refused('marked', 'abcdefgh12345678', 'named-value');
  await suite('marked', '/marked', [], { accept: [{ ...entry, path: 'html[1]/body[1]/main[1]/p[2].attrs["data-session"]' }] });
  await refused('marked', 'abcdefgh12345678', 'named-value');
});

test('a token that changes with every load records when its path is noise, and not otherwise', async () => {
  const noise = [{ layer: 'dom', path: 'html[1]/body[1]/main[1]/input[1].props.value' }];
  rolled = [];
  await suite('rolling', '/rolling', [], { noise });
  const output = await recorded('rolling');
  assert.equal(new Set(rolled).size, 1);
  await absent(output, ...rolled);
  rolled = [];
  await suite('rolling', '/rolling');
  const result = await record('rolling');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /step 1, layer dom, path html\[1\]\/body\[1\]\/main\[1\]\/input\[1\]\["props"\]\["value"\]: credential/);
  assert.equal(await exists(recordingOf('rolling')), false);
  await absent(result.output, ...rolled);
});

test('a cookie that an answer set is a credential though the page removed it at once', async () => {
  await suite('server-cookie', '/server-cookie');
  await refused('server-cookie', word, 'layer dom', 'credential');
});

test('a cookie that a script set is a credential though a later step removed it', async () => {
  await suite('script-cookie', '/script-cookie', [click('Set'), click('Drop')]);
  await refused('script-cookie', word, /step 2, layer dom, path .*: credential/);
});

test('a line that holds a credential of the step that failed is left out', async () => {
  await suite('stuck-cookie', '/stuck-cookie', [click('Go')]);
  await refused('stuck-cookie', word, 'a line is left out, it holds a detected secret: credential');
});

test('the content of an uploaded file is checked, though only its hash is written', async () => {
  await suite('upload', '/upload');
  await refused('upload', word, /layer tape, path \[0\]\["body"\]: credential/);
});

test('the tool writes no storage state, trace, HAR or video, and adds no package', async () => {
  const source = await contents(fileURLToPath(new URL('../src/', import.meta.url)));
  for (const banned of ['storageState', 'tracing', 'recordHar', 'recordVideo', 'routeFromHAR']) {
    assert.ok(!source.includes(banned), banned);
  }
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(manifest.dependencies), ['playwright']);
  assert.ok(!(await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')).includes('secretlint'));
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  for (const kind of ['credential', 'jwt', 'pem', 'bearer-or-basic', 'url-password', 'named-value', 'secret-field']) {
    assert.ok(readme.includes(`\`${kind}\``), kind);
  }
});
