import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { UsageError } from './case.ts';
import { isPlaceholder } from './value.ts';

export const FAILING_LITERALS = 3;

export type Literal = { file: string; line: number; value: string };

export type LiteralCheck = { result: 'pass' | 'fail'; found: Literal[]; named: { file: string; line: number; name: string }[] };

export type Sources = { originalSource: string; portSource: string };

type Token = { value: string; at: number };

const SKIPPED = /^(node_modules|dist|test|tests|__tests__|\..*)$/;
const TEST_FILE = /\.(test|spec)\.[^.]+$/;
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx|html|css|scss|less|json|vue|svelte|svg)$/;
const NUMBER = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const TOKENS =
  /((?<!\\)\/\*[^]*?\*\/|<!--[^]*?-->|(?<![:\\])\/\/[^\n]*)|("(?:[^"\\\n]|\\[^])*"|'(?:[^'\\\n]|\\[^])*'|`(?:[^`\\]|\\[^])*`)|(?<![\w$.])(\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![\w$])/g;
const QUOTED = /"([^"\n]*)"|'([^'\n]*)'/g;
const SPANNING = /=\s*(?:"([^"]*\n[^"]*)"|'([^']*\n[^']*)')/g;
const BETWEEN_TAGS = />([^<>]+)(?=<)/g;
const TEMPLATE = /\{\{|@(?:if|for|switch|defer|let)\b/;
const BREAKS = /@(?:if|for|switch|defer)\b[^{}]*\{|@let\s[^;]*;|[{}]/g;
const PARTS = /[^<>\0]+/g;
const ACCEPTED = /recorded-literal:[ \t]*(?!-->|\*\/)\S/;

const squeezed = (text: string) => text.replace(/\s+/g, ' ').trim();

function significant(text: string): string | undefined {
  const match = NUMBER.exec(text.replaceAll('_', ''));
  if (!match) return undefined;
  const [, whole, fraction = '', exponent = '0'] = match;
  const digits = (whole + fraction).replace(/^0+/, '');
  const trimmed = digits.replace(/0+$/, '');
  return trimmed.length < 5 ? undefined : `${trimmed}e${Number(exponent) - fraction.length + digits.length - trimmed.length}`;
}

const keyOf = (value: string): string | undefined => {
  const text = squeezed(value);
  const number = significant(text);
  if (number !== undefined) return `number ${number}`;
  return [...text].length >= 8 ? `string ${text}` : undefined;
};

const unescaped = (text: string) =>
  text.replace(/\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([^]))/g, (_, long?: string, four?: string, two?: string, char?: string) => {
    const code = long ?? four ?? two;
    if (code !== undefined) return String.fromCodePoint(Math.min(parseInt(code, 16), 0x10ffff));
    return char === 'n' ? '\n' : char === 't' ? '\t' : char!;
  });

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const decoded = (text: string) => text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => entities[name]);

function markup(text: string, from: number): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(BETWEEN_TAGS)) {
    tokens.push({ value: decoded(match[1]), at: from + match.index + 1 + match[1].search(/\S|$/) });
  }
  for (const match of text.matchAll(QUOTED)) {
    const value = match[1] ?? match[2];
    const at = from + match.index + 1;
    tokens.push({ value: decoded(value), at });
    if (/["']/.test(value)) tokens.push(...markup(value, at));
  }
  for (const match of text.matchAll(SPANNING)) {
    const value = match[1] ?? match[2];
    tokens.push({ value: decoded(value), at: from + match.index + match[0].search(/["']/) + 1 + value.search(/\S|$/) });
  }
  return tokens;
}

function template(text: string, from: number): Token[] {
  if (!TEMPLATE.test(text)) return [];
  const cut = text.replace(BREAKS, (part) => part.replace(/[^\n]/g, '\0'));
  return [...cut.matchAll(PARTS)].map((match) => ({
    value: decoded(unescaped(match[0])),
    at: from + match.index + match[0].search(/\S|$/),
  }));
}

function scan(text: string, file: string): { tokens: Token[]; code: string } {
  const html = /\.(html|svg)$/.test(file);
  const tokens: Token[] = [];
  const code = text.replace(html ? /<!--[^]*?-->/g : TOKENS, (whole: string, comment?: string | number, string?: string, number?: string, at?: number) => {
    if (html || typeof comment === 'string') return whole.replace(/[^\n]/g, ' ');
    if (string !== undefined) {
      tokens.push({ value: unescaped(string.slice(1, -1)), at: at! }, ...template(string.slice(1, -1), at! + 1));
    } else if (number !== undefined) {
      tokens.push({ value: number, at: at! });
    }
    return whole;
  });
  tokens.push(...markup(code, 0), ...(/\.(html|svg|vue)$/.test(file) ? template(code, 0) : []));
  return { tokens, code };
}

const lineOf = (text: string, at: number) => text.slice(0, at).split('\n').length;

async function filesBelow(flag: string, directory: string): Promise<{ file: string; text: string }[]> {
  const info = await stat(directory).catch(() => undefined);
  if (!info?.isDirectory()) throw new UsageError(`${flag} ${directory} is not a folder`);
  const files: { file: string; text: string }[] = [];
  const walk = async (folder: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory() && !SKIPPED.test(entry.name)) await walk(path);
      else if (entry.isFile() && !TEST_FILE.test(entry.name)) {
        files.push({ file: relative(directory, path).split(sep).join('/'), text: await readFile(path, 'utf8') });
      }
    }
  };
  await walk(directory);
  return files.sort((a, b) => (a.file < b.file ? -1 : 1));
}

async function holds(outer: string, inner: string): Promise<boolean> {
  const wanted = await stat(outer).catch(() => undefined);
  let at = await realpath(inner).catch(() => undefined);
  if (!wanted || at === undefined) return false;
  for (;;) {
    const { dev, ino } = await stat(at);
    if (dev === wanted.dev && ino === wanted.ino) return true;
    if (dirname(at) === at) return false;
    at = dirname(at);
  }
}

function collect(value: unknown, keys: Set<string>): void {
  if (isPlaceholder(value)) return;
  if (typeof value === 'number') collect(String(value), keys);
  else if (typeof value === 'string') {
    const key = keyOf(value);
    if (key !== undefined) keys.add(key);
    if (/^\s*[[{]/.test(value)) {
      try {
        collect(JSON.parse(value), keys);
      } catch {}
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const each of Object.values(value)) collect(each, keys);
  }
}

async function recordedKeys(recorded: string, ids: string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const id of ids) {
    for (const name of await readdir(join(recorded, id)).catch(() => [])) {
      if (!/^(\d+|tape)\.json$/.test(name)) continue;
      try {
        collect(JSON.parse(await readFile(join(recorded, id, name), 'utf8')), keys);
      } catch {}
    }
  }
  return keys;
}

export async function checkLiterals({
  recordings,
  ids,
  source,
  originalSource,
  portSource,
}: Sources & { recordings: string; ids: string[]; source: string }): Promise<LiteralCheck> {
  const original = await filesBelow('--original-source', originalSource);
  if (original.length === 0) throw new UsageError(`--original-source ${originalSource} holds no file`);
  const port = (await filesBelow('--port-source', portSource)).filter(({ file }) => SOURCE.test(file));
  if (port.length === 0) throw new UsageError(`--port-source ${portSource} holds no source file`);
  if (await holds(originalSource, portSource)) {
    throw new UsageError(`--original-source ${originalSource} holds the port source, so no literal of the port could be found`);
  }
  if ((await holds(originalSource, recordings)) || (await holds(recordings, originalSource))) {
    throw new UsageError(`--original-source ${originalSource} holds the recordings or is inside them, so no recorded value could be found`);
  }

  const known = new Set<string | undefined>();
  for (const { file, text } of original) for (const { value } of scan(text, file).tokens) known.add(keyOf(value));
  const inOriginal = (value: string) =>
    original.some(({ text }) => [value, squeezed(value), JSON.stringify(value).slice(1, -1)].some((form) => text.includes(form)));

  const keys = await recordedKeys(join(recordings, source), ids);
  const found = new Map<string, Literal>();
  const named: LiteralCheck['named'] = [];
  const names = new RegExp(`(?<![\\w.-])(?:recording|tape|lock)\\.json(?![\\w-])|recordings[\\\\/]${source}(?![\\w-])`, 'g');
  for (const { file, text } of port) {
    const { tokens, code } = scan(text, file);
    const lines = text.split('\n');
    for (const match of code.matchAll(names)) named.push({ file, line: lineOf(text, match.index), name: match[0] });
    for (const { value, at } of tokens.sort((a, b) => a.at - b.at)) {
      const key = keyOf(value);
      if (key === undefined || !keys.has(key) || found.has(key) || known.has(key) || inOriginal(value)) continue;
      const line = lineOf(text, at);
      if (ACCEPTED.test(lines[line - 1])) continue;
      found.set(key, { file, line, value: key.startsWith('number ') ? value : squeezed(value) });
    }
  }
  const result = found.size >= FAILING_LITERALS || named.length > 0 ? 'fail' : 'pass';
  return { result, found: [...found.values()], named };
}
