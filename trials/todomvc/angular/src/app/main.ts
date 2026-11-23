import { Component, computed, inject } from '@angular/core';
import { Item } from './item';
import { Todos } from './todos';

@Component({
  selector: 'main[data-testid=main]',
  imports: [Item],
  host: { '[hidden]': 'todos.list().length === 0' },
  template: `<div class="toggle-all-container"><input class="toggle-all" type="checkbox" id="toggle-all" data-testid="toggle-all" [checked]="allDone()" (change)="toggleAll($event)"><label class="toggle-all-label" for="toggle-all">Toggle All Input</label></div><ul class="todo-list" data-testid="todo-list">@for (todo of todos.visible(); track todo.id) {<li data-testid="todo-item" [todo]="todo"></li>}</ul>`,
})
export class Main {
  protected readonly todos = inject(Todos);
  protected readonly allDone = computed(() => this.todos.visible().length > 0 && this.todos.visible().every((todo) => todo.completed));

  protected toggleAll(event: Event) {
    this.todos.toggleAll((event.target as HTMLInputElement).checked);
  }
}
