import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { capturePage } from '../src/page.ts';
import type { DomNode } from '../src/page.ts';

const angularjsFile = createRequire(new URL('../fixtures/angularjs/package.json', import.meta.url)).resolve('angular/angular.js');

const react = `
<div id="root"><main class="app"><h1>Tasks</h1><form class="add" aria-label="Add task"><label for="new-task">New task</label><input id="new-task" required="" type="text" name="title"><button type="submit" class="btn btn-primary">Add</button></form><ul class="tasks" aria-label="Tasks"><li class="task"><input id="task-1" type="checkbox"><label for="task-1">Buy milk</label></li><li class="task is-done"><input id="task-2" type="checkbox" checked=""><label for="task-2">Write report</label></li></ul><p class="count" aria-live="polite">1 task left</p><section id="details" class="details" hidden=""><p>Tasks are stored in this browser.</p></section><div class="toast" role="status"></div></main></div>
<script>document.getElementById('new-task').value = 'Call mom';</script>`;

const vue = `
<div id="root" data-v-app=""><main class="app"><h1>Tasks</h1><form class="add" aria-label="Add task"><label for="new-task">New task</label><input id="new-task" name="title" type="text" required=""><button type="submit" class="btn btn-primary">Add</button></form><ul class="tasks" aria-label="Tasks"><li class="task"><input type="checkbox" id="task-1"><label for="task-1">Buy milk</label></li><li class="task is-done"><input type="checkbox" id="task-2"><label for="task-2">Write report</label></li></ul><p class="count" aria-live="polite">1 task left</p><section id="details" class="details" hidden=""><p>Tasks are stored in this browser.</p></section><div class="toast" role="status"></div></main></div>
<script>
  document.getElementById('root').__vue_app__ = {};
  document.querySelector('.tasks').prepend(document.createTextNode(''));
  document.querySelector('.tasks').append(document.createTextNode(''));
  document.getElementById('new-task').value = 'Call mom';
  document.getElementById('task-2').checked = true;
</script>`;

const angular = `
<div id="root" ng-version="22.3.0"><main class="app"><h1>Tasks</h1><form aria-label="Add task" class="add"><label for="new-task">New task</label><input id="new-task" name="title" type="text" required=""><button type="submit" class="btn btn-primary">Add</button></form><ul aria-label="Tasks" class="tasks"><li class="task"><input type="checkbox" id="task-1"><label for="task-1">Buy milk</label></li><li class="task is-done"><input type="checkbox" id="task-2"><label for="task-2">Write report</label></li><!----></ul><p aria-live="polite" class="count">1 task left</p><section id="details" class="details" hidden=""><p>Tasks are stored in this browser.</p></section><div role="status" class="toast"></div></main></div>
<script>
  document.getElementById('root').__ngContext__ = 1;
  document.querySelector('.toast').append(document.createTextNode(''));
  document.getElementById('new-task').value = 'Call mom';
  document.getElementById('task-2').checked = true;
</script>`;

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

async function capture(html: string, angularjsApp?: string, width?: number) {
  const page = await browser.newPage(width === undefined ? {} : { viewport: { width, height: 800 } });
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
  assert.equal(await same('<p>x</p>', '<p task-row>x</p>'), false, 'unknown attribute');
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

const differ = async (a: string, b: string) => !(await same(a, b));

test('text is compared as the browser collapses it', async () => {
  assert.equal(await same('<p>a   b\n\t c</p>', '<p>a b c</p>'), true, 'a run of whitespace is one space');
  assert.equal(await same('<p> a </p>', '<p>a</p>'), true, 'no space at the start or the end of a block');
  assert.equal(await same('<p>a <br> b</p>', '<p>a<br>b</p>'), true, 'no space next to a br');
  assert.equal(await same('<p><b>a </b> b</p>', '<p><b>a </b>b</p>'), true, 'no space after another space');
  assert.equal(await same('<ul>\n <li>a</li>\n <li>b</li>\n</ul>', '<ul><li>a</li><li>b</li></ul>'), true, 'between blocks');
  assert.equal(await same('<div>a <p>b</p> c</div>', '<div>a<p>b</p>c</div>'), true, 'next to a block');
  assert.equal(await same('<table><tr> <td> a </td> </tr></table>', '<table><tr><td>a</td></tr></table>'), true, 'table');
  assert.equal(await same('<p>a <span hidden></span> b</p>', '<p>a <span hidden></span>b</p>'), true, 'around an element that is not rendered');
  assert.equal(await same('<div style="display: flex"> <span> a </span> <span>b</span> </div>', '<div style="display: flex"><span>a</span><span>b</span></div>'), true, 'flex items');
  assert.equal(await same('<p>a<!---->  b</p>', '<p>a b</p>'), true, 'text split by a comment');
  assert.equal(await same('<p>a</p><textarea>x</textarea>', '<p>a</p><textarea>x</textarea> '), true, 'after an atomic element at the end of the body');
  assert.equal(await same('<p>a <img alt="x"> b</p>', '<p>a<img alt="x">b</p>'), false, 'next to an image');

  assert.equal(await differ('<p><span>a</span> <span>b</span></p>', '<p><span>a</span><span>b</span></p>'), true, 'a rendered space');
  assert.equal(await differ('<p>a&nbsp;b</p>', '<p>a b</p>'), true, 'a no-break space is text');
  assert.equal(await differ('<p>a&nbsp;&nbsp;b</p>', '<p>a&nbsp;b</p>'), true, 'two no-break spaces are not one');
  assert.equal(await differ('<p>a <b>b</b></p>', '<p>a<b>b</b></p>'), true, 'a space before an inline element');
  assert.equal(await differ('<p><b>a</b> </p><p>c</p>', '<p><b>a</b></p><p>c</p>'), false, 'a space at the end of a block');
  assert.equal(await differ('<p>a b</p>', '<p>ab</p>'), true, 'a space inside text');
  assert.equal(await differ('<p>x</p>', '<p>y</p>'), true, 'other text');

  assert.equal(await differ('<pre>a  b</pre>', '<pre>a b</pre>'), true, 'pre keeps spaces');
  assert.equal(await differ('<pre>a\nb</pre>', '<pre>a b</pre>'), true, 'pre keeps line breaks');
  assert.equal(await differ('<p style="white-space: pre-wrap">a  b</p>', '<p style="white-space: pre-wrap">a b</p>'), true, 'pre-wrap');
  const preLine = '<style>p { white-space: pre-line }</style>';
  assert.equal(await differ(`${preLine}<p>a\nb</p>`, `${preLine}<p>a b</p>`), true, 'pre-line keeps a line break');
  assert.equal(await same(`${preLine}<p>a  \t b</p>`, `${preLine}<p>a b</p>`), true, 'pre-line collapses spaces and tabs');
  assert.equal(await same(`${preLine}<p>a \n b</p>`, `${preLine}<p>a\nb</p>`), true, 'pre-line removes spaces around a line break');
  assert.equal(await same('<p>a<span style="white-space: pre">  </span>b</p>', '<p>a<span style="white-space: pre"> </span> b</p>'), false, 'a preserved run inside collapsing text');
});

test('the canonical text does not depend on where a line wraps', async () => {
  const split = `<div id="box"><p id="p">word </p></div><script>
    const p = document.getElementById('p');
    p.textContent = '';
    for (const part of ['aaaa bbbb ', 'cccc ', ' dddd ']) p.append(document.createTextNode(part));
    const b = document.createElement('b'); b.textContent = 'eeee'; p.append(b);
    p.append(document.createTextNode(' ffff gggg'));
  </script>`;
  const whole = '<div id="box"><p id="p">aaaa bbbb cccc dddd <b>eeee</b> ffff gggg</p></div>';
  const control = '<div id="box"><p id="p">aaaa bbbb cccc dddd<b>eeee</b> ffff gggg</p></div>';
  const narrow = (await capture(split, undefined, 90)).dom;
  const wide = (await capture(split, undefined, 1200)).dom;
  assert.deepEqual(narrow, wide, 'split text nodes at two widths');
  assert.deepEqual(narrow, (await capture(whole, undefined, 90)).dom, 'one text node, narrow');
  assert.deepEqual(wide, (await capture(whole, undefined, 1200)).dom, 'one text node, wide');
  assert.notDeepEqual((await capture(control, undefined, 90)).dom, narrow, 'control without the space, narrow');
  assert.notDeepEqual((await capture(control, undefined, 1200)).dom, wide, 'control without the space, wide');
});

test('style is compared as the declarations the browser parsed', async () => {
  assert.equal(await same('<p style="color: red; margin: 0">x</p>', '<p style="margin: 0; color: red">x</p>'), true, 'order');
  assert.equal(await same('<p style="font-weight: 600">x</p>', '<p style="font-weight:600;">x</p>'), true, 'spelling');
  assert.equal(await same('<p style="color: red">x</p>', '<p style="color: red; ">x</p>'), true, 'trailing semicolon');
  assert.equal(await same('<p>x</p>', '<p style="color: bogus; nonsense">x</p>'), true, 'declarations the browser dropped');
  assert.equal(await differ('<p style="color: red">x</p>', '<p style="color: blue">x</p>'), true, 'another value');
  assert.equal(await differ('<p style="color: red">x</p>', '<p style="color: red; margin: 0">x</p>'), true, 'another declaration');
  assert.equal(await differ('<p style="color: red">x</p>', '<p style="color: red !important">x</p>'), true, 'priority');
  const sheet = '<style>p { color: blue !important }</style>';
  assert.equal(await differ(`${sheet}<p style="color: red">x</p>`, `${sheet}<p style="color: green">x</p>`), true, 'same computed value');
  assert.equal(await differ('<p>x</p>', '<p style="color: red">x</p>'), true, 'a missing attribute');
  const node = (await dom('<p style="color: red; margin: 0 !important">x</p>')) as { children: { children: { inline: unknown; attrs?: unknown }[] }[] };
  const p = node.children[0].children[0];
  assert.deepEqual(p.inline, { color: '#ff0000', 'margin-top': '0px !important', 'margin-right': '0px !important', 'margin-bottom': '0px !important', 'margin-left': '0px !important' });
  assert.equal(p.attrs, undefined);
});

test('a textarea is compared by its value and has no text child', async () => {
  assert.equal(await differ('<textarea>a</textarea>', '<textarea>b</textarea>'), true, 'another value');
  assert.equal(await same('<textarea>a</textarea>', '<textarea></textarea><script>document.querySelector("textarea").value = "a"</script>'), true, 'text child against value');
  assert.equal(await differ('<textarea>a</textarea>', '<textarea>a</textarea><script>document.querySelector("textarea").value = "b"</script>'), true, 'the value is not the text child');
  const textarea = (await dom('<textarea>a</textarea>')) as { children: { children: { children?: unknown; props?: unknown }[] }[] };
  assert.equal(textarea.children[0].children[0].children, undefined);
  assert.deepEqual(textarea.children[0].children[0].props, { value: 'a' });
});

test('a boolean attribute loses its value only on an element that has that boolean property', async () => {
  assert.equal(await same('<input disabled>', '<input disabled="disabled">'), true, 'disabled');
  assert.equal(await same('<input readonly>', '<input readonly="readonly">'), true, 'readonly, with the property readOnly');
  assert.equal(await same('<button hidden>x</button>', '<button hidden="hidden">x</button>'), true, 'hidden');
  assert.equal(await differ('<span selected="1">x</span>', '<span selected="2">x</span>'), true, 'selected on a span');
  assert.equal(await differ('<vaadin-tabs selected="1"></vaadin-tabs>', '<vaadin-tabs selected="2"></vaadin-tabs>'), true, 'selected on a custom element');
  assert.equal(await differ('<span multiple="a">x</span>', '<span multiple="b">x</span>'), true, 'multiple on a span');
  assert.equal(await differ('<p hidden>x</p>', '<p hidden="until-found">x</p>'), true, 'hidden until-found');
});

const urlPages: Record<string, { head?: string; body?: string; css?: string }> = {
  none: {},
  'rel-sheet': { css: 'h1 { background-image: url("logo.png"); }' },
  'rootrel-sheet': { css: 'h1 { background-image: url("/img/logo.png"); }' },
  'rel-style-element': { head: '<style>h1 { background-image: url("logo.png"); }</style>' },
  'rel-style-attr': { body: '<h1 style="background-image: url(logo.png)">x</h1>' },
  data: { css: 'h1 { background-image: url("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"); }' },
  'third-origin': { css: 'h1 { background-image: url("http://third.test/logo.png"); }' },
  fragment: { css: 'h1 { filter: url("#soft"); }', body: '<svg width="0" height="0"><filter id="soft"><feGaussianBlur stdDeviation="0"/></filter></svg><h1>x</h1>' },
  'font-face': { css: '@font-face { font-family: "Probe"; src: url("probe.woff2"); } h1 { font-family: "Probe", sans-serif; }' },
  import: { css: '@import url("more.css"); h1 { color: red; }' },
  'custom-property': { css: 'h1 { --logo: url("logo.png"); }' },
  cursor: { css: 'h1 { cursor: url("cur.png"), auto; }' },
  'list-style-image': { css: 'ul { list-style-image: url("bullet.png"); }' },
  'before-content': { css: 'h1::before { content: url("icon.png"); }' },
};

async function captureOn(origin: string, page: { head?: string; body?: string; css?: string }) {
  const tab = await browser.newPage();
  try {
    await tab.route('**/*', async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/site.css') return route.fulfill({ contentType: 'text/css', body: page.css ?? '' });
      if (pathname === '/more.css') return route.fulfill({ contentType: 'text/css', body: 'h1 { letter-spacing: 1px }' });
      if (pathname !== '/') return route.fulfill({ status: 404, body: '' });
      const html = `<!doctype html><html><head><title>t</title>${page.css === undefined ? '' : '<link rel="stylesheet" href="/site.css">'}${page.head ?? ''}</head><body><ul><li>a</li></ul>${page.body ?? '<h1>x</h1>'}</body></html>`;
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    await tab.goto(`${origin}/`);
    await tab.waitForLoadState('load');
    return await tab.evaluate(capturePage);
  } finally {
    await tab.close();
  }
}

test('the origin of the page is taken out of url(), so the same pages compare equal on two origins', async () => {
  for (const [name, page] of Object.entries(urlPages)) {
    const first = await captureOn('http://one.test', page);
    const second = await captureOn('http://two.test:81', page);
    assert.deepEqual(second.style, first.style, name);
    assert.deepEqual(second.dom, first.dom, name);
  }
  const written = await captureOn('http://one.test', urlPages['rel-sheet']);
  assert.equal(written.style['html[1]/body[1]/h1[1]'].style['background-image'], 'url("[page-origin]/logo.png")');
});

test('a url() to another file or to another host is a difference', async () => {
  const at = (page: { css: string }, origin = 'http://one.test') => captureOn(origin, page);
  const first = await at({ css: 'h1 { background-image: url("logo.png"); }' });
  const file = await at({ css: 'h1 { background-image: url("other.png"); }' });
  const sameHost = await at({ css: 'h1 { background-image: url("http://one.test/logo.png"); }' });
  const otherHost = await at({ css: 'h1 { background-image: url("http://two.test:81/logo.png"); }' });
  const h1 = 'html[1]/body[1]/h1[1]';
  assert.notEqual(file.style[h1].style['background-image'], first.style[h1].style['background-image'], 'another file');
  assert.equal(sameHost.style[h1].style['background-image'], first.style[h1].style['background-image'], 'the same URL written in full');
  assert.notEqual(otherHost.style[h1].style['background-image'], first.style[h1].style['background-image'], 'the same path on another host');
  assert.equal(otherHost.style[h1].style['background-image'], 'url("http://two.test:81/logo.png")');
  const lookalike = await at({ css: 'h1 { background-image: url("http://one.test.example/logo.png"); }' });
  assert.equal(lookalike.style[h1].style['background-image'], 'url("http://one.test.example/logo.png")', 'a host that starts like the origin');
});

test('a url() in a style attribute compares equal when it is relative, or absolute on the own origin, on two origins', async () => {
  const inline = (url: string) => ({
    body: `<h1 style="background-image: url(${url}); --u: url('${url}'); cursor: url(${url}), auto">x</h1>`,
  });
  const relative = await captureOn('http://one.test', inline('/logo.png'));
  const ownOne = await captureOn('http://one.test', inline('http://one.test/logo.png'));
  const ownTwo = await captureOn('http://two.test:81', inline('http://two.test:81/logo.png'));
  const relativeTwo = await captureOn('http://two.test:81', inline('/logo.png'));
  const bare = await captureOn('http://two.test:81', inline('logo.png'));
  const node = (capture: typeof relative) => find(capture.dom, 'h1')[0];
  assert.deepEqual(node(ownTwo), node(ownOne), 'absolute on the own origin, two origins');
  assert.deepEqual(node(relative), node(ownTwo), 'relative against absolute on the own origin');
  assert.deepEqual(node(relativeTwo), node(ownOne), 'relative on the second origin');
  assert.deepEqual(node(bare), node(relative), 'a path without a slash on the root');
  const element = node(relative);
  assert.equal(element.inline?.['background-image'], 'url("[page-origin]/logo.png")');
  assert.equal(element.inline?.['--u'], 'url("[page-origin]/logo.png")');
  assert.equal(element.inline?.cursor, 'url("[page-origin]/logo.png"), auto');
  const otherHost = await captureOn('http://one.test', inline('http://two.test:81/logo.png'));
  const otherFile = await captureOn('http://one.test', inline('/other.png'));
  const lookalike = await captureOn('http://one.test', inline('http://one.test.example/logo.png'));
  assert.notDeepEqual(node(otherHost), node(relative), 'the same path on another host');
  assert.equal(node(otherHost).inline?.['background-image'], 'url("http://two.test:81/logo.png")');
  assert.notDeepEqual(node(otherFile), node(relative), 'another file');
  assert.equal(node(lookalike).inline?.['background-image'], 'url("http://one.test.example/logo.png")');
  const fragment = await captureOn('http://one.test', { body: '<h1 style="filter: url(#soft)">x</h1>' });
  assert.equal(node(fragment).inline?.filter, 'url("#soft")');
});

test('a custom property registered with inherits: false is compared per element', async () => {
  const page = (registration: string) => `
    <script>${registration}</script>
    <style>div { --tone: red } p { color: blue }</style>
    <div><p>x</p></div>`;
  const registered = await capture(page("CSS.registerProperty({ name: '--tone', syntax: '*', inherits: false });"));
  const plain = await capture(page(''));
  const rule = await capture(`<style>@property --tone { syntax: '*'; inherits: false }</style>${page('')}`);
  const child = 'html[1]/body[1]/div[1]/p[1]';
  assert.equal(plain.style[child].style['--tone'], undefined, 'inherited and unregistered: the parent value, so not listed');
  assert.equal(registered.style[child].style['--tone'], '', 'registered: missing on the child');
  assert.equal(rule.style[child].style['--tone'], '', 'registered with @property');
});

const ajs = (markup: string, modules = '') => `
  const root = document.getElementById('root');
  root.innerHTML = ${JSON.stringify(markup)};
  angular.module('app', [])${modules};
  angular.bootstrap(root, ['app']);`;

type Captured = Exclude<DomNode, string>;

function attributeNames(node: DomNode, names: string[] = []): string[] {
  if (typeof node === 'string') return names;
  names.push(...Object.keys(node.attrs ?? {}));
  for (const child of node.children ?? []) attributeNames(child, names);
  return names;
}

function find(node: DomNode, tag: string): Captured[] {
  if (typeof node === 'string') return [];
  return [...(node.tag === tag ? [node] : []), ...(node.children ?? []).flatMap((child) => find(child, tag))];
}

test('AngularJS: the binding prefixes have no directive and are dropped, any other ng- attribute stays', async () => {
  const markup = `<p ng-attr-title="{{'t'}}" data-ng-attr-lang="{{'en'}}" ng-prop-value="'v'" ng-on-click="n = 1" ng-foo="kept" data-ng-bar="x">x</p>`;
  const [p] = find(await dom('<div id="root"></div>', ajs(markup)), 'p');
  assert.deepEqual(p.attrs, { 'data-ng-bar': 'x', 'ng-foo': 'kept', lang: 'en', title: 't' });
});

test('AngularJS: the attributes that AngularJS reads without a directive of that name are dropped by a fixed list', async () => {
  const markup = `
    <p ng-repeat-start="i in [1, 2]" data-label="a">x</p><span ng-repeat-end>y</span>
    <input type="checkbox" ng-model="v" ng-true-value="'Y'" ng-false-value="'N'">
    <input ng-model="t" ng-trim="false" ng-ref-read="controller" ng-foo="kept">
    <div ng-switch="'a'"><i ng-switch-when="a" ng-switch-when-separator="|">z</i></div>
    <div ng-transclude-slot="s" ng-animate-ref="r"></div>`;
  const app = `${ajs(markup)}; root.setAttribute('ng-app', 'app'); root.setAttribute('ng-strict-di', ''); root.setAttribute('ng-csp', ''); root.setAttribute('data-ng-jq', 'jQuery');`;
  const tree = await dom('<div id="root"></div>', app);
  assert.deepEqual([...new Set(attributeNames(tree))].sort(), ['data-label', 'id', 'ng-foo', 'type']);
  assert.equal(find(tree, 'p').length, 2);
  assert.equal(find(tree, 'span').length, 2);
});

test('AngularJS: the bindings of a component and of an element directive are dropped', async () => {
  const markup = `<user-card user="u" on-pick="pick()" title="Mr" label="L"></user-card><status-pill level="warn" lang="en"></status-pill><p user="kept">x</p>`;
  const modules = `
    .component('userCard', { bindings: { user: '<', onPick: '&', title: '@', label: '@' }, template: '<b>card</b>' })
    .directive('statusPill', () => ({ restrict: 'E', scope: { level: '@', lang: '@' }, template: '<i>pill</i>' }))`;
  const tree = await dom('<div id="root"></div>', ajs(markup, modules));
  assert.deepEqual(find(tree, 'user-card')[0].attrs, { title: 'Mr' });
  assert.deepEqual(find(tree, 'status-pill')[0].attrs, { lang: 'en' });
  assert.deepEqual(find(tree, 'p')[0].attrs, { user: 'kept' });
});

test('AngularJS: a text binding keeps the attribute when the browser reads it, and the port has to have it', async () => {
  const names = ['class', 'viewBox', 'fill', 'stroke-width', 'itemprop', 'for', 'accept-charset'];
  const modules = `.directive('probe', () => ({
    restrict: 'A',
    scope: { a: '@class', b: '@viewBox', c: '@fill', d: '@strokeWidth', e: '@itemprop', f: '@for', g: '@acceptCharset' },
  }))`;
  const markup = (without?: string) => {
    const attr = (name: string, value: string) => (name === without ? '' : ` ${name}="${value}"`);
    return (
      `<label probe${attr('for', 'x')}${attr('class', 'k')}${attr('itemprop', 'i')}>l</label>` +
      `<svg probe${attr('viewBox', '0 0 1 1')}${attr('fill', 'red')}${attr('stroke-width', '2')}></svg>` +
      `<form probe${attr('accept-charset', 'utf-8')}></form>`
    );
  };
  const original = await dom('<div id="root"></div>', ajs(markup(), modules));
  const kept = attributeNames(original);
  for (const name of names) {
    assert.ok(kept.some((each) => each.toLowerCase() === name.toLowerCase()), `${name} stays`);
    const port = await dom('<div id="root"></div>', ajs(markup(name), modules));
    assert.notDeepEqual(port, original, `a port without ${name}`);
  }
  assert.ok(!kept.includes('probe'), 'the name of the directive is dropped');
});

test('AngularJS: required, pattern, maxlength and form stay, because the browser reads them', async () => {
  const markup = (attrs: string) => `<form id="f1"></form><input ${attrs} name="n"><button form="f1">go</button>`;
  const full = markup('required pattern="[a-z]+" maxlength="5"');
  const original = await dom('<div id="root"></div>', ajs(full));
  const [input] = find(original, 'input');
  assert.deepEqual(input.attrs, { maxlength: '5', name: 'n', pattern: '[a-z]+', required: '' });
  assert.deepEqual(find(original, 'button')[0].attrs, { form: 'f1' });
  const parts = ['required', 'pattern="[a-z]+"', 'maxlength="5"'];
  for (const without of parts) {
    const port = await dom('<div id="root"></div>', ajs(markup(parts.filter((part) => part !== without).join(' '))));
    assert.notDeepEqual(port, original, `a port without ${without}`);
  }
  const noForm = await dom('<div id="root"></div>', ajs(full.replace(' form="f1"', '').replace('<button form="f1">', '<button>')));
  assert.notDeepEqual(noForm, original, 'a port without form');
});

test('AngularJS: ng-readonly is read by a directive, the readonly attribute it writes is compared like any other', async () => {
  const original = await dom('<div id="root"></div>', ajs('<input ng-readonly="true" name="n">'));
  const port = await dom('<div id="root"><input readonly name="n"></div>');
  assert.deepEqual(find(original, 'input')[0].attrs, { name: 'n', readonly: '' });
  assert.deepEqual(find(port, 'input')[0].attrs, { name: 'n', readonly: '' });
});

test('text next to an atomic inline, an out-of-flow box, an element that is not rendered and inside SVG', async () => {
  const children = async (html: string) => {
    const body = (await dom(html)) as { children: { children: { children: unknown[] }[] }[] };
    return body.children[0].children[0].children;
  };
  assert.equal(await differ('<p>a <img alt="x"> b</p>', '<p>a <img alt="x">b</p>'), true, 'a space after an image is rendered');
  assert.equal(await differ('<p>a <img alt="x"> b</p>', '<p>a<img alt="x"> b</p>'), true, 'a space before an image is rendered');
  const floated = await children('<p>a <span style="position: absolute">x</span> b</p>');
  assert.deepEqual(floated[0], 'a ');
  assert.deepEqual(floated[2], 'b', 'an out-of-flow box does not break the line, so the second space collapses');
  const hidden = await children('<p>a <span style="display: none">x</span> b</p>');
  assert.deepEqual([hidden[0], hidden[2]], ['a ', 'b'], 'an element that is not rendered does not break the line');
  assert.equal(await same('<svg><text>a</text> <text>b</text></svg>', '<svg><text>a</text><text>b</text></svg>'), true, 'whitespace between SVG shapes is not rendered');
  const svg = (await children('<svg><text>a <tspan>b</tspan> c</text></svg>')) as { children: unknown[] }[];
  assert.deepEqual(svg[0].children, ['a ', { tag: 'tspan', children: ['b'] }, ' c']);
});

test('class tokens are compared as a sorted set', async () => {
  assert.equal(await same('<p class="b a">x</p>', '<p class="a b">x</p>'), true, 'order');
  assert.equal(await same('<p class="a  b\n a">x</p>', '<p class="a b">x</p>'), true, 'repeated tokens and spaces');
  assert.equal(await differ('<p class="a b">x</p>', '<p class="a c">x</p>'), true, 'another token');
});

test('an element with the id angular and a stored key named length are captured', async () => {
  const captured = await captureOn('http://one.test', {
    body: '<div id="angular">box</div><script>localStorage.setItem("length", "5"); localStorage.setItem("other", "o");</script>',
  });
  assert.deepEqual(captured.storage, { length: '5', other: 'o' });
  assert.ok(JSON.stringify(captured.dom).includes('"id":"angular"'));
});

test('ng-hide stays in the canonical DOM inside an AngularJS app, the classes that AngularJS adds go', async () => {
  const paragraph = async (classes: string) => find(await dom('<div id="root"></div>', ajs(`<p class="${classes}">x</p>`)), 'p')[0];
  assert.equal((await paragraph('ng-hide')).attrs?.class, 'ng-hide');
  assert.equal((await paragraph('ng-hide ng-binding')).attrs?.class, 'ng-hide');
  assert.equal((await paragraph('ng-binding')).attrs?.class, undefined);
});

test('required, role and tabindex are listed for the accessibility layer, and the value of an input is its property', async () => {
  const captured = await capture('<input id="a" type="text" required tabindex="2" role="searchbox" value="start"><script>document.getElementById("a").value = "typed"</script>');
  assert.deepEqual(captured.aria['html[1]/body[1]/input[1]'], { required: '', role: 'searchbox', tabindex: '2' });
  const [input] = find(captured.dom, 'input');
  assert.equal(input.attrs?.value, undefined);
  assert.equal(input.props?.value, 'typed');
});

test('script, style and link elements are no part of the canonical DOM, wherever they are', async () => {
  const ignored = '<script>window.mark = 1</script><style>p { color: red }</style><link rel="stylesheet" href="data:text/css,p{}">';
  assert.equal(await same('<p>x</p>', `<p>x</p>${ignored}`), true, 'in body');
  assert.equal(await same('<div><p>x</p></div>', `<div>${ignored}<p>x</p></div>`), true, 'in a div');
  assert.equal(await same('<p>x</p>', '<p>x</p><template>y</template>'), false, 'a template element is content');
});

test('text around each kind of box: a space next to a box that is drawn is kept, next to a box that is out of flow it is not', async () => {
  const around = async (element: string) => {
    const body = (await dom(`<section>a ${element} b</section>`)) as { children: { children: { children: unknown[] }[] }[] };
    const [first, , last] = body.children[0].children[0].children;
    return [first, last];
  };
  for (const out of [
    '<span style="float: left">x</span>',
    '<span style="float: right">x</span>',
    '<span style="position: absolute">x</span>',
    '<span style="position: fixed">x</span>',
  ]) {
    assert.deepEqual(await around(out), ['a ', 'b'], out);
  }
  for (const atom of [
    '<span style="display: inline-block">x</span>',
    '<span style="display: inline-flex">x</span>',
    '<span style="display: inline-grid">x</span>',
    '<img alt="x">',
    '<canvas></canvas>',
    '<video></video>',
    '<iframe></iframe>',
    '<object></object>',
    '<embed>',
    '<audio controls></audio>',
    '<math></math>',
    '<svg></svg>',
  ]) {
    assert.deepEqual(await around(atom), ['a ', ' b'], atom);
  }
  assert.deepEqual(await around('<span style="display: contents">x</span>'), ['a ', ' b'], 'contents belongs to the line');
  assert.deepEqual(await around('<ruby>x<rt>y</rt></ruby>'), ['a ', ' b'], 'ruby belongs to the line');
  assert.deepEqual(await around('<div>x</div>'), ['a', 'b'], 'a block ends the line');
  assert.deepEqual(await around('<span style="display: none">x</span>'), ['a ', 'b']);
});

test('text inside SVG: a nested svg is a block of its own, an a inside text is part of the text, and break-spaces is kept', async () => {
  const [outer] = find(await dom('<svg><text>a</text><svg></svg> <svg></svg><text>b</text></svg>'), 'svg');
  assert.deepEqual(
    (outer.children ?? []).map((child) => (typeof child === 'string' ? child : child.tag)),
    ['text', 'svg', 'svg', 'text'],
    'the space between two nested svg elements is not text',
  );
  const [text] = find(await dom('<svg><text>a <a>b</a> c</text></svg>'), 'text');
  assert.deepEqual(text.children, ['a ', { tag: 'a', children: ['b'] }, ' c']);
  const spaces = '<p style="white-space: break-spaces">a  b </p>';
  assert.deepEqual(find(await dom(spaces), 'p')[0].children, ['a  b ']);
  assert.equal(await differ(spaces, '<p style="white-space: break-spaces">a b</p>'), true);
});

test('the box of an element is captured to two decimals', async () => {
  const captured = await capture('<div style="margin: 0; width: 100.5px; height: 20.25px; position: absolute; left: 0.5px; top: 10.75px"></div>');
  assert.deepEqual(captured.style['html[1]/body[1]/div[1]'].box, { x: 0.5, y: 10.75, width: 100.5, height: 20.25 });
});

test('AngularJS: a directive counts only in the forms its restrict allows', async () => {
  const modules = `
    .directive('badge', () => ({ restrict: 'E', scope: { label: '<' } }))
    .directive('tip', () => ({ restrict: 'A', scope: { text: '<' } }))
    .directive('plain', () => ({ restrict: 'A', scope: { kind: '<' } }))
    .directive('boxed', () => ({ restrict: 'C', scope: { size: '<' } }))
    .directive('wide', () => ({ restrict: 'E', scope: { width: '<' } }))`;
  const markup = `
    <p id="a" badge label="L">x</p>
    <tip id="b" text="T">x</tip>
    <p id="c" class="plain" kind="K">x</p>
    <p id="d" class="boxed" size="3">x</p>
    <p id="e" wide width="9">x</p>
    <wide id="f" width="9"></wide>`;
  const tree = await dom('<div id="root"></div>', ajs(markup, modules));
  const byId = (id: string) => [...find(tree, 'p'), ...find(tree, 'tip'), ...find(tree, 'wide')].find((node) => node.attrs?.id === id)!.attrs;
  assert.deepEqual(byId('a'), { badge: '', id: 'a', label: 'L' }, 'an element directive is not active as an attribute');
  assert.deepEqual(byId('b'), { id: 'b', text: 'T' }, 'an attribute directive is not active as an element');
  assert.deepEqual(byId('c'), { class: 'plain', id: 'c', kind: 'K' }, 'an attribute directive is not active as a class');
  assert.deepEqual(byId('d'), { class: 'boxed', id: 'd' }, 'a class directive reads its bindings');
  assert.deepEqual(byId('e'), { id: 'e', wide: '', width: '9' });
  assert.deepEqual(byId('f'), { id: 'f' }, 'an element directive reads its bindings');
});

test('AngularJS: an attribute that one directive reads as text and another as an expression is dropped', async () => {
  for (const scope of ["{ a: '<title', b: '@title' }", "{ a: '@title', b: '<title' }"]) {
    const modules = `.directive('probe', () => ({ restrict: 'A', scope: ${scope} }))`;
    const [p] = find(await dom('<div id="root"></div>', ajs('<p probe title="T">x</p>', modules)), 'p');
    assert.deepEqual(p.attrs, undefined, scope);
  }
  const text = `.directive('probe', () => ({ restrict: 'A', scope: { a: '@title' } }))`;
  assert.deepEqual(find(await dom('<div id="root"></div>', ajs('<p probe title="T">x</p>', text)), 'p')[0].attrs, { title: 'T' });
});

test('AngularJS: every spelling of a directive name is read, with x, data, a colon, a dash or an underscore', async () => {
  const modules = `.directive('myProbe', () => ({ restrict: 'A' })).directive('probe', () => ({ restrict: 'A' }))`;
  const names = ['my-probe', 'my:probe', 'my_probe', 'x-my-probe', 'x:my:probe', 'x_my_probe', 'data-my-probe', 'data:my:probe', 'data_my_probe', 'x-probe', 'data-probe', 'probe'];
  const markup = names.map((name) => `<p ${name}="1" id="${name.replace(/[^a-z]/g, '')}${names.indexOf(name)}">x</p>`).join('');
  const tree = await dom('<div id="root"></div>', ajs(markup, modules));
  for (const p of find(tree, 'p')) assert.deepEqual(Object.keys(p.attrs ?? {}), ['id'], `${p.attrs?.id} keeps only its id`);
  assert.equal(find(tree, 'p').length, names.length);
});

test('AngularJS: a directive named like a method of the element does not make the attribute read by the browser', async () => {
  const modules = `.directive('focus', () => ({ restrict: 'A' })).directive('click', () => ({ restrict: 'A' })).directive('remove', () => ({ restrict: 'A' })).directive('scroll', () => ({ restrict: 'A' }))`;
  const tree = await dom('<div id="root"></div>', ajs('<input focus="1" name="n"><button click="a" remove="b" scroll="c" title="t">b</button>', modules));
  assert.deepEqual(find(tree, 'input')[0].attrs, { name: 'n' });
  assert.deepEqual(find(tree, 'button')[0].attrs, { title: 't' });
});

test('AngularJS: itemscope, exportparts, is and the SVG presentation attributes are read by the browser', async () => {
  const modules = `.directive('probe', () => ({
    restrict: 'A',
    scope: { a: '@itemscope', b: '@exportparts', c: '@is', d: '@stroke', e: '@opacity', f: '@textAnchor', g: '@fontSize' },
  }))`;
  const tree = await dom(
    '<div id="root"></div>',
    ajs('<div probe itemscope exportparts="x" is="y">d</div><svg><text probe stroke="red" opacity=".5" text-anchor="middle" font-size="9">t</text></svg>', modules),
  );
  assert.deepEqual(find(tree, 'div')[1].attrs, { exportparts: 'x', is: 'y', itemscope: '' });
  assert.deepEqual(find(tree, 'text')[0].attrs, { 'font-size': '9', opacity: '.5', stroke: 'red', 'text-anchor': 'middle' });
});

test('an element named angular that is no framework does not break the capture', async () => {
  const captured = await capture('<script>window.angular = { element: 5 }</script><p>x</p>');
  assert.deepEqual(find(captured.dom, 'p')[0].children, ['x']);
});

test('under pre-line a space is removed before a line break that starts the next text node, and not before text that ends with one', async () => {
  const preLine = '<style>section { white-space: pre-line }</style>';
  assert.equal(await same(`${preLine}<section><span>a </span><span>\nb</span></section>`, `${preLine}<section><span>a</span><span>\nb</span></section>`), true);
  assert.equal(await same(`${preLine}<section><span>a </span><b> \nb</b></section>`, `${preLine}<section><span>a</span><b>\nb</b></section>`), true);
  assert.equal(await differ(`${preLine}<section><b>a </b><b>x\n</b></section>`, `${preLine}<section><b>a</b><b>x\n</b></section>`), true, 'the space is before x');
  assert.equal(await same('<section><span>a </span><span style="white-space: pre">\nb</span></section>', '<section><span>a</span><span style="white-space: pre">\nb</span></section>'), true);
});

test('a colour in a style attribute compares as the colour the browser reads, however it is written', async () => {
  const colour = (value: string) => `<p style="${value}">x</p>`;
  assert.equal(await same(colour('color: red'), colour('color: #f00')), true, 'a keyword against short hex');
  assert.equal(await same(colour('color: red'), colour('color: rgb(255, 0, 0)')), true, 'a keyword against rgb');
  assert.equal(await same(colour('color: #ff0000'), colour('color: hsl(0 100% 50%)')), true, 'hex against hsl');
  assert.equal(await same(colour('border: 1px solid red'), colour('border: 1px solid #ff0000')), true, 'inside a shorthand');
  assert.equal(await same(colour('fill: red'), colour('fill: #f00')), true, 'fill');
  assert.equal(await same(colour('color: rgba(255, 0, 0, 0.5)'), colour('color: #ff000080')), true, 'with alpha');
  assert.equal(await differ(colour('color: red'), colour('color: #fe0000')), true, 'another colour');
  assert.equal(await differ(colour('color: red'), colour('color: red !important')), true, 'the priority still counts');
  assert.equal(await differ(colour('color: currentcolor'), colour('color: black')), true, 'currentcolor stays as written');
  assert.equal(await differ(colour('animation-name: red'), colour('animation-name: Red')), true, 'a name that looks like a colour is no colour');
  assert.equal(await differ(colour('color: inherit'), colour('color: red')), true, 'a keyword of CSS stays as written');
  assert.equal(await differ(colour('--c: red'), colour('--c: #f00')), true, 'a custom property is compared as written');
  assert.equal(await differ(colour('color: var(--c, red)'), colour('color: var(--c, #f00)')), true, 'a var() is compared as written');
});

test('custom properties of the computed style are stored in the order of their names, after the longhands', async () => {
  const names = Array.from({ length: 24 }, (_, at) => `--p${String(23 - at).padStart(2, '0')}`);
  const captured = await capture(`<style>p { ${names.map((name) => `${name}: 1`).join('; ')} }</style><p>x</p>`);
  const keys = Object.keys(captured.style['html[1]/body[1]/p[1]'].style);
  const custom = keys.filter((key) => key.startsWith('--'));
  assert.deepEqual(custom, [...names].sort());
  assert.equal(keys.findIndex((key) => key.startsWith('--')), keys.length - custom.length, 'the custom properties come last');
});
