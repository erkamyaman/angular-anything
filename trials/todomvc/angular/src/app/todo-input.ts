import { afterNextRender, Component, ElementRef, inject, input, output } from '@angular/core';

@Component({
  selector: 'input[data-testid=text-input]',
  template: '',
  host: {
    '[class]': "editing() ? 'edit' : 'new-todo'",
    '[attr.aria-label]': 'label()',
    '[attr.placeholder]': 'placeholder()',
    '(blur)': 'blur()',
    '(keydown)': 'keydown($event)',
  },
})
export class TodoInput {
  readonly label = input.required<string>({ alias: 'aria-label' });
  readonly placeholder = input<string | undefined>(undefined);
  readonly defaultValue = input<string | undefined>(undefined);
  readonly editing = input(false);
  readonly submitted = output<string>();
  readonly left = output<string>();
  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;

  constructor() {
    afterNextRender(() => {
      const value = this.defaultValue();
      if (value !== undefined) {
        this.element.value = value;
        this.element.defaultValue = value;
      }
      this.element.focus();
    });
  }

  blur() {
    this.left.emit(this.element.value.trim());
  }

  keydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    const value = this.element.value.trim();
    if (!this.editing() && value.length === 0) return;
    this.submitted.emit(value);
    if (!this.editing()) this.element.value = '';
  }
}
