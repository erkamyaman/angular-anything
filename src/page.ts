export type DomNode =
  | string
  | {
      tag: string;
      attrs?: Record<string, string>;
      inline?: Record<string, string>;
      props?: Record<string, string | boolean>;
      layout?: Record<string, string>;
      children?: DomNode[];
    };

export type Box = { x: number; y: number; width: number; height: number };

export type Style = Record<string, { style: Record<string, string>; box?: Box; layout?: Record<string, string> }>;

export const LAID_OUT = '[laid out]';

export const LAID_OUT_NAMES = 'width height inline-size block-size perspective-origin transform-origin top right bottom left inset-block-start inset-block-end inset-inline-start inset-inline-end margin-top margin-right margin-bottom margin-left margin-block-start margin-block-end margin-inline-start margin-inline-end';

export type Unread = { path: string; attribute: string }[];

export type PageCapture = {
  dom: DomNode;
  style: Style;
  aria: Record<string, Record<string, string>>;
  focus: string | null;
  unread: Unread;
  secretFields: string[];
  storage: Record<string, string>;
  href: string;
  title: string;
};

type AngularJs = {
  element(el: Element): { injector(): AngularJsInjector | undefined };
};
type AngularJsInjector = {
  has(name: string): boolean;
  get(name: string): {
    restrict: string;
    multiElement?: boolean;
    $$bindings?: Record<string, Record<string, { attrName: string; mode: string }> | null>;
  }[];
};
type Instrumented = {
  __aaEmit(json: string): void;
  __aaPopup?(json: string, opened: boolean): void;
  __aaShared?(id: string, url: string): void;
  __aaSync?(request: string, waiting: boolean): void;
  __aaMutations: number;
  __aaRested?: number;
  __aaShadows: WeakMap<Element, ShadowRoot>;
  __aaSecretField?(el: Element): boolean;
  __aaTyping?: Element[];
  __aaTurned?(): void;
  __aaHeld: WeakSet<SVGSVGElement>;
  __aaSeen: WeakSet<Animation>;
  __aaPending?: Map<unknown, { due: number; delay: number }>;
  __aaFired?: Map<number, Set<number>>;
  __aaFrame(): Promise<void>;
  angular?: AngularJs;
};

export function initPage(): void {
  const page = window as unknown as Instrumented & { __aa: unknown };
  const expansionLimit = 10_000;
  const tooLarge = Symbol();
  const failed = Symbol();
  const nodeType = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeType')!.get!;
  const nodeName = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeName')!.get!;
  const marker = (kind: string, fields: string[] = []) => `{${[`"$aa":${JSON.stringify(kind)}`, ...fields].join(',')}}`;
  const read = (get: () => unknown): unknown => {
    try {
      return get();
    } catch {
      return failed;
    }
  };

  const encode = (payload: unknown, walked: Set<unknown> | null): string | undefined => {
    const ancestors: unknown[] = [];
    let count = 0;
    const host = (value: object): string | undefined => {
      if (read(() => nodeType.call(value)) !== failed) return marker('node', [`"name":${JSON.stringify(nodeName.call(value))}`]);
      if (read(() => (value as { window?: unknown }).window === value) === true) return marker('window');
      return undefined;
    };
    const walk = (source: unknown, key: string, hole?: boolean): string | undefined => {
      if (source === failed) return marker('throws');
      if (++count > expansionLimit && !walked) throw tooLarge;
      let value = source;
      if ((typeof value === 'object' && value !== null) || typeof value === 'bigint') {
        if (typeof value === 'object') {
          const marked = host(value);
          if (marked) return marked;
          if (ancestors.includes(value)) return marker('circular');
        }
        const toJson = read(() => (source as { toJSON?: unknown }).toJSON);
        if (toJson === failed) return marker('throws');
        if (typeof toJson === 'function') value = read(() => toJson.call(source, key));
        if (value === failed) return marker('throws');
      }
      if (value instanceof Number || value instanceof String || value instanceof Boolean || value instanceof BigInt) {
        const boxed = value;
        value = read(() => boxed.valueOf());
        if (value === failed) return marker('throws');
      }
      if (value === undefined && hole !== undefined) return marker(hole ? 'hole' : 'undefined');
      if (value === undefined) return undefined;
      if (typeof value === 'bigint') return marker('bigint', [`"value":"${value}"`]);
      if (typeof value === 'number' && !Number.isFinite(value)) return marker(String(value));
      if (Object.is(value, -0)) return marker('-0');
      if (typeof value !== 'object' || value === null) return JSON.stringify(value);
      const object = value as Record<string, unknown>;
      const marked = host(object);
      if (marked) return marked;
      if (ancestors.includes(object)) return marker('circular');
      if (walked) {
        if (walked.has(source) || walked.has(object)) return marker('repeated');
        walked.add(source).add(object);
      }
      const depth = ancestors.push(source, object) - 2;
      const field = (name: string, get: () => unknown, label = name): string | undefined => {
        const written = walk(read(get), name);
        return written === undefined ? undefined : `${JSON.stringify(label)}:${written}`;
      };
      const list = (items: unknown): string => {
        if (items === failed) return marker('throws');
        const array = items as unknown[];
        const written = Array.from(
          { length: array.length },
          (_, at) => walk(read(() => array[at]), String(at), !(at in array)) ?? 'null',
        );
        return `[${written.join(',')}]`;
      };
      const present = (fields: (string | undefined)[]) => fields.filter((each) => each !== undefined);
      let written: string;
      if (Array.isArray(object)) {
        written = list(object);
      } else if (object instanceof Set) {
        written = marker('Set', [`"values":${list(read(() => [...object]))}`]);
      } else if (object instanceof Map) {
        written = marker('Map', [`"entries":${list(read(() => [...object]))}`]);
      } else if (object instanceof RegExp) {
        written = marker('RegExp', present([field('source', () => object.source), field('flags', () => object.flags)]));
      } else {
        const keys = read(() => Object.keys(object));
        if (keys === failed) {
          written = marker('throws');
        } else if (object instanceof Error) {
          const names = new Set(['name', 'message', ...(keys as string[])]);
          for (const name of ['cause', 'errors']) if (Object.hasOwn(object, name)) names.add(name);
          written = marker('Error', present([...names].map((name) => field(name, () => object[name]))));
        } else {
          written = `{${present((keys as string[]).map((name) => field(name, () => object[name]))).join(',')}}`;
        }
      }
      ancestors.length = depth;
      return written;
    };
    return walk(payload, 'payload');
  };

  page.__aa = {
    emit(name: string, payload: unknown) {
      const head = JSON.stringify({ name }).slice(1, -1);
      const event = (body: string | undefined) =>
        `{${[head, body === undefined ? '' : `"payload":${body}`].filter(Boolean).join(',')}}`;
      let json: string;
      try {
        let body: string | undefined;
        try {
          body = encode(payload ?? null, null);
        } catch (error) {
          if (error !== tooLarge) throw error;
          body = encode(payload ?? null, new Set());
        }
        json = event(body);
      } catch {
        json = event('"[unserializable]"');
      }
      page.__aaEmit(json);
    },
  };
  page.__aaMutations = 0;
  new MutationObserver((records) => {
    page.__aaMutations += records.length;
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const requestFrame = window.requestAnimationFrame.bind(window);
  page.__aaFrame = () => new Promise((resolve) => requestFrame(() => resolve()));

  const secretAutocomplete = ['current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc'];
  page.__aaSecretField = (el) =>
    ['input', 'textarea', 'select'].includes(el.localName) &&
    ((el as HTMLInputElement).type === 'password' ||
      (el.getAttribute('autocomplete') ?? '')
        .toLowerCase()
        .split(/\s+/)
        .some((token) => secretAutocomplete.includes(token)));

  const turned = () => page.__aaTyping?.some((element) => page.__aaSecretField!(element)) ?? false;
  const turning = new MutationObserver(() => {
    if (turned()) page.__aaTurned?.();
  });

  const reaching = (event: Event) => {
    const typing = page.__aaTyping;
    if (!typing || !event.isTrusted) return;
    let element = event.composedPath()[0] as Element | null | undefined;
    while (element) {
      typing.push(element);
      turning.observe(element, { attributeFilter: ['type', 'autocomplete'] });
      element = (element.shadowRoot ?? page.__aaShadows.get(element))?.activeElement;
    }
    if (!typing.some((each) => page.__aaSecretField!(each))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of ['keydown', 'beforeinput']) addEventListener(type, reaching, true);

  page.__aaHeld = new WeakSet();
  page.__aaSeen = new WeakSet();
  page.__aaShadows = new WeakMap();
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    const root = attachShadow.call(this, init);
    page.__aaShadows.set(this, root);
    return root;
  };

  const { open, send } = XMLHttpRequest.prototype;
  const synchronous = new WeakMap<XMLHttpRequest, string>();
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    const [method, url, async] = args;
    if (args.length > 2 && !async) {
      const target = new URL(String(url), document.baseURI);
      target.hash = '';
      synchronous.set(this, `${String(method).toUpperCase()} ${target.href}`);
    } else {
      synchronous.delete(this);
    }
    return (open as (...args: unknown[]) => void).apply(this, args);
  };
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const request = synchronous.get(this);
    if (request === undefined) return send.call(this, body);
    if (turned()) throw new DOMException('angular-anything does not send after typing reached a secret field', 'NetworkError');
    page.__aaSync?.(request, true);
    try {
      return send.call(this, body);
    } finally {
      page.__aaSync?.(request, false);
    }
  };

  const dialogs = { alert: window.alert, confirm: window.confirm, prompt: window.prompt, print: window.print, open: window.open };
  const text = (value: unknown): string => (value === undefined ? '' : String(value));
  const record = (entry: Record<string, unknown>, opened = false) => {
    try {
      page.__aaPopup?.(JSON.stringify(entry), opened);
    } catch {}
  };
  const named = <T extends (...args: never[]) => unknown>(wrapper: T, name: string): T => {
    Object.defineProperty(wrapper, 'name', { value: name, configurable: true });
    Object.defineProperty(wrapper, 'length', { value: 0, configurable: true });
    return wrapper;
  };
  window.alert = named(function (this: unknown, ...args: unknown[]) {
    const message = typeof args[0] === 'symbol' ? args[0] : text(args[0]);
    const result = dialogs.alert.call(this, message as string);
    record({ kind: 'alert', message });
    return result;
  }, 'alert');
  window.confirm = named(function (this: unknown, ...args: unknown[]) {
    const message = typeof args[0] === 'symbol' ? args[0] : text(args[0]);
    const result = dialogs.confirm.call(this, message as string);
    record({ kind: 'confirm', message });
    return result;
  }, 'confirm');
  window.prompt = named(function (this: unknown, ...args: unknown[]) {
    const message = typeof args[0] === 'symbol' ? args[0] : text(args[0]);
    const value = typeof args[1] === 'symbol' ? args[1] : text(args[1]);
    const result = dialogs.prompt.call(this, message as string, value as string);
    record({ kind: 'prompt', message, default: value });
    return result;
  }, 'prompt');
  window.print = named(function (this: unknown) {
    const result = dialogs.print.call(this);
    record({ kind: 'print' });
    return result;
  }, 'print');
  window.open = named(function (this: unknown, ...args: unknown[]) {
    const url = typeof args[0] === 'symbol' ? args[0] : text(args[0]);
    const target = typeof args[1] === 'symbol' ? args[1] : text(args[1]) || '_blank';
    const features = typeof args[2] === 'symbol' ? args[2] : text(args[2]);
    const result = dialogs.open.call(this, url as string, target as string, features as string);
    let opened = false;
    try {
      opened = result !== null && result !== window && result.opener === window;
    } catch {}
    try {
      record({ kind: 'open', url: url === '' ? 'about:blank' : new URL(url as string, document.baseURI).href, target, features }, opened);
    } catch {}
    return result;
  }, 'open');

  const fetch = window.fetch;
  window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
    const answer = fetch.apply(this, args);
    answer.then((response) => response.clone().arrayBuffer()).catch(() => {});
    return answer;
  } as typeof fetch;
}

export function clampIntervals(): void {
  const setInterval = window.setInterval;
  window.setInterval = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) =>
    setInterval(handler, Math.max(1, Number(delay) || 0), ...rest)) as typeof window.setInterval;
}

export const SHARED_MARK = '__aaShared';

export function blockSharedWorker(mark: string): void {
  const page = window as unknown as Instrumented;
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!.set!;
  const blocked = function SharedWorker(url: unknown) {
    let name = String(url);
    try {
      name = new URL(name, document.baseURI).href;
    } catch {}
    const id = Math.random().toString(36).slice(2);
    try {
      cookie.call(document, `${mark}${id}=${encodeURIComponent(name)}; path=/`);
    } catch {}
    page.__aaShared?.(id, name);
    throw new DOMException('angular-anything does not run a SharedWorker', 'SecurityError');
  };
  Object.defineProperty(window, 'SharedWorker', { value: blocked, writable: true, enumerable: false, configurable: false });
}

export function trackTimers(): void {
  const page = window as unknown as Instrumented;
  const { setTimeout, clearTimeout, clearInterval } = window;
  const pending = new Map<unknown, { due: number; delay: number }>();
  const fired = new Map<number, Set<number>>();
  page.__aaPending = pending;
  page.__aaFired = fired;
  window.setTimeout = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) => {
    const wait = Math.max(0, Number(delay) || 0);
    let id: unknown;
    const run = function (this: unknown, ...args: unknown[]) {
      pending.delete(id);
      const times = fired.get(wait) ?? new Set<number>();
      times.add(Math.round(performance.now()));
      fired.set(wait, times);
      return typeof handler === 'function' ? handler.apply(this, args) : (0, eval)(String(handler));
    };
    id = setTimeout(run, delay, ...rest);
    pending.set(id, { due: performance.now() + wait, delay: wait });
    return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = ((id?: number) => {
    pending.delete(id);
    return clearTimeout(id);
  }) as typeof window.clearTimeout;
  window.clearInterval = ((id?: number) => {
    pending.delete(id);
    return clearInterval(id);
  }) as typeof window.clearInterval;
}

export function beginStep(): void {
  (window as unknown as Instrumented).__aaFired?.clear();
}

export type Due = { delay: number; left: number };

export function dueTimers(horizon: number): Due | null {
  const page = window as unknown as Instrumented;
  const now = performance.now();
  let nearest: Due | null = null;
  for (const { due, delay } of page.__aaPending?.values() ?? []) {
    if ((page.__aaFired?.get(delay)?.size ?? 0) >= 2) continue;
    const left = Math.max(0, Math.round(due - now));
    if (left <= horizon && (nearest === null || left < nearest.left)) nearest = { delay, left };
  }
  return nearest;
}

export function browserFrame(): Promise<void> {
  return (window as unknown as Instrumented).__aaFrame();
}

export function probePage(): string {
  const page = window as unknown as Instrumented;
  const round = (value: number) => Math.round(value * 100) / 100;
  const boxes: number[] = [];
  const scrolled: number[] = [];
  const roots: (Document | ShadowRoot)[] = [document];
  for (const root of roots) {
    for (const element of root.querySelectorAll('*')) {
      const shadow = element.shadowRoot ?? page.__aaShadows.get(element);
      if (shadow) roots.push(shadow);
      const box = element.getBoundingClientRect();
      boxes.push(round(box.x), round(box.y), round(box.width), round(box.height));
      if (element.scrollTop !== 0 || element.scrollLeft !== 0) scrolled.push(boxes.length, element.scrollTop, element.scrollLeft);
    }
  }
  let storage = '';
  try {
    storage = JSON.stringify(
      Array.from({ length: localStorage.length }, (_, at) => localStorage.key(at)!).map((key) => [key, localStorage.getItem(key)]),
    );
  } catch {}
  return JSON.stringify([page.__aaMutations, location.href, [scrollX, scrollY], boxes, scrolled, storage]);
}

export function typesIntoSecretField(el: Element, pressed: boolean): boolean {
  const page = window as unknown as Instrumented;
  const field = (el as HTMLLabelElement).control ?? el;
  if (page.__aaSecretField!(field)) return true;
  if (!pressed || field.matches('input, textarea, select, button, a[href], [tabindex], [contenteditable]')) return false;
  let focused = document.activeElement;
  while (focused) {
    const inner: Element | null | undefined = (focused.shadowRoot ?? page.__aaShadows.get(focused))?.activeElement;
    if (!inner) return page.__aaSecretField!(focused);
    focused = inner;
  }
  return false;
}

export function watchTyping(): void {
  (window as unknown as Instrumented).__aaTyping = [];
}

export function typedIntoSecretField(): boolean {
  const page = window as unknown as Instrumented;
  return page.__aaTyping?.some((element) => page.__aaSecretField!(element)) ?? false;
}

export function stopTyping(): boolean {
  const page = window as unknown as Instrumented;
  const reached = page.__aaTyping?.some((element) => page.__aaSecretField!(element)) ?? false;
  page.__aaTyping = undefined;
  return reached;
}

export function adoptPage(...roots: ShadowRoot[]): void {
  for (const root of roots) (window as unknown as Instrumented).__aaShadows.set(root.host, root);
}

export async function restPage(): Promise<string> {
  const page = window as unknown as Instrumented;
  const tasks = async () => {
    for (let hop = 0; hop < 2; hop++) {
      await new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage(null);
      });
    }
  };
  await tasks();
  let moved = page.__aaMutations === page.__aaRested ? '' : 'the DOM';
  page.__aaRested = page.__aaMutations;
  const unended = (element: SVGAnimationElement) => {
    if (element.getAttribute('repeatCount') === 'indefinite' || element.getAttribute('repeatDur') === 'indefinite') {
      return false;
    }
    try {
      element.getSimpleDuration();
      element.getStartTime();
      return true;
    } catch {
      return false;
    }
  };
  const timelines = new Map<SVGSVGElement, boolean>();
  const roots: (Document | ShadowRoot)[] = [document];
  for (const root of roots) {
    for (const element of root.querySelectorAll('*')) {
      const shadow = element.shadowRoot ?? page.__aaShadows.get(element);
      if (shadow) roots.push(shadow);
      if (element instanceof SVGAnimationElement && element.ownerSVGElement) {
        const svg = element.ownerSVGElement;
        timelines.set(svg, timelines.get(svg) || unended(element));
      }
    }
    for (const animation of root.getAnimations()) {
      if (animation.playState !== 'running' || animation.playbackRate === 0) continue;
      if (!(animation.timeline instanceof DocumentTimeline)) continue;
      if (animation.effect?.getComputedTiming().endTime === Infinity) {
        if (moved === '' || moved === 'the DOM') moved = 'a held animation';
        animation.pause();
        animation.currentTime = 0;
      } else if (!page.__aaSeen.has(animation)) {
        page.__aaSeen.add(animation);
        moved = 'an animation';
      } else {
        moved = 'an animation';
        animation.finish();
      }
    }
  }
  for (const [svg, running] of timelines) {
    if (svg.animationsPaused() && !(running && page.__aaHeld.has(svg))) continue;
    svg.pauseAnimations();
    svg.setCurrentTime((Math.floor(svg.getCurrentTime() / 3600) + 1) * 3600);
    page.__aaHeld.add(svg);
    if (timelines.get(svg)) moved = 'an SVG animation';
    else if (moved === '' || moved === 'the DOM') moved = 'a held SVG animation';
  }
  if (moved) {
    await page.__aaFrame();
    await tasks();
  }
  return moved;
}

export function capturePage(): PageCapture {
  const page = window as unknown as Instrumented;
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const ignoredTags = new Set(['head', 'script', 'style', 'link']);
  const booleanAttributes = new Set(
    'allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected'.split(
      ' ',
    ),
  );
  const angularjsClass =
    /^ng-(scope|isolate-scope|binding|pristine|dirty|touched|untouched|valid|invalid|pending|empty|not-empty|submitted|(valid|invalid)-.+)$/;
  const angularjsWithoutDirective = new Set(
    'ngApp ngStrictDi ngCsp ngJq ngTrueValue ngFalseValue ngTrim ngRefRead ngSwitchWhenSeparator ngTranscludeSlot ngAnimateRef'.split(
      ' ',
    ),
  );
  const globalAttributes = new Set(
    'accesskey autocapitalize autofocus class contenteditable dir draggable enterkeyhint exportparts hidden id inert inputmode is itemid itemprop itemref itemscope itemtype lang nonce part popover slot spellcheck style tabindex title translate writingsuggestions'.split(
      ' ',
    ),
  );
  const svgPresentation = new Set(
    'alignment-baseline baseline-shift clip-path clip-rule color color-interpolation color-interpolation-filters cursor direction display dominant-baseline fill fill-opacity fill-rule filter flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight image-rendering letter-spacing lighting-color marker-end marker-mid marker-start mask opacity overflow paint-order pointer-events shape-rendering stop-color stop-opacity stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering transform unicode-bidi vector-effect visibility word-spacing writing-mode'.split(
      ' ',
    ),
  );
  const renamedProperties: Record<string, string> = {
    class: 'classname',
    for: 'htmlfor',
    'accept-charset': 'acceptcharset',
    'http-equiv': 'httpequiv',
  };

  const style: Style = {};
  const aria: PageCapture['aria'] = {};
  const unread: Unread = [];
  const secretFields: string[] = [];
  const paths = new Map<Element, string>();
  const round = (value: number) => Math.round(value * 100) / 100;

  const originPattern = new RegExp(
    `url\\((["']?)${location.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[/?#"')]|$)`,
    'g',
  );

  const withoutOrigin = (value: string) => value.replace(originPattern, 'url($1[page-origin]');
  const cssStringOrUrl =
    /"[^"\\]*(?:\\[\s\S][^"\\]*)*"|'[^'\\]*(?:\\[\s\S][^'\\]*)*'|(?<![-\w\\])url\(\s*(?:"([^"\\]*(?:\\[\s\S][^"\\]*)*)"|'([^'\\]*(?:\\[\s\S][^'\\]*)*)'|([^)\s"'\\]*(?:(?:\\[0-9a-fA-F]{1,6}\s|\\[\s\S])[^)\s"'\\]*)*))\s*\)/gi;
  const unescapeCss = (text: string) =>
    text.replace(/\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\n\r\f])|([\s\S]))/g, (_, hex?: string, newline?: string, char?: string) => {
      if (hex === undefined) return newline === undefined ? char! : '';
      return String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff));
    });

  const resolveUrls = (value: string) =>
    value.replace(cssStringOrUrl, (whole, double?: string, single?: string, bare?: string) => {
      const written = unescapeCss(double ?? single ?? bare ?? '');
      if (written === '' || written.startsWith('#')) return whole;
      try {
        const href = new URL(written, document.baseURI).href.replace(/["\\]/g, '\\$&');
        return withoutOrigin(`url("${href}")`);
      } catch {
        return whole;
      }
    });

  let paint: CanvasRenderingContext2D | null | undefined;
  const colourOf = (property: string, value: string): string => {
    if (property.startsWith('--') || /^currentcolor$/i.test(value) || !CSS.supports(property, '#ff0000')) return value;
    paint ??= document.createElement('canvas').getContext('2d');
    if (!paint) return value;
    const read = (sentinel: string) => {
      paint!.fillStyle = sentinel;
      paint!.fillStyle = value;
      return paint!.fillStyle;
    };
    const first = read('#000001');
    return first === read('#000002') ? first : value;
  };

  const angularjsName = (attribute: string) =>
    attribute.replace(/^(x|data)[:\-_]/i, '').replace(/[:\-_]+(.)/g, (_, letter: string) => letter.toUpperCase());

  type Binding = { text: boolean };

  function angularjsBindings(el: Element, injector: AngularJsInjector): Map<string, Binding> {
    const bindings = new Map<string, Binding>();
    const collect = (name: string, form: string) => {
      if (!injector.has(`${name}Directive`)) return;
      for (const directive of injector.get(`${name}Directive`)) {
        if (!directive.restrict.includes(form)) continue;
        for (const map of Object.values(directive.$$bindings ?? {})) {
          for (const binding of Object.values(map ?? {})) {
            const known = bindings.get(binding.attrName);
            bindings.set(binding.attrName, { text: binding.mode === '@' && known?.text !== false });
          }
        }
      }
    };
    collect(angularjsName(el.localName), 'E');
    for (const attribute of el.getAttributeNames()) collect(angularjsName(attribute), 'A');
    for (const token of el.classList) collect(angularjsName(token), 'C');
    return bindings;
  }

  function angularjsDirective(injector: AngularJsInjector, name: string, form: string) {
    return injector.has(`${name}Directive`) && injector.get(`${name}Directive`).filter((d) => d.restrict.includes(form));
  }

  const properties = new Map<string, Map<string, string>>();

  function propertiesOf(el: Element): Map<string, string> {
    const key = `${el.namespaceURI}|${el.localName}`;
    let known = properties.get(key);
    if (!known) {
      known = new Map();
      for (let object: object | null = el; object && object !== Object.prototype; object = Object.getPrototypeOf(object)) {
        for (const name of Object.getOwnPropertyNames(object)) {
          const descriptor = Object.getOwnPropertyDescriptor(object, name)!;
          if (descriptor.enumerable && typeof descriptor.value !== 'function') known.set(name.toLowerCase(), name);
        }
      }
      properties.set(key, known);
    }
    return known;
  }

  function isNative(el: Element, attribute: string): boolean {
    const lower = attribute.toLowerCase();
    if (lower.startsWith('aria-') || lower === 'role') return true;
    if (propertiesOf(el).has(renamedProperties[lower] ?? lower)) return true;
    if (globalAttributes.has(lower)) return true;
    return el.namespaceURI === svgNamespace && svgPresentation.has(lower);
  }

  function angularjsDrops(el: Element, injector: AngularJsInjector, bindings: Map<string, Binding>, attribute: string) {
    const name = angularjsName(attribute);
    if (/^ng(Attr|Prop|On)[A-Z]/.test(name) || angularjsWithoutDirective.has(name)) return true;
    const spanned = /^(.+)(Start|End)$/.exec(name);
    if (spanned && angularjsDirective(injector, spanned[1], 'A') && injector.get(`${spanned[1]}Directive`).some((d) => d.multiElement)) {
      return true;
    }
    const binding = bindings.get(name);
    if (binding && !binding.text) return true;
    const named = angularjsDirective(injector, name, 'A');
    if ((binding || (named && named.length > 0)) && !isNative(el, attribute)) return true;
    return false;
  }

  const isBooleanProperty = (el: Element, attribute: string): boolean => {
    const name = propertiesOf(el).get(attribute);
    return name !== undefined && typeof (el as unknown as Record<string, unknown>)[name] === 'boolean';
  };

  const laidOut = '[laid out]';
  const laidOutNames = new Set(
    'width height inline-size block-size perspective-origin transform-origin top right bottom left inset-block-start inset-block-end inset-inline-start inset-inline-end margin-top margin-right margin-bottom margin-left margin-block-start margin-block-end margin-inline-start margin-inline-end'.split(' '),
  );
  const isLength = (value: string) => /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?px$/.test(value.trim());
  const probe = (() => {
    const html = document.documentElement;
    if (typeof html.computedStyleMap !== 'function') return false;
    return html.computedStyleMap().get('width')?.toString() === 'auto' && getComputedStyle(html).width.endsWith('px');
  })();

  type Longhands = { values: Record<string, string>; layout: Record<string, string> };

  const longhands = (computed: CSSStyleDeclaration, el?: Element): Longhands => {
    const declared = probe && el ? el.computedStyleMap() : undefined;
    const values: Record<string, string> = {};
    const layout: Record<string, string> = {};
    const names = [...[...computed].filter((property) => !property.startsWith('--')), ...[...computed].filter((property) => property.startsWith('--')).sort()];
    for (const property of names) {
      const read = computed.getPropertyValue(property);
      const value = property.startsWith('--') ? resolveUrls(read) : withoutOrigin(read);
      if (property.startsWith('--')) {
        if (isLength(value)) {
          values[property] = laidOut;
          layout[property] = value;
        } else {
          values[property] = value;
        }
      } else if (!value.includes('px') && property !== 'transform') {
        values[property] = value;
      } else if (declared) {
        const typed = declared.get(property)?.toString();
        const written = typed === undefined ? undefined : withoutOrigin(typed);
        if (written === undefined || written === value || (isLength(written) && isLength(value))) {
          values[property] = value;
        } else {
          values[property] = written;
          layout[property] = value;
        }
      } else if (laidOutNames.has(property)) {
        values[property] = laidOut;
        layout[property] = value;
      } else {
        values[property] = value;
      }
    }
    return { values, layout };
  };

  const changedLayout = (own: Record<string, string>, parent: Record<string, string> = {}) =>
    Object.fromEntries(Object.entries(own).filter(([property, value]) => value !== parent[property]));

  const changed = (own: Record<string, string>, parent: Record<string, string> = {}) => {
    const result = Object.fromEntries(Object.entries(own).filter(([property, value]) => value !== parent[property]));
    for (const property of Object.keys(parent)) if (!(property in own)) result[property] = '';
    return result;
  };

  function localStorageItems(): Record<string, string> {
    try {
      return Object.fromEntries(
        Array.from({ length: localStorage.length }, (_, at) => localStorage.key(at)!)
          .sort()
          .map((key) => [key, localStorage.getItem(key)!]),
      );
    } catch {
      return {};
    }
  }

  type Kind = 'inline' | 'atom' | 'block' | 'out' | 'none' | 'break';
  const replaced = new Set(['img', 'video', 'canvas', 'iframe', 'object', 'embed', 'audio', 'svg', 'math']);

  function kindOf(el: Element): Kind {
    if (ignoredTags.has(el.localName)) return 'none';
    if (el.localName === 'br') return 'break';
    if (el.namespaceURI === svgNamespace) {
      if (el.localName === 'svg' && el.parentElement?.namespaceURI !== svgNamespace) return 'atom';
      if (el.localName === 'tspan' || el.localName === 'textPath') return 'inline';
      if (el.localName === 'a' && el.closest('text')) return 'inline';
      return 'block';
    }
    const computed = getComputedStyle(el);
    if (computed.display === 'none') return 'none';
    if (computed.position === 'absolute' || computed.position === 'fixed' || computed.float !== 'none') return 'out';
    if (replaced.has(el.localName)) return 'atom';
    if (/^inline-/.test(computed.display)) return 'atom';
    if (computed.display === 'inline' || computed.display === 'contents' || computed.display.startsWith('ruby')) return 'inline';
    return 'block';
  }

  const texts = new Map<Node, string>();

  const isWrapper = (el: Element) =>
    el.localName.includes('-') &&
    '__ngContext__' in el &&
    el.attributes.length === 0 &&
    customElements.get(el.localName) === undefined &&
    getComputedStyle(el).display === 'contents';

  const childrenOf = (el: Element): ChildNode[] =>
    [...el.childNodes].flatMap((child) =>
      child.nodeType === Node.ELEMENT_NODE && isWrapper(child as Element) ? childrenOf(child as Element) : [child],
    );

  function flow(container: Element): void {
    const tokens: ({ node: Text; collapse: string } | 'break' | 'atom')[] = [];
    const walk = (parent: Element) => {
      const collapse = getComputedStyle(parent).whiteSpaceCollapse;
      for (const child of parent.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          tokens.push({ node: child as Text, collapse });
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const kind = kindOf(child as Element);
          if (kind === 'inline') walk(child as Element);
          else if (kind === 'atom') tokens.push('atom');
          else if (kind === 'break') tokens.push('break');
          else if (kind === 'block') tokens.push('break', 'break');
        }
      }
    };
    if (container.localName !== 'textarea') walk(container);

    const values: string[] = [];
    let lineStart = true;
    let space = false;
    for (const token of tokens) {
      if (token === 'break') {
        lineStart = true;
        space = false;
        values.push('');
      } else if (token === 'atom') {
        lineStart = false;
        space = false;
        values.push('');
      } else {
        const raw = token.node.nodeValue ?? '';
        let value: string;
        if (token.collapse === 'preserve' || token.collapse === 'break-spaces') {
          value = raw;
        } else if (token.collapse === 'preserve-breaks') {
          value = raw
            .replace(/\r\n?/g, '\n')
            .replace(/[ \t]*\n[ \t]*/g, '\n')
            .replace(/[ \t]+/g, ' ');
        } else {
          value = raw.replace(/[ \t\n\r]+/g, ' ');
        }
        const collapsible = token.collapse !== 'preserve' && token.collapse !== 'break-spaces';
        if (collapsible && (lineStart || space) && value.startsWith(' ')) value = value.slice(1);
        if (value !== '') {
          lineStart = value.endsWith('\n');
          space = collapsible && value.endsWith(' ');
        }
        values.push(value);
      }
    }
    let end = true;
    for (let index = tokens.length - 1; index >= 0; index--) {
      const token = tokens[index];
      if (token === 'break') end = true;
      else if (token === 'atom') end = false;
      else {
        let value = values[index];
        const collapsible = token.collapse !== 'preserve' && token.collapse !== 'break-spaces';
        if (collapsible && end && value.endsWith(' ')) value = value.slice(0, -1);
        if (value !== '') end = value.startsWith('\n');
        texts.set(token.node, value);
      }
    }
  }

  function capture(el: Element, path: string, parentStyle?: Record<string, string>, parentLayout?: Record<string, string>): DomNode {
    paths.set(el, path);
    if (kindOf(el) !== 'inline' || el === document.documentElement) flow(el);
    const injector = typeof page.angular?.element === 'function' ? page.angular.element(el).injector() : undefined;
    const bindings = injector && angularjsBindings(el, injector);
    const attrs: Record<string, string> = {};
    for (const name of el.getAttributeNames().sort()) {
      if (injector && bindings && angularjsDrops(el, injector, bindings, name)) continue;
      if (name === 'ng-version' && '__ngContext__' in el) continue;
      if (name === 'data-v-app' && '__vue_app__' in el) continue;
      let value = el.getAttribute(name)!;
      if (name === 'class') {
        const tokens = value.split(/\s+/).filter((token) => token && !(injector && angularjsClass.test(token)));
        if (tokens.length === 0) continue;
        value = [...new Set(tokens)].sort().join(' ');
      } else if (name === 'style') {
        continue;
      } else if (booleanAttributes.has(name) && isBooleanProperty(el, name)) {
        value = '';
      }
      attrs[name] = value;
      if (value === '' && !isNative(el, name)) unread.push({ path, attribute: name });
    }

    const inline: Record<string, string> = {};
    const inlineLayout: Record<string, string> = {};
    const declared = (el as HTMLElement).style;
    if (declared) {
      for (const property of declared) {
        const priority = declared.getPropertyPriority(property);
        const value = colourOf(property, resolveUrls(declared.getPropertyValue(property)));
        if (property.startsWith('--') && isLength(value)) {
          inlineLayout[property] = value + (priority ? ` !${priority}` : '');
          inline[property] = laidOut + (priority ? ` !${priority}` : '');
        } else {
          inline[property] = value + (priority ? ` !${priority}` : '');
        }
      }
    }

    const props: Record<string, string | boolean> = {};
    if (el.localName === 'input') {
      const input = el as HTMLInputElement;
      if (input.type === 'checkbox' || input.type === 'radio') {
        delete attrs.checked;
        props.checked = input.checked;
        if (input.indeterminate) props.indeterminate = true;
      } else {
        delete attrs.value;
        props.value = input.value;
      }
    } else if (el.localName === 'textarea' || el.localName === 'select') {
      props.value = (el as HTMLTextAreaElement | HTMLSelectElement).value;
    } else if (el.localName === 'option') {
      delete attrs.selected;
      props.selected = (el as HTMLOptionElement).selected;
    }

    const accessibility: Record<string, string> = {};
    for (const [name, value] of Object.entries(attrs)) {
      if (name.startsWith('aria-') || name === 'role' || name === 'tabindex' || name === 'required') {
        accessibility[name] = value;
      }
    }
    if (Object.keys(accessibility).length > 0) aria[path] = accessibility;

    const own = longhands(getComputedStyle(el), el);
    const ownStyle = own.values;
    const rect = el.getBoundingClientRect();
    style[path] = {
      style: changed(ownStyle, parentStyle),
      box: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
    };
    const ownLayout = changedLayout(own.layout, parentLayout);
    if (Object.keys(ownLayout).length > 0) style[path].layout = ownLayout;
    for (const pseudo of ['::before', '::after']) {
      const computed = getComputedStyle(el, pseudo);
      if (computed.content === 'none') continue;
      const before = longhands(computed);
      style[`${path}/${pseudo}`] = { style: changed(before.values, ownStyle) };
      const pseudoLayout = changedLayout(before.layout, own.layout);
      if (Object.keys(pseudoLayout).length > 0) style[`${path}/${pseudo}`].layout = pseudoLayout;
    }

    const children: DomNode[] = [];
    const counts: Record<string, number> = {};
    let text = '';
    const flushText = () => {
      if (text !== '') children.push(text);
      text = '';
    };
    if (el.localName !== 'textarea') {
      for (const child of childrenOf(el)) {
        if (child.nodeType === Node.TEXT_NODE) {
          text += texts.get(child) ?? '';
        } else if (child.nodeType === Node.ELEMENT_NODE && !ignoredTags.has((child as Element).localName)) {
          flushText();
          const tag = (child as Element).localName;
          counts[tag] = (counts[tag] ?? 0) + 1;
          children.push(capture(child as Element, `${path}/${tag}[${counts[tag]}]`, ownStyle, own.layout));
        }
      }
    }
    flushText();

    const node: Exclude<DomNode, string> = { tag: el.localName };
    if (Object.keys(attrs).length > 0) node.attrs = attrs;
    if (Object.keys(inline).length > 0) node.inline = inline;
    if (Object.keys(inlineLayout).length > 0) node.layout = inlineLayout;
    if (Object.keys(props).length > 0) node.props = props;
    if (children.length > 0) node.children = children;
    return node;
  }

  const dom = capture(document.documentElement, 'html[1]');

  const pathOf = (el: Element): string => {
    const known = paths.get(el);
    if (known) return known;
    const parent = el.parentNode as Element | ShadowRoot;
    const above = parent instanceof ShadowRoot ? `${pathOf(parent.host)}/shadow-root[1]` : pathOf(parent);
    const alike = [...parent.children].filter((child) => child.localName === el.localName);
    return `${above}/${el.localName}[${alike.indexOf(el) + 1}]`;
  };
  const roots: (Document | ShadowRoot)[] = [document];
  for (const root of roots) {
    for (const element of root.querySelectorAll('*')) {
      const shadow = element.shadowRoot ?? page.__aaShadows?.get(element);
      if (shadow) roots.push(shadow);
      if (page.__aaSecretField?.(element) && (element as HTMLInputElement).value !== '') {
        secretFields.push(pathOf(element));
      }
    }
  }
  return {
    dom,
    style,
    aria,
    focus: (document.activeElement && paths.get(document.activeElement)) ?? null,
    unread,
    secretFields,
    storage: localStorageItems(),
    href: location.href,
    title: document.title,
  };
}
