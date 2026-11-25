import { LAYERS } from './compare.ts';
import type { Observation } from './compare.ts';
import type { Entry } from './noise.ts';
import { expandJson, isNumberNode, queryFields } from './parts.ts';
import { matcher, parsePath } from './path.ts';
import type { Token } from './path.ts';
import { CREDENTIAL_HEADERS, maskRequest } from './tape.ts';
import type { TapeEntry } from './tape.ts';
import { walkLayer } from './value.ts';

export const KINDS = ['credential', 'jwt', 'pem', 'bearer-or-basic', 'url-password', 'named-value', 'secret-field'] as const;
export type Kind = (typeof KINDS)[number];

const ACCEPT_LAYERS = [...LAYERS, 'tape'] as const;
export type Accept = { layer: (typeof ACCEPT_LAYERS)[number]; path: string; kind: Kind; reason: string };

export type Finding = { step: number; layer: string; tokens: Token[]; kind: Kind; hidden: Map<number, Kind> };

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

export function addCredential(seen: Seen, header: string, text: string): void {
  const value = header === 'authorization' ? text.replace(/^\S+\s+/, '') : text;
  if (value.length >= MIN_LENGTH) seen.credentials.add(value);
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

function holds(text: string, value: string): boolean {
  const bytes = Buffer.from(value);
  const forms = [
    value,
    JSON.stringify(value).slice(1, -1),
    encodeURIComponent(value.toWellFormed()),
    bytes.toString('base64').replace(/=+$/, ''),
    bytes.toString('base64url'),
  ];
  return forms.some((form) => text.includes(form)) || text.toLowerCase().includes(bytes.toString('hex'));
}

const schemed = (text: string): boolean =>
  [...text.matchAll(/\b(?:bearer|basic)[ \t]+([A-Za-z0-9._~+/=-]+)/gi)].some(([, found]) => {
    const value = found.replace(/\.+$/, '');
    return value.length >= 8 && /[0-9._~+/=]|.[A-Z]/.test(value);
  });

const PATTERNS: [Kind, (text: string) => boolean][] = [
  ['jwt', (text) => /eyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\./.test(text)],
  ['pem', (text) => /-----BEGIN [A-Z0-9 ]+-----/.test(text)],
  ['bearer-or-basic', schemed],
  ['url-password', (text) => /[a-z][a-z0-9+.-]*:\/\/[^\s/?#@:]+:[^\s/?#@]+@/i.test(text)],
];

const SECRET_NAME = /token|secret|password|api_key|session/i;

export function kindsOf(text: string, credentials: Set<string>, key?: string): Kind[] {
  const kinds: Kind[] = [];
  if ([...credentials].some((value) => holds(text, value))) kinds.push('credential');
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

const tokensOf = (path: string): Token[] => {
  try {
    return parsePath(path);
  } catch {
    return [{ key: path }];
  }
};

const isKey = (token: Token): token is { key: string } => typeof token === 'object' && 'key' in token;

function finding(step: number, layer: string, tokens: Token[], kind: Kind, credentials: Set<string>): Finding {
  const hidden = new Map<number, Kind>();
  tokens.forEach((token, at) => {
    const [found] = isKey(token) ? kindsOf(token.key, credentials) : [];
    if (found) hidden.set(at, found);
  });
  return { step, layer, tokens, kind, hidden };
}

function walk(layer: Parameters<typeof walkLayer>[0], document: object, credentials: Set<string>, report: (tokens: Token[], kind: Kind) => void) {
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
    for (const kind of kinds) report(tokens, kind);
  });
}

const decoded = (entry: TapeEntry) =>
  entry.answer === null ? '' : Buffer.from(entry.answer.body, entry.answer.base64 ? 'base64' : 'utf8').toString('utf8');

export function scanCase({ seen, observations, fields, tape, noise }: Scanned): Finding[] {
  const { credentials } = seen;
  const findings: Finding[] = [];
  observations.forEach((observation, at) => {
    for (const layer of LAYERS) {
      walk(layer, observation, credentials, (tokens, kind) => findings.push(finding(at + 1, layer, tokens, kind, credentials)));
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
    const answer = entry.answer && { status: entry.answer.status, headers: entry.answer.headers, body: expandJson(text, false) ?? text };
    const events: unknown[] = [];
    events[at] = { ...masked, answer };
    const found: Finding[] = [];
    walk('events', { events }, credentials, (tokens, kind) => found.push(finding(entry.step, 'tape', tokens, kind, credentials)));
    const raw = (path: string, bytes: string) => {
      const below = tokensOf(path);
      const shown = found.filter((each) => below.every((token, depth) => JSON.stringify(token) === JSON.stringify(each.tokens[depth])));
      for (const kind of kindsOf(bytes, credentials)) {
        if (!shown.some((each) => each.kind === kind)) found.push(finding(entry.step, 'tape', below, kind, credentials));
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
