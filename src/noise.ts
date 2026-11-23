import { compareObservations, LAYER_NAMES, LAYERS } from './compare.ts';
import type { Layer, Observation } from './compare.ts';
import type { UrlParts } from './parts.ts';
import { matcher, parsePath } from './path.ts';
import type { Matcher, Token } from './path.ts';
import { kindOf, maskable, nodesOf, placeholder, walkLayer } from './value.ts';
import type { Kind } from './value.ts';

export type Noise = { layer: Layer; path: string };
export type Entry = Noise & { matcher: Matcher };

const key = (token: Token | undefined): token is { key: string } => typeof token === 'object' && 'key' in token;
const index = (token: Token | undefined): boolean => typeof token === 'object' && 'index' in token;
const words = (...names: string[]) => (token: Token | undefined) => key(token) && names.includes(token.key);

function elementPath(tokens: Token[], from: number, pseudo: boolean): { end: number; text: boolean } | undefined {
  let at = from;
  for (;;) {
    const label = tokens[at];
    if (!key(label)) return undefined;
    at++;
    if (index(tokens[at])) at++;
    else if (!pseudo || !label.key.startsWith('::')) return undefined;
    if (tokens[at] === '/') {
      at++;
      continue;
    }
    return { end: at, text: label.key === 'text()' };
  }
}

const URL_SHAPE = (tokens: Token[]): string | undefined => {
  const [first, second, third] = tokens;
  if (words('origin', 'fragment')(first) && tokens.length === 1) return undefined;
  if (words('path')(first)) return tokens.length === 2 && index(second) ? undefined : 'names the whole path, not one segment of it';
  if (words('query')(first)) {
    if (tokens.length === 3 && key(second) && index(third)) return undefined;
    return 'names a list of query values, not one value: name the parameter and an index';
  }
  return 'is not a part of a URL';
};

const shape: Record<Layer, (tokens: Token[]) => string | undefined> = {
  dom(tokens) {
    const element = elementPath(tokens, 0, false);
    if (!element) return 'does not start with a path of elements';
    const rest = tokens.slice(element.end);
    if (element.text) return rest.length === 0 ? undefined : 'a text node has no fields';
    if (rest.length === 0) return 'names an element, not one value';
    if (rest.length === 2 && words('attrs', 'props', 'inline')(rest[0]) && key(rest[1])) return undefined;
    return 'names an object: use attrs.<name>, props.<name> or inline.<property> of an element';
  },
  accessibility(tokens) {
    if (words('tree')(tokens[0]) && tokens[1] === '/') {
      const element = elementPath(tokens, 2, false);
      if (!element) return 'does not start with a path of elements';
      const rest = tokens.slice(element.end);
      if (element.text) return rest.length === 0 ? undefined : 'a text node has no fields';
      if (rest.length === 1 && key(rest[0]) && rest[0].key !== 'children') return undefined;
      return 'names an element, not one value: add the field, such as .name';
    }
    if (words('attributes')(tokens[0])) {
      const element = elementPath(tokens, 1, false);
      if (!element || element.text) return 'does not name an element';
      const rest = tokens.slice(element.end);
      return rest.length === 1 && key(rest[0]) ? undefined : 'names the attributes of an element, not one value';
    }
    return 'is neither in tree/ nor in attributes.';
  },
  style(tokens) {
    const element = elementPath(tokens, 0, true);
    if (!element) return 'does not start with a path of elements';
    const rest = tokens.slice(element.end);
    const [group, name] = rest;
    if (rest.length === 2 && key(name)) {
      if (words('style')(group)) return undefined;
      if (words('box')(group) && ['x', 'y', 'width', 'height'].includes(name.key)) return undefined;
    }
    return 'is not .style.<longhand> or .box.<x|y|width|height> of an element';
  },
  events(tokens) {
    const [first, second] = tokens;
    if (!index(first)) return 'starts with the index of an event, such as [0]';
    if (words('name')(second) && tokens.length === 2) return undefined;
    if (words('payload')(second)) return undefined;
    return 'is not .name or .payload of an event';
  },
  effects(tokens) {
    const [first, second, third] = tokens;
    if (words('title', 'focus')(first)) return tokens.length === 1 ? undefined : 'a text has no parts';
    if (words('storage')(first)) return key(second) ? undefined : 'names all of the storage: name a key';
    if (words('url')(first)) return URL_SHAPE(tokens.slice(1));
    if (words('gets')(first)) return index(second) ? URL_SHAPE(tokens.slice(2)) : 'names the list, not one value';
    if (words('requests')(first)) {
      if (!index(second)) return 'names the list, not one value';
      if (words('method')(third) && tokens.length === 3) return undefined;
      if (words('body')(third)) return undefined;
      if (words('url')(third)) return URL_SHAPE(tokens.slice(3));
      return 'is not .method, .url or .body of a request';
    }
    if (words('popups')(first)) {
      if (!index(second)) return 'names the list, not one value';
      if (words('message', 'default', 'target', 'features')(third) && tokens.length === 3) return undefined;
      if (words('url')(third)) return URL_SHAPE(tokens.slice(3));
      return 'is not .message, .default, .target, .features or .url of a dialog or window';
    }
    return 'is not requests, gets, storage, url, title, focus or popups';
  },
};

export function compile(list: Noise[]): Entry[] {
  return list.map((entry) => ({ ...entry, matcher: matcher(parsePath(entry.path)) }));
}

export function parseNoise(value: unknown): Noise[] {
  if (!Array.isArray(value)) throw new Error('"noise" must be a list of { "layer", "path" }');
  const seen = new Set<string>();
  return value.map((entry, at) => {
    const where = `noise entry ${at + 1}`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error(`${where} is not an object`);
    const unknown = Object.keys(entry).filter((name) => name !== 'layer' && name !== 'path');
    if (unknown.length > 0) throw new Error(`${where} has the unknown key ${JSON.stringify(unknown[0])}, it takes "layer" and "path"`);
    const { layer, path } = entry as { layer: unknown; path: unknown };
    if (layer === 'screenshot') throw new Error(`${where}: a screenshot is never compared by the gate, so it needs no noise entry`);
    if (typeof layer !== 'string' || !(LAYERS as readonly string[]).includes(layer)) {
      throw new Error(`${where} needs a "layer" of ${LAYERS.join(', ')}`);
    }
    if (typeof path !== 'string') throw new Error(`${where} needs a "path" that is a string`);
    let tokens: Token[];
    try {
      tokens = parsePath(path);
    } catch (error) {
      throw new Error(`${where}: ${(error as Error).message}`);
    }
    const problem = shape[layer as Layer](tokens);
    if (problem) throw new Error(`${where}: the ${LAYER_NAMES[layer as Layer]} path ${JSON.stringify(path)} ${problem}`);
    const id = `${layer} ${matcher(tokens).canonical}`;
    if (seen.has(id)) throw new Error(`${where} is listed twice: ${id}`);
    seen.add(id);
    return { layer: layer as Layer, path };
  });
}

const entriesOf = (entries: Entry[], layer: Layer) => entries.filter((entry) => entry.layer === layer);

export function normalize(observation: Observation, noise: Entry[]): Observation {
  const { gets } = observation.effects;
  if (gets.length < 2) return observation;
  const relaxed = entriesOf(noise, 'effects');
  const order = (get: UrlParts): string => {
    const probe = { effects: { gets: [structuredClone(get)] } };
    const leaves: [string, (value: unknown) => void, Kind][] = [];
    walkLayer('effects', probe, (path, value, set) => {
      if (relaxed.some((entry) => entry.matcher.matches(path, true)) && maskable(kindOf(value))) {
        leaves.push([path, set, kindOf(value)]);
      }
    });
    for (const [, set, kind] of leaves) set(placeholder(kind));
    return JSON.stringify(probe.effects.gets[0]);
  };
  const keyed = gets.map((get) => ({ get, order: order(get) }));
  keyed.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  return { ...observation, effects: { ...observation.effects, gets: keyed.map(({ get }) => get) } };
}

export type Audit = { problems: string[]; unnamed: Noise[]; agreed: Noise[] };

const an = (kind: Kind): string => (kind === 'object' || kind === 'array' || kind === 'empty string' ? `an ${kind}` : `a ${kind}`);

export function audit(entries: Entry[], first: Observation[], second: Observation[]): Audit {
  const problems: string[] = [];
  const unnamed = new Map<string, Noise>();
  const matched = entries.map(() => false);
  const differed = entries.map(() => false);
  const refused = new Set<number>();
  first.forEach((observation, step) => {
    const compared = compareObservations(observation, second[step], false);
    for (const layer of LAYERS) {
      const where = `step ${step + 1}, ${LAYER_NAMES[layer]}`;
      for (const { path, expected, actual } of compared.layers[layer]) {
        const was = kindOf(expected);
        const now = kindOf(actual);
        if (was === 'missing') problems.push(`${where}: ${path} exists in the second run only`);
        else if (now === 'missing') problems.push(`${where}: ${path} exists in the first run only`);
        else if (was !== now) problems.push(`${where}: ${path} is ${an(was)} in the first run and ${an(now)} in the second`);
        else if (!maskable(was)) problems.push(`${where}: ${path} is another ${was === 'object' ? 'element or object' : was} in each run`);
        else {
          const at = entries.findIndex((entry) => entry.layer === layer && entry.matcher.matches(path));
          if (at >= 0) differed[at] = true;
          else unnamed.set(`${layer} ${path}`, { layer, path });
        }
      }
      const mine = entriesOf(entries, layer);
      if (mine.length === 0) continue;
      const left = nodesOf(layer, observation);
      const right = nodesOf(layer, second[step]);
      for (const path of new Set([...left.keys(), ...right.keys()])) {
        entries.forEach((entry, at) => {
          if (entry.layer !== layer || !entry.matcher.matches(path)) return;
          matched[at] = true;
          for (const kind of [kindOf(left.get(path)), kindOf(right.get(path))]) {
            if (kind !== 'missing' && !maskable(kind) && !refused.has(at)) {
              refused.add(at);
              problems.push(`the noise entry ${LAYER_NAMES[layer]} ${entry.path} names ${an(kind)} at ${path} (${where}), not one value`);
            }
          }
        });
      }
    }
  });
  const agreed: Noise[] = [];
  entries.forEach((entry, at) => {
    const noise = { layer: entry.layer, path: entry.path };
    if (!matched[at]) problems.push(`the noise entry ${LAYER_NAMES[entry.layer]} ${entry.path} matches nothing in any step`);
    else if (!differed[at]) agreed.push(noise);
  });
  return { problems, unnamed: [...unnamed.values()], agreed };
}

export type Masked = { observations: Observation[]; counts: number[] };

export function maskObservations(entries: Entry[], first: Observation[], second: Observation[]): Masked {
  const observations = structuredClone(first);
  const counts = entries.map(() => 0);
  const leaves: { pair?: string; kind: Kind; set: (value: unknown) => void }[] = [];
  observations.forEach((observation, step) => {
    for (const layer of LAYERS) {
      const mine = entriesOf(entries, layer);
      if (mine.length === 0) continue;
      const other = nodesOf(layer, second[step]);
      walkLayer(layer, observation, (path, value, set) => {
        const at = entries.findIndex((entry) => entry.layer === layer && entry.matcher.matches(path));
        if (at < 0) return;
        counts[at]++;
        const again = other.get(path);
        const long = typeof value === 'string' && typeof again === 'string' && value.length >= 8 && again.length >= 8;
        leaves.push({ kind: kindOf(value), pair: long ? JSON.stringify([value, again]) : undefined, set });
      });
    }
  });
  const sizes = new Map<string, number>();
  for (const { pair } of leaves) if (pair !== undefined) sizes.set(pair, (sizes.get(pair) ?? 0) + 1);
  const numbers = new Map<string, number>();
  for (const leaf of leaves) {
    let group: number | undefined;
    if (leaf.pair !== undefined && (sizes.get(leaf.pair) ?? 0) > 1) {
      if (!numbers.has(leaf.pair)) numbers.set(leaf.pair, numbers.size + 1);
      group = numbers.get(leaf.pair);
    }
    leaf.set(placeholder(leaf.kind, group));
  }
  return { observations, counts };
}

export function placeholdersOutside(entries: Entry[], observations: Observation[]): string[] {
  const outside: string[] = [];
  observations.forEach((observation, step) => {
    for (const layer of LAYERS) {
      const mine = entriesOf(entries, layer);
      walkLayer(layer, observation, (path, value) => {
        if (typeof value === 'object' && value !== null && (value as { $aa?: unknown }).$aa === 'noise') {
          if (!mine.some((entry) => entry.matcher.matches(path))) outside.push(`step ${step + 1}, ${LAYER_NAMES[layer]}: ${path}`);
        }
      });
    }
  });
  return outside;
}
