import type { DomNode, Style } from './page.ts';
import { isNumberNode } from './parts.ts';
import type { Body, UrlParts } from './parts.ts';
import { indexPath, keyPath, rawKeyPath, treePath } from './path.ts';
import { isLeafNode, isObject, isPlaceholder, kindOf, own } from './value.ts';
import type { Placeholder } from './value.ts';

export type Popup =
  | { kind: 'alert' | 'confirm'; message: string }
  | { kind: 'prompt'; message: string; default: string }
  | { kind: 'print' }
  | { kind: 'open'; url: UrlParts; target: string; features: string };

export type Observation = {
  accessibility: { tree: unknown[]; attributes: Record<string, Record<string, string>> };
  dom: DomNode;
  style: Style;
  events: { name: string; payload: unknown }[];
  effects: {
    requests: { method: string; url: UrlParts; body: Body }[];
    gets: UrlParts[];
    storage: Record<string, unknown>;
    url: UrlParts;
    title: string;
    focus: string | null;
    popups: Popup[];
  };
};

export const LAYERS = ['accessibility', 'dom', 'style', 'events', 'effects'] as const;
export type Layer = (typeof LAYERS)[number];

export const LAYER_NAMES: Record<Layer, string> = {
  accessibility: 'accessibility',
  dom: 'DOM',
  style: 'style and geometry',
  events: 'events',
  effects: 'side effects',
};

export type Difference = { path: string; expected?: unknown; actual?: unknown };

export type Seen = { layer: Layer; path: string; value: unknown; group?: number; from?: string };

type Tree = string | { children?: Tree[]; [field: string]: unknown };

type Out = { differences: Difference[]; seen: Seen[]; layer: Layer };

const masked = (mask: Placeholder) => `a masked ${mask.kind}`;

function diffValue(expected: unknown, actual: unknown, path: string, out: Out, raw = false): void {
  if (isPlaceholder(expected)) {
    if (kindOf(actual) === expected.kind && !isPlaceholder(actual)) {
      out.seen.push({ layer: out.layer, path, value: actual, group: expected.group, from: expected.from });
    } else {
      out.differences.push({ path, expected: masked(expected), actual });
    }
  } else if (isNumberNode(expected) || isNumberNode(actual)) {
    const numeric = (value: unknown) => isNumberNode(value) || typeof value === 'number';
    const text = (value: unknown) => (isNumberNode(value) ? value.source : JSON.stringify(value));
    if (!numeric(expected) || !numeric(actual) || text(expected) !== text(actual)) {
      out.differences.push({ path, expected, actual });
    }
  } else if (Array.isArray(expected) && Array.isArray(actual)) {
    for (let index = 0; index < Math.max(expected.length, actual.length); index++) {
      diffValue(expected[index], actual[index], indexPath(path, index), out);
    }
  } else if (isObject(expected) && isObject(actual)) {
    const order = (value: Record<string, unknown>) => (Array.isArray(value.$order) ? value.$order : Object.keys(value));
    if (own(expected, '$order') || own(actual, '$order')) {
      const left = order(expected).filter((key) => key !== '$order');
      const right = order(actual).filter((key) => key !== '$order');
      if (left.length !== right.length || left.some((key, at) => key !== right[at])) {
        out.differences.push({ path: keyPath(path, '$order'), expected: left, actual: right });
      }
    }
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      if (key === '$order') continue;
      diffValue(
        own(expected, key) ? expected[key] : undefined,
        own(actual, key) ? actual[key] : undefined,
        raw ? rawKeyPath(path, key) : keyPath(path, key),
        out,
      );
    }
  } else if (expected !== actual) {
    out.differences.push({ path, expected, actual });
  }
}

const labelOf = (node: Tree | undefined, kind: 'tag' | 'role'): string =>
  typeof node === 'string' || isPlaceholder(node) ? 'text()' : String((node as Record<string, unknown>)[kind]);

function diffTree(expected: Tree[], actual: Tree[], parent: string, kind: 'tag' | 'role', out: Out): void {
  const seen: Record<string, number> = {};
  for (let index = 0; index < Math.max(expected.length, actual.length); index++) {
    const e = expected[index];
    const a = actual[index];
    const label = labelOf(e ?? a, kind);
    seen[label] = (seen[label] ?? 0) + 1;
    const path = treePath(parent, label, seen[label]);
    if (isPlaceholder(e)) {
      diffValue(e, a, path, out);
    } else if (isObject(e) && isObject(a) && e[kind] === a[kind]) {
      const { children: expectedChildren = [], ...expectedFields } = e;
      const { children: actualChildren = [], ...actualFields } = a;
      diffValue(expectedFields, actualFields, path, out);
      diffTree(expectedChildren, actualChildren, path, kind, out);
    } else if (e !== a) {
      out.differences.push({ path, expected: withoutChildren(e), actual: withoutChildren(a) });
    }
  }
}

function withoutChildren(node: Tree | undefined): unknown {
  if (!isObject(node)) return node;
  const { children: _, ...fields } = node;
  return fields;
}

function inheritStyle(style: Style): Style {
  const full: Style = {};
  for (const [path, own] of Object.entries(style)) {
    const parentPath = path.slice(0, path.lastIndexOf('/'));
    const parent = full[parentPath];
    const inherited: Record<string, unknown> = {};
    for (const [property, value] of Object.entries(parent?.style ?? {})) {
      const mask: unknown = value;
      inherited[property] = isPlaceholder(mask)
        ? { ...mask, group: undefined, from: mask.from ?? `${parentPath}.style.${property}` }
        : value;
    }
    full[path] = { ...own, style: { ...inherited, ...own.style } as Record<string, string> };
  }
  return full;
}

export type Compared = { layers: Record<Layer, Difference[]>; seen: Seen[] };

export function compareObservations(expected: Observation, actual: Observation, inherit = true): Compared {
  const result: Record<Layer, Difference[]> = { accessibility: [], dom: [], style: [], events: [], effects: [] };
  const seen: Seen[] = [];
  const out = (layer: Layer): Out => ({ differences: result[layer], seen, layer });
  diffTree(expected.accessibility.tree as Tree[], actual.accessibility.tree as Tree[], 'tree', 'role', out('accessibility'));
  diffValue(expected.accessibility.attributes, actual.accessibility.attributes, 'attributes', out('accessibility'), true);
  diffTree([expected.dom], [actual.dom], '', 'tag', out('dom'));
  const styles = inherit ? [inheritStyle(expected.style), inheritStyle(actual.style)] : [expected.style, actual.style];
  diffValue(styles[0], styles[1], '', out('style'), true);
  diffValue(expected.events, actual.events, '', out('events'));
  diffValue(expected.effects, actual.effects, '', out('effects'));
  return { layers: result, seen };
}

export const compare = (expected: Observation, actual: Observation): Record<Layer, Difference[]> =>
  compareObservations(expected, actual).layers;

export type LayerResult = { differences: Difference[]; masked: number };

export function compareCase(expected: Observation[], actual: Observation[]): Record<Layer, LayerResult>[] {
  const compared = expected.map((observation, index) => compareObservations(observation, actual[index]));
  const results = compared.map(({ layers, seen }) => {
    const result = {} as Record<Layer, LayerResult>;
    for (const layer of LAYERS) {
      result[layer] = { differences: layers[layer], masked: seen.filter((entry) => entry.layer === layer && !entry.from).length };
    }
    return result;
  });
  const groups = new Map<number, { step: number; entry: Seen }[]>();
  compared.forEach(({ seen }, step) => {
    for (const entry of seen) {
      if (entry.group === undefined) continue;
      groups.set(entry.group, [...(groups.get(entry.group) ?? []), { step, entry }]);
    }
  });
  const tie = (step: number, entry: Seen, reference: string) => {
    results[step][entry.layer].differences.push({ path: entry.path, expected: reference, actual: entry.value });
  };
  for (const members of groups.values()) {
    const [first, ...others] = members;
    for (const { step, entry } of others) {
      if (entry.value !== first.entry.value) {
        tie(step, entry, `the same value as ${LAYER_NAMES[first.entry.layer]} ${first.entry.path} at step ${first.step + 1}`);
      }
    }
  }
  compared.forEach(({ seen }, step) => {
    for (const entry of seen) {
      if (entry.from === undefined) continue;
      const origin = seen.find((other) => other.layer === entry.layer && other.path === entry.from);
      if (origin && origin.value !== entry.value) tie(step, entry, `the same value as ${entry.from}`);
    }
  });
  return results;
}
