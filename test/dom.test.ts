import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { capturePage } from '../src/page.ts';

// One page in four flavors: the markup each framework leaves in the DOM for the same content.
// The text input holds "Call mom", "Write report" is checked, "Buy milk" was checked once and is not any more.

const react = `
<div id="root"><main class="app"><h1>Tasks</h1><form class="add" aria-label="Add task"><label for="new-task">New task</label><input id="new-task" required="" type="text" name="title" value="Call mom"><button type="submit" class="btn btn-primary" disabled="">Add</button></form><ul class="tasks" aria-label="Tasks"><li class="task"><input id="task-1" type="checkbox" checked=""><label for="task-1">Buy milk</label></li><li class="task is-done"><input id="task-2" type="checkbox" checked=""><label for="task-2">Write report</label></li></ul><p class="count" aria-live="polite">1<!-- --> task left</p><!--$--><section id="details" class="details" hidden=""><p>Tasks are stored in this browser.</p></section><!--/$--></main></div>
<script>document.getElementById('task-1').checked = false;</script>`;

const vue = `
<div id="root" data-v-app=""><main class="app" data-v-7ba5bd90=""><h1 data-v-7ba5bd90="">Tasks</h1><form class="add" aria-label="Add task" data-v-7ba5bd90=""><label for="new-task" data-v-7ba5bd90="">New task</label><input id="new-task" name="title" type="text" required="" data-v-7ba5bd90=""><button type="submit" class="btn btn-primary" disabled="" data-v-7ba5bd90="">Add</button></form><ul class="tasks" aria-label="Tasks" data-v-7ba5bd90=""><!--[--><li class="task" data-v-0f3a9c1e=""><input type="checkbox" id="task-1" data-v-0f3a9c1e=""><label for="task-1" data-v-0f3a9c1e="">Buy milk</label></li><li class="task is-done" data-v-0f3a9c1e=""><input type="checkbox" id="task-2" data-v-0f3a9c1e=""><label for="task-2" data-v-0f3a9c1e="">Write report</label></li><!--]--></ul><p class="count" aria-live="polite" data-v-7ba5bd90="">1 task left</p><!--v-if--><section id="details" class="details" hidden="" data-v-7ba5bd90=""><p data-v-7ba5bd90="">Tasks are stored in this browser.</p></section><!----></main></div>
<script>
  document.getElementById('new-task').value = 'Call mom';
  document.getElementById('task-2').checked = true;
</script>`;

const angularjs = `
<div id="root" class="ng-scope">
  <main class="app">
    <h1>Tasks</h1>
    <form class="add ng-dirty ng-valid ng-valid-required ng-submitted" aria-label="Add task" ng-submit="$ctrl.add()">
      <label for="new-task">New task</label>
      <input id="new-task" name="title" type="text" required="required" ng-model="$ctrl.title" class="ng-dirty ng-touched ng-not-empty ng-valid ng-valid-required">
      <button type="submit" class="btn btn-primary" ng-disabled="$ctrl.busy" disabled="disabled">Add</button>
    </form>
    <ul class="tasks" aria-label="Tasks">
      <!-- ngRepeat: task in $ctrl.visible() track by task.id --><li class="task ng-scope ng-isolate-scope" ng-class="{'is-done': task.done}" ng-repeat="task in $ctrl.visible() track by task.id"><input type="checkbox" id="task-1" ng-checked="$ctrl.task.done" data-ng-click="$ctrl.onToggle()"><label for="task-1" class="ng-binding">Buy milk</label></li><!-- end ngRepeat: task in $ctrl.visible() track by task.id --><li class="task ng-scope ng-isolate-scope is-done" ng-class="{'is-done': task.done}" ng-repeat="task in $ctrl.visible() track by task.id"><input type="checkbox" id="task-2" ng-checked="$ctrl.task.done" data-ng-click="$ctrl.onToggle()" checked="checked"><label for="task-2" class="ng-binding">Write report</label></li><!-- end ngRepeat: task in $ctrl.visible() track by task.id -->
    </ul>
    <p class="count ng-binding" aria-live="polite">1 task left</p>
    <section id="details" class="details" ng-attr-hidden="{{$ctrl.open ? undefined : ''}}" hidden="hidden"><p>Tasks are stored in this browser.</p></section>
  </main>
</div>
<script>document.getElementById('new-task').value = 'Call mom';</script>`;

const angular = `
<div id="root" ng-version="22.3.0" _nghost-ng-c2520861411=""><main _ngcontent-ng-c2520861411="" class="app"><h1 _ngcontent-ng-c2520861411="">Tasks</h1><form _ngcontent-ng-c2520861411="" aria-label="Add task" class="add"><label _ngcontent-ng-c2520861411="" for="new-task">New task</label><input _ngcontent-ng-c2520861411="" id="new-task" name="title" type="text" required="" ng-reflect-name="title"><button _ngcontent-ng-c2520861411="" type="submit" class="btn-primary btn" disabled="">Add</button></form><ul _ngcontent-ng-c2520861411="" aria-label="Tasks" class="tasks"><li _ngcontent-ng-c2520861411="" class="task" _nghost-ng-c1183221107="" ng-reflect-task="[object Object]"><input _ngcontent-ng-c1183221107="" type="checkbox" id="task-1"><label _ngcontent-ng-c1183221107="" for="task-1">Buy milk</label></li><li _ngcontent-ng-c2520861411="" class="is-done task" _nghost-ng-c1183221107="" ng-reflect-task="[object Object]"><input _ngcontent-ng-c1183221107="" type="checkbox" id="task-2"><label _ngcontent-ng-c1183221107="" for="task-2">Write report</label></li><!--container--></ul><p _ngcontent-ng-c2520861411="" aria-live="polite" class="count">1 task left</p><section _ngcontent-ng-c2520861411="" id="details" class="details" hidden=""><p _ngcontent-ng-c2520861411="">Tasks are stored in this browser.</p></section><!----></main></div>
<script>
  document.getElementById('new-task').value = 'Call mom';
  document.getElementById('task-2').checked = true;
</script>`;

const canonical = {
  tag: 'body',
  children: [
    {
      tag: 'div',
      attrs: { id: 'root' },
      children: [
        {
          tag: 'main',
          attrs: { class: 'app' },
          children: [
            { tag: 'h1', children: ['Tasks'] },
            {
              tag: 'form',
              attrs: { 'aria-label': 'Add task', class: 'add' },
              children: [
                { tag: 'label', attrs: { for: 'new-task' }, children: ['New task'] },
                {
                  tag: 'input',
                  attrs: { id: 'new-task', name: 'title', required: '', type: 'text' },
                  props: { value: 'Call mom' },
                },
                { tag: 'button', attrs: { class: 'btn btn-primary', disabled: '', type: 'submit' }, children: ['Add'] },
              ],
            },
            {
              tag: 'ul',
              attrs: { 'aria-label': 'Tasks', class: 'tasks' },
              children: [
                {
                  tag: 'li',
                  attrs: { class: 'task' },
                  children: [
                    { tag: 'input', attrs: { id: 'task-1', type: 'checkbox' }, props: { checked: false } },
                    { tag: 'label', attrs: { for: 'task-1' }, children: ['Buy milk'] },
                  ],
                },
                {
                  tag: 'li',
                  attrs: { class: 'is-done task' },
                  children: [
                    { tag: 'input', attrs: { id: 'task-2', type: 'checkbox' }, props: { checked: true } },
                    { tag: 'label', attrs: { for: 'task-2' }, children: ['Write report'] },
                  ],
                },
              ],
            },
            { tag: 'p', attrs: { 'aria-live': 'polite', class: 'count' }, children: ['1 task left'] },
            {
              tag: 'section',
              attrs: { class: 'details', hidden: '', id: 'details' },
              children: [{ tag: 'p', children: ['Tasks are stored in this browser.'] }],
            },
          ],
        },
      ],
    },
  ],
};

let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

after(async () => {
  await browser.close();
});

async function capture(html: string) {
  await page.setContent(html);
  return page.evaluate(capturePage);
}

const dom = async (html: string) => (await capture(html)).dom;

test('the React, Vue, AngularJS and Angular flavors of one page have the same canonical DOM', async () => {
  for (const [name, html] of Object.entries({ react, vue, angularjs, angular })) {
    assert.deepEqual(await dom(html), canonical, name);
  }
});

test('React useId values are numbered in document order, whatever the format', async () => {
  const first = await dom('<label for=":r1:">A</label><input id=":r1:" aria-describedby=":r2:-hint"><p id=":r2:-hint">h</p>');
  const second = await dom('<label for="_r_5_">A</label><input id="_r_5_" aria-describedby="_r_8_-hint"><p id="_r_8_-hint">h</p>');
  const third = await dom('<label for="«r3»">A</label><input id="«r3»" aria-describedby="«r4»-hint"><p id="«r4»-hint">h</p>');
  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
  assert.deepEqual(first, {
    tag: 'body',
    children: [
      { tag: 'label', attrs: { for: 'useId#1' }, children: ['A'] },
      { tag: 'input', attrs: { 'aria-describedby': 'useId#2-hint', id: 'useId#1' }, props: { value: '' } },
      { tag: 'p', attrs: { id: 'useId#2-hint' }, children: ['h'] },
    ],
  });
  const swapped = await dom('<label for="_r_8_">A</label><input id="_r_5_" aria-describedby="_r_8_-hint"><p id="_r_8_-hint">h</p>');
  assert.notDeepEqual(swapped, first, 'a label that points at another element is a real difference');
});

test('differences that are not framework artifacts stay in the canonical DOM', async () => {
  const same = async (a: string, b: string) => {
    try {
      assert.deepEqual(await dom(a), await dom(b));
      return true;
    } catch {
      return false;
    }
  };
  assert.equal(await same('<p class="a b">x</p>', '<p class="b  a">x</p>'), true, 'class order');
  assert.equal(await same('<p>x</p>', '<p class="">x</p>'), true, 'empty class');
  assert.equal(await same('<p>x</p>', '<p style="">x</p>'), true, 'empty style');
  assert.equal(await same('<p> <b>x</b>\n</p>', '<p><b>x</b></p>'), true, 'whitespace-only text');
  assert.equal(await same('<p>a<!---->b</p>', '<p>ab</p>'), true, 'text split by a comment');

  assert.equal(await same('<p class="a">x</p>', '<p class="a b">x</p>'), false, 'extra class');
  assert.equal(await same('<p>x</p>', '<p class="ng-hide">x</p>'), false, 'ng-hide hides the element');
  assert.equal(await same('<p>x</p>', '<p data-v-step="1">x</p>'), false, 'data-v- without a scope hash');
  assert.equal(await same('<p>x</p>', '<p task-row>x</p>'), false, 'unknown attribute');
  assert.equal(await same('<p>x</p>', '<p>x </p>'), false, 'text is compared as written');
  assert.equal(await same('<p><b>x</b></p>', '<p><b>x</b>&nbsp;</p>'), false, 'a no-break space is content');
  assert.equal(await same('<p hidden>x</p>', '<p hidden="until-found">x</p>'), false, 'hidden until-found');
  assert.equal(await same('<button aria-expanded="false">x</button>', '<button aria-expanded="true">x</button>'), false, 'aria value');
  assert.equal(await same('<input value="a">', '<input value="b">'), false, 'input value');
  assert.equal(await same('<p>x</p>', '<div><p>x</p></div>'), false, 'wrapper element');
  assert.equal(await same('<p id="_r_1_x">x</p>', '<p id="_r_2_x">x</p>'), false, 'an id that only looks like useId');
});

test('style, accessibility attributes and focus use the paths of the canonical DOM', async () => {
  const captured = await capture(`
    <style>button { margin-left: 3px }</style>
    <main><!----><button id="a" aria-expanded="false" aria-controls="x" tabindex="0" ng-click="go()">A</button><p role="note">B</p></main>
    <script>document.getElementById('a').focus();</script>`);
  const button = 'body[1]/main[1]/button[1]';
  assert.deepEqual(Object.keys(captured.style), ['body[1]', 'body[1]/main[1]', button, 'body[1]/main[1]/p[1]']);
  assert.equal(captured.style[button].style['margin-left'], '3px');
  assert.equal(captured.style[button].box.x, 11);
  assert.deepEqual(captured.aria, {
    [button]: { 'aria-controls': 'x', 'aria-expanded': 'false', tabindex: '0' },
    'body[1]/main[1]/p[1]': { role: 'note' },
  });
  assert.equal(captured.focus, button);
});

test('AngularJS: attributes of directives registered in the page are artifacts, other attributes are not', async () => {
  const angularjs = createRequire(new URL('../fixtures/angularjs/package.json', import.meta.url)).resolve('angular/angular.js');
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ path: angularjs });
  await page.addScriptTag({
    content: `
      angular.module('app', [])
        .directive('taskRow', () => ({
          restrict: 'A',
          scope: {},
          bindToController: { task: '<', onToggle: '&', label: '@rowLabel' },
          controller: function () {},
          controllerAs: '$ctrl',
          template: '<label>{{$ctrl.task.title}}</label>',
        }))
        .directive('other', () => ({ restrict: 'E' }))
        .directive('appShell', () => ({
          restrict: 'A',
          template: '<ul><li task-row task="task" on-toggle="toggle()" row-label="x" title="kept" other="kept" ng-repeat="task in [{title: \\'Buy milk\\'}]"></li></ul>',
        }));
      const root = document.getElementById('root');
      root.setAttribute('data-app-shell', '');
      angular.bootstrap(root, ['app']);`,
  });
  assert.deepEqual((await page.evaluate(capturePage)).dom, {
    tag: 'body',
    children: [
      {
        tag: 'div',
        attrs: { id: 'root' },
        children: [
          {
            tag: 'ul',
            children: [
              { tag: 'li', attrs: { other: 'kept', title: 'kept' }, children: [{ tag: 'label', children: ['Buy milk'] }] },
            ],
          },
        ],
      },
    ],
  });
});
