import type { Observation } from './compare.ts';
import type { DomNode, Style } from './page.ts';

const strip = (node: DomNode): DomNode => {
  if (typeof node === 'string') return node;
  const { layout, children, ...rest } = node;
  return children ? { ...rest, children: children.map(strip) } : rest;
};

const keep = (node: DomNode): DomNode => {
  if (typeof node === 'string') return '';
  const kept: Exclude<DomNode, string> = { tag: node.tag };
  if (node.layout) kept.layout = node.layout;
  if (node.children) kept.children = node.children.map(keep);
  return kept;
};

export function stored(observation: Observation): Observation {
  const style: Style = {};
  for (const [path, entry] of Object.entries(observation.style)) style[path] = { style: entry.style };
  return { ...observation, dom: strip(observation.dom), style };
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
    effects: { requests: [], gets: [], storage: {}, url: { path: [], query: {} }, title: '', focus: null, popups: [] },
  };
}
