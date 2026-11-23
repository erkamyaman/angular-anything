import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeWindows, popupOf } from '../src/run.ts';
import type { Log } from '../src/run.ts';
import type { Page } from 'playwright';

function logWith(windows: Page[], asked: number, seen: number): Log {
  return { windows, windowsAsked: asked, windowsSeen: seen } as unknown as Log;
}

const window = (closed: string[], name: string, fail = false) =>
  ({
    close: async () => {
      closed.push(name);
      if (fail) throw new Error('already closed');
    },
  }) as unknown as Page;

test('every window that opened is closed, and the list is empty after', async () => {
  const closed: string[] = [];
  const log = logWith([window(closed, 'a'), window(closed, 'b', true)], 2, 2);
  await closeWindows(log);
  assert.deepEqual(closed, ['a', 'b']);
  assert.deepEqual(log.windows, []);
});

test('a window that the page asked for and that has not arrived is waited for, then closed', async () => {
  const closed: string[] = [];
  const log = logWith([], 1, 0);
  const closing = closeWindows(log, 2000);
  setTimeout(() => {
    log.windows.push(window(closed, 'late'));
    log.windowsSeen++;
  }, 50);
  await closing;
  assert.deepEqual(closed, ['late']);
});

test('a window that never arrives (a mailto: URL) costs the wait and nothing else', async () => {
  const started = Date.now();
  const log = logWith([], 1, 0);
  const finished = await Promise.race([closeWindows(log, 60).then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500))]);
  assert.equal(finished, true, 'the wait ends');
  assert.ok(Date.now() - started >= 55);
  assert.ok(Date.now() - started < 1000);
  assert.equal(log.windowsAsked, 0);
});

test('a window that does not close fails the step by name', async () => {
  const stuck = { close: () => new Promise(() => {}) } as unknown as Page;
  await assert.rejects(closeWindows(logWith([stuck], 1, 1), 60, 60), /^Error: waited 60 ms to close a window$/);
});

test('the URL of a window is the one the page gave, resolved, and the scheme is kept for URLs that are not on the web', () => {
  const base = new URL('http://localhost:4104/?bug=text');
  const open = (url: string) => popupOf({ kind: 'open', url, target: '_blank', features: '' }, base);
  assert.deepEqual(open('http://localhost:4104/a/b?x=1#h'), {
    kind: 'open',
    url: { path: ['a', 'b'], query: { x: ['1'] }, fragment: 'h' },
    target: '_blank',
    features: '',
  });
  assert.equal((open('https://example.org/a') as { url: { origin?: string } }).url.origin, 'https://example.org');
  assert.deepEqual((open('about:blank') as { url: unknown }).url, { origin: 'about:', path: ['blank'], query: {}, fragment: '' });
  assert.deepEqual((open('mailto:a@b.c') as { url: unknown }).url, { origin: 'mailto:', path: ['a@b.c'], query: {}, fragment: '' });
  assert.notDeepEqual(open('mailto:a@b.c'), open('tel:a@b.c'));
  assert.deepEqual(popupOf({ kind: 'prompt', message: 'm', default: 'd' }, base), { kind: 'prompt', message: 'm', default: 'd' });
});
