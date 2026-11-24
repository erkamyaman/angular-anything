export type ToastTypes = 'normal' | 'action' | 'success' | 'info' | 'warning' | 'error' | 'loading' | 'default';

export type Title = string | (() => string);

export type PromiseT<Data = any> = Promise<Data> | (() => Promise<Data>);

export type PromiseIExtendedResult = ExternalToast & { message: Title };

export type PromiseTResult<Data = any> = Title | PromiseIExtendedResult | ((data: Data) => Title | PromiseIExtendedResult | Promise<Title | PromiseIExtendedResult>);

export type PromiseExternalToast = Omit<ExternalToast, 'description'>;

export type PromiseData<ToastData = any> = PromiseExternalToast & {
  loading?: Title;
  success?: PromiseTResult<ToastData>;
  error?: PromiseTResult;
  description?: PromiseTResult;
  finally?: () => void | Promise<void>;
};

export interface Action {
  label: string;
  onClick: (event: MouseEvent) => void;
  actionButtonStyle?: Record<string, string>;
}

export interface ToastT {
  id: number | string;
  toasterId?: string;
  title?: Title;
  type?: ToastTypes;
  dismissible?: boolean;
  description?: Title;
  duration?: number;
  delete?: boolean;
  action?: Action;
  cancel?: Action;
  onDismiss?: (toast: ToastT) => void;
  onAutoClose?: (toast: ToastT) => void;
  promise?: PromiseT;
  closeButton?: boolean;
  invert?: boolean;
  richColors?: boolean;
  position?: Position;
  testId?: string;
}

export type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center';

export type SwipeDirection = 'top' | 'right' | 'bottom' | 'left';

export interface HeightT {
  height: number;
  toastId: number | string;
  position: Position | undefined;
}

export interface ToastToDismiss {
  id: number | string;
  dismiss: boolean;
}

export type ExternalToast = Omit<ToastT, 'id' | 'type' | 'title' | 'delete' | 'promise'> & { id?: number | string };
