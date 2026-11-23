import { Component, inject, input, signal } from '@angular/core';
import { TodoInput } from './todo-input';
import { Todo, Todos } from './todos';

@Component({
  selector: 'li[data-testid=todo-item]',
  imports: [TodoInput],
  host: { '[attr.class]': 'classes()' },
  template: `<div class="view"><input class="toggle" type="checkbox" data-testid="todo-item-toggle" [checked]="todo().completed" (change)="todos.toggle(todo().id)"><label data-testid="todo-item-label" (dblclick)="writable.set(true)">{{ todo().title }}</label><button class="destroy" data-testid="todo-item-button" aria-label="Delete todo" (click)="todos.remove(todo().id)"></button></div>@if (writable()) {<input type="text" data-testid="text-input" aria-label="Edit todo" [editing]="true" [defaultValue]="todo().title" (submitted)="commit($event)" (left)="commit($event)">}`,
})
export class Item {
  readonly todo = input.required<Todo>();
  protected readonly todos = inject(Todos);
  protected readonly writable = signal(false);

  protected classes() {
    return [this.todo().completed ? 'completed' : '', this.writable() ? 'editing' : ''].filter(Boolean).join(' ');
  }

  protected commit(title: string) {
    if (!this.writable()) return;
    this.writable.set(false);
    if (title.length === 0) this.todos.remove(this.todo().id);
    else this.todos.update(this.todo().id, title);
  }
}
