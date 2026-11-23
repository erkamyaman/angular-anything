import { createHash } from 'node:crypto';

export type Fields = Record<string, string[]>;
export type UrlParts = { origin?: string; path: string[]; query: Fields; fragment?: string };
export type Part = { type?: string; filename?: string; size?: number; content: string };
export type Body =
  | null
  | string
  | unknown[]
  | { [key: string]: unknown }
  | { $aa: 'form'; fields: Fields }
  | { $aa: 'multipart'; fields: Record<string, Part[]> };

export const NUMBER = 'number';

const reserved = /^\$+(aa|order)$/;
const safeKey = (key: string): string => (reserved.test(key) ? `$${key}` : key);

const canonicalNumber = (text: string): string | undefined => {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return undefined;
  const fraction = match[3] ?? '';
  const digits = (match[2] + fraction).replace(/^0+/, '');
  if (digits === '') return '0';
  const trimmed = digits.replace(/0+$/, '');
  const exponent = Number(match[4] ?? 0) - fraction.length + (digits.length - trimmed.length);
  return `${match[1]}${trimmed}e${exponent}`;
};

const keepsDigits = (value: number, source: string): boolean => {
  const written = canonicalNumber(source);
  return written !== undefined && written !== canonicalNumber(JSON.stringify(value));
};

export const isNumberNode = (value: unknown): value is { $aa: 'number'; source: string } =>
  typeof value === 'object' && value !== null && (value as { $aa?: unknown }).$aa === NUMBER;

export function expandJson(text: string, ordered: boolean): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, function (_key: string, value: unknown, context?: { source?: string }) {
      if (typeof value === 'number') {
        const source = context?.source;
        if (source === undefined) return value;
        if (ordered) return JSON.stringify(value) !== source ? { $aa: NUMBER, source } : value;
        return keepsDigits(value, source) ? { $aa: NUMBER, source: canonicalNumber(source)! } : value;
      }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
      const keys = Object.keys(value);
      const entries = keys.map((key): [string, unknown] => [safeKey(key), (value as Record<string, unknown>)[key]]);
      if (ordered && keys.length > 1) entries.push(['$order', keys.map(safeKey)]);
      return Object.fromEntries(entries);
    } as (key: string, value: unknown) => unknown);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || isNumberNode(parsed)) return undefined;
  return parsed;
}

export const storageValue = (text: string): unknown => expandJson(text, true) ?? text;

export function fieldsOf(pairs: Iterable<[string, string]>): Fields {
  const grouped = new Map<string, string[]>();
  for (const [name, value] of pairs) {
    const list = grouped.get(name);
    if (list) list.push(value);
    else grouped.set(name, [value]);
  }
  return Object.fromEntries(grouped);
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function formDecoded(text: string): string {
  const bytes: number[] = [];
  const raw = text.replace(/\+/g, ' ');
  for (let at = 0; at < raw.length; ) {
    const hex = raw[at] === '%' ? /^[0-9a-fA-F]{2}$/.exec(raw.slice(at + 1, at + 3)) : null;
    if (hex) {
      bytes.push(parseInt(hex[0], 16));
      at += 3;
    } else {
      const point = raw.codePointAt(at)!;
      bytes.push(...Buffer.from(String.fromCodePoint(point), 'utf8'));
      at += point > 0xffff ? 2 : 1;
    }
  }
  const buffer = Buffer.from(bytes);
  try {
    return decoder.decode(buffer);
  } catch {
    return `base64:${buffer.toString('base64')}`;
  }
}

export function queryFields(search: string): Fields {
  const pairs: [string, string][] = [];
  for (const piece of search.replace(/^\?/, '').split('&')) {
    if (piece === '') continue;
    const at = piece.indexOf('=');
    pairs.push(at < 0 ? [formDecoded(piece), ''] : [formDecoded(piece.slice(0, at)), formDecoded(piece.slice(at + 1))]);
  }
  return fieldsOf(pairs);
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function urlParts(href: string, base: URL, kind: 'request' | 'page'): UrlParts {
  const url = new URL(href);
  const segments = url.pathname.split('/').slice(1);
  const parts: UrlParts = {
    path: kind === 'page' ? segments.map(decoded) : segments,
    query: queryFields(url.search),
  };
  if (url.origin !== base.origin) parts.origin = url.origin;
  if (kind === 'page') parts.fragment = url.hash.replace(/^#/, '');
  return parts;
}

const text = (buffer: Buffer): string => {
  const string = buffer.toString('utf8');
  return Buffer.from(string, 'utf8').equals(buffer) ? string : `base64:${buffer.toString('base64')}`;
};

function multipartParts(body: Buffer, boundary: string): Record<string, Part[]> | undefined {
  const raw = body.toString('latin1');
  const delimiter = `--${boundary}`;
  if (!raw.startsWith(delimiter)) return undefined;
  const fields = new Map<string, Part[]>();
  let at = 0;
  for (;;) {
    const after = at + delimiter.length;
    if (raw.startsWith('--', after)) return Object.fromEntries(fields);
    if (raw.slice(after, after + 2) !== '\r\n') return undefined;
    const start = after + 2;
    const next = raw.indexOf(`\r\n${delimiter}`, start);
    if (next < 0) return undefined;
    const section = raw.slice(start, next);
    const split = section.startsWith('\r\n') ? -2 : section.indexOf('\r\n\r\n');
    if (split === -1) return undefined;
    const head = split === -2 ? '' : section.slice(0, split);
    const content = Buffer.from(section.slice(split === -2 ? 2 : split + 4), 'latin1');
    const headers = new Map<string, string>();
    for (const line of head.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
    const disposition = headers.get('content-disposition') ?? '';
    const parameter = (key: string) =>
      new RegExp(`(?:^|;)\\s*${key}="((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(disposition)?.[1];
    const name = Buffer.from(parameter('name') ?? '', 'latin1').toString('utf8');
    const filename = parameter('filename');
    const part: Part =
      filename === undefined
        ? { content: text(content) }
        : {
            filename: Buffer.from(filename, 'latin1').toString('utf8'),
            size: content.length,
            content: `sha256:${createHash('sha256').update(content).digest('hex')}`,
          };
    const type = headers.get('content-type');
    if (type !== undefined) part.type = type;
    const list = fields.get(name);
    if (list) list.push(part);
    else fields.set(name, [part]);
    at = next + 2;
  }
}

export function bodyParts(body: Buffer | null, contentType: string): Body {
  if (body === null) return null;
  const type = contentType.toLowerCase();
  if (type.startsWith('application/x-www-form-urlencoded')) {
    return { $aa: 'form', fields: queryFields(body.toString('utf8')) };
  }
  if (type.startsWith('multipart/') || type === '') {
    const declared = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
    const sniffed = /^--([^\r\n]+)\r\nContent-Disposition:/i.exec(body.subarray(0, 300).toString('latin1'));
    const boundary = declared?.[1] ?? declared?.[2] ?? sniffed?.[1];
    const fields = boundary === undefined ? undefined : multipartParts(body, boundary);
    if (fields) return { $aa: 'multipart', fields };
  }
  const string = body.toString('utf8');
  return (expandJson(string, false) as Body | undefined) ?? string;
}
