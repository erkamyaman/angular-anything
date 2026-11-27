import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactPath, redactReport, redactStep, shape } from '../src/redact.ts';
import { REPORT_FORMAT } from '../src/report.ts';

const masked = (layer: Parameters<typeof redactPath>[0], path: string) => redactPath(layer, path).replace(/<[0-9a-f]{8}>/g, '<>');

test('a shape holds the type, the length and a hash, and a number or boolean only its type', () => {
  assert.match(shape('abc')!, /^string, length 3, hash [0-9a-f]{8}$/);
  assert.match(shape('😀')!, /^string, length 1, /);
  assert.notEqual(shape('abc'), shape('abd'));
  assert.equal(shape('abc'), shape('abc'));
  assert.match(shape([1, 2])!, /^array, length 2, hash [0-9a-f]{8}$/);
  assert.match(shape({ a: 1 })!, /^object, 1 key, hash [0-9a-f]{8}$/);
  assert.equal(shape(1234567), 'number');
  assert.equal(shape({ $aa: 'number', source: '1e30' }), 'number');
  assert.equal(shape(false), 'boolean');
  assert.equal(shape(null), 'null');
  assert.equal(shape(undefined), undefined);
});

test('a path keeps the words of the tool and the browser and hides the names the page chose', () => {
  assert.equal(masked('dom', 'html[1]/body[1]/main[1]/text()[1]'), 'html[1]/body[1]/main[1]/text()[1]');
  assert.equal(masked('dom', 'html[1]/my-user[1].attrs.class'), 'html[1]/<>[1].attrs.class');
  assert.equal(masked('dom', 'html[1].attrs.data-user-ada'), 'html[1].attrs.<>');
  assert.equal(masked('dom', 'html[1].attrs.aria-label'), 'html[1].attrs.aria-label');
  assert.equal(masked('dom', 'html[1].attrs.aria-ada'), 'html[1].attrs.<>');
  assert.equal(masked('dom', 'html[1].props.value'), 'html[1].props.value');
  assert.equal(masked('dom', 'html[1].inline.margin-left'), 'html[1].inline.margin-left');
  assert.equal(masked('dom', 'html[1].inline.--ada'), 'html[1].inline.<>');
  assert.equal(masked('style', 'html[1]/p[1]/::before.style.-webkit-box-flex'), 'html[1]/p[1]/::before.style.-webkit-box-flex');
  assert.equal(masked('style', 'html[1]/p[1]/::after.style.color'), 'html[1]/p[1]/::after.style.color');
  assert.equal(masked('dom', 'html[1].attrs.::PatientAda'), 'html[1].attrs.<>');
  assert.equal(masked('accessibility', 'attributes.html[1].::ada'), 'attributes.html[1].<>');
  assert.equal(masked('style', 'html[1].style.::ada'), 'html[1].style.<>');
  assert.equal(masked('style', 'html[1].layout.margin-left'), 'html[1].layout.margin-left');
  assert.equal(masked('style', 'html[1].layout.--ada'), 'html[1].layout.<>');
  assert.equal(masked('style', 'html[1].box.width'), 'html[1].box.width');
  assert.equal(masked('accessibility', 'tree/main[1]/button[2].name'), 'tree/main[1]/button[2].name');
  assert.equal(masked('accessibility', 'attributes.html[1]/form[1].aria-ada'), 'attributes.html[1]/form[1].<>');
  assert.equal(masked('accessibility', 'attributes.html[1].aria-q.name[1]'), 'attributes.html[1].<>.<>[1]');
  assert.equal(masked('accessibility', 'attributes.html[1]/p[1].aria-q.ada[1]'), 'attributes.html[1]/p[1].<>.<>[1]');
  assert.equal(masked('accessibility', 'attributes.html[1]/x.ada[1]'), 'attributes.html[1]/x.<>[1]');
  assert.equal(masked('style', 'html[1]/x.ada[1]/p[2].style.color'), 'html[1]/x.<>[1]/p[2].style.color');
  assert.equal(masked('dom', 'html[1].attrs.aria-q.ada/p[1]'), 'html[1].attrs.<>.<>/p[1]');
  assert.equal(masked('events', '[0].name'), '[0].name');
  assert.equal(masked('events', '[0].payload.value.name'), '[0].payload.<>.<>');
  assert.equal(masked('effects', 'storage.title'), 'storage.<>');
  assert.equal(masked('effects', 'storage["a b"].name[0]'), 'storage.<>.<>[0]');
  assert.equal(masked('effects', 'requests[0].url.query.name[0]'), 'requests[0].url.query.<>[0]');
  assert.equal(masked('effects', 'requests[0].body.method'), 'requests[0].body.<>');
  assert.equal(masked('effects', 'url.path[1]'), 'url.path[1]');
  assert.equal(masked('effects', 'popups[0].message'), 'popups[0].message');
  assert.equal(masked('effects', 'tape GET /api/ada?q=1'), 'tape GET <>');
  assert.equal(masked('effects', 'tape ADA /api'), 'tape <>');
  assert.equal(masked('effects', 'ada ada'), '<>');
});

test('a step keeps its action, its roles and its keys, and hides names, values and paths', () => {
  const hidden = (step: Parameters<typeof redactStep>[0]) => redactStep(step).replace(/<[0-9a-f]{8}>/g, '<>');
  assert.equal(hidden({ action: 'goto', path: '/ada' }), 'goto <>');
  assert.equal(hidden({ action: 'reload' }), 'reload');
  assert.equal(hidden({ action: 'advance', frames: 3 }), 'advance 3 frames');
  assert.equal(
    hidden({ action: 'click', target: { role: 'button', name: 'Ada', index: 2, within: { role: 'list', name: 'Bob' } } }),
    'click button <> #2 in list <>',
  );
  assert.equal(hidden({ action: 'fill', target: { role: 'textbox' }, value: 'Ada' }), 'fill textbox with <>');
  assert.equal(hidden({ action: 'press', target: { role: 'textbox' }, key: 'Enter' }), 'press Enter on textbox');
  assert.equal(hidden({ action: 'press', target: { role: 'textbox' }, key: 'a' }), 'press <> on textbox');
  assert.equal(hidden({ action: 'click', target: { role: 'Ada Lovelace' } }), 'click <>');
});

test('an error is hidden whole, with only a step number or a fixed phrase before it', () => {
  const error = (text: string) =>
    redactReport({
      format: REPORT_FORMAT,
      command: 'gate',
      suite: 's',
      source: 'o',
      url: 'http://localhost:1/?ada=1',
      original: 'http://localhost:2/?ada=2',
      playwright: 'p',
      browser: 'b',
      result: 'fail',
      cases: [{ id: 'one', result: 'fail', stepCount: 1, steps: [], error: text }],
    });
  const text = (given: string) => error(given).cases[0].error!.replace(/length \d+, hash [0-9a-f]{8}/, 'N');
  assert.equal(text('Ada broke'), 'hidden, N');
  assert.equal(text('step 12 (click "Ada"): Ada'), 'step 12: hidden, N');
  assert.equal(text('cannot replay against the recording: Ada'), 'cannot replay against the recording: hidden, N');
  assert.equal(text('the original at http://ada/ does not match'), 'the original does not match its recording: hidden, N');
  assert.deepEqual([error('x').url, error('x').original], ['http://localhost:1/', 'http://localhost:2/']);
});
