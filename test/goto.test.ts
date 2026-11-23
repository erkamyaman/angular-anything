import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gotoUrl } from '../src/run.ts';

test('the query of --url is added to the address of a goto as written', () => {
  const base = new URL('http://localhost:4104/?bug=aria&tag=a%20b');
  assert.equal(gotoUrl('/two?q=a%20b', base), 'http://localhost:4104/two?q=a%20b&bug=aria&tag=a%20b');
  assert.equal(gotoUrl('/two?q=/home', base), 'http://localhost:4104/two?q=/home&bug=aria&tag=a%20b');
  assert.equal(gotoUrl('/two?q=a+b#frag', base), 'http://localhost:4104/two?q=a+b&bug=aria&tag=a%20b#frag');
  assert.equal(gotoUrl('/', base), 'http://localhost:4104/?bug=aria&tag=a%20b');
  assert.equal(gotoUrl('/p', base), 'http://localhost:4104/p?bug=aria&tag=a%20b');
});

test('a goto without a query in --url opens the path as written', () => {
  const base = new URL('http://localhost:4104/');
  assert.equal(gotoUrl('/two?q=a%20b', base), 'http://localhost:4104/two?q=a%20b');
  assert.equal(gotoUrl('/a%7Eb', base), 'http://localhost:4104/a%7Eb');
});
