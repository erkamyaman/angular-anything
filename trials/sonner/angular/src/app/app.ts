import { Component } from '@angular/core';
import { toast, Toaster } from '../sonner/sonner';

const emit = (name: string, payload: unknown) => (window as { __aa?: { emit(name: string, payload: unknown): void } }).__aa?.emit(name, payload);

const save = () =>
  fetch('/api/save', { method: 'POST' }).then((response) => {
    if (!response.ok) throw new Error('failed');
    return response.json() as Promise<{ name: string }>;
  });

@Component({
  selector: '[id=root]',
  imports: [Toaster],
  template: `<main class="demo"><h1>Toasts</h1><div class="buttons"><button type="button" (click)="plain()">Default</button><button type="button" (click)="described()">Description</button><button type="button" (click)="success()">Success</button><button type="button" (click)="error()">Error</button><button type="button" (click)="withAction()">Action</button><button type="button" (click)="closable()">Close button</button><button type="button" (click)="promised()">Promise</button><button type="button" (click)="dismissAll()">Dismiss all</button></div><ngx-toaster></ngx-toaster></main>`,
})
export class App {
  protected plain() {
    toast('Event has been created');
  }

  protected described() {
    toast('Event has been created', { description: 'Monday, January 3rd at 6:00pm' });
  }

  protected success() {
    toast.success('Event has been saved');
  }

  protected error() {
    toast.error('Event could not be saved');
  }

  protected withAction() {
    toast('Event has been deleted', { action: { label: 'Undo', onClick: () => emit('undo', { at: Date.now() }) } });
  }

  protected closable() {
    toast('You can close this', { closeButton: true, onDismiss: () => emit('dismissed', {}) });
  }

  protected promised() {
    toast.promise(save, { loading: 'Saving...', success: (data: { name: string }) => `Saved ${data.name}`, error: 'Could not save' });
  }

  protected dismissAll() {
    toast.dismiss();
  }
}
