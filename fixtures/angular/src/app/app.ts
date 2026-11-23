import { Component, ElementRef, ViewEncapsulation, computed, signal, viewChild } from '@angular/core';
import { bug } from './bug';
import { TaskRow, type Task } from './task-row';

type Filter = 'all' | 'active' | 'done';

declare global {
  interface Window {
    __aa?: { emit(name: string, payload: unknown): void };
  }
}

function loadTasks(): Task[] {
  const stored = localStorage.getItem('tasks');
  if (stored) return JSON.parse(stored);
  return [
    { id: 1, title: 'Buy milk', done: false },
    { id: 2, title: 'Write report', done: true },
  ];
}

@Component({
  selector: '[id=root]',
  imports: [TaskRow],
  encapsulation: ViewEncapsulation.None,
  template: `
    <main class="app">
      <h1>Tasks</h1>
      <form class="add" aria-label="Add task" (submit)="add($event)">
        <label for="new-task">New task</label>
        <input #input id="new-task" name="title" type="text" required>
        <button type="submit" class="btn btn-primary">Add</button>
      </form>
      <div class="filters" role="tablist" aria-label="Filter">
        @for (tab of tabs; track tab.filter) {
          <button type="button" role="tab" [attr.aria-selected]="filter() === tab.filter" class="tab" [class.is-active]="filter() === tab.filter" (click)="selectFilter(tab.filter)">{{ tab.label }}</button>
        }
      </div>
      <ul class="tasks" aria-label="Tasks">
        @for (task of visible(); track task.id) {
          <li class="task" [task]="task" (taskToggled)="toggle($event)" (taskDeleted)="remove($event)"></li>
        }
      </ul>
      <p class="count" aria-live="polite">{{ count() }}</p>
      <button type="button" class="btn details-toggle" [attr.aria-expanded]="expanded() && bug !== 'aria'" aria-controls="details" (click)="expanded.set(!expanded())">Details</button>
      <section id="details" class="details" [hidden]="!expanded()">
        <p>Tasks are stored in this browser.</p>
      </section>
      <button type="button" class="btn load" [disabled]="loading()" [attr.aria-busy]="loading() ? 'true' : null" (click)="loadSuggestions()">Load suggestions</button>
      <ul class="suggestions" aria-label="Suggestions">
        @for (suggestion of suggestions(); track suggestion) {
          <li>{{ suggestion }}</li>
        }
      </ul>
      <div class="toast" role="status">{{ toast() }}</div>
    </main>
  `,
})
export class App {
  protected readonly bug = bug;
  protected readonly tabs: { filter: Filter; label: string }[] = [
    { filter: 'all', label: 'All' },
    { filter: 'active', label: 'Active' },
    { filter: 'done', label: 'Done' },
  ];

  protected readonly tasks = signal(loadTasks());
  protected readonly filter = signal<Filter>('all');
  protected readonly expanded = signal(false);
  protected readonly loading = signal(false);
  protected readonly suggestions = signal<string[]>([]);
  protected readonly toast = signal('');

  protected readonly visible = computed(() => {
    const filter = this.filter();
    return this.tasks().filter((task) => filter === 'all' || task.done === (filter === 'done'));
  });
  protected readonly count = computed(() => {
    const left = this.tasks().filter((task) => !task.done).length;
    return `${left} ${left === 1 && bug !== 'text' ? 'task' : 'tasks'} left`;
  });

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private toastTimer?: number;

  constructor() {
    if (bug === 'style') {
      const style = document.createElement('style');
      style.textContent = '.count { margin-left: 3px; }';
      document.head.append(style);
    }
  }

  protected add(event: Event): void {
    event.preventDefault();
    const input = this.input().nativeElement;
    const title = input.value.trim();
    if (!title) return;
    const id = Math.max(0, ...this.tasks().map((task) => task.id)) + 1;
    this.save([...this.tasks(), { id, title, done: false }]);
    input.value = '';
    input.focus();
    fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bug === 'request' ? {} : { title }),
    });
    this.toast.set('Task added');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 2000);
    window.__aa?.emit('taskAdded', { id, title });
  }

  protected toggle(event: { id: number; done: boolean }): void {
    this.save(this.tasks().map((task) => (task.id === event.id ? { ...task, done: event.done } : task)));
    window.__aa?.emit('taskToggled', event);
    if (bug === 'double-event') window.__aa?.emit('taskToggled', event);
  }

  protected remove(event: { id: number }): void {
    this.save(this.tasks().filter((task) => task.id !== event.id));
    if (bug !== 'focus') this.input().nativeElement.focus();
    window.__aa?.emit('taskDeleted', event);
  }

  protected selectFilter(filter: Filter): void {
    this.filter.set(filter);
    window.__aa?.emit('filterChanged', { filter });
  }

  protected async loadSuggestions(): Promise<void> {
    this.loading.set(true);
    const response = await fetch('/api/suggestions');
    this.suggestions.set(await response.json());
    this.loading.set(false);
  }

  private save(tasks: Task[]): void {
    this.tasks.set(tasks);
    if (bug !== 'storage') localStorage.setItem('tasks', JSON.stringify(tasks));
  }
}
