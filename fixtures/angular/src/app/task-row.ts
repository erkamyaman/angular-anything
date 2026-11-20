import { Component, ViewEncapsulation, input, output } from '@angular/core';
import { bug } from './bug';

export interface Task {
  id: number;
  title: string;
  done: boolean;
}

@Component({
  selector: 'li[appTaskRow]',
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'task',
    '[class.is-done]': "task().done && bug !== 'missing-class'",
  },
  template: `
    <input type="checkbox" id="task-{{ task().id }}" [checked]="task().done" (change)="taskToggled.emit({ id: task().id, done: !task().done })">
    <label for="task-{{ task().id }}">{{ task().title }}</label>
    <button type="button" class="btn btn-icon" [attr.aria-label]="'Delete ' + task().title" (click)="taskDeleted.emit({ id: task().id })">×</button>
  `,
})
export class TaskRow {
  readonly task = input.required<Task>({ alias: 'appTaskRow' });
  readonly taskToggled = output<{ id: number; done: boolean }>();
  readonly taskDeleted = output<{ id: number }>();

  protected readonly bug = bug;
}
