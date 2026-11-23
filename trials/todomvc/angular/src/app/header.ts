import { Component, inject } from '@angular/core';
import { TodoInput } from './todo-input';
import { Todos } from './todos';

@Component({
  selector: 'header[data-testid=header]',
  imports: [TodoInput],
  template: `<h1>todos</h1><input type="text" data-testid="text-input" aria-label="New Todo Input" placeholder="What needs to be done?" (submitted)="todos.add($event)">`,
})
export class Header {
  protected readonly todos = inject(Todos);
}
