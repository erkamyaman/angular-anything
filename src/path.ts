export type Token = '/' | { key: string } | { index: number | null };

const BARE = /^[^./[\]*"\\\s]+$/u;

const quote = (key: string): string => `[${JSON.stringify(key)}]`;

export const keyPath = (base: string, key: string): string =>
  BARE.test(key) ? (base === '' ? key : `${base}.${key}`) : `${base}${quote(key)}`;

export const rawKeyPath = (base: string, key: string): string => (base === '' ? key : `${base}.${key}`);

export const indexPath = (base: string, index: number): string => `${base}[${index}]`;

export const treePath = (parent: string, label: string, position: number): string =>
  `${parent === '' ? '' : `${parent}/`}${BARE.test(label) ? label : quote(label)}[${position}]`;

const bareEnd = (text: string, from: number): number => {
  let end = from;
  while (end < text.length && !'./[]*"\\'.includes(text[end]) && !/\s/u.test(text[end])) end++;
  return end;
};

export function parsePath(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  const fail = (why: string): never => {
    throw new Error(`"${text}" is not a path: ${why} at position ${at + 1}`);
  };
  const name = (): Token => {
    const end = bareEnd(text, at);
    if (end === at) return fail('a name is expected');
    const token = { key: text.slice(at, end) };
    at = end;
    return token;
  };
  while (at < text.length) {
    const char = text[at];
    if (char === '/') {
      if (tokens.length === 0 || tokens.at(-1) === '/') fail('a name is expected before "/"');
      tokens.push('/');
      at++;
      if (at >= text.length) fail('a name is expected after "/"');
      tokens.push(name());
    } else if (char === '.') {
      if (tokens.length === 0) fail('a path does not start with "."');
      at++;
      tokens.push(name());
    } else if (char === '[') {
      if (text[at + 1] === '"') {
        let end = at + 2;
        for (; end < text.length && text[end] !== '"'; end++) if (text[end] === '\\') end++;
        let key: unknown;
        try {
          key = JSON.parse(text.slice(at + 1, end + 1));
        } catch {
          fail('the quoted name is not a JSON string');
        }
        if (text[end + 1] !== ']' || typeof key !== 'string') {
          at = end + 1;
          fail('"]" is expected after a quoted name');
        }
        tokens.push({ key: key as string });
        at = end + 2;
      } else {
        const close = text.indexOf(']', at);
        const inside = close < 0 ? '' : text.slice(at + 1, close);
        if (inside === '*') tokens.push({ index: null });
        else if (/^(0|[1-9]\d*)$/.test(inside)) tokens.push({ index: Number(inside) });
        else fail('"[" holds a whole number, "*" or a quoted name');
        at = close + 1;
      }
    } else if (tokens.length === 0) {
      tokens.push(name());
    } else {
      fail(`"${char}" cannot follow the part before it`);
    }
  }
  if (tokens.length === 0) fail('it is empty');
  return tokens;
}

export function formatPath(tokens: Token[]): string {
  let text = '';
  tokens.forEach((token, at) => {
    if (token === '/') text += '/';
    else if ('index' in token) text += `[${token.index ?? '*'}]`;
    else if (!BARE.test(token.key)) text += quote(token.key);
    else text += at === 0 || tokens[at - 1] === '/' ? token.key : `.${token.key}`;
  });
  return text;
}

export type Matcher = { canonical: string; matches(path: string, relaxed?: boolean): boolean };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

export function matcher(tokens: Token[]): Matcher {
  const canonical = formatPath(tokens);
  const wild = tokens.some((token) => typeof token === 'object' && 'index' in token && token.index === null);
  const build = (relaxFirstIndex: boolean) => {
    let relaxed = relaxFirstIndex;
    let source = '^';
    let before = '';
    for (const [at, token] of tokens.entries()) {
      const text = formatPath(tokens.slice(0, at + 1)).slice(before.length);
      before += text;
      if (typeof token === 'object' && 'index' in token && (token.index === null || relaxed)) {
        source += '\\[\\d+\\]';
        relaxed = false;
      } else {
        source += escape(text);
        if (typeof token === 'object' && 'index' in token) relaxed = false;
      }
    }
    return new RegExp(`${source}$`);
  };
  const strict = wild ? build(false) : undefined;
  let loose: RegExp | undefined;
  return {
    canonical,
    matches(path, relaxed = false) {
      if (relaxed) return (loose ??= build(true)).test(path);
      return strict ? strict.test(path) : path === canonical;
    },
  };
}
