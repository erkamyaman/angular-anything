import { Component, inject } from '@angular/core';
import { Todos } from './todos';

@Component({
  selector: 'footer[data-testid=footer]',
  host: { '[hidden]': 'todos.list().length === 0' },
  template: `<span class="todo-count">{{ todos.active().length }} {{ todos.active().length === 1 ? 'item' : 'items' }} left!</span><ul class="filters" data-testid="footer-navigation"><li><a [attr.class]="selected('/')" href="#/">All</a></li><li><a [attr.class]="selected('/active')" href="#/active">Active</a></li><li><a [attr.class]="selected('/completed')" href="#/completed">Completed</a></li></ul><button class="clear-completed" [hidden]="todos.completedCount() === 0" (click)="todos.removeCompleted()">Clear completed</button>`,
})
export class Footer {
  protected readonly todos = inject(Todos);

  protected selected(route: string) {
    return this.todos.route() === route ? 'selected' : '';
  }
}
