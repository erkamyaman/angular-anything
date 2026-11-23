import { computed, Service, signal } from '@angular/core';

export type Todo = { id: string; title: string; completed: boolean };

const urlAlphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

function nanoid(size = 21): string {
  let id = '';
  let i = size;
  while (i--) id += urlAlphabet[(Math.random() * 64) | 0];
  return id;
}

const routeOf = () => location.hash.replace(/^#/, '').replace(/[?#].*$/, '') || '/';

@Service()
export class Todos {
  readonly list = signal<Todo[]>([]);
  readonly route = signal(routeOf());
  readonly active = computed(() => this.list().filter((todo) => !todo.completed));
  readonly completedCount = computed(() => this.list().length - this.active().length);
  readonly visible = computed(() => {
    const route = this.route();
    return this.list().filter((todo) => (route === '/active' ? !todo.completed : route === '/completed' ? todo.completed : true));
  });

  constructor() {
    window.addEventListener('popstate', () => this.route.set(routeOf()));
  }

  add(title: string) {
    this.list.update((list) => list.concat({ id: nanoid(), title, completed: false }));
  }

  update(id: string, title: string) {
    this.list.update((list) => list.map((todo) => (todo.id === id ? { ...todo, title } : todo)));
  }

  remove(id: string) {
    this.list.update((list) => list.filter((todo) => todo.id !== id));
  }

  toggle(id: string) {
    this.list.update((list) => list.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)));
  }

  toggleAll(completed: boolean) {
    this.list.update((list) => list.map((todo) => (todo.completed !== completed ? { ...todo, completed } : todo)));
  }

  removeCompleted() {
    this.list.update((list) => list.filter((todo) => !todo.completed));
  }
}
