(function () {
  'use strict';

  class TasksAppController {
    static $inject = ['$http', '$timeout'];

    constructor($http, $timeout) {
      this.$http = $http;
      this.$timeout = $timeout;
      this.tasks = JSON.parse(localStorage.getItem('tasks')) || [
        { id: 1, title: 'Buy milk', done: false },
        { id: 2, title: 'Write report', done: true },
      ];
      this.title = '';
      this.filter = 'all';
      this.open = false;
      this.loading = false;
      this.suggestions = [];
      this.toast = '';
    }

    visible() {
      return this.tasks.filter((task) => this.filter === 'all' || task.done === (this.filter === 'done'));
    }

    count() {
      const left = this.tasks.filter((task) => !task.done).length;
      return left === 1 ? '1 task left' : left + ' tasks left';
    }

    save() {
      localStorage.setItem('tasks', JSON.stringify(this.tasks));
    }

    add() {
      const title = (this.title || '').trim();
      if (!title) return;
      const id = Math.max(0, ...this.tasks.map((task) => task.id)) + 1;
      this.tasks.push({ id, title, done: false });
      this.save();
      this.title = '';
      document.getElementById('new-task').focus();
      this.$http.post('/api/tasks', { title });
      this.toast = 'Task added';
      this.$timeout.cancel(this.toastTimer);
      this.toastTimer = this.$timeout(() => {
        this.toast = '';
      }, 2000);
      window.__aa?.emit('taskAdded', { id, title });
    }

    toggle(task) {
      task.done = !task.done;
      this.save();
      window.__aa?.emit('taskToggled', { id: task.id, done: task.done });
    }

    remove(task) {
      this.tasks.splice(this.tasks.indexOf(task), 1);
      this.save();
      document.getElementById('new-task').focus();
      window.__aa?.emit('taskDeleted', { id: task.id });
    }

    setFilter(filter) {
      this.filter = filter;
      window.__aa?.emit('filterChanged', { filter });
    }

    load() {
      this.loading = true;
      this.$http.get('/api/suggestions').then((response) => {
        this.suggestions = response.data;
        this.loading = false;
      });
    }
  }

  const appTemplate = [
    '<main class="app">',
    '<h1>Tasks</h1>',
    '<form class="add" aria-label="Add task" ng-submit="$ctrl.add()">',
    '<label for="new-task">New task</label>',
    '<input id="new-task" name="title" type="text" required ng-model="$ctrl.title">',
    '<button type="submit" class="btn btn-primary">Add</button>',
    '</form>',
    '<div class="filters" role="tablist" aria-label="Filter">',
    `<button type="button" role="tab" aria-selected="{{$ctrl.filter === 'all'}}" class="tab" ng-class="{'is-active': $ctrl.filter === 'all'}" ng-click="$ctrl.setFilter('all')">All</button>`,
    `<button type="button" role="tab" aria-selected="{{$ctrl.filter === 'active'}}" class="tab" ng-class="{'is-active': $ctrl.filter === 'active'}" ng-click="$ctrl.setFilter('active')">Active</button>`,
    `<button type="button" role="tab" aria-selected="{{$ctrl.filter === 'done'}}" class="tab" ng-class="{'is-active': $ctrl.filter === 'done'}" ng-click="$ctrl.setFilter('done')">Done</button>`,
    '</div>',
    '<ul class="tasks" aria-label="Tasks">',
    `<li class="task" ng-class="{'is-done': task.done}" ng-repeat="task in $ctrl.visible() track by task.id" task-row task="task" on-toggle="$ctrl.toggle(task)" on-delete="$ctrl.remove(task)"></li>`,
    '</ul>',
    '<p class="count" aria-live="polite">{{$ctrl.count()}}</p>',
    '<button type="button" class="btn details-toggle" aria-expanded="{{$ctrl.open}}" aria-controls="details" ng-click="$ctrl.open = !$ctrl.open">Details</button>',
    `<section id="details" class="details" ng-attr-hidden="{{$ctrl.open ? undefined : ''}}">`,
    '<p>Tasks are stored in this browser.</p>',
    '</section>',
    '<button type="button" class="btn load" ng-disabled="$ctrl.loading" ng-attr-aria-busy="{{$ctrl.loading || undefined}}" ng-click="$ctrl.load()">Load suggestions</button>',
    '<ul class="suggestions" aria-label="Suggestions">',
    '<li ng-repeat="suggestion in $ctrl.suggestions">{{suggestion}}</li>',
    '</ul>',
    '<div class="toast" role="status">{{$ctrl.toast}}</div>',
    '</main>',
  ].join('');

  const rowTemplate = [
    '<input type="checkbox" id="task-{{$ctrl.task.id}}" ng-checked="$ctrl.task.done" ng-click="$ctrl.onToggle()">',
    '<label for="task-{{$ctrl.task.id}}">{{$ctrl.task.title}}</label>',
    '<button type="button" class="btn btn-icon" aria-label="Delete {{$ctrl.task.title}}" ng-click="$ctrl.onDelete()">×</button>',
  ].join('');

  angular
    .module('tasks', [])
    .directive('tasksApp', function () {
      return {
        restrict: 'A',
        scope: {},
        controller: TasksAppController,
        controllerAs: '$ctrl',
        template: appTemplate,
      };
    })
    .directive('taskRow', function () {
      return {
        restrict: 'A',
        scope: {},
        bindToController: { task: '<', onToggle: '&', onDelete: '&' },
        controller: function () {},
        controllerAs: '$ctrl',
        template: rowTemplate,
      };
    });

  const root = document.getElementById('root');
  root.setAttribute('tasks-app', '');
  angular.bootstrap(root, ['tasks'], { strictDi: true });
})();
