import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { checkLiterals } from '../src/literals.ts';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'aa-literals-'));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
  return root;
}

const values = ['eight888', 'Call the bank', 'Water the plants', 'Buy more milk', 'Feed the cat now', 'He said "no" twice', 'Two  spaced\nwords here'];

const recordings = () =>
  tree({
    'one/01.json': JSON.stringify({
      dom: { tag: 'html', children: values.map((value) => ({ tag: 'p', children: [value] })) },
      style: { 'html[1]': { style: { color: 'rgb(1, 2, 3)' } } },
      effects2: { mask: { $aa: 'noise', kind: 'empty string' } },
      events: [{ name: 'e', payload: { amp: 'Fish & <chips>', uni: 'Caf\u00e9 \u{1f600} au lait', lines: 'first line\nsecond', total: 48213.5, big: 100000, four: 4821, text: '73519', short: 'seven77', huge: { $aa: 'number', source: '12345678901234567890' } } }],
      effects: { title: ' Padded heading ' },
    }),
    'one/tape.json': JSON.stringify([{ answer: { body: '{"items":["Only on the tape","A second answer"],"id":90817263}' } }]),
    'one/recording.json': JSON.stringify({ url: 'http://recording.example' }),
    'one/lock.json': JSON.stringify({ root: 'abcdefabcdefabcdef' }),
    'gone/01.json': JSON.stringify({ title: 'Of another suite' }),
  });

async function check(port: Record<string, string>, original: Record<string, string> = { 'app.js': 'nothing' }) {
  const [recorded, originalSource, portSource] = await Promise.all([recordings(), tree(original), tree(port)]);
  return checkLiterals({ recorded, ids: ['one'], source: 'react', originalSource, portSource });
}

const found = async (...args: Parameters<typeof check>) => (await check(...args)).found.map((each) => each.value).sort();

const strings = (...list: string[]) => list.map((value, at) => `const v${at} = '${value}';`).join('\n');

test('one or two recorded literals are noted, three distinct ones fail', async () => {
  const two = await check({ 'src/a.ts': strings('Call the bank', 'Water the plants', 'Call the bank'), 'src/b.ts': strings('Call the bank') });
  assert.equal(two.result, 'pass');
  assert.deepEqual(two.found, [
    { file: 'src/a.ts', line: 1, value: 'Call the bank' },
    { file: 'src/a.ts', line: 2, value: 'Water the plants' },
  ]);
  const three = await check({ 'src/a.ts': strings('Call the bank', 'Water the plants'), 'src/b.ts': strings('Buy more milk') });
  assert.equal(three.result, 'fail');
  assert.equal(three.found.length, 3);
  assert.deepEqual((await check({ 'src/a.ts': 'export {};' })), { result: 'pass', found: [], named: [] });
});

test('a literal counts when it is a string of 8 characters or a number of 5 significant digits that was recorded', async () => {
  assert.deepEqual(await found({ 'a.ts': strings('seven77', 'Never recorded', 'Of another suite') }), []);
  assert.deepEqual(await found({ 'a.ts': strings('eight888') }), ['eight888']);
  assert.deepEqual(await found({ 'a.ts': 'f(100000, 4821, 99999, x48213, 0x48213);' }), []);
  assert.deepEqual(await found({ 'a.ts': 'f(48_213.50, 73519, 90817263); g(12345678901234567890);' }), ['12345678901234567890', '48_213.50', '73519', '90817263']);
  assert.deepEqual(await found({ 'a.ts': strings('48213.5', 'Only on the tape', 'Padded heading') }), ['48213.5', 'Only on the tape', 'Padded heading']);
  assert.deepEqual(await found({ 'a.ts': 'const a = "He said \\"no\\" twice"; const b = \'A second \\x61nswer\';' }), ['A second answer', 'He said "no" twice']);
  assert.deepEqual(await found({ 'a.ts': strings('http://recording.example', 'abcdefabcdefabcdef') }), []);
});

test('text and attributes of a template count, also in an inline template', async () => {
  assert.deepEqual(await found({ 'a.html': '<ul>\n  <li title="Buy more milk">\n    Call the bank\n  </li><li>Two spaced words\nhere</li><li>48213.5</li></ul>' }), [
    '48213.5',
    'Buy more milk',
    'Call the bank',
    'Two spaced words here',
  ]);
  const inline = await check({ 'a.ts': 'const x = 1;\n@Component({ template: `\n  <p title="Buy more milk">Water the plants</p>\n  <p [title]="\'Feed the cat now\'">x</p>` })' });
  assert.deepEqual(inline.found.map(({ value, line }) => [value, line]).sort(), [
    ['Buy more milk', 3],
    ['Feed the cat now', 4],
    ['Water the plants', 3],
  ]);
  assert.deepEqual(await found({ 'a.json': '{ "a": "Call the bank", "b": 73519 }' }), ['73519', 'Call the bank']);
  assert.deepEqual((await check({ 'a.html': '<ul>\n  <li>\n\n    Call the bank\n  </li></ul>' })).found, [{ file: 'a.html', line: 4, value: 'Call the bank' }]);
});

test('a literal is reported at its first line, whatever form it has there', async () => {
  const both = await check({ 'a.ts': "const t = `<p>\nCall the bank</p>`;\nconst a = 'Call the bank';" });
  assert.deepEqual(both.found, [{ file: 'a.ts', line: 2, value: 'Call the bank' }]);
});

test('escapes and entities are read as the browser reads them, a mask is no recorded value, and a regex does not hide literals', async () => {
  assert.deepEqual(await found({ 'a.html': '<p>Fish &amp; &lt;chips&gt;</p>' }), ['Fish & <chips>']);
  assert.deepEqual(await found({ 'a.ts': String.raw`const a = 'Caf\u00e9 \u{1f600} au lait'; const b = "first line\nsecond";` }), ['Café 😀 au lait', 'first line second']);
  assert.deepEqual(await found({ 'a.ts': strings('empty string') }), []);
  assert.deepEqual(await found({ 'a.ts': `const r = /a\\/*b/;\n${strings('Call the bank')}\n/* end */` }), ['Call the bank']);
});

test('a literal in a comment does not count, and recorded-literal with a reason accepts the literals of its line', async () => {
  assert.deepEqual(await found({ 'a.ts': "// 'Call the bank' 73519\n/* 'Water the plants'\n 48213.5 */\nconst url = 'http://x';", 'a.html': '<!-- <p>Buy more milk</p> -->' }), []);
  assert.deepEqual(
    await found({
      'a.ts': "const a = 'Call the bank'; // recorded-literal: a constant of the library\nconst b = 'Water the plants'; // recorded-literal:\nconst c = 'Buy more milk'; /* recorded-literal: */",
      'a.html': '<p>Feed the cat now</p> <!-- recorded-literal: fixed text -->\n<p>He said "no" twice</p> <!-- recorded-literal: -->',
    }),
    ['Buy more milk', 'He said "no" twice', 'Water the plants', 'no'].filter((value) => value.length >= 8),
  );
});

test('a literal that the original source holds does not count, also written another way', async () => {
  const port = { 'a.ts': `${strings('Call the bank', 'Water the plants')}\nconst c = 'He said "no" twice';\nf(48213.5, 73519, 90817263);` };
  const original = {
    'src/App.tsx': '<p>\n  Call the bank\n</p>; f(48213.50);',
    'src/data.json': '{ "quote": "He said \\"no\\" twice" }',
    'copy/notes.txt': 'Water the plants and 90817263',
    'node_modules/x/index.js': "f(73519)",
    'dist/main.js': 'f(73519)',
  };
  assert.deepEqual(await found(port, original), ['73519']);
  const spread = {
    'a.html': '<p>Call\n   the bank</p>',
    'b.ts': String.raw`const a = 'Water the \x70lants'; f(4.82135e4, 90_817_263);`,
  };
  assert.deepEqual(await found(port, spread), ['73519', 'He said "no" twice']);
});

test('node_modules, dist, test folders, test files and dot folders of the port are not read', async () => {
  const text = strings('Call the bank', 'Water the plants', 'Buy more milk');
  const skipped = ['node_modules/p/a.ts', 'dist/a.js', 'src/dist/a.js', 'test/a.ts', 'tests/a.ts', 'src/__tests__/a.ts', 'src/a.spec.ts', 'src/a.test.js', '.angular/cache/a.js', 'src/a.md'];
  assert.deepEqual(await found({ 'src/main.ts': 'export {};', ...Object.fromEntries(skipped.map((name) => [name, `${text} // tape.json`])) }), []);
  assert.equal((await check({ 'src/testing/a.ts': text })).result, 'fail');
});

test('a port source that names the recording files fails', async () => {
  const named = await check({
    'src/a.ts': "import tape from '../../recordings/react/one/tape.json';\nfetch('recording.json');\nread(`${dir}/lock.json`);",
    'src/b.ts': "const folder = 'recordings/react';",
  });
  assert.equal(named.result, 'fail');
  assert.deepEqual(
    named.named.map(({ file, line, name }) => [file, line, name]),
    [
      ['src/a.ts', 1, 'recordings/react'],
      ['src/a.ts', 1, 'tape.json'],
      ['src/a.ts', 2, 'recording.json'],
      ['src/a.ts', 3, 'lock.json'],
      ['src/b.ts', 1, 'recordings/react'],
    ],
  );
  const other = await check({ 'a.ts': "// tape.json\nread('package-lock.json', 'mixtape.json', 'composer.lock.json', 'recordings/reactive', 'tape.jsonl');" });
  assert.deepEqual(other, { result: 'pass', found: [], named: [] });
});

test('a source folder that is missing or holds no source file is refused', async () => {
  await assert.rejects(check({ 'notes.md': 'x' }), /--port-source .* holds no source file/);
  await assert.rejects(check({ 'a.ts': 'x' }, {}), /--original-source .* holds no file/);
  await assert.rejects(
    checkLiterals({ recorded: await recordings(), ids: ['one'], source: 'react', originalSource: '/nowhere-at-all', portSource: '/nowhere-at-all' }),
    /--original-source \/nowhere-at-all is not a folder/,
  );
});
