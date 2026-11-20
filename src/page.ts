export type DomNode =
  | string
  | { tag: string; attrs?: Record<string, string>; props?: Record<string, string | boolean>; children?: DomNode[] };

export type Box = { x: number; y: number; width: number; height: number };

export type PageCapture = {
  dom: DomNode;
  style: Record<string, { style: Record<string, string>; box: Box }>;
  aria: Record<string, Record<string, string>>;
  focus: string | null;
  storage: Record<string, string>;
  href: string;
  mutations: number;
};

type AngularJs = {
  element(el: Element): { injector(): AngularJsInjector | undefined };
};
type AngularJsInjector = {
  modules?: Record<string, { _invokeQueue: [string, string, [string | Record<string, unknown>]][] }>;
  get(name: string): {
    restrict: string;
    $$bindings?: Record<string, Record<string, { attrName: string }> | null>;
  }[];
};
type Instrumented = { __aaEmit(json: string): void; __aaMutations?: number; angular?: AngularJs };

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
    page.__aaMutations! += records.length;
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
}

// Runs in the page, so it must not use anything from outside its own body.
export function capturePage(): PageCapture {
  const page = window as unknown as Instrumented;
  const ignoredTags = new Set(['script', 'style', 'link']);
  const booleanAttributes = new Set(
    'allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected'.split(
      ' ',
    ),
  );
  const artifactAttributes = {
    angular: /^(_ngcontent-|_nghost-|ng-reflect-|ng-version$)/,
    angularjs: /^(data-)?ng-/,
    vue: /^data-v-(app|[0-9a-f]{8})$/,
  };
  const angularjsClass =
    /^ng-(scope|isolate-scope|binding|pristine|dirty|touched|untouched|valid|invalid|pending|empty|not-empty|submitted|(valid|invalid)-.+)$/;
  const reactUseId = /(?<![\w-])(:r[0-9a-v]+:|«r[0-9a-v]+»|_r_[0-9a-v]+_)(?!\w)/g;
  const styleProperties = [
    'display visibility opacity position z-index float overflow-x overflow-y box-sizing vertical-align',
    'color font-family font-size font-weight font-style line-height letter-spacing text-align',
    'text-decoration-line text-decoration-color text-decoration-style text-transform white-space',
    'margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left',
    'border-top-width border-right-width border-bottom-width border-left-width',
    'border-top-style border-right-style border-bottom-style border-left-style',
    'border-top-color border-right-color border-bottom-color border-left-color',
    'border-top-left-radius border-top-right-radius border-bottom-right-radius border-bottom-left-radius',
    'background-color background-image box-shadow outline-style outline-width outline-color outline-offset',
    'cursor pointer-events transform list-style-type accent-color',
    'flex-direction flex-wrap flex-grow flex-shrink flex-basis justify-content align-items align-self row-gap column-gap',
  ].flatMap((group) => group.split(' '));

  const style: PageCapture['style'] = {};
  const aria: PageCapture['aria'] = {};
  const paths = new Map<Element, string>();
  const useIds = new Map<string, string>();
  const round = (value: number) => Math.round(value * 100) / 100;

  const angularjsName = (attribute: string) =>
    attribute.replace(/^(x|data)[:\-_]/i, '').replace(/[:\-_]+(.)/g, (_, letter: string) => letter.toUpperCase());
  const angularjsDirectives = new Map<AngularJsInjector, Set<string>>();

  // The normalized names of the attributes on el that invoke an attribute directive registered in the page's
  // AngularJS injector, and of the bindings those directives declare.
  function angularjsDirectiveAttributes(el: Element): Set<string> {
    const names = new Set<string>();
    const injector = page.angular?.element(el).injector();
    if (!injector?.modules) return names;
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
    for (const attribute of el.getAttributeNames()) {
      const name = angularjsName(attribute);
      if (!registered.has(name)) continue;
      for (const directive of injector.get(`${name}Directive`)) {
        if (!directive.restrict.includes('A')) continue;
        names.add(name);
        for (const bindings of Object.values(directive.$$bindings ?? {})) {
          for (const binding of Object.values(bindings ?? {})) names.add(binding.attrName);
        }
      }
    }
    return names;
  }

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

  function capture(el: Element, path: string): DomNode {
    paths.set(el, path);
    const directiveAttributes = angularjsDirectiveAttributes(el);
    const attrs: Record<string, string> = {};
    for (const name of el.getAttributeNames().sort()) {
      if (Object.values(artifactAttributes).some((artifact) => artifact.test(name))) continue;
      if (directiveAttributes.has(angularjsName(name))) continue;
      let value = el.getAttribute(name)!;
      if (name === 'class') {
        const tokens = value.split(/\s+/).filter((token) => token && !angularjsClass.test(token));
        if (tokens.length === 0) continue;
        value = [...new Set(tokens)].sort().join(' ');
      } else if (name === 'style' && value.trim() === '') {
        continue;
      } else if (booleanAttributes.has(name) && value !== 'until-found') {
        value = '';
      } else {
        value = value.replace(reactUseId, (id) => {
          if (!useIds.has(id)) useIds.set(id, `useId#${useIds.size + 1}`);
          return useIds.get(id)!;
        });
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

    const computed = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    style[path] = {
      style: Object.fromEntries(styleProperties.map((property) => [property, computed.getPropertyValue(property)])),
      box: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
    };

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
        children.push(capture(child as Element, `${path}/${tag}[${counts[tag]}]`));
      }
    }
    flushText();

    const node: Exclude<DomNode, string> = { tag: el.localName };
    if (Object.keys(attrs).length > 0) node.attrs = attrs;
    if (Object.keys(props).length > 0) node.props = props;
    if (children.length > 0) node.children = children;
    return node;
  }

  const dom = capture(document.body, 'body[1]');
  return {
    dom,
    style,
    aria,
    focus: (document.activeElement && paths.get(document.activeElement)) ?? null,
    storage: localStorageItems(),
    href: location.href,
    mutations: page.__aaMutations ?? 0,
  };
}
