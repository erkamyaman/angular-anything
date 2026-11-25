import type { Step, Target } from './case.ts';
import type { Layer } from './compare.ts';
import { sha256 } from './lock.ts';
import { parsePath } from './path.ts';
import type { Token } from './path.ts';
import type { Located, Report } from './report.ts';
import { kindOf } from './value.ts';

const words = (list: string) => new Set(list.split(' '));

const ARIA =
  'activedescendant atomic autocomplete busy checked colcount colindex colspan controls current describedby description details disabled errormessage expanded flowto haspopup hidden invalid keyshortcuts label labelledby level live modal multiline multiselectable orientation owns placeholder posinset pressed readonly relevant required roledescription rowcount rowindex rowspan selected setsize sort valuemax valuemin valuenow valuetext';

const KEPT = words(
  'tree attributes attrs props inline layout box style x y width height value checked selected indeterminate name role level disabled expanded pressed text url path query origin fragment requests method body storage gets title focus popups message default target features payload class id type href src alt for placeholder hidden tabindex required lang rel',
).union(words(ARIA.replace(/\S+/g, 'aria-$&')));

const OPEN = words('payload body storage query');
const STYLED = words('style layout inline');
const KEYS = words('Enter Tab Shift+Tab Escape Space Backspace Delete ArrowUp ArrowDown ArrowLeft ArrowRight Home End PageUp PageDown');

const digest = (text: string) => sha256(text).slice(0, 8);
const mark = (text: string) => `<${digest(text)}>`;
const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export const hidden = (text: string): string => `hidden, length ${[...text].length}, hash ${digest(text)}`;

export function shape(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const hash = () => `hash ${digest(JSON.stringify(value))}`;
  if (typeof value === 'string') return `string, length ${[...value].length}, ${hash()}`;
  if (Array.isArray(value)) return `array, length ${value.length}, ${hash()}`;
  const kind = kindOf(value);
  return kind === 'object' ? `object, ${counted(Object.keys(value as object).length, 'key')}, ${hash()}` : kind;
}

export function redactPath(layer: Layer, path: string): string {
  if (path.startsWith('tape ')) {
    const [, method, rest] = /^tape (GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|WebSocket) ([^]*)$/.exec(path) ?? [];
    return method === undefined ? `tape ${mark(path)}` : `tape ${method} ${mark(rest)}`;
  }
  let tokens: Token[];
  try {
    tokens = parsePath(path);
  } catch {
    return mark(path);
  }
  const elements = layer !== 'events' && layer !== 'effects';
  let open = false;
  let before = '';
  let text = '';
  tokens.forEach((token, at) => {
    if (token === '/') text += '/';
    else if ('index' in token) text += `[${token.index ?? '*'}]`;
    else {
      const { key } = token;
      const next = tokens[at + 1];
      let keep: boolean;
      if (elements && (next === '/' || (typeof next === 'object' && 'index' in next) || key.startsWith('::'))) {
        keep = key === 'text()' || /^(::)?[a-zA-Z][a-zA-Z0-9]*$/.test(key);
      } else if (elements) {
        keep = STYLED.has(before) ? /^-?[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(key) : KEPT.has(key);
      } else {
        keep = key === '$order' || (!open && KEPT.has(key));
        open ||= OPEN.has(key);
      }
      if (text !== '' && !text.endsWith('/')) text += '.';
      text += keep ? key : mark(key);
      before = key;
    }
  });
  return text;
}

const redactTarget = ({ role, name, index, within }: Target): string =>
  [
    /^[a-z]+$/.test(role) ? role : mark(role),
    name === undefined ? '' : ` ${mark(name)}`,
    index === undefined ? '' : ` #${index}`,
    within === undefined ? '' : ` in ${redactTarget(within)}`,
  ].join('');

export function redactStep(step: Step): string {
  switch (step.action) {
    case 'goto':
      return `goto ${mark(step.path)}`;
    case 'fill':
      return `fill ${redactTarget(step.target)} with ${mark(step.value)}`;
    case 'press':
      return `press ${KEYS.has(step.key) ? step.key : mark(step.key)} on ${redactTarget(step.target)}`;
    case 'reload':
      return 'reload';
    case 'advance':
      return `advance ${step.frames} frames`;
    default:
      return `${step.action} ${redactTarget(step.target)}`;
  }
}

function redactError(error: string): string {
  if (error.startsWith('the original at ')) return `the original does not match its recording: ${hidden(error)}`;
  const [prefix] = /^(step \d+|cannot replay against the recording)/.exec(error) ?? [];
  return prefix === undefined ? hidden(error) : `${prefix}: ${hidden(error)}`;
}

const redactDifference = <T extends Omit<Located, 'layer' | 'kind'>>(layer: Layer, difference: T): T => ({
  ...difference,
  path: redactPath(layer, difference.path),
  expected: shape(difference.expected),
  actual: shape(difference.actual),
  ...(difference.at ? { at: { offset: difference.at.offset } } : {}),
});

const origin = (href: string) => `${new URL(href).origin}/`;

export function redactReport(report: Report): Report {
  const copy = structuredClone(report);
  copy.url = origin(copy.url);
  if (copy.original !== null) copy.original = origin(copy.original);
  for (const item of copy.cases) {
    if (item.error !== undefined) item.error = redactError(item.error);
    for (const step of item.steps) {
      step.reads = step.reads.map(hidden);
      step.convention = step.convention.map((name) => (KEPT.has(name) ? name : mark(name)));
      for (const result of Object.values(step.layers)) {
        result.first = result.first.map((difference) => redactDifference(difference.layer, difference));
      }
    }
  }
  for (const group of copy.distinct?.differences ?? []) {
    group.path = redactPath(group.layer, group.path);
    group.example = redactDifference(group.layer, group.example);
  }
  for (const literal of copy.literals?.found ?? []) literal.value = shape(literal.value)!;
  return copy;
}
