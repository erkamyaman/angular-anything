export type DomNode =
  | string
  | {
      tag: string;
      attrs?: Record<string, string>;
      inline?: Record<string, string>;
      props?: Record<string, string | boolean>;
      children?: DomNode[];
    };

export type Box = { x: number; y: number; width: number; height: number };

export type Style = Record<string, { style: Record<string, string>; box?: Box }>;

export type Unread = { path: string; attribute: string }[];

export type PageCapture = {
  dom: DomNode;
  style: Style;
  aria: Record<string, Record<string, string>>;
  focus: string | null;
  unread: Unread;
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
  __aaSync?(request: string, waiting: boolean): void;
  __aaMutations: number;
  __aaRested?: number;
  __aaShadows: WeakMap<Element, ShadowRoot>;
  __aaHeld: WeakSet<SVGSVGElement>;
  __aaSeen: WeakSet<Animation>;
  __aaPending?: Map<unknown, { due: number; delay: number }>;
  __aaFired?: Map<number, Set<number>>;
  __aaFrame(): Promise<void>;
  angular?: AngularJs;
};

export function initPage(): void {
  const page = window as unknown as Instrumented & { __aa: unknown };
  page.__aa = {
    emit(name: string, payload: unknown) {
      let json: string;
      try {
        const holders: unknown[] = [];
        const originals: unknown[] = [];
        json = JSON.stringify({ name, payload: payload ?? null }, function (this: unknown, key, value: unknown) {
          while (holders.length > 0 && holders[holders.length - 1] !== this) {
            holders.pop();
            originals.pop();
          }
          const isObject = typeof value === 'object' && value !== null;
          let result: unknown = value;
          if (isObject && originals.includes(value)) {
            result = { $aa: 'circular' };
            holders.push(result);
            originals.push(result);
            return result;
          }
          if (value === undefined) {
            if (!Array.isArray(this)) return undefined;
            result = key in this ? { $aa: 'undefined' } : { $aa: 'hole' };
          } else if (typeof value === 'bigint') {
            result = { $aa: 'bigint', value: String(value) };
          } else if (typeof value === 'number' && !Number.isFinite(value)) {
            result = { $aa: String(value) };
          } else if (Object.is(value, -0)) {
            result = { $aa: '-0' };
          } else if (value instanceof Set) {
            result = { $aa: 'Set', values: [...value] };
          } else if (value instanceof Map) {
            result = { $aa: 'Map', entries: [...value] };
          } else if (value instanceof Error) {
            result = { $aa: 'Error', name: value.name, message: value.message };
          } else if (value instanceof RegExp) {
            result = { $aa: 'RegExp', source: value.source, flags: value.flags };
          }
          if (typeof result === 'object' && result !== null) {
            holders.push(result);
            originals.push(isObject ? value : result);
          }
          return result;
        });
      } catch {
        json = JSON.stringify({ name, payload: '[unserializable]' });
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
  const paths = new Map<Element, string>();
  const round = (value: number) => Math.round(value * 100) / 100;

  const originPattern = new RegExp(
    `url\\((["']?)${location.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[/?#"')]|$)`,
    'g',
  );

  const inlineUrls = (value: string) =>
    value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)/g, (whole, double?: string, single?: string, bare?: string) => {
      const written = double ?? single ?? bare ?? '';
      if (written === '' || written.startsWith('#')) return whole;
      try {
        return `url("${new URL(written, document.baseURI).href}")`.replace(originPattern, 'url($1[page-origin]');
      } catch {
        return whole;
      }
    });

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

  const longhands = (computed: CSSStyleDeclaration): Record<string, string> =>
    Object.fromEntries(
      [...computed].map((property) => [property, computed.getPropertyValue(property).replace(originPattern, 'url($1[page-origin]')]),
    );

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

  function capture(el: Element, path: string, parentStyle?: Record<string, string>): DomNode {
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
    const declared = (el as HTMLElement).style;
    if (declared) {
      for (const property of declared) {
        const priority = declared.getPropertyPriority(property);
        inline[property] = inlineUrls(declared.getPropertyValue(property)) + (priority ? ` !${priority}` : '');
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

    const ownStyle = longhands(getComputedStyle(el));
    const rect = el.getBoundingClientRect();
    style[path] = {
      style: changed(ownStyle, parentStyle),
      box: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
    };
    for (const pseudo of ['::before', '::after']) {
      const computed = getComputedStyle(el, pseudo);
      if (computed.content === 'none') continue;
      style[`${path}/${pseudo}`] = { style: changed(longhands(computed), ownStyle) };
    }

    const children: DomNode[] = [];
    const counts: Record<string, number> = {};
    let text = '';
    const flushText = () => {
      if (text !== '') children.push(text);
      text = '';
    };
    if (el.localName !== 'textarea') {
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          text += texts.get(child) ?? '';
        } else if (child.nodeType === Node.ELEMENT_NODE && !ignoredTags.has((child as Element).localName)) {
          flushText();
          const tag = (child as Element).localName;
          counts[tag] = (counts[tag] ?? 0) + 1;
          children.push(capture(child as Element, `${path}/${tag}[${counts[tag]}]`, ownStyle));
        }
      }
    }
    flushText();

    const node: Exclude<DomNode, string> = { tag: el.localName };
    if (Object.keys(attrs).length > 0) node.attrs = attrs;
    if (Object.keys(inline).length > 0) node.inline = inline;
    if (Object.keys(props).length > 0) node.props = props;
    if (children.length > 0) node.children = children;
    return node;
  }

  const dom = capture(document.documentElement, 'html[1]');
  return {
    dom,
    style,
    aria,
    focus: (document.activeElement && paths.get(document.activeElement)) ?? null,
    unread,
    storage: localStorageItems(),
    href: location.href,
    title: document.title,
  };
}
