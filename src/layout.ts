import type { Observation } from './compare.ts';
import type { DomNode, Style } from './page.ts';
import { LAID_OUT } from './page.ts';
import { keyPath, matcher, parsePath, treePath } from './path.ts';
import { isPlaceholder } from './value.ts';

export type Measured = { layer: 'style' | 'dom'; path: string };

const GROUP = { style: 'style', dom: 'inline' } as const;

export function parseMeasured(value: unknown): Measured[] {
  if (!Array.isArray(value)) throw new Error('"measured" must be a list of { "layer", "path" }');
  const seen = new Set<string>();
  return value.map((entry, at) => {
    const where = `measured entry ${at + 1}`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error(`${where} is not an object`);
    const unknown = Object.keys(entry).find((name) => name !== 'layer' && name !== 'path');
    if (unknown !== undefined) throw new Error(`${where} has the unknown key ${JSON.stringify(unknown)}, it takes "layer" and "path"`);
    const { layer, path } = entry as { layer: unknown; path: unknown };
    if (layer !== 'style' && layer !== 'dom') throw new Error(`${where} needs a "layer" of style, dom`);
    if (typeof path !== 'string') throw new Error(`${where} needs a "path" that is a string`);
    const tokens = parsePath(path);
    const [group, name] = tokens.slice(-2);
    const named = (token: typeof group) => typeof token === 'object' && 'key' in token;
    if (tokens.length < 3 || !named(name) || !named(group) || (group as { key: string }).key !== GROUP[layer]) {
      throw new Error(`${where}: the path ${JSON.stringify(path)} does not end in .${GROUP[layer]}.<property> of an element`);
    }
    const id = `${layer} ${matcher(tokens).canonical}`;
    if (seen.has(id)) throw new Error(`${where} is listed twice: ${id}`);
    seen.add(id);
    return { layer, path };
  });
}

export function measure(observation: Observation, list: Measured[], matched: Set<Measured> = new Set()): Observation {
  if (list.length === 0) return observation;
  const result = structuredClone(observation);
  const entries = list.map((entry) => ({ entry, matcher: matcher(parsePath(entry.path)) }));
  const move = (layer: Measured['layer'], base: string, values: Record<string, string>, layout: () => Record<string, string>) => {
    for (const [property, value] of Object.entries(values)) {
      const path = keyPath(keyPath(base, GROUP[layer]), property);
      const hits = entries.filter((item) => item.entry.layer === layer && item.matcher.matches(path));
      if (hits.length === 0) continue;
      for (const hit of hits) matched.add(hit.entry);
      if (value.startsWith(LAID_OUT)) continue;
      layout()[property] ??= value;
      values[property] = LAID_OUT + (layer === 'dom' ? (/ !important$/.exec(value)?.[0] ?? '') : '');
    }
  };
  for (const [path, entry] of Object.entries(result.style)) move('style', path, entry.style, () => (entry.layout ??= {}));
  const walk = (node: DomNode, parent: string, seen: Record<string, number>) => {
    const label = typeof node === 'string' || isPlaceholder(node) ? 'text()' : node.tag;
    seen[label] = (seen[label] ?? 0) + 1;
    if (typeof node === 'string' || isPlaceholder(node)) return;
    const path = treePath(parent, label, seen[label]);
    if (node.inline) move('dom', path, node.inline, () => (node.layout ??= {}));
    const below: Record<string, number> = {};
    for (const child of node.children ?? []) walk(child, path, below);
  };
  walk(result.dom, '', {});
  return result;
}

const strip = (node: DomNode): DomNode => {
  if (typeof node === 'string') return node;
  const { layout, children, ...rest } = node;
  return children ? { ...rest, children: children.map(strip) } : rest;
};

const keep = (node: DomNode): DomNode => {
  if (typeof node === 'string' || isPlaceholder(node)) return '';
  const kept: Exclude<DomNode, string> = { tag: node.tag };
  if (node.layout) kept.layout = node.layout;
  if (node.children) kept.children = node.children.map(keep);
  return kept;
};

export function stored(observation: Observation): Observation {
  const style: Style = {};
  for (const [path, entry] of Object.entries(observation.style)) style[path] = { style: entry.style };
  const { gets: _, ...effects } = observation.effects;
  return { ...observation, dom: strip(observation.dom), style, effects };
}

export function laidOut(observation: Observation): Observation {
  const style: Style = {};
  for (const [path, entry] of Object.entries(observation.style)) {
    if (!entry.box && !entry.layout) continue;
    style[path] = { style: {} };
    if (entry.layout) style[path].layout = entry.layout;
    if (entry.box) style[path].box = entry.box;
  }
  return {
    accessibility: { tree: [], attributes: {} },
    dom: keep(observation.dom),
    style,
    events: [],
    effects: { requests: [], storage: {}, url: { path: [], query: {} }, title: '', focus: null, popups: [] },
  };
}
