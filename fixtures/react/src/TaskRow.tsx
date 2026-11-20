export type Task = { id: number; title: string; done: boolean };

type Props = {
  task: Task;
  onToggle: (id: number, done: boolean) => void;
  onDelete: (id: number) => void;
};

export function TaskRow({ task, onToggle, onDelete }: Props) {
  const id = `task-${task.id}`;
  return (
    <li className={task.done ? 'task is-done' : 'task'}>
      <input type="checkbox" id={id} checked={task.done} onChange={() => onToggle(task.id, !task.done)} />
      <label htmlFor={id}>{task.title}</label>
      <button
        type="button"
        className="btn btn-icon"
        aria-label={`Delete ${task.title}`}
        onClick={() => onDelete(task.id)}
      >
        ×
      </button>
    </li>
  );
}
