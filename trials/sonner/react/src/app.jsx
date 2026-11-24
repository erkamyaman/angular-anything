import { Toaster, toast } from 'sonner';

const emit = (name, payload) => window.__aa?.emit(name, payload);

const save = () =>
  fetch('/api/save', { method: 'POST' }).then((response) => {
    if (!response.ok) throw new Error('failed');
    return response.json();
  });

export function App() {
  return (
    <main className="demo">
      <h1>Toasts</h1>
      <div className="buttons">
        <button type="button" onClick={() => toast('Event has been created')}>Default</button>
        <button type="button" onClick={() => toast('Event has been created', { description: 'Monday, January 3rd at 6:00pm' })}>Description</button>
        <button type="button" onClick={() => toast.success('Event has been saved')}>Success</button>
        <button type="button" onClick={() => toast.error('Event could not be saved')}>Error</button>
        <button type="button" onClick={() => toast('Event has been deleted', { action: { label: 'Undo', onClick: () => emit('undo', { at: Date.now() }) } })}>Action</button>
        <button type="button" onClick={() => toast('You can close this', { closeButton: true, onDismiss: () => emit('dismissed', {}) })}>Close button</button>
        <button type="button" onClick={() => toast.promise(save, { loading: 'Saving...', success: (data) => `Saved ${data.name}`, error: 'Could not save' })}>Promise</button>
        <button type="button" onClick={() => toast.dismiss()}>Dismiss all</button>
      </div>
      <Toaster />
    </main>
  );
}
