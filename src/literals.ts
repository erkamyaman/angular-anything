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
const BLOCK_COMMENT = /(?<!\\)\/\*[^]*?\*\/|<!--[^]*?-->/.source;
const LINE_COMMENT = /(?<![:\\]|url\()\/\/[^\n]*/.source;
const MARKUP_TEXT = /(?!\/[/*](?<=>[^<>;{}()=\n]*..)[^\n]*<\/)/.source;
const REGEX = /\/(?<=(?:^|[(=,:[!&|?{;]|=>|\breturn)[ \t]*\/)(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^\\/[\n])+\/(?![/*])/.source;
const STRING = /"(?:[^"\\\n]|\\[^])*"|'(?:[^'\\\n]|\\[^])*'|`(?:[^`\\]|\\[^])*`/.source;
const DIGITS = /(?<![\w$.])(\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![\w$])/.source;

function tokensOf(file: string): RegExp {
  const text = /\.([jt]sx|vue|svelte)$/.test(file) ? MARKUP_TEXT : '';
  const comment = file.endsWith('.css') ? BLOCK_COMMENT : `${BLOCK_COMMENT}|${LINE_COMMENT}`;
  const regex = /\.([cm]?[jt]s|[jt]sx|vue|svelte)$/.test(file) ? `|${REGEX}` : '';
  return new RegExp(`${text}(${comment})${regex}|(${STRING})|${DIGITS}`, 'gm');
}

const QUOTED = /"([^"\n]*)"|'([^'\n]*)'/g;
const SPANNING = /=\s*(?:"([^"]*\n[^"]*)"|'([^']*\n[^']*)')/g;
const BETWEEN_TAGS = />([^<>]+)(?=<)/g;
const TEMPLATE = /\{\{|@(?:if|for|switch|defer|let)\b|\{[^{}]*,\s*(?:plural|select|selectordinal)\s*,/;
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
    if (code !== undefined) return character(parseInt(code, 16));
    return char === 'n' ? '\n' : char === 't' ? '\t' : char!;
  });

const LATIN =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';
const entities = new Map([
  ...LATIN.split(' ').map((name, at): [string, string] => [name, String.fromCodePoint(160 + at)]),
  ...Object.entries({
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', minus: '−', lsquo: '‘', rsquo: '’', sbquo: '‚',
    ldquo: '“', rdquo: '”', bdquo: '„', lsaquo: '‹', rsaquo: '›', dagger: '†', Dagger: '‡', bull: '•', hellip: '…', permil: '‰',
    prime: '′', Prime: '″', euro: '€', trade: '™', larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔',
  }),
]);

const character = (code: number) => String.fromCodePoint(Math.min(code, 0x10ffff));

const decoded = (text: string) =>
  text.replace(/&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]*));/g, (whole: string, hex?: string, decimal?: string, name?: string) => {
    if (hex !== undefined) return character(parseInt(hex, 16));
    if (decimal !== undefined) return character(Number(decimal));
    return entities.get(name!) ?? whole;
  });

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
  const code = text.replace(html ? /<!--[^]*?-->/g : tokensOf(file), (whole: string, comment?: string | number, string?: string, number?: string, at?: number) => {
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

function canonical(text: string): string | undefined {
  if (!/^\s*[[{]/.test(text)) return undefined;
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return undefined;
  }
}

async function recordedFiles(recordings: string): Promise<Set<string | undefined>> {
  const names = await readdir(recordings, { recursive: true }).catch(() => []);
  const texts = await Promise.all(names.map((name) => readFile(join(recordings, name), 'utf8').catch(() => '')));
  return new Set(texts.map(canonical).filter((each) => each !== undefined));
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

  const copies = await recordedFiles(recordings);
  const own = original.filter(({ text }) => {
    const json = canonical(text);
    return json === undefined || !copies.has(json);
  });
  const known = new Set<string | undefined>();
  for (const { file, text } of own) for (const { value } of scan(text, file).tokens) known.add(keyOf(value));
  const texts = own.flatMap(({ text }) => [text, decoded(text)]);
  const inOriginal = (value: string) =>
    texts.some((text) => [value, squeezed(value), JSON.stringify(value).slice(1, -1)].some((form) => text.includes(form)));

  const keys = await recordedKeys(join(recordings, source), ids);
  const found = new Map<string, Literal>();
  const named: LiteralCheck['named'] = [];
  const names = new RegExp(`(?<![\\w.-])(?:recording|tape|lock)\\.json(?![\\w-])|recordings[\\\\/]${source}(?![\\w-])`, 'g');
  for (const { file, text } of port) {
    const { tokens, code } = scan(text, file);
    const lines = text.split('\n');
    const bare = code.split('\n');
    const accepted = (at: number) => {
      const mark = ACCEPTED.exec(lines[at]);
      return mark !== null && (bare[at][mark.index] === ' ' || /<!--\s*$/.test(lines[at].slice(0, mark.index)));
    };
    for (const match of code.matchAll(names)) named.push({ file, line: lineOf(text, match.index), name: match[0] });
    for (const { value, at } of tokens.sort((a, b) => a.at - b.at)) {
      const key = keyOf(value);
      if (key === undefined || !keys.has(key) || found.has(key) || known.has(key) || inOriginal(value)) continue;
      const line = lineOf(text, at);
      if (accepted(line - 1)) continue;
      found.set(key, { file, line, value: key.startsWith('number ') ? value : squeezed(value) });
    }
  }
  const result = found.size >= FAILING_LITERALS || named.length > 0 ? 'fail' : 'pass';
  return { result, found: [...found.values()], named };
}
