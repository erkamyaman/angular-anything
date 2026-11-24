import type { ExternalToast, PromiseData, PromiseIExtendedResult, PromiseT, ToastT, ToastToDismiss, ToastTypes, Title } from './types';

let toastsCounter = 1;

const MAX_HISTORY_SIZE = 100;

const getToastId = (data?: { id?: number | string }) => {
  return typeof data?.id === 'number' || (typeof data?.id === 'string' && data.id.length > 0) ? data.id : toastsCounter++;
};

class Observer {
  subscribers: Array<(toast: ToastT | ToastToDismiss) => void> = [];
  toasts: Array<ToastT | ToastToDismiss> = [];
  dismissedToasts = new Set<string | number>();
  private pendingDismissals = new Map<string | number, number>();

  subscribe = (subscriber: (toast: ToastT | ToastToDismiss) => void) => {
    this.subscribers.push(subscriber);
    this.getActiveToasts().forEach((toast) => subscriber(toast as ToastT));
    return () => {
      const index = this.subscribers.indexOf(subscriber);
      this.subscribers.splice(index, 1);
    };
  };

  publish = (data: ToastT) => {
    this.subscribers.forEach((subscriber) => subscriber(data));
  };

  addToast = (data: ToastT) => {
    this.publish(data);
    this.toasts = [...this.toasts, data];
    this.trimHistory();
  };

  private trimHistory = () => {
    let toRemove = this.toasts.length - MAX_HISTORY_SIZE;
    if (toRemove <= 0) return;
    this.toasts = this.toasts.filter((toast) => {
      if (toRemove > 0 && this.dismissedToasts.has(toast.id)) {
        this.dismissedToasts.delete(toast.id);
        toRemove--;
        return false;
      }
      return true;
    });
  };

  create = (data: ExternalToast & { message?: Title; type?: ToastTypes; promise?: PromiseT }) => {
    const { message, ...rest } = data;
    const id = getToastId(data);

    const pendingDismissal = this.pendingDismissals.get(id);
    if (pendingDismissal !== undefined) {
      cancelAnimationFrame(pendingDismissal);
      this.pendingDismissals.delete(id);
      this.dismissedToasts.delete(id);
    }

    const wasDismissed = this.dismissedToasts.has(id);
    const dismissible = data.dismissible === undefined ? true : data.dismissible;

    if (wasDismissed) {
      this.dismissedToasts.delete(id);
      this.toasts = this.toasts.filter((toast) => toast.id !== id);
    }

    const alreadyExists = wasDismissed ? undefined : this.toasts.find((toast) => toast.id === id);

    if (alreadyExists) {
      this.toasts = this.toasts.map((toast) => {
        if (toast.id === id) {
          this.publish({ ...toast, ...data, id, title: message } as ToastT);
          return { ...toast, ...data, id, dismissible, title: message } as ToastT;
        }
        return toast;
      });
    } else {
      this.addToast({ title: message, ...rest, dismissible, id } as ToastT);
    }

    return id;
  };

  dismiss = (id?: number | string) => {
    if (id === undefined || id === null) {
      this.getActiveToasts().forEach((toast) => {
        this.dismissedToasts.add(toast.id);
        this.subscribers.forEach((subscriber) => subscriber({ id: toast.id, dismiss: true }));
      });
      return id;
    }

    this.dismissedToasts.add(id);
    const alreadyPending = this.pendingDismissals.get(id);
    if (alreadyPending !== undefined) cancelAnimationFrame(alreadyPending);
    this.pendingDismissals.set(
      id,
      requestAnimationFrame(() => {
        this.pendingDismissals.delete(id);
        this.subscribers.forEach((subscriber) => subscriber({ id, dismiss: true }));
      }),
    );
    return id;
  };

  message = (message: Title, data?: ExternalToast) => this.create({ ...data, message, type: undefined });
  error = (message: Title, data?: ExternalToast) => this.create({ ...data, message, type: 'error' });
  success = (message: Title, data?: ExternalToast) => this.create({ ...data, type: 'success', message });
  info = (message: Title, data?: ExternalToast) => this.create({ ...data, type: 'info', message });
  warning = (message: Title, data?: ExternalToast) => this.create({ ...data, type: 'warning', message });
  loading = (message: Title, data?: ExternalToast) => this.create({ ...data, type: 'loading', message });

  promise = <ToastData>(promise: PromiseT<ToastData>, data?: PromiseData<ToastData>) => {
    if (!data) return;

    let id: string | number | undefined = undefined;
    if (data.loading !== undefined) {
      id = this.create({
        ...data,
        promise,
        type: 'loading',
        message: data.loading,
        description: typeof data.description !== 'function' ? (data.description as Title | undefined) : undefined,
      });
    }

    const p = Promise.resolve(promise instanceof Function ? promise() : promise);
    let shouldDismiss = id !== undefined;
    let result: ['resolve', ToastData] | ['reject', unknown];

    const settled = async (type: 'error' | 'success', handler: unknown, value: unknown) => {
      const promiseData = typeof handler === 'function' ? await handler(value) : handler;
      const description = typeof data.description === 'function' ? await data.description(value) : data.description;
      const toastSettings: PromiseIExtendedResult =
        typeof promiseData === 'object' && promiseData !== null ? (promiseData as PromiseIExtendedResult) : { message: promiseData as Title };
      this.create({ id, type, description: description as Title | undefined, ...toastSettings });
    };

    const originalPromise = p
      .then(async (response) => {
        result = ['resolve', response];
        if (isHttpResponse(response) && !response.ok) {
          shouldDismiss = false;
          await settled('error', data.error, `HTTP error! status: ${response.status}`);
        } else if (response instanceof Error) {
          shouldDismiss = false;
          await settled('error', data.error, response);
        } else if (data.success !== undefined) {
          shouldDismiss = false;
          await settled('success', data.success, response);
        }
      })
      .catch(async (error) => {
        result = ['reject', error];
        if (data.error !== undefined) {
          shouldDismiss = false;
          await settled('error', data.error, error);
        }
      })
      .finally(() => {
        if (shouldDismiss) {
          this.dismiss(id);
          id = undefined;
        }
        data.finally?.();
      });

    const unwrap = () =>
      new Promise<ToastData>((resolve, reject) =>
        originalPromise.then(() => (result[0] === 'reject' ? reject(result[1]) : resolve(result[1]))).catch(reject),
      );

    if (typeof id !== 'string' && typeof id !== 'number') return { unwrap };
    return Object.assign(id, { unwrap });
  };

  getActiveToasts = () => this.toasts.filter((toast) => !this.dismissedToasts.has(toast.id));
}

export const ToastState = new Observer();

const isHttpResponse = (data: any): data is Response =>
  data && typeof data === 'object' && 'ok' in data && typeof data.ok === 'boolean' && 'status' in data && typeof data.status === 'number';

const basicToast = (message: Title, data?: ExternalToast) => ToastState.message(message, data);

export const toast = Object.assign(
  basicToast,
  {
    success: ToastState.success,
    info: ToastState.info,
    warning: ToastState.warning,
    error: ToastState.error,
    message: ToastState.message,
    promise: ToastState.promise,
    dismiss: ToastState.dismiss,
    loading: ToastState.loading,
  },
  { getHistory: () => ToastState.toasts, getToasts: () => ToastState.getActiveToasts() },
);
