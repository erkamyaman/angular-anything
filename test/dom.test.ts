import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { capturePage } from '../src/page.ts';

const angularjsFile = createRequire(new URL('../fixtures/angularjs/package.json', import.meta.url)).resolve('angular/angular.js');

// One page in four flavors, with the marks that the built fixtures of this repository leave in the DOM.
// The text input holds "Call mom", "Write report" is checked, "Buy milk" was checked once and is not any more.

// React writes checked="" once and does not update it.
const react = `
<div id="root"><main class="app"><h1>Tasks</h1><form class="add" aria-label="Add task"><label for="new-task">New task</label><input id="new-task" required="" type="text" name="title"><button type="submit" class="btn btn-primary">Add</button></form><ul class="tasks" aria-label="Tasks"><li class="task"><input id="task-1" type="checkbox"><label for="task-1">Buy milk</label></li><li class="task is-done"><input id="task-2" type="checkbox" checked=""><label for="task-2">Write report</label></li></ul><p class="count" aria-live="polite">1 task left</p><section id="details" class="details" hidden=""><p>Tasks are stored in this browser.</p></section><div class="toast" role="status"></div></main></div>
<script>document.getElementById('new-task').value = 'Call mom';</script>`;

// Vue marks its container with data-v-app and __vue_app__ and puts empty text nodes around a list.
const vue = `
<div id="root" data-v-app=""><main class="app"><h1>Tasks</h1><form class="add" aria-label="Add task"><label for="new-task">New task</label><input id="new-task" name="title" type="text" required=""><button type="submit" class="btn btn-primary">Add</button></form><ul class="tasks" aria-label="Tasks"><li class="task"><input type="checkbox" id="task-1"><label for="task-1">Buy milk</label></li><li class="task is-done"><input type="checkbox" id="task-2"><label for="task-2">Write report</label></li></ul><p class="count" aria-live="polite">1 task left</p><section id="details" class="details" hidden=""><p>Tasks are stored in this browser.</p></section><div class="toast" role="status"></div></main></div>
<script>
  document.getElementById('root').__vue_app__ = {};
  document.querySelector('.tasks').prepend(document.createTextNode(''));
  document.querySelector('.tasks').append(document.createTextNode(''));
  document.getElementById('new-task').value = 'Call mom';
  document.getElementById('task-2').checked = true;
</script>`;

// Angular marks its root element with ng-version and __ngContext__ and leaves comments and an empty text node.
const angular = `
<div id="root" ng-version="22.3.0"><main class="app"><h1>Tasks</h1><form aria-label="Add task" class="add"><label for="new-task">New task</label><input id="new-task" name="title" type="text" required=""><button type="submit" class="btn btn-primary">Add</button></form><ul aria-label="Tasks" class="tasks"><li class="task"><input type="checkbox" id="task-1"><label for="task-1">Buy milk</label></li><li class="task is-done"><input type="checkbox" id="task-2"><label for="task-2">Write report</label></li><!----></ul><p aria-live="polite" class="count">1 task left</p><section id="details" class="details" hidden=""><p>Tasks are stored in this browser.</p></section><div role="status" class="toast"></div></main></div>
<script>
  document.getElementById('root').__ngContext__ = 1;
  document.querySelector('.toast').append(document.createTextNode(''));
  document.getElementById('new-task').value = 'Call mom';
  document.getElementById('task-2').checked = true;
</script>`;

// AngularJS itself renders this one, so its classes, comments and attributes are the real ones.
const angularjs = `
  angular.module('tasks', [])
    .directive('tasksApp', () => ({
      restrict: 'A',
      scope: {},
      controller: function () {
        this.title = '';
        this.tasks = [{ id: 1, title: 'Buy milk', done: false }, { id: 2, title: 'Write report', done: true }];
      },
      controllerAs: '$ctrl',
      template:
        '<main class="app"><h1>Tasks</h1>' +
        '<form class="add" aria-label="Add task" ng-submit="$ctrl.add()"><label for="new-task">New task</label>' +
        '<input id="new-task" name="title" type="text" required ng-model="$ctrl.title">' +
        '<button type="submit" class="btn btn-primary">Add</button></form>' +
        '<ul class="tasks" aria-label="Tasks">' +
        '<li class="task" ng-class="{\\'is-done\\': task.done}" ng-repeat="task in $ctrl.tasks track by task.id" task-row task="task" on-toggle="$ctrl.toggle(task)"></li>' +
        '</ul><p class="count" aria-live="polite">{{$ctrl.tasks.length - 1}} task left</p>' +
        '<section id="details" class="details" ng-attr-hidden="{{$ctrl.open ? undefined : \\'\\'}}"><p>Tasks are stored in this browser.</p></section>' +
        '<div class="toast" role="status">{{$ctrl.toast}}</div></main>',
    }))
    .directive('taskRow', () => ({
      restrict: 'A',
      scope: {},
      bindToController: { task: '<', onToggle: '&' },
      controller: function () {},
      controllerAs: '$ctrl',
      template:
        '<input type="checkbox" id="task-{{$ctrl.task.id}}" ng-checked="$ctrl.task.done" data-ng-click="$ctrl.onToggle()">' +
        '<label for="task-{{$ctrl.task.id}}">{{$ctrl.task.title}}</label>',
    }));
  const root = document.getElementById('root');
  root.setAttribute('tasks-app', '');
  angular.bootstrap(root, ['tasks']);
  const input = document.getElementById('new-task');
  input.value = 'Call mom';
  input.dispatchEvent(new Event('input'));`;

const canonical = {
  tag: 'html',
  children: [
    {
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
                    { tag: 'button', attrs: { class: 'btn btn-primary', type: 'submit' }, children: ['Add'] },
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
                { tag: 'div', attrs: { class: 'toast', role: 'status' } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

let browser: Browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
});

async function capture(html: string, angularjsApp?: string) {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    if (angularjsApp) {
      await page.addScriptTag({ path: angularjsFile });
      await page.addScriptTag({ content: angularjsApp });
    }
    return await page.evaluate(capturePage);
  } finally {
    await page.close();
  }
}

const dom = async (html: string, angularjsApp?: string) => (await capture(html, angularjsApp)).dom;

async function same(a: string, b: string): Promise<boolean> {
  try {
    assert.deepEqual(await dom(a), await dom(b));
    return true;
  } catch {
    return false;
  }
}

test('the React, Vue, AngularJS and Angular flavors of one page have the same canonical DOM', async () => {
  for (const [name, html] of Object.entries({ react, vue, angular })) {
    assert.deepEqual(await dom(html), canonical, name);
  }
  assert.deepEqual(await dom('<div id="root"></div>', angularjs), canonical, 'angularjs');
});

test('a framework mark is dropped only where that framework is proven', async () => {
  const unmarked = (html: string) => html.replace(/__(vue_app|ngContext)__/, '__nothing__');
  assert.notDeepEqual(await dom(unmarked(vue)), canonical, 'data-v-app on an element that Vue did not mount on');
  assert.notDeepEqual(await dom(unmarked(angular)), canonical, 'ng-version on an element that Angular did not bootstrap');

  const outside = '<p id="outside" class="note ng-binding" ng-click="go()" data-ng-if="ready">kept</p>';
  const withAngularjs = await dom(`<div id="root"></div>${outside}`, angularjs);
  assert.deepEqual((withAngularjs as { children: { children: unknown[] }[] }).children[0].children, [
    canonical.children[0].children[0],
    {
      tag: 'p',
      attrs: { class: 'ng-binding note', 'data-ng-if': 'ready', id: 'outside', 'ng-click': 'go()' },
      children: ['kept'],
    },
  ]);

  assert.equal(await same('<p>x</p>', '<p ng-click="go()">x</p>'), false, 'ng-click without AngularJS');
  assert.equal(await same('<p>x</p>', '<p data-ng-if="ready">x</p>'), false, 'data-ng-if without AngularJS');
  assert.equal(await same('<p>x</p>', '<p class="ng-binding">x</p>'), false, 'ng-binding without AngularJS');
  assert.equal(await same('<p>x</p>', '<p _ngcontent-ng-c1="">x</p>'), false, 'view encapsulation attribute');
  assert.equal(await same('<p>x</p>', '<p data-v-0123abcd="">x</p>'), false, 'Vue scope attribute');
  assert.equal(await same('<p id=":r1:">x</p>', '<p id=":r2:">x</p>'), false, 'ids are compared as written');
});

test('differences that are not framework artifacts stay in the canonical DOM', async () => {
  assert.equal(await same('<p class="a b">x</p>', '<p class="b  a">x</p>'), true, 'class order');
  assert.equal(await same('<p>x</p>', '<p class="">x</p>'), true, 'empty class');
  assert.equal(await same('<p>x</p>', '<p style="">x</p>'), true, 'empty style');
  assert.equal(await same('<p> <b>x</b>\n</p>', '<p><b>x</b></p>'), true, 'whitespace-only text');
  assert.equal(await same('<p>a<!---->b</p>', '<p>ab</p>'), true, 'text split by a comment');

  assert.equal(await same('<p class="a">x</p>', '<p class="a b">x</p>'), false, 'extra class');
  assert.equal(await same('<p>x</p>', '<p class="ng-hide">x</p>'), false, 'ng-hide hides the element');
  assert.equal(await same('<p>x</p>', '<p task-row>x</p>'), false, 'unknown attribute');
  assert.equal(await same('<p>x</p>', '<p>x </p>'), false, 'text is compared as written');
  assert.equal(await same('<p><b>x</b></p>', '<p><b>x</b>&nbsp;</p>'), false, 'a no-break space is content');
  assert.equal(await same('<p hidden>x</p>', '<p hidden="until-found">x</p>'), false, 'hidden until-found');
  assert.equal(await same('<button aria-expanded="false">x</button>', '<button aria-expanded="true">x</button>'), false, 'aria value');
  assert.equal(await same('<input value="a">', '<input value="b">'), false, 'input value');
  assert.equal(await same('<p>x</p>', '<div><p>x</p></div>'), false, 'wrapper element');
  assert.equal(await same('<p>x</p>', '<html lang="de"><body><p>x</p></body></html>'), false, 'attribute of html');
});

test('the html element is captured, head is not, and the title is', async () => {
  const captured = await capture(
    '<html lang="en" class="dark"><head><title>Tasks</title><style>html { background: rgb(1, 2, 3) }</style></head><body><p>x</p></body></html>',
  );
  assert.deepEqual(captured.dom, {
    tag: 'html',
    attrs: { class: 'dark', lang: 'en' },
    children: [{ tag: 'body', children: [{ tag: 'p', children: ['x'] }] }],
  });
  assert.equal(captured.style['html[1]'].style['background-color'], 'rgb(1, 2, 3)');
  assert.equal(captured.title, 'Tasks');
});

test('style, accessibility attributes and focus use the paths of the canonical DOM', async () => {
  const captured = await capture(`
    <style>button { margin-left: 3px }</style>
    <main><!----><button id="a" aria-expanded="false" aria-controls="x" tabindex="0">A</button><p role="note">B</p></main>
    <script>document.getElementById('a').focus();</script>`);
  const main = 'html[1]/body[1]/main[1]';
  assert.deepEqual(Object.keys(captured.style), ['html[1]', 'html[1]/body[1]', main, `${main}/button[1]`, `${main}/p[1]`]);
  assert.equal(captured.style[`${main}/button[1]`].style['margin-left'], '3px');
  assert.equal(captured.style[`${main}/button[1]`].box!.x, 11);
  assert.deepEqual(captured.aria, {
    [`${main}/button[1]`]: { 'aria-controls': 'x', 'aria-expanded': 'false', tabindex: '0' },
    [`${main}/p[1]`]: { role: 'note' },
  });
  assert.equal(captured.focus, `${main}/button[1]`);
});

test('every computed longhand is captured, listed where it differs from the parent element', async () => {
  const { style } = await capture(`
    <style>
      ul { filter: opacity(0); --gap: 4px }
      li { color: rgb(1, 2, 3); --gap: initial }
      p::before { content: "Left: "; color: rgb(4, 5, 6) }
    </style>
    <ul><li>a</li></ul><p>b</p>`);
  const body = 'html[1]/body[1]';
  assert.ok(Object.keys(style['html[1]'].style).length > 300, 'the html element lists every longhand');
  assert.equal(style['html[1]'].style.filter, 'none');
  assert.equal(style[`${body}/ul[1]`].style.filter, 'opacity(0)');
  assert.equal(style[`${body}/ul[1]`].style['--gap'], '4px');
  assert.equal(style[`${body}/ul[1]`].style.color, undefined, 'the same value as the parent is not repeated');

  const item = style[`${body}/ul[1]/li[1]`].style;
  assert.equal(item.color, 'rgb(1, 2, 3)');
  assert.equal(item.filter, 'none', 'a longhand that is not inherited is listed with its own value');
  assert.equal(item['--gap'], '', 'a custom property that is reset');
  assert.equal(item['font-size'], undefined);

  assert.deepEqual(Object.keys(style).filter((path) => path.includes('::')), [`${body}/p[1]/::before`]);
  const pseudo = style[`${body}/p[1]/::before`];
  assert.equal(pseudo.style.content, '"Left: "');
  assert.equal(pseudo.style.color, 'rgb(4, 5, 6)');
  assert.equal(pseudo.box, undefined);
});

test('AngularJS: what only a registered directive reads is an artifact, what the browser reads as well is not', async () => {
  const app = `
    angular.module('app', [])
      .directive('taskRow', () => ({
        restrict: 'A',
        scope: {},
        bindToController: { task: '<', onToggle: '&', label: '@rowLabel', title: '@', value: '<' },
        controller: function () {},
        controllerAs: '$ctrl',
        template: '<label>{{$ctrl.task.title}}</label>',
      }))
      .directive('myField', () => ({ restrict: 'A', scope: { name: '@', ariaLabel: '@', hint: '@' } }))
      .directive('draggable', () => ({ restrict: 'A' }))
      .directive('other', () => ({ restrict: 'E' }))
      .directive('appShell', () => ({
        restrict: 'A',
        template:
          '<ul><li task-row task="task" on-toggle="toggle()" row-label="x" title="Deletes the task" value="task.id" other="kept" ng-repeat="task in [{id: 7, title: \\'Buy milk\\'}]"></li></ul>' +
          '<input my-field name="email" aria-label="Email" hint="h" type="email"><p draggable="true">drag me</p>',
      }));
    const root = document.getElementById('root');
    root.setAttribute('data-app-shell', '');
    angular.bootstrap(root, ['app']);`;
  assert.deepEqual(await dom('<div id="root"></div>', app), {
    tag: 'html',
    children: [
      {
        tag: 'body',
        children: [
          {
            tag: 'div',
            attrs: { id: 'root' },
            children: [
              {
                tag: 'ul',
                children: [
                  {
                    tag: 'li',
                    attrs: { other: 'kept', title: 'Deletes the task' },
                    children: [{ tag: 'label', children: ['Buy milk'] }],
                  },
                ],
              },
              { tag: 'input', attrs: { 'aria-label': 'Email', name: 'email', type: 'email' }, props: { value: '' } },
              { tag: 'p', attrs: { draggable: 'true' }, children: ['drag me'] },
            ],
          },
        ],
      },
    ],
  });
});
