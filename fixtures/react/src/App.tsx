import { type SubmitEvent, useRef, useState } from 'react';
import { type Task, TaskRow } from './TaskRow';

type Filter = 'all' | 'active' | 'done';

declare global {
  interface Window {
    __aa?: { emit(name: string, payload: unknown): void };
  }
}

const filters: [Filter, string][] = [
  ['all', 'All'],
  ['active', 'Active'],
  ['done', 'Done'],
];

function loadTasks(): Task[] {
  const stored = localStorage.getItem('tasks');
  if (stored) return JSON.parse(stored);
  return [
    { id: 1, title: 'Buy milk', done: false },
    { id: 2, title: 'Write report', done: true },
  ];
}

export function App() {
  const [tasks, setTasks] = useState(loadTasks);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number>(undefined);

  const visible = tasks.filter((task) => filter === 'all' || task.done === (filter === 'done'));
  const left = tasks.filter((task) => !task.done).length;

  function save(next: Task[]) {
    setTasks(next);
    localStorage.setItem('tasks', JSON.stringify(next));
  }

  function add(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = inputRef.current!;
    const title = input.value.trim();
    if (!title) return;
    const id = Math.max(0, ...tasks.map((task) => task.id)) + 1;
    save([...tasks, { id, title, done: false }]);
    input.value = '';
    input.focus();
    fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    setToast('Task added');
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2000);
    window.__aa?.emit('taskAdded', { id, title });
  }

  function toggle(id: number, done: boolean) {
    save(tasks.map((task) => (task.id === id ? { ...task, done } : task)));
    window.__aa?.emit('taskToggled', { id, done });
  }

  function remove(id: number) {
    save(tasks.filter((task) => task.id !== id));
    inputRef.current!.focus();
    window.__aa?.emit('taskDeleted', { id });
  }

  function selectFilter(next: Filter) {
    setFilter(next);
    window.__aa?.emit('filterChanged', { filter: next });
  }

  async function loadSuggestions() {
    setLoading(true);
    const response = await fetch('/api/suggestions');
    setSuggestions(await response.json());
    setLoading(false);
  }

  return (
    <main className="app">
      <h1>Tasks</h1>
      <form className="add" aria-label="Add task" onSubmit={add}>
        <label htmlFor="new-task">New task</label>
        <input ref={inputRef} id="new-task" name="title" type="text" required />
        <button type="submit" className="btn btn-primary">
          Add
        </button>
      </form>
      <div className="filters" role="tablist" aria-label="Filter">
        {filters.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            className={filter === value ? 'tab is-active' : 'tab'}
            onClick={() => selectFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="tasks" aria-label="Tasks">
        {visible.map((task) => (
          <TaskRow key={task.id} task={task} onToggle={toggle} onDelete={remove} />
        ))}
      </ul>
      <p className="count" aria-live="polite">{`${left} ${left === 1 ? 'task' : 'tasks'} left`}</p>
      <button
        type="button"
        className="btn details-toggle"
        aria-expanded={expanded}
        aria-controls="details"
        onClick={() => setExpanded(!expanded)}
      >
        Details
      </button>
      <section id="details" className="details" hidden={!expanded}>
        <p>Tasks are stored in this browser.</p>
      </section>
      <button
        type="button"
        className="btn load"
        disabled={loading}
        aria-busy={loading || undefined}
        onClick={loadSuggestions}
      >
        Load suggestions
      </button>
      <ul className="suggestions" aria-label="Suggestions">
        {suggestions.map((suggestion) => (
          <li key={suggestion}>{suggestion}</li>
        ))}
      </ul>
      <div className="toast" role="status">{toast}</div>
    </main>
  );
}
