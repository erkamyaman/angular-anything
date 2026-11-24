import {
  afterNextRender,
  afterRenderEffect,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ToastState } from './state';
import type { HeightT, Position, SwipeDirection, Title, ToastT, ToastToDismiss } from './types';

const VISIBLE_TOASTS_AMOUNT = 3;
const VIEWPORT_OFFSET = '24px';
const MOBILE_VIEWPORT_OFFSET = '16px';
const TOAST_LIFETIME = 4000;
const TOAST_WIDTH = 356;
const GAP = 14;
const SWIPE_THRESHOLD = 45;
const TIME_BEFORE_UNMOUNT = 200;

function getDefaultSwipeDirections(position: string): SwipeDirection[] {
  const [y, x] = position.split('-');
  const directions: SwipeDirection[] = [];
  if (y) directions.push(y as SwipeDirection);
  if (x) directions.push(x as SwipeDirection);
  return directions;
}

function getDocumentDirection(): 'ltr' | 'rtl' | 'auto' {
  const dirAttribute = document.documentElement.getAttribute('dir');
  if (dirAttribute === 'auto' || !dirAttribute) return window.getComputedStyle(document.documentElement).direction as 'ltr' | 'rtl';
  return dirAttribute as 'ltr' | 'rtl';
}

const text = (value: Title | undefined) => (typeof value === 'function' ? value() : value);

@Component({
  selector: 'div.sonner-loading-wrapper',
  host: { '[attr.data-visible]': 'visible()' },
  template: `<div class="sonner-spinner">@for (bar of bars; track $index) {<div class="sonner-loading-bar"></div>}</div>`,
})
export class Loader {
  readonly visible = input.required<boolean>();
  protected readonly bars = Array(12).fill(0);
}

@Component({
  selector: 'li[data-sonner-toast]',
  imports: [Loader],
  host: {
    tabindex: '0',
    '[attr.data-rich-colors]': 'toast().richColors ?? toaster.richColors',
    '[attr.data-styled]': 'true',
    '[attr.data-mounted]': 'mounted()',
    '[attr.data-promise]': 'promise()',
    '[attr.data-swiped]': 'isSwiped()',
    '[attr.data-removed]': 'removed()',
    '[attr.data-visible]': 'index() + 1 <= toaster.visibleToasts',
    '[attr.data-y-position]': 'y()',
    '[attr.data-x-position]': 'x()',
    '[attr.data-index]': 'index()',
    '[attr.data-front]': 'index() === 0',
    '[attr.data-swiping]': 'swiping()',
    '[attr.data-dismissible]': 'dismissible()',
    '[attr.data-type]': 'toast().type',
    '[attr.data-invert]': 'toast().invert || toaster.invert',
    '[attr.data-swipe-out]': 'swipeOut()',
    '[attr.data-swipe-direction]': 'swipeOutDirection()',
    '[attr.data-expanded]': 'toaster.expanded() || (toaster.expand && mounted())',
    '[attr.data-testid]': 'toast().testId',
    '[style]': 'styles()',
    '(dragend)': 'dragEnd()',
    '(pointerdown)': 'pointerDown($event)',
    '(pointerup)': 'pointerUp()',
    '(pointermove)': 'pointerMove($event)',
  },
  template: `@if (closeButton() && toast().type !== 'loading') {<button [attr.aria-label]="closeButtonAriaLabel" [attr.data-disabled]="disabled()" data-close-button="true" (click)="closeClicked()"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>}@if (toast().type || toast().promise) {<div data-icon="">@if (toast().type === 'loading') {<div class="sonner-loading-wrapper" [visible]="true"></div>} @else if (toast().promise) {<div class="sonner-loading-wrapper" [visible]="false"></div>}@if (toast().type !== 'loading') {@switch (toast().type) {@case ('success') {<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" height="20" width="20" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"></path></svg>} @case ('warning') {<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" height="20" width="20" aria-hidden="true"><path fill-rule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clip-rule="evenodd"></path></svg>} @case ('info') {<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" height="20" width="20" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd"></path></svg>} @case ('error') {<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" height="20" width="20" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"></path></svg>}}}</div>}<div data-content=""><div data-title="">{{ title() }}</div>@if (toast().description) {<div data-description="">{{ description() }}</div>}</div>@if (toast().cancel; as cancel) {<button data-button="true" data-cancel="true" (click)="cancelClicked($event)">{{ cancel.label }}</button>}@if (toast().action; as action) {<button data-button="true" data-action="true" (click)="actionClicked($event)">{{ action.label }}</button>}`,
})
export class Toast {
  readonly toast = input.required<ToastT>();
  readonly index = input.required<number>();
  readonly position = input.required<Position>();
  protected readonly toaster = inject(Toaster);
  private readonly element = inject<ElementRef<HTMLLIElement>>(ElementRef).nativeElement;
  protected readonly closeButtonAriaLabel = 'Close toast';

  protected readonly swipeDirection = signal<'x' | 'y' | null>(null);
  protected readonly swipeOutDirection = signal<'left' | 'right' | 'up' | 'down' | null>(null);
  protected readonly mounted = signal(false);
  protected readonly removed = signal(false);
  protected readonly swiping = signal(false);
  protected readonly swipeOut = signal(false);
  protected readonly isSwiped = signal(false);
  private readonly offsetBeforeRemove = signal(0);
  private readonly initialHeight = signal(0);
  private remainingTime = TOAST_LIFETIME;
  private dragStartTime: Date | null = null;
  private closeTimerStartTime = 0;
  private lastCloseTimerStartTime = 0;
  private pointerStart: { x: number; y: number } | null = null;

  protected readonly y = computed(() => this.position().split('-')[0]);
  protected readonly x = computed(() => this.position().split('-')[1]);
  protected readonly dismissible = computed(() => this.toast().dismissible !== false);
  protected readonly disabled = computed(() => this.toast().type === 'loading');
  protected readonly promise = computed(() => Boolean(this.toast().promise));
  protected readonly title = computed(() => text(this.toast().title));
  protected readonly description = computed(() => text(this.toast().description));
  protected readonly closeButton = computed(() => this.toast().closeButton ?? this.toaster.closeButton);
  private readonly duration = computed(() => this.toast().duration || this.toaster.duration || TOAST_LIFETIME);
  private readonly heights = computed(() => this.toaster.heights().filter((height) => height.position == this.toast().position));
  private readonly toasts = computed(() => this.toaster.filteredToasts().filter((toast) => toast.position == this.toast().position));
  private readonly heightIndex = computed(() => this.heights().findIndex((height) => height.toastId === this.toast().id) || 0);
  private readonly toastsHeightBefore = computed(() =>
    this.heights().reduce((previous, current, reducerIndex) => (reducerIndex >= this.heightIndex() ? previous : previous + current.height), 0),
  );
  private readonly offset = computed(() => this.heightIndex() * this.toaster.gap + this.toastsHeightBefore());
  private readonly swipeDirections = computed(() => getDefaultSwipeDirections(this.position()));
  protected readonly styles = computed(() => ({
    '--index': `${this.index()}`,
    '--toasts-before': `${this.index()}`,
    '--z-index': `${this.toasts().length - this.index()}`,
    '--offset': `${this.removed() ? this.offsetBeforeRemove() : this.offset()}px`,
    '--initial-height': this.toaster.expand ? 'auto' : `${this.initialHeight()}px`,
  }));

  constructor() {
    effect(() => {
      this.remainingTime = this.duration();
    });

    afterNextRender(() => {
      const height = this.element.getBoundingClientRect().height;
      this.initialHeight.set(height);
      this.toaster.heights.update((heights) => [{ toastId: this.toast().id, height, position: this.toast().position }, ...heights]);
      this.mounted.set(true);
    });

    afterRenderEffect(() => {
      if (!this.mounted()) return;
      this.title();
      this.description();
      this.toast().action;
      this.toast().cancel;
      untracked(() => {
        const originalHeight = this.element.style.height;
        this.element.style.height = 'auto';
        const newHeight = this.element.getBoundingClientRect().height;
        this.element.style.height = originalHeight;
        this.initialHeight.set(newHeight);
        const id = this.toast().id;
        this.toaster.heights.update((heights) =>
          heights.find((height) => height.toastId === id)
            ? heights.map((height) => (height.toastId === id ? { ...height, height: newHeight } : height))
            : [{ toastId: id, height: newHeight, position: this.toast().position }, ...heights],
        );
      });
    });

    effect((onCleanup) => {
      const toast = this.toast();
      const expanded = this.toaster.expanded();
      const interacting = this.toaster.interacting();
      const hidden = this.toaster.documentHidden();
      if ((toast.promise && toast.type === 'loading') || toast.duration === Infinity || toast.type === 'loading') return;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      untracked(() => {
        if (expanded || interacting || hidden) {
          if (this.lastCloseTimerStartTime < this.closeTimerStartTime) {
            this.remainingTime = this.remainingTime - (new Date().getTime() - this.closeTimerStartTime);
          }
          this.lastCloseTimerStartTime = new Date().getTime();
        } else if (this.remainingTime !== Infinity) {
          this.closeTimerStartTime = new Date().getTime();
          timeoutId = setTimeout(() => {
            toast.onAutoClose?.(toast);
            this.deleteToast();
          }, this.remainingTime);
        }
      });
      onCleanup(() => clearTimeout(timeoutId));
    });

    effect(() => {
      if (!this.toast().delete) return;
      untracked(() => {
        this.deleteToast();
        this.toast().onDismiss?.(this.toast());
      });
    });
  }

  private deleteToast() {
    const toast = this.toast();
    this.removed.set(true);
    this.offsetBeforeRemove.set(this.offset());
    this.toaster.heights.update((heights) => heights.filter((height) => height.toastId !== toast.id));
    setTimeout(() => this.toaster.removeToast(toast), TIME_BEFORE_UNMOUNT);
  }

  ngOnDestroy() {
    const id = this.toast().id;
    this.toaster.heights.update((heights) => heights.filter((height) => height.toastId !== id));
  }

  protected closeClicked() {
    if (this.disabled() || !this.dismissible()) return;
    this.deleteToast();
    this.toast().onDismiss?.(this.toast());
  }

  protected cancelClicked(event: MouseEvent) {
    const cancel = this.toast().cancel;
    if (!cancel || !this.dismissible()) return;
    cancel.onClick?.(event);
    this.deleteToast();
  }

  protected actionClicked(event: MouseEvent) {
    const action = this.toast().action;
    if (!action) return;
    action.onClick?.(event);
    if (event.defaultPrevented) return;
    this.deleteToast();
  }

  protected dragEnd() {
    this.swiping.set(false);
    this.swipeDirection.set(null);
    this.pointerStart = null;
  }

  protected pointerDown(event: PointerEvent) {
    if (event.button === 2) return;
    if (this.disabled() || !this.dismissible()) return;
    this.dragStartTime = new Date();
    this.offsetBeforeRemove.set(this.offset());
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    if ((event.target as HTMLElement).tagName === 'BUTTON') return;
    this.swiping.set(true);
    this.pointerStart = { x: event.clientX, y: event.clientY };
  }

  protected pointerUp() {
    if (this.swipeOut() || !this.dismissible()) return;
    this.pointerStart = null;
    const swipeAmountX = Number(this.element.style.getPropertyValue('--swipe-amount-x').replace('px', '') || 0);
    const swipeAmountY = Number(this.element.style.getPropertyValue('--swipe-amount-y').replace('px', '') || 0);
    const timeTaken = new Date().getTime() - (this.dragStartTime?.getTime() ?? NaN);
    const direction = this.swipeDirection();
    const swipeAmount = direction === 'x' ? swipeAmountX : swipeAmountY;
    const velocity = Math.abs(swipeAmount) / timeTaken;
    const isAllowedDirection =
      direction === 'x'
        ? this.swipeDirections().includes(swipeAmountX > 0 ? 'right' : 'left')
        : this.swipeDirections().includes(swipeAmountY > 0 ? 'bottom' : 'top');

    if (isAllowedDirection && (Math.abs(swipeAmount) >= SWIPE_THRESHOLD || velocity > 0.11)) {
      this.offsetBeforeRemove.set(this.offset());
      this.toast().onDismiss?.(this.toast());
      if (direction === 'x') this.swipeOutDirection.set(swipeAmountX > 0 ? 'right' : 'left');
      else this.swipeOutDirection.set(swipeAmountY > 0 ? 'down' : 'up');
      this.deleteToast();
      this.swipeOut.set(true);
      return;
    }
    this.element.style.setProperty('--swipe-amount-x', '0px');
    this.element.style.setProperty('--swipe-amount-y', '0px');
    this.isSwiped.set(false);
    this.swiping.set(false);
    this.swipeDirection.set(null);
  }

  protected pointerMove(event: PointerEvent) {
    if (!this.pointerStart || !this.dismissible()) return;
    if ((window.getSelection()?.toString().length ?? 0) > 0) return;
    const yDelta = event.clientY - this.pointerStart.y;
    const xDelta = event.clientX - this.pointerStart.x;
    let direction = this.swipeDirection();
    if (!direction && (Math.abs(xDelta) > 1 || Math.abs(yDelta) > 1)) {
      this.swipeDirection.set(Math.abs(xDelta) > Math.abs(yDelta) ? 'x' : 'y');
    }
    const swipeAmount = { x: 0, y: 0 };
    const getDampening = (delta: number) => 1 / (1.5 + Math.abs(delta) / 20);
    const directions = this.swipeDirections();
    if (direction === 'y') {
      if (directions.includes('top') || directions.includes('bottom')) {
        if ((directions.includes('top') && yDelta < 0) || (directions.includes('bottom') && yDelta > 0)) {
          swipeAmount.y = yDelta;
        } else {
          const dampenedDelta = yDelta * getDampening(yDelta);
          swipeAmount.y = Math.abs(dampenedDelta) < Math.abs(yDelta) ? dampenedDelta : yDelta;
        }
      }
    } else if (direction === 'x') {
      if (directions.includes('left') || directions.includes('right')) {
        if ((directions.includes('left') && xDelta < 0) || (directions.includes('right') && xDelta > 0)) {
          swipeAmount.x = xDelta;
        } else {
          const dampenedDelta = xDelta * getDampening(xDelta);
          swipeAmount.x = Math.abs(dampenedDelta) < Math.abs(xDelta) ? dampenedDelta : xDelta;
        }
      }
    }
    if (Math.abs(swipeAmount.x) > 0 || Math.abs(swipeAmount.y) > 0) this.isSwiped.set(true);
    this.element.style.setProperty('--swipe-amount-x', `${swipeAmount.x}px`);
    this.element.style.setProperty('--swipe-amount-y', `${swipeAmount.y}px`);
  }
}

@Component({
  selector: 'section[data-react-aria-top-layer]',
  imports: [Toast],
  host: {
    '[attr.aria-label]': 'label',
    tabindex: '-1',
    'aria-live': 'polite',
    'aria-relevant': 'additions text',
    'aria-atomic': 'false',
    'data-react-aria-top-layer': 'true',
  },
  template: `@for (position of possiblePositions(); track position; let positionIndex = $index) {@if (filteredToasts().length) {<ol #list [attr.dir]="dir" tabindex="-1" data-sonner-toaster="true" [attr.data-sonner-theme]="theme" [attr.data-y-position]="position.split('-')[0]" [attr.data-x-position]="position.split('-')[1]" [style]="listStyle()" (focusout)="listBlur($event)" (focusin)="listFocus($event)" (mouseenter)="expanded.set(true)" (mousemove)="expanded.set(true)" (mouseleave)="listLeave()" (dragend)="expanded.set(false)" (pointerdown)="listPointerDown($event)" (pointerup)="interacting.set(false)">@for (toast of toastsAt(position, positionIndex); track toast.id; let index = $index) {<li data-sonner-toast="" [toast]="toast" [index]="index" [position]="position"></li>}</ol>}}`,
})
export class Toaster implements OnDestroy {
  readonly position: Position = 'bottom-right';
  readonly hotkey = ['altKey', 'KeyT'];
  readonly expand = false;
  readonly closeButton = false;
  readonly richColors: boolean | undefined = undefined;
  readonly invert: boolean | undefined = undefined;
  readonly duration: number | undefined = undefined;
  readonly visibleToasts = VISIBLE_TOASTS_AMOUNT;
  readonly gap = GAP;
  protected readonly theme = 'light';
  protected readonly dir = getDocumentDirection();
  protected readonly label = `Notifications ${this.hotkey.join('+').replace(/Key/g, '').replace(/Digit/g, '')}`;

  readonly toasts = signal<ToastT[]>([]);
  readonly heights = signal<HeightT[]>([]);
  readonly expanded = signal(false);
  readonly interacting = signal(false);
  readonly documentHidden = signal(document.hidden);
  readonly filteredToasts = computed(() => this.toasts().filter((toast) => !toast.toasterId));
  protected readonly possiblePositions = computed(() =>
    Array.from(new Set([this.position].concat(this.filteredToasts().filter((toast) => toast.position).map((toast) => toast.position!)))),
  );
  protected readonly listStyle = computed(() => ({
    '--front-toast-height': `${this.heights()[0]?.height || 0}px`,
    '--width': `${TOAST_WIDTH}px`,
    '--gap': `${this.gap}px`,
    ...Object.fromEntries(['top', 'right', 'bottom', 'left'].map((key) => [`--offset-${key}`, VIEWPORT_OFFSET])),
    ...Object.fromEntries(['top', 'right', 'bottom', 'left'].map((key) => [`--mobile-offset-${key}`, MOBILE_VIEWPORT_OFFSET])),
  }));
  private readonly list = viewChild<ElementRef<HTMLOListElement>>('list');
  private lastFocusedElement: HTMLElement | null = null;
  private isFocusWithin = false;
  private readonly unsubscribe: () => void;
  private readonly keydown = (event: KeyboardEvent) => {
    const isHotkeyPressed = this.hotkey.length > 0 && this.hotkey.every((key) => (event as any)[key] || event.code === key);
    if (isHotkeyPressed) {
      this.expanded.set(true);
      this.list()?.nativeElement.focus();
    }
    const list = this.list()?.nativeElement;
    if (event.code === 'Escape' && (document.activeElement === list || list?.contains(document.activeElement))) {
      this.expanded.set(false);
    }
  };
  private readonly visibility = () => this.documentHidden.set(document.hidden);

  constructor() {
    this.unsubscribe = ToastState.subscribe((toast) => {
      if ((toast as ToastToDismiss).dismiss) {
        requestAnimationFrame(() => {
          this.toasts.update((toasts) => toasts.map((t) => (t.id === toast.id ? { ...t, delete: true } : t)));
        });
        return;
      }
      setTimeout(() => {
        this.toasts.update((toasts) => {
          const indexOfExistingToast = toasts.findIndex((t) => t.id === toast.id);
          if (indexOfExistingToast !== -1) {
            return [
              ...toasts.slice(0, indexOfExistingToast),
              { ...toasts[indexOfExistingToast], ...(toast as ToastT) },
              ...toasts.slice(indexOfExistingToast + 1),
            ];
          }
          return [toast as ToastT, ...toasts];
        });
      });
    });

    effect(() => {
      if (this.toasts().length <= 1) this.expanded.set(false);
    });

    effect((onCleanup) => {
      if (!this.list()) return;
      onCleanup(() => {
        if (this.lastFocusedElement) {
          this.lastFocusedElement.focus({ preventScroll: true });
          this.lastFocusedElement = null;
          this.isFocusWithin = false;
        }
      });
    });

    document.addEventListener('keydown', this.keydown);
    document.addEventListener('visibilitychange', this.visibility);
  }

  ngOnDestroy() {
    this.unsubscribe();
    document.removeEventListener('keydown', this.keydown);
    document.removeEventListener('visibilitychange', this.visibility);
  }

  protected toastsAt(position: Position, positionIndex: number) {
    return this.filteredToasts().filter((toast) => (!toast.position && positionIndex === 0) || toast.position === position);
  }

  removeToast(toastToRemove: ToastT) {
    this.toasts.update((toasts) => {
      if (!toasts.find((toast) => toast.id === toastToRemove.id)?.delete) ToastState.dismiss(toastToRemove.id);
      return toasts.filter(({ id }) => id !== toastToRemove.id);
    });
  }

  protected listBlur(event: FocusEvent) {
    const list = event.currentTarget as HTMLElement;
    if (this.isFocusWithin && !list.contains(event.relatedTarget as Node | null)) {
      this.isFocusWithin = false;
      if (this.lastFocusedElement) {
        this.lastFocusedElement.focus({ preventScroll: true });
        this.lastFocusedElement = null;
      }
    }
  }

  protected listFocus(event: FocusEvent) {
    if (event.target instanceof HTMLElement && event.target.dataset['dismissible'] === 'false') return;
    if (!this.isFocusWithin) {
      this.isFocusWithin = true;
      this.lastFocusedElement = event.relatedTarget as HTMLElement;
    }
  }

  protected listLeave() {
    if (!this.interacting()) this.expanded.set(false);
  }

  protected listPointerDown(event: PointerEvent) {
    if (event.target instanceof HTMLElement && event.target.dataset['dismissible'] === 'false') return;
    this.interacting.set(true);
  }
}

export { toast } from './state';
