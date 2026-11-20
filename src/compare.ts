import type { Box, DomNode } from './page.ts';

export type Observation = {
  accessibility: { tree: unknown[]; attributes: Record<string, Record<string, string>> };
  dom: DomNode;
  style: Record<string, { style: Record<string, string>; box: Box }>;
  events: { name: string; payload: unknown }[];
  effects: {
    requests: { method: string; url: string; body: unknown }[];
    gets: string[];
    storage: Record<string, string>;
    url: string;
    focus: string | null;
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

export const GEOMETRY_TOLERANCE_PX = 0.5;

// A missing "expected" or "actual" means that side has nothing at the path.
export type Difference = { path: string; expected?: unknown; actual?: unknown };

type Tree = string | { children?: Tree[]; [field: string]: unknown };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function diffValue(expected: unknown, actual: unknown, path: string, tolerance: number, out: Difference[]): void {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    for (let index = 0; index < Math.max(expected.length, actual.length); index++) {
      diffValue(expected[index], actual[index], `${path}[${index}]`, tolerance, out);
    }
  } else if (isObject(expected) && isObject(actual)) {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      diffValue(expected[key], actual[key], path === '' ? key : `${path}.${key}`, tolerance, out);
    }
  } else if (typeof expected === 'number' && typeof actual === 'number') {
    if (Math.abs(expected - actual) > tolerance + 1e-9) out.push({ path, expected, actual });
  } else if (expected !== actual) {
    out.push({ path, expected, actual });
  }
}

function diffTree(expected: Tree[], actual: Tree[], parent: string, kind: 'tag' | 'role', out: Difference[]): void {
  const seen: Record<string, number> = {};
  for (let index = 0; index < Math.max(expected.length, actual.length); index++) {
    const e = expected[index];
    const a = actual[index];
    const node = e ?? a;
    const label = typeof node === 'string' ? 'text()' : String(node[kind]);
    seen[label] = (seen[label] ?? 0) + 1;
    const path = `${parent === '' ? '' : `${parent}/`}${label}[${seen[label]}]`;
    if (isObject(e) && isObject(a) && e[kind] === a[kind]) {
      const { children: expectedChildren = [], ...expectedFields } = e;
      const { children: actualChildren = [], ...actualFields } = a;
      diffValue(expectedFields, actualFields, path, 0, out);
      diffTree(expectedChildren, actualChildren, path, kind, out);
    } else if (e !== a) {
      out.push({ path, expected: withoutChildren(e), actual: withoutChildren(a) });
    }
  }
}

function withoutChildren(node: Tree | undefined): unknown {
  if (!isObject(node)) return node;
  const { children: _, ...fields } = node;
  return fields;
}

export function compare(expected: Observation, actual: Observation): Record<Layer, Difference[]> {
  const result: Record<Layer, Difference[]> = { accessibility: [], dom: [], style: [], events: [], effects: [] };
  diffTree(expected.accessibility.tree as Tree[], actual.accessibility.tree as Tree[], 'tree', 'role', result.accessibility);
  diffValue(expected.accessibility.attributes, actual.accessibility.attributes, 'attributes', 0, result.accessibility);
  diffTree([expected.dom], [actual.dom], '', 'tag', result.dom);
  diffValue(expected.style, actual.style, '', GEOMETRY_TOLERANCE_PX, result.style);
  diffValue(expected.events, actual.events, '', 0, result.events);
  diffValue(expected.effects, actual.effects, '', 0, result.effects);
  return result;
}

// One path that differed between the two recording runs of the original. Steps count from 1.
// A mask covers its path and everything below it.
export type Mask = { step: number; layer: Layer | 'screenshot'; path: string };

export function noiseMask(first: Observation[], second: Observation[]): Mask[] {
  const masked: Mask[] = [];
  first.forEach((observation, index) => {
    const differences = compare(observation, second[index]);
    for (const layer of LAYERS) {
      for (const { path } of differences[layer]) masked.push({ step: index + 1, layer, path });
    }
  });
  return masked;
}

function isMasked(path: string, masked: string[]): boolean {
  return masked.some((mask) => path === mask || (path.startsWith(mask) && '/.['.includes(path[mask.length])));
}

export type LayerResult = { differences: Difference[]; masked: number };

export function compareMasked(
  expected: Observation,
  actual: Observation,
  masked: Mask[],
  step: number,
): Record<Layer, LayerResult> {
  const all = compare(expected, actual);
  const result = {} as Record<Layer, LayerResult>;
  for (const layer of LAYERS) {
    const paths = masked.filter((mask) => mask.step === step && mask.layer === layer).map((mask) => mask.path);
    const differences = all[layer].filter((difference) => !isMasked(difference.path, paths));
    result[layer] = { differences, masked: all[layer].length - differences.length };
  }
  return result;
}
