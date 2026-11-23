import type { Layer } from './compare.ts';
import { isNumberNode } from './parts.ts';
import { indexPath, keyPath, rawKeyPath, treePath } from './path.ts';

export type Kind = 'string' | 'empty string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'missing';

export type Placeholder = { $aa: 'noise'; kind: Kind; group?: number; from?: string };

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isPlaceholder = (value: unknown): value is Placeholder => isObject(value) && value.$aa === 'noise';

export const placeholder = (kind: Kind, group?: number): Placeholder =>
  group === undefined ? { $aa: 'noise', kind } : { $aa: 'noise', kind, group };

export function kindOf(value: unknown): Kind {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (typeof value === 'string') return value === '' ? 'empty string' : 'string';
  if (typeof value === 'number' || isNumberNode(value)) return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (isPlaceholder(value)) return value.kind;
  return 'object';
}

export const maskable = (kind: Kind): boolean => ['string', 'empty string', 'number', 'boolean'].includes(kind);

export const isLeafNode = (value: unknown): boolean => isNumberNode(value) || isPlaceholder(value);

export const own = (object: object, key: string): boolean => Object.hasOwn(object, key);

type Tree = string | { children?: Tree[]; [field: string]: unknown };
export type Visit = (path: string, value: unknown, set: (value: unknown) => void) => void;

function walkValue(parent: Record<string, unknown> | unknown[], key: string | number, path: string, visit: Visit, raw: boolean) {
  const holder = parent as Record<string | number, unknown>;
  visit(path, holder[key], (value) => {
    holder[key] = value;
  });
  const current = holder[key];
  if (isLeafNode(current)) return;
  if (Array.isArray(current)) {
    current.forEach((_, index) => walkValue(current, index, indexPath(path, index), visit, false));
  } else if (isObject(current)) {
    for (const name of Object.keys(current)) {
      if (name === '$order') continue;
      walkValue(current, name, raw ? rawKeyPath(path, name) : keyPath(path, name), visit, false);
    }
  }
}

const labelOf = (node: Tree, kind: 'tag' | 'role'): string =>
  typeof node === 'string' || isPlaceholder(node) ? 'text()' : String(node[kind]);

function walkTree(list: Tree[], parent: string, kind: 'tag' | 'role', visit: Visit) {
  const seen: Record<string, number> = {};
  list.forEach((node, index) => {
    const label = labelOf(node, kind);
    seen[label] = (seen[label] ?? 0) + 1;
    const path = treePath(parent, label, seen[label]);
    visit(path, node, (value) => {
      list[index] = value as Tree;
    });
    const current = list[index];
    if (typeof current === 'string' || isPlaceholder(current)) return;
    for (const field of Object.keys(current)) {
      if (field !== 'children') walkValue(current, field, keyPath(path, field), visit, false);
    }
    if (Array.isArray(current.children)) walkTree(current.children, path, kind, visit);
  });
}

export function walkLayer(layer: Layer, observation: Record<string, any>, visit: Visit): void {
  switch (layer) {
    case 'accessibility':
      walkTree(observation.accessibility.tree, 'tree', 'role', visit);
      walkValue(observation.accessibility, 'attributes', 'attributes', visit, true);
      break;
    case 'dom':
      walkTree([observation.dom], '', 'tag', visit);
      break;
    case 'style':
      for (const key of Object.keys(observation.style)) walkValue(observation.style, key, key, visit, false);
      break;
    case 'events':
      observation.events.forEach((_: unknown, index: number) => walkValue(observation.events, index, indexPath('', index), visit, false));
      break;
    case 'effects':
      for (const key of Object.keys(observation.effects)) walkValue(observation.effects, key, keyPath('', key), visit, false);
      break;
  }
}

export function nodesOf(layer: Layer, observation: object): Map<string, unknown> {
  const nodes = new Map<string, unknown>();
  walkLayer(layer, observation, (path, value) => {
    nodes.set(path, value);
  });
  return nodes;
}
