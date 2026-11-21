export type DomNode =
  | string
  | { tag: string; attrs?: Record<string, string>; props?: Record<string, string | boolean>; children?: DomNode[] };

export type Box = { x: number; y: number; width: number; height: number };

// Per element path: the border box and the computed longhands whose value differs from the parent element's.
// The html element holds every longhand, and a parent is always listed before its children.
// A ::before or ::after with content is listed as <element path>/::before, without a box.
export type Style = Record<string, { style: Record<string, string>; box?: Box }>;

export type PageCapture = {
  dom: DomNode;
  style: Style;
  aria: Record<string, Record<string, string>>;
  focus: string | null;
  storage: Record<string, string>;
  href: string;
  title: string;
};

type AngularJs = {
  element(el: Element): { injector(): AngularJsInjector | undefined };
};
type AngularJsInjector = {
  modules?: Record<string, { _invokeQueue: [string, string, [string | Record<string, unknown>]][] }>;
  get(name: string): {
    restrict: string;
    $$bindings?: Record<string, Record<string, { attrName: string; mode: string }> | null>;
  }[];
};
type Instrumented = {
  __aaEmit(json: string): void;
  __aaMutations: number;
  __aaRested?: number;
  __aaFrame(): Promise<void>;
  angular?: AngularJs;
};

// Runs in the page before any page script. Defines window.__aa.emit and counts DOM mutations.
export function initPage(): void {
  const page = window as unknown as Instrumented & { __aa: unknown };
  page.__aa = {
    emit(name: string, payload: unknown) {
      let json: string;
      try {
        json = JSON.stringify({ name, payload: payload ?? null });
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
}

export function clampIntervals(): void {
  const setInterval = window.setInterval;
  window.setInterval = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) =>
    setInterval(handler, Math.max(1, Number(delay) || 0), ...rest)) as typeof window.setInterval;
}

export function browserFrame(): Promise<void> {
  return (window as unknown as Instrumented).__aaFrame();
}

export async function restPage(): Promise<boolean> {
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
  let moved = page.__aaMutations !== page.__aaRested;
  page.__aaRested = page.__aaMutations;
  const roots: (Document | ShadowRoot)[] = [document];
  for (const root of roots) {
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
    for (const animation of root.getAnimations()) {
      if (animation.playState !== 'running') continue;
      moved = true;
      if (animation.effect?.getComputedTiming().endTime === Infinity) {
        animation.pause();
        animation.currentTime = 0;
      } else {
        animation.finish();
      }
    }
  }
  if (moved) {
    await page.__aaFrame();
    await tasks();
  }
  return moved;
}

// Runs in the page, so it must not use anything from outside its own body.
// A framework artifact is dropped only where that framework is proven for the element:
// AngularJS by the injector of the element, Vue and Angular by the property they set on their root element.
export function capturePage(): PageCapture {
  const page = window as unknown as Instrumented;
  const ignoredTags = new Set(['head', 'script', 'style', 'link']);
  const booleanAttributes = new Set(
    'allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected'.split(
      ' ',
    ),
  );
  const angularjsAttribute = /^(data-)?ng-/;
  const angularjsClass =
    /^ng-(scope|isolate-scope|binding|pristine|dirty|touched|untouched|valid|invalid|pending|empty|not-empty|submitted|(valid|invalid)-.+)$/;

  const style: Style = {};
  const aria: PageCapture['aria'] = {};
  const paths = new Map<Element, string>();
  const round = (value: number) => Math.round(value * 100) / 100;

  const angularjsName = (attribute: string) =>
    attribute.replace(/^(x|data)[:\-_]/i, '').replace(/[:\-_]+(.)/g, (_, letter: string) => letter.toUpperCase());
  const angularjsDirectives = new Map<AngularJsInjector, Set<string>>();

  // The attributes on el that an attribute directive registered in the injector reads, by normalized name:
  // the name of the directive and the bindings it declares. False means the value is an AngularJS expression,
  // true means it is text, which the browser may read as well.
  function angularjsDirectiveAttributes(el: Element, injector: AngularJsInjector): Map<string, boolean> {
    const names = new Map<string, boolean>();
    if (!injector.modules) return names;
    let registered = angularjsDirectives.get(injector);
    if (!registered) {
      registered = new Set();
      for (const module of Object.values(injector.modules)) {
        for (const [, method, [name]] of module._invokeQueue) {
          if (method !== 'directive') continue;
          for (const each of typeof name === 'string' ? [name] : Object.keys(name)) registered.add(each);
        }
      }
      angularjsDirectives.set(injector, registered);
    }
    const add = (name: string, text: boolean) => names.set(name, text && names.get(name) !== false);
    for (const attribute of el.getAttributeNames()) {
      const name = angularjsName(attribute);
      if (!registered.has(name)) continue;
      for (const directive of injector.get(`${name}Directive`)) {
        if (!directive.restrict.includes('A')) continue;
        add(name, true);
        for (const bindings of Object.values(directive.$$bindings ?? {})) {
          for (const binding of Object.values(bindings ?? {})) add(binding.attrName, binding.mode === '@');
        }
      }
    }
    return names;
  }

  const properties = new Map<string, Set<string>>();

  // True when the browser itself reads the attribute on this element: aria-*, role, or a property of the same name.
  function isNative(el: Element, attribute: string): boolean {
    if (attribute.startsWith('aria-') || attribute === 'role') return true;
    let known = properties.get(el.localName);
    if (!known) {
      known = new Set();
      for (const key in el) known.add(key.toLowerCase());
      properties.set(el.localName, known);
    }
    return known.has(attribute);
  }

  const longhands = (computed: CSSStyleDeclaration): Record<string, string> =>
    Object.fromEntries([...computed].map((property) => [property, computed.getPropertyValue(property)]));

  const changed = (own: Record<string, string>, parent: Record<string, string> = {}) =>
    Object.fromEntries(Object.entries(own).filter(([property, value]) => value !== parent[property]));

  function localStorageItems(): Record<string, string> {
    try {
      return Object.fromEntries(
        Object.keys(localStorage)
          .sort()
          .map((key) => [key, localStorage.getItem(key)!]),
      );
    } catch {
      return {};
    }
  }

  function capture(el: Element, path: string, parentStyle?: Record<string, string>): DomNode {
    paths.set(el, path);
    const injector = page.angular?.element(el).injector();
    const directiveAttributes = injector && angularjsDirectiveAttributes(el, injector);
    const attrs: Record<string, string> = {};
    for (const name of el.getAttributeNames().sort()) {
      if (injector && angularjsAttribute.test(name)) continue;
      if (name === 'ng-version' && '__ngContext__' in el) continue;
      if (name === 'data-v-app' && '__vue_app__' in el) continue;
      const text = directiveAttributes?.get(angularjsName(name));
      if (text === false || (text && !isNative(el, name))) continue;
      let value = el.getAttribute(name)!;
      if (name === 'class') {
        const tokens = value.split(/\s+/).filter((token) => token && !(injector && angularjsClass.test(token)));
        if (tokens.length === 0) continue;
        value = [...new Set(tokens)].sort().join(' ');
      } else if (name === 'style' && value.trim() === '') {
        continue;
      } else if (booleanAttributes.has(name) && value !== 'until-found') {
        value = '';
      }
      attrs[name] = value;
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
      if (/[^ \t\n\f\r]/.test(text)) children.push(text);
      text = '';
    };
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.nodeValue;
      } else if (child.nodeType === Node.ELEMENT_NODE && !ignoredTags.has((child as Element).localName)) {
        flushText();
        const tag = (child as Element).localName;
        counts[tag] = (counts[tag] ?? 0) + 1;
        children.push(capture(child as Element, `${path}/${tag}[${counts[tag]}]`, ownStyle));
      }
    }
    flushText();

    const node: Exclude<DomNode, string> = { tag: el.localName };
    if (Object.keys(attrs).length > 0) node.attrs = attrs;
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
    storage: localStorageItems(),
    href: location.href,
    title: document.title,
  };
}
