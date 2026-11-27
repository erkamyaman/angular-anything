import { LAYERS } from './compare.ts';
import type { Observation } from './compare.ts';
import type { Entry } from './noise.ts';
import { expandJson, isNumberNode, queryFields } from './parts.ts';
import { matcher, parsePath } from './path.ts';
import type { Token } from './path.ts';
import { CREDENTIAL_HEADERS, maskRequest } from './tape.ts';
import type { TapeEntry } from './tape.ts';
import { isObject, walkLayer } from './value.ts';

export const KINDS = ['credential', 'jwt', 'pem', 'bearer-or-basic', 'url-password', 'named-value', 'secret-field'] as const;
export type Kind = (typeof KINDS)[number];

const ACCEPT_LAYERS = [...LAYERS, 'tape'] as const;
export type Accept = { layer: (typeof ACCEPT_LAYERS)[number]; path: string; kind: Kind; reason: string };

export type Finding = { step: number; layer: string; tokens: Token[]; kind: Kind; hidden: Map<number, Kind>; text?: string };

export type Seen = { credentials: Set<string>; bodies: WeakMap<object, Buffer> };

export type Scanned = {
  seen: Seen;
  observations: Observation[];
  fields: string[][];
  tape: TapeEntry[];
  noise: Entry[];
};

const MIN_LENGTH = 16;

export const newSeen = (): Seen => ({ credentials: new Set(), bodies: new WeakMap() });

const percentDecoded = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

export function addCredential(seen: Seen, header: string, text: string): void {
  const value = header === 'authorization' ? text.replace(/^\S+\s+/, '') : text;
  const unquoted = value.replace(/^"(.*)"$/s, '$1');
  const forms = [value, unquoted, percentDecoded(unquoted)];
  if (header === 'authorization' && /^basic\s/i.test(text)) {
    const pair = Buffer.from(value, 'base64').toString('utf8');
    forms.push(pair, pair.slice(pair.indexOf(':') + 1));
  }
  for (const form of forms) if (form.length >= MIN_LENGTH) seen.credentials.add(form);
}

export function addRequest(seen: Seen, headers: Record<string, string>): void {
  for (const name of CREDENTIAL_HEADERS) {
    if (headers[name] !== undefined) addCredential(seen, name, headers[name]);
  }
}

export function addSetCookie(seen: Seen, header: string): void {
  for (const line of header.split('\n')) {
    const [pair] = line.split(';');
    addCredential(seen, 'cookie', pair.slice(pair.indexOf('=') + 1).trim());
  }
}

const upperEscapes = (text: string): string => text.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());

const inBase64 = (bytes: Buffer): string[] =>
  [0, 1, 2].flatMap((before) => {
    const whole = Buffer.concat([Buffer.alloc(before), bytes]).toString('base64');
    const own = whole.slice(Math.ceil((before * 4) / 3), Math.floor(((before + bytes.length) * 4) / 3));
    return [own, own.replaceAll('+', '-').replaceAll('/', '_')];
  });

function holds(text: string, escaped: string, value: string): boolean {
  const bytes = Buffer.from(value);
  const forms = [value, JSON.stringify(value).slice(1, -1), ...inBase64(bytes)];
  const inUrl = [encodeURIComponent(value.toWellFormed()), new URLSearchParams([['', value]]).toString().slice(1)];
  return (
    forms.some((form) => text.includes(form)) ||
    inUrl.some((form) => escaped.includes(form)) ||
    text.toLowerCase().includes(bytes.toString('hex'))
  );
}

const userAndPassword = (value: string): boolean =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(value) && /^[^\x00-\x1f\x7f]*:[^\x00-\x1f\x7f]*$/.test(Buffer.from(value, 'base64').toString('latin1'));

const schemed = (text: string): boolean =>
  [...text.matchAll(/\b(bearer|basic)[ \t]+([A-Za-z0-9._~+/=-]+)/gi)].some(([, scheme, found]) => {
    const value = found.replace(/(?<!\.)\.+$/, '');
    if (value.length < 8) return false;
    return scheme.toLowerCase() === 'basic' ? userAndPassword(value) : /[0-9._~+/=]|.[A-Z]/.test(value);
  });

const webToken = (text: string): boolean =>
  [...text.matchAll(/(?<![\w-])([\w-]+)\.(?=eyJ[\w-]{4,}\.)/g)].some(([, head]) => /eyJ[\w-]{4,}$/.test(head));

const PATTERNS: [Kind, (text: string) => boolean][] = [
  ['jwt', webToken],
  ['pem', (text) => /-----BEGIN [A-Z0-9 ]+-----/.test(text)],
  ['bearer-or-basic', schemed],
  ['url-password', (text) => /:\/\/(?<=[a-z][a-z0-9+.-]*:\/\/)[^\s/?#@:"<>]+:[^\s/?#@"<>]+@/i.test(text)],
];

const SECRET_NAME = /token|secret|password|api_key|session/i;

export function kindsOf(text: string, credentials: Set<string>, key?: string): Kind[] {
  const kinds: Kind[] = [];
  const escaped = upperEscapes(text);
  if ([...credentials].some((value) => holds(text, escaped, value))) kinds.push('credential');
  for (const [kind, found] of PATTERNS) if (found(text)) kinds.push(kind);
  if (key !== undefined && SECRET_NAME.test(key) && text.length >= MIN_LENGTH && !/\s/.test(text) && /\p{L}/u.test(text) && /\d/.test(text)) {
    kinds.push('named-value');
  }
  return kinds;
}

const textKinds = (text: string, credentials: Set<string>, key?: string): Kind[] => {
  const kinds = kindsOf(text, credentials, key);
  if (!text.startsWith('base64:')) return kinds;
  return [...new Set([...kinds, ...kindsOf(Buffer.from(text.slice(7), 'base64').toString('utf8'), credentials)])];
};

export const isSecret = (text: string, names: string[], credentials: Set<string>): boolean =>
  names.some((name) => SECRET_NAME.test(name)) || textKinds(text, credentials, names.at(-1)).length > 0;

const tokensOf = (path: string): Token[] => {
  try {
    return parsePath(path);
  } catch {
    return [{ key: path }];
  }
};

const isKey = (token: Token): token is { key: string } => typeof token === 'object' && 'key' in token;

function finding(step: number, layer: string, tokens: Token[], kind: Kind, credentials: Set<string>, text?: string): Finding {
  const hidden = new Map<number, Kind>();
  tokens.forEach((token, at) => {
    const [found] = isKey(token) ? kindsOf(token.key, credentials) : [];
    if (found) hidden.set(at, found);
  });
  return { step, layer, tokens, kind, hidden, ...(kind === 'named-value' ? { text } : {}) };
}

type Report = (tokens: Token[], kind: Kind, text?: string) => void;

const ownedByTool = (object: Record<string, unknown>): boolean => {
  if ('$order' in object) return Array.isArray(object.$order) && object.$order.every((key) => Object.hasOwn(object, String(key)));
  return isNumberNode(object) && Object.keys(object).every((key) => key === '$aa' || key === 'source');
};

const revealed = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(revealed);
  if (!isObject(value)) return value;
  const kept = ownedByTool(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, below]) => [!kept && /^\$(aa|order)$/.test(key) ? `$${key}` : key, revealed(below)]),
  );
};

function walk(layer: Parameters<typeof walkLayer>[0], document: object, credentials: Set<string>, report: Report) {
  walkLayer(layer, document, (path, value) => {
    const tokens = tokensOf(path);
    const last = tokens.at(-1)!;
    const key = tokens.findLast(isKey)?.key;
    const text =
      typeof value === 'string' ? value : typeof value === 'number' ? String(value) : isNumberNode(value) ? value.source : undefined;
    const kinds = new Set<Kind>([
      ...(isKey(last) ? kindsOf(last.key, credentials) : []),
      ...(text === undefined ? [] : textKinds(text, credentials, key)),
    ]);
    for (const kind of kinds) report(tokens, kind, text);
  });
}

const decoded = (entry: TapeEntry) =>
  entry.answer === null ? '' : Buffer.from(entry.answer.body, entry.answer.base64 ? 'base64' : 'utf8').toString('utf8');

const answerBody = (text: string, type = ''): unknown =>
  type.toLowerCase().startsWith('application/x-www-form-urlencoded') ? queryFields(text) : (expandJson(text, false) ?? text);

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function namedBelow(text: string, credentials: Set<string>): string[] {
  if (parsedJson(text) === undefined) return [];
  let at = 0;
  const unique = text.replace(/"[^"\\]*(?:\\.[^"\\]*)*"(\s*:)?/g, (whole: string, colon?: string) =>
    colon === undefined ? whole : `${whole.slice(0, -colon.length - 1)}\\u0000${at++}"${colon}`,
  );
  const found: string[] = [];
  const walk = (value: unknown, key?: string) => {
    if (typeof value === 'object' && value !== null) {
      for (const [name, below] of Object.entries(value)) walk(below, Array.isArray(value) ? key : name.split('\0')[0]);
      return;
    }
    if (typeof value === 'string') found.push(...namedBelow(value, credentials));
    if (kindsOf(String(value), credentials, key).includes('named-value')) found.push(String(value));
  };
  walk(JSON.parse(unique));
  return found;
}

const keysIn = (value: unknown): number => {
  if (typeof value !== 'object' || value === null) return 0;
  const below = Object.values(value).reduce((sum: number, each) => sum + keysIn(each), 0);
  return below + (Array.isArray(value) ? 0 : Object.keys(value).length);
};

const nestedRepeat = (value: unknown): boolean =>
  typeof value === 'string' ? repeatsKey(value) : typeof value === 'object' && value !== null && Object.values(value).some(nestedRepeat);

function repeatsKey(text: string): boolean {
  const parsed = parsedJson(text);
  if (parsed === undefined) return false;
  const written = [...text.matchAll(/"[^"\\]*(?:\\.[^"\\]*)*"(\s*:)?/g)].filter((match) => match[1] !== undefined);
  return written.length > keysIn(parsed) || nestedRepeat(parsed);
}

export function scanCase({ seen, observations, fields, tape, noise }: Scanned): Finding[] {
  const { credentials } = seen;
  const findings: Finding[] = [];
  observations.forEach((observation, at) => {
    for (const layer of LAYERS) {
      const document = layer === 'events' || layer === 'effects' ? { ...observation, [layer]: revealed(observation[layer]) } : observation;
      walk(layer, document, credentials, (tokens, kind, text) => findings.push(finding(at + 1, layer, tokens, kind, credentials, text)));
    }
  });
  fields.forEach((paths, at) => {
    for (const path of paths) {
      findings.push(finding(at + 1, 'dom', tokensOf(`${path}.props.value`), 'secret-field', credentials));
    }
  });
  tape.forEach((entry, at) => {
    const masked = maskRequest(entry, noise);
    const text = decoded(entry);
    const answer = entry.answer && {
      status: entry.answer.status,
      headers: entry.answer.headers,
      body: answerBody(text, entry.answer.headers['content-type']),
    };
    const events: unknown[] = [];
    events[at] = revealed({ ...masked, answer });
    const found: Finding[] = [];
    walk('events', { events }, credentials, (tokens, kind, value) => found.push(finding(entry.step, 'tape', tokens, kind, credentials, value)));
    const raw = (path: string, bytes: string) => {
      const below = tokensOf(path);
      const repeated = repeatsKey(bytes);
      const shown = repeated
        ? []
        : found.filter((each) => below.every((token, depth) => JSON.stringify(token) === JSON.stringify(each.tokens[depth])));
      for (const kind of kindsOf(bytes, credentials)) {
        if (!shown.some((each) => each.kind === kind)) found.push(finding(entry.step, 'tape', below, kind, credentials));
      }
      for (const value of repeated ? namedBelow(bytes, credentials) : []) {
        found.push(finding(entry.step, 'tape', below, 'named-value', credentials, value));
      }
    };
    const sent = seen.bodies.get(entry);
    if (sent && JSON.stringify(masked.body) === JSON.stringify(entry.body)) raw(`[${at}].body`, sent.toString('utf8'));
    raw(`[${at}].answer.body`, text);
    findings.push(...found);
  });
  return findings;
}

export function scanUrl(url: URL, seen: Seen): Finding[] {
  const found: Finding[] = [];
  for (const [name, values] of Object.entries(queryFields(url.search))) {
    const at: Token[] = [{ key: 'query' }, { key: name }];
    const report = (index: number | undefined, kind: Kind) =>
      found.push(finding(0, 'url', index === undefined ? at : [...at, { index }], kind, seen.credentials));
    for (const kind of kindsOf(name, seen.credentials)) report(undefined, kind);
    values.forEach((value, index) => {
      for (const kind of textKinds(value, seen.credentials, name)) report(index, kind);
    });
  }
  for (const kind of kindsOf(url.href, seen.credentials)) {
    if (!found.some((each) => each.kind === kind)) found.push(finding(0, 'url', [{ key: 'query' }], kind, seen.credentials));
  }
  return found;
}

function printPath({ tokens, hidden }: Finding): string {
  let text = '';
  tokens.forEach((token, at) => {
    const kind = hidden.get(at);
    if (token === '/') text += '/';
    else if (!isKey(token)) text += `[${token.index}]`;
    else if (at === 0 || tokens[at - 1] === '/') text += kind ? `<${kind}>` : matcher([token]).canonical;
    else text += `[${JSON.stringify(kind ? `<${kind}>` : token.key)}]`;
  });
  return text;
}

export function describeFinding(found: Finding): string {
  const where = found.step === 0 ? '--url' : `step ${found.step}`;
  return `${where}, layer ${found.layer}, path ${printPath(found)}: ${found.kind}`;
}

const sameToken = (accepted: Token, found: Token): boolean => {
  if (accepted === '/' || found === '/') return accepted === found;
  if (isKey(accepted)) return isKey(found) && accepted.key === found.key;
  return !isKey(found) && (accepted.index === null || accepted.index === found.index);
};

export function isAccepted(found: Finding, list: Accept[]): boolean {
  return list.some((entry) => {
    if (entry.layer !== found.layer || entry.kind !== found.kind) return false;
    const tokens = parsePath(entry.path);
    return tokens.length === found.tokens.length && tokens.every((token, at) => sameToken(token, found.tokens[at]));
  });
}

const ACCEPT_KEYS = ['layer', 'path', 'kind', 'reason'];

export function parseAccept(value: unknown): Accept[] {
  if (!Array.isArray(value)) throw new Error('"accept" must be a list of { "layer", "path", "kind", "reason" }');
  return value.map((entry, at) => {
    const where = `accept entry ${at + 1}`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error(`${where} is not an object`);
    const unknown = Object.keys(entry).find((name) => !ACCEPT_KEYS.includes(name));
    if (unknown !== undefined) throw new Error(`${where} has the unknown key ${JSON.stringify(unknown)}, it takes ${ACCEPT_KEYS.join(', ')}`);
    const { layer, path, kind, reason } = entry as Record<string, unknown>;
    if (!(ACCEPT_LAYERS as readonly unknown[]).includes(layer)) throw new Error(`${where} needs a "layer" of ${ACCEPT_LAYERS.join(', ')}`);
    if (!(KINDS as readonly unknown[]).includes(kind)) throw new Error(`${where} needs a "kind" of ${KINDS.join(', ')}`);
    if (typeof path !== 'string') throw new Error(`${where} needs a "path" that is a string`);
    try {
      parsePath(path);
    } catch (error) {
      throw new Error(`${where}: ${(error as Error).message}`);
    }
    if (typeof reason !== 'string' || reason === '') throw new Error(`${where} needs a "reason"`);
    return entry as Accept;
  });
}
