import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCase } from '../src/case.ts';
import type { Observation } from '../src/compare.ts';
import { bodyParts } from '../src/parts.ts';
import { compile } from '../src/noise.ts';
import { addCredential, addSetCookie, describeFinding, isAccepted, kindsOf, newSeen, parseAccept, scanCase, scanUrl } from '../src/secrets.ts';
import type { Scanned } from '../src/secrets.ts';
import type { TapeEntry } from '../src/tape.ts';

const word = 'Zq7'.repeat(8);
const odd = 'fake secret/"value"+0123456789';
const jwt = ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJmYWtlIn0', 'ZmFrZXNpZ25hdHVyZQ'].join('.');
const holding = (...values: string[]) => new Set(values);
const none = holding();

const empty = (): Observation => ({
  accessibility: { tree: [], attributes: {} },
  dom: { tag: 'html' },
  style: {},
  events: [],
  effects: { requests: [], storage: {}, url: { path: [''], query: {}, fragment: '' }, title: '', focus: null, popups: [] },
});

const entry = (changes: Partial<TapeEntry> = {}): TapeEntry => ({
  step: 1,
  epoch: 0,
  method: 'POST',
  url: { path: ['api'], query: {} },
  body: null,
  credentials: [],
  answer: { status: 200, headers: {}, body: '' },
  ...changes,
});

const scan = (changes: Partial<Scanned> = {}) =>
  scanCase({ seen: newSeen(), observations: [], fields: [], tape: [], noise: [], ...changes });
const lines = (changes: Partial<Scanned> = {}) => scan(changes).map(describeFinding);
const observed = (change: (observation: Observation) => void) => {
  const observation = empty();
  change(observation);
  return observation;
};
const withCredential = (value: string) => {
  const seen = newSeen();
  addCredential(seen, 'cookie', value);
  return seen;
};

test('a credential of the run is found as it is, JSON-escaped, URL-encoded, as base64, base64url and hex', () => {
  const value = 'fake?>secret "value"\\ ~~~ 0123456789a';
  const bytes = Buffer.from(value);
  const forms = {
    plain: value,
    json: JSON.stringify(value).slice(1, -1),
    url: encodeURIComponent(value),
    base64: bytes.toString('base64'),
    unpadded: bytes.toString('base64').replace(/=+$/, ''),
    base64url: bytes.toString('base64url'),
    hex: bytes.toString('hex'),
    upper: bytes.toString('hex').toUpperCase(),
  };
  assert.notEqual(forms.base64, forms.unpadded);
  assert.notEqual(forms.base64url, forms.unpadded);
  for (const [name, form] of Object.entries(forms)) {
    assert.deepEqual(kindsOf(`before ${form} after`, holding(value)), ['credential'], name);
    assert.deepEqual(kindsOf(`before ${form} after`, none), [], name);
  }
  assert.deepEqual(kindsOf(value.slice(1), holding(value)), []);
});

test('a credential shorter than 16 characters is not searched', () => {
  assert.deepEqual([...withCredential('a'.repeat(15)).credentials], []);
  assert.deepEqual([...withCredential('a'.repeat(16)).credentials], ['a'.repeat(16)]);
});

test('of a Set-Cookie header the value of each cookie is the credential', () => {
  const seen = newSeen();
  addSetCookie(seen, `a=${word}; Path=/; HttpOnly\nb= x=${word} ; Max-Age=1`);
  assert.deepEqual([...seen.credentials], [word, `x=${word}`]);
});

test('of an authorization header the part after the scheme word is the credential', () => {
  const seen = newSeen();
  addCredential(seen, 'authorization', `Token ${word}`);
  addCredential(seen, 'authorization', `raw-${word}`);
  addCredential(seen, 'x-csrf-token', `two words ${word}`);
  assert.deepEqual([...seen.credentials], [word, `raw-${word}`, `two words ${word}`]);
});

test('each pattern finds its own shape and nothing near it', () => {
  const cases: [string, string[], string[]][] = [
    [
      'jwt',
      [jwt, `x ${jwt} y`, 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWtlIn0.', `id-${jwt}`, `a.${jwt}`, `eyJaaaa.${jwt}`],
      ['eyJhbGciOiJub25lIn0', 'one.two.three', 'eyJhbGciOiJub25lIn0.plain.sig', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWtlIn0', 'eyJ.eyJzdWIiOiJmYWtlIn0.', 'abcdefghij.eyJzdWIiOiJmYWtlIn0.'],
    ],
    ['pem', ['-----BEGIN PRIVATE KEY-----\nfake', '-----BEGIN CERTIFICATE-----'], ['----- BEGIN here', 'BEGIN PRIVATE KEY', '-----BEGIN -----']],
    [
      'bearer-or-basic',
      ['Bearer abc123def456', 'sent: basic dXNlcjpwYXNz.', 'BEARER aaaa-bbbb.cccc', 'Basic YWRhOnA='],
      [
        'Bearer', 'Basic features', 'Basic Information.', 'Bearer a1b2c3', 'the bearer of this letter', 'Basicabc123def456', 'rebasic abc123def456',
        'Basic JavaScript', 'Basic PowerPoint course', 'basic read/write', 'Basic information/settings', 'Basic abc123def456', 'Basic dXNlcnBhc3M=',
        `Basic ${Buffer.from('a\x01:b123').toString('base64')}`, 'Basic YWRh.OnBhc3M',
      ],
    ],
    [
      'url-password',
      ['https://ada:fakepass@example.test/x', 'see postgres://u:p@db/x', '{"u":"https://ada:p!$&\'()*+,;=@h"}', 'x1+http://u:p@h', 'git+ssh://u:p@h'],
      [
        'https://example.test/a:b@c', 'https://ada@example.test', 'https://:fakepass@example.test', 'mailto:ada@example.test', 'http://host:80/?q=a@b',
        '{"site":"https://example.test:8443","email":"ada@example.test"}', '<https://example.test:8443>ada@example.test', '123://u:p@h', '://u:p@h',
        '{"a":"https://example.test","b":"x:y@z"}', '<https://example.test>x:y@z',
      ],
    ],
  ];
  for (const [kind, found, missed] of cases) {
    for (const text of found) assert.deepEqual(kindsOf(text, none), [kind], text);
    for (const text of missed) assert.deepEqual(kindsOf(text, none), [], text);
  }
});

test('a value under a key named like a secret is found by its length, its letter and its digit', () => {
  const value = 'abcdefgh12345678';
  for (const key of ['token', 'X-TOKEN-X', 'clientSecret', 'Password', 'api_key', 'my_session_id']) {
    assert.deepEqual(kindsOf(value, none, key), ['named-value'], key);
  }
  for (const key of ['ref', 'apikey', 'pass', undefined]) assert.deepEqual(kindsOf(value, none, key), [], String(key));
  for (const text of [value.slice(1), 'abcdefgh 12345678', 'abcdefghijklmnop', '1234567812345678']) {
    assert.deepEqual(kindsOf(text, none, 'token'), [], text);
  }
});

test('observations are checked in every layer, by value and by key, and the printed path holds no finding', () => {
  const seen = withCredential(word);
  const observations = [
    observed((o) => {
      o.dom = { tag: 'html', attrs: { 'data-ref': word }, children: [word] };
      o.accessibility.tree = [{ role: 'paragraph', name: word }];
      o.style = { 'html[1]': { style: { '--ref': word } } };
      o.events = [{ name: 'sent', payload: { ref: word, count: 1 } }];
      o.effects.storage = { ref: { list: [word] }, [word]: '1' };
    }),
  ];
  const found = lines({ seen, observations });
  assert.deepEqual(found.sort(), [
    'step 1, layer accessibility, path tree/paragraph[1]["name"]: credential',
    'step 1, layer dom, path html[1]/text()[1]: credential',
    'step 1, layer dom, path html[1]["attrs"]["data-ref"]: credential',
    'step 1, layer effects, path storage["<credential>"]: credential',
    'step 1, layer effects, path storage["ref"]["list"][0]: credential',
    'step 1, layer events, path [0]["payload"]["ref"]: credential',
    'step 1, layer style, path html[1]["style"]["--ref"]: credential',
  ]);
  assert.ok(!found.join('\n').includes(word));
});

test('a key that is a finding is replaced in the paths below it as well, and by a pattern too', () => {
  const observations = [observed((o) => (o.effects.storage = { [jwt]: { deeper: 'Bearer abc123def456' } }))];
  assert.deepEqual(lines({ observations }), [
    'step 1, layer effects, path storage["<jwt>"]: jwt',
    'step 1, layer effects, path storage["<jwt>"]["deeper"]: bearer-or-basic',
  ]);
});

test('the key of a value is the nearest name above it', () => {
  const value = 'abcdefgh12345678';
  const observations = [
    observed((o) => {
      o.effects.url.query = { access_token: [value] };
      o.effects.storage = { session: { id: value } };
    }),
  ];
  assert.deepEqual(lines({ observations }), ['step 1, layer effects, path url["query"]["access_token"][0]: named-value']);
});

test('a number and a number that keeps its digits are searched for a credential', () => {
  const digits = '12345678901234567890';
  const observations = [observed((o) => (o.events = [{ name: 'n', payload: [1234567890123456, { $aa: 'number', source: digits }] }]))];
  const seen = withCredential('1234567890123456');
  addCredential(seen, 'cookie', digits);
  assert.deepEqual(lines({ seen, observations }), [
    'step 1, layer events, path [0]["payload"][0]: credential',
    'step 1, layer events, path [0]["payload"][1]: credential',
  ]);
});

test('a part that is stored as base64 is checked as the page sent it', () => {
  const body = Buffer.concat([Buffer.from([0xff]), Buffer.from(word)]);
  const parts = bodyParts(body, 'text/plain');
  assert.ok(String(parts).startsWith('base64:'));
  assert.deepEqual(lines({ seen: withCredential(word), tape: [entry({ body: parts })] }), ['step 1, layer tape, path [0]["body"]: credential']);
  const answer = { status: 200, headers: {}, body: body.toString('base64'), base64: true as const };
  assert.deepEqual(lines({ seen: withCredential(word), tape: [entry({ answer })] }), ['step 1, layer tape, path [0]["answer"]["body"]: credential']);
});

test('a request is checked in its URL, an answer in its headers and in its JSON by key', () => {
  const seen = withCredential(word);
  const value = 'abcdefgh12345678';
  const tape = [
    entry({
      step: 3,
      url: { path: ['api', word], query: {} },
      answer: { status: 200, headers: { location: `/x/${word}` }, body: JSON.stringify({ data: { access_token: value } }) },
    }),
  ];
  assert.deepEqual(lines({ seen, tape }), [
    'step 3, layer tape, path [0]["url"]["path"][1]: credential',
    'step 3, layer tape, path [0]["answer"]["headers"]["location"]: credential',
    'step 3, layer tape, path [0]["answer"]["body"]["data"]["access_token"]: named-value',
  ]);
});

test('the bytes the page sent or got are checked when no part shows the finding', () => {
  const seen = withCredential(odd);
  const sent = Buffer.from(`--b\r\nContent-Disposition: form-data; name="f"; filename="a.txt"\r\n\r\n${odd}\r\n--b--\r\n`);
  const file = entry({ body: bodyParts(sent, 'multipart/form-data; boundary=b') });
  assert.ok(!JSON.stringify(file.body).includes('fake'));
  seen.bodies.set(file, sent);
  assert.deepEqual(lines({ seen, tape: [file] }), ['step 1, layer tape, path [0]["body"]: credential']);

  const duplicate = entry({ answer: { status: 200, headers: {}, body: `{"a":"${word}","a":0}` } });
  assert.deepEqual(lines({ seen: withCredential(word), tape: [duplicate] }), ['step 1, layer tape, path [0]["answer"]["body"]: credential']);
  const shown = entry({ body: { ref: word } });
  seen.bodies.set(shown, Buffer.from(JSON.stringify(shown.body)));
  assert.deepEqual(lines({ seen: withCredential(word), tape: [shown] }), ['step 1, layer tape, path [0]["body"]["ref"]: credential']);
});

test('a value that the case masks as noise is not written, so it is not a finding', () => {
  const noise = compile([
    { layer: 'effects', path: 'requests[0].body.ref' },
    { layer: 'dom', path: 'html[1].attrs.ref' },
  ]);
  const body = { ref: word };
  const sent = entry({ body });
  assert.equal(lines({ seen: withCredential(word), tape: [sent] }).length, 1);
  const seen = withCredential(word);
  seen.bodies.set(sent, Buffer.from(JSON.stringify(body)));
  const mask = { $aa: 'noise', kind: 'string' };
  const observations = [observed((o) => (o.dom = { tag: 'html', attrs: { ref: mask as unknown as string } }))];
  assert.deepEqual(lines({ seen, tape: [sent], noise, observations }), []);
});

test('a secret field is a finding whatever it holds and whether or not it is masked', () => {
  const fields = [[], ['html[1]/body[1]/input[2]']];
  assert.deepEqual(lines({ fields, observations: [empty(), empty()] }), [
    'step 2, layer dom, path html[1]/body[1]/input[2]["props"]["value"]: secret-field',
  ]);
});

test('the query of the url is checked by value and by name', () => {
  const found = (href: string, seen = newSeen()) => scanUrl(new URL(href), seen).map(describeFinding);
  assert.deepEqual(found('http://h/?access_token=abcdefgh12345678'), ['--url, layer url, path query["access_token"][0]: named-value']);
  assert.deepEqual(found(`http://h/?a=1&t=${jwt}`), ['--url, layer url, path query["t"][0]: jwt']);
  assert.deepEqual(found(`http://h/?${jwt}`), ['--url, layer url, path query["<jwt>"]: jwt']);
  assert.deepEqual(found(`http://h/?t=${word}`, withCredential(word)), ['--url, layer url, path query["t"][0]: credential']);
  assert.deepEqual(found(`http://h/?${word}&tail=1`, withCredential(`${word}&tail`)), ['--url, layer url, path query: credential']);
  assert.deepEqual(found('http://h/?bug=aria&token=short1'), []);
});

test('an accepted entry is one layer, path and kind, with * for any index', () => {
  const [found] = scan({ seen: withCredential(word), observations: [empty(), observed((o) => (o.events = [{ name: 'a', payload: [word] }]))] });
  const accepts = (layer: string, path: string, kind: string) =>
    isAccepted(found, parseAccept([{ layer, path, kind, reason: 'a test value' }]));
  assert.ok(accepts('events', '[0].payload[0]', 'credential'));
  assert.ok(accepts('events', '[*]["payload"][*]', 'credential'));
  assert.ok(!accepts('dom', '[0].payload[0]', 'credential'));
  assert.ok(!accepts('events', '[0].payload[0]', 'jwt'));
  assert.ok(!accepts('events', '[1].payload[0]', 'credential'));
  assert.ok(!accepts('events', '[0].payload', 'credential'));
  assert.ok(!accepts('events', '[0].payload[0].more', 'credential'));
  assert.ok(!accepts('events', '[0].other[0]', 'credential'));
  assert.ok(!isAccepted(found, []));
});

test('the accept list of a case needs a layer, a path, a kind and a reason, and nothing accepts everything', () => {
  const good = { layer: 'tape', path: '[*].answer.body.token', kind: 'named-value', reason: 'a made-up value' };
  assert.deepEqual(parseAccept([good]), [good]);
  const refused: [unknown, RegExp][] = [
    ['all', /"accept" must be a list/],
    [['all'], /accept entry 1 is not an object/],
    [[{ ...good, extra: 1 }], /accept entry 1 has the unknown key "extra"/],
    [[{ ...good, layer: '*' }], /accept entry 1 needs a "layer" of /],
    [[{ ...good, kind: '*' }], /accept entry 1 needs a "kind" of /],
    [[{ ...good, path: 3 }], /accept entry 1 needs a "path"/],
    [[{ ...good, path: '*' }], /accept entry 1: .*is not a path/],
    [[{ ...good, reason: '' }], /accept entry 1 needs a "reason"/],
    [[{ ...good, reason: undefined }], /accept entry 1 needs a "reason"/],
  ];
  for (const [list, message] of refused) assert.throws(() => parseAccept(list), message, JSON.stringify(list));
  const testCase = {
    format: 'angular-anything/case@1',
    id: 'a',
    viewport: { width: 1, height: 1 },
    steps: [{ action: 'goto', path: '/' }],
  };
  assert.deepEqual(parseCase(JSON.stringify({ ...testCase, accept: [good] }), 'a').accept, [good]);
  assert.throws(() => parseCase(JSON.stringify({ ...testCase, accept: [{ ...good, reason: '' }] }), 'a'), /needs a "reason"/);
});

test('a large text is searched in time that grows with its length', () => {
  const texts = ['x'.repeat(200_000), 'eyJ'.repeat(70_000), 'eyJaaaa.'.repeat(25_000), 'a://'.repeat(50_000), 'a://b:'.repeat(30_000), 'Basic '.repeat(30_000)];
  const started = performance.now();
  for (const text of texts) kindsOf(text, none);
  assert.ok(performance.now() - started < 2000, `${Math.round(performance.now() - started)} ms`);
});

test('a cookie is found unquoted and decoded, and a percent escape in either case', () => {
  const seen = newSeen();
  const encoded = 's%3AFakeSessionValue0123456789.abc%2Fdef%3D';
  addSetCookie(seen, `a=${encoded}; Path=/\nb="${word}"; Path=/\nc="Fake%20Spaced%20Value%200123"`);
  for (const text of [encoded, decodeURIComponent(encoded), word, 'Fake Spaced Value 0123']) assert.deepEqual(kindsOf(text, seen.credentials), ['credential'], text);
  const header = 'Fake/Value+0123456789==';
  assert.deepEqual(kindsOf('x=Fake%2fValue%2b0123456789%3d%3d', holding(header)), ['credential']);
  assert.deepEqual(kindsOf('x=fake%2fValue%2b0123456789%3d%3d', holding(header)), []);
  const broken = newSeen();
  addSetCookie(broken, `a=%zz${word}`);
  assert.deepEqual(kindsOf(`%zz${word}`, broken.credentials), ['credential']);
});

test('the password of a Basic authorization header is a credential, also decoded', () => {
  const password = 'FakeBasicPass0123456789';
  const pair = `ada:${password}:more`;
  const seen = newSeen();
  addCredential(seen, 'authorization', `Basic ${Buffer.from(pair).toString('base64')}`);
  for (const text of [pair, `${password}:more`]) assert.deepEqual(kindsOf(text, seen.credentials), ['credential'], text);
  const short = newSeen();
  addCredential(short, 'authorization', `Basic ${Buffer.from('ada-user-name:short').toString('base64')}`);
  assert.deepEqual(kindsOf('ada-user-name:short', short.credentials), ['credential']);
  const other = newSeen();
  addCredential(other, 'authorization', `Bearer ${Buffer.from(pair).toString('base64')}`);
  assert.deepEqual(kindsOf(pair.slice(4), other.credentials), []);
});

test('a query value that is not UTF-8 is searched as the page got it, and named by its place', () => {
  assert.deepEqual(scanUrl(new URL(`http://h/?t=%FF${jwt}`), newSeen()).map(describeFinding), ['--url, layer url, path query["t"][0]: jwt']);
});

test('a credential that is not well formed text does not stop the check', () => {
  assert.deepEqual(kindsOf('nothing here', holding(`\ud800${word}`)), []);
});

test('an accepted index does not stand for a step into a shadow tree', () => {
  const [found] = scan({ fields: [['html[1]/input[1]']], observations: [empty()] });
  const accepts = (path: string) => isAccepted(found, parseAccept([{ layer: 'dom', path, kind: 'secret-field', reason: 'a test value' }]));
  assert.ok(accepts('html[1]/input[1].props.value'));
  assert.ok(!accepts('html[1][0].input[1].props.value'));
});

test('a credential is found inside a longer base64 text at each offset, and in a form that writes a space as +', () => {
  const value = 'fake?>secret "value" ~~~ 0123456789a';
  for (const before of ['', 'a', 'ab', 'abc']) {
    for (const behind of ['', 'x', 'xy', 'xyz']) {
      const bytes = Buffer.from(`${before}${value}${behind}`);
      for (const encoding of ['base64', 'base64url'] as const) {
        const text = bytes.toString(encoding);
        assert.deepEqual(kindsOf(`see ${text} here`, holding(value)), ['credential'], `${before}|${behind}|${encoding}`);
      }
    }
  }
  assert.deepEqual(kindsOf(Buffer.from(`ab${value.slice(1)}`).toString('base64'), holding(value)), []);
  const form = new URLSearchParams({ q: value }).toString();
  assert.ok(form.includes('+'));
  assert.deepEqual(kindsOf(form, holding(value)), ['credential']);
});

test('a key that the tool reserves hides nothing of a page from the check', () => {
  const seen = withCredential(word);
  const observations = [
    observed((o) => {
      o.events = [
        { name: 'a', payload: { $order: word } },
        { name: 'b', payload: { $aa: 'number', source: '1', rest: word } },
        { name: 'c', payload: { $aa: 'noise', kind: 'string', rest: word } },
        { name: 'd', payload: { $order: { password: 'abcdefgh12345678' } } },
      ];
      o.effects.storage = { $order: word };
    }),
  ];
  assert.deepEqual(lines({ seen, observations }), [
    'step 1, layer events, path [0]["payload"]["$$order"]: credential',
    'step 1, layer events, path [1]["payload"]["rest"]: credential',
    'step 1, layer events, path [2]["payload"]["rest"]: credential',
    'step 1, layer events, path [3]["payload"]["$$order"]["password"]: named-value',
    'step 1, layer effects, path storage["$$order"]: credential',
  ]);
});

test('a reserved name in a query of the tape hides nothing', () => {
  const tape = [entry({ url: { path: ['api'], query: { $order: [word] } } })];
  assert.deepEqual(lines({ seen: withCredential(word), tape }), ['step 1, layer tape, path [0]["url"]["query"]["$$order"][0]: credential']);
});

test('a stored key order, a number that keeps its digits and a mask are read as before', () => {
  const observations = [
    observed((o) => {
      o.effects.storage = { saved: { [jwt]: '1', other: '2', $order: [jwt, 'other'] } };
      o.events = [{ name: 'a', payload: { $aa: 'noise', kind: 'string', group: 1 } }];
    }),
  ];
  assert.deepEqual(lines({ observations }), ['step 1, layer effects, path storage["saved"]["<jwt>"]: jwt']);
});

test('accepting a finding of a JSON answer hides no second value under a repeated key', () => {
  const [kept, hidden] = [jwt, `${jwt}x`];
  const answer = (body: string) => ({ status: 200, headers: {}, body });
  const found = lines({ tape: [entry({ answer: answer(`{"a":"${hidden}","a":"${kept}"}`) })] });
  assert.deepEqual(found, ['step 1, layer tape, path [0]["answer"]["body"]["a"]: jwt', 'step 1, layer tape, path [0]["answer"]["body"]: jwt']);
  const single = lines({ tape: [entry({ answer: answer(`{"a":"${kept}","b":{"a":"x: \\"y\\":"}}`) })] });
  assert.deepEqual(single, ['step 1, layer tape, path [0]["answer"]["body"]["a"]: jwt']);
});

test('a value under a repeated key of a JSON body is found by its name', () => {
  const value = 'abcdefgh12345678';
  const answer = (body: string) => ({ status: 200, headers: {}, body });
  const whole = ['step 1, layer tape, path [0]["answer"]["body"]: named-value'];
  for (const body of [
    `{"token":"${value}","token":"x"}`,
    `{"a":{"token":"${value}"},"a":null}`,
    `{"session":["${value}"],"session":[]}`,
    `{"a":[{"api_key":"${value}","api_key":1}]}`,
    `{"\\u0074oken":"${value}","token":"x"}`,
    `{"data":"{\\"token\\":\\"${value}\\",\\"token\\":\\"x\\"}"}`,
  ]) {
    assert.deepEqual(lines({ tape: [entry({ answer: answer(body) })] }), whole, body);
  }
  assert.deepEqual(lines({ tape: [entry({ answer: answer(`{"ref":"${value}","ref":"x","token":"x"}`) })] }), []);
  const seen = newSeen();
  const sent = entry({ body: { token: 'x' } });
  seen.bodies.set(sent, Buffer.from(`{"token":"${value}","token":"x"}`));
  assert.deepEqual(lines({ seen, tape: [sent] }), ['step 1, layer tape, path [0]["body"]: named-value']);
});

test('an answer that is a form is checked by its field names', () => {
  const answer = (type: string) => ({ status: 200, headers: { 'content-type': type }, body: 'access_token=abcdefgh12345678&scope=read' });
  assert.deepEqual(lines({ tape: [entry({ answer: answer('application/x-www-form-urlencoded; charset=utf-8') })] }), [
    'step 1, layer tape, path [0]["answer"]["body"]["access_token"][0]: named-value',
  ]);
  assert.deepEqual(lines({ tape: [entry({ answer: answer('text/plain') })] }), []);
});
