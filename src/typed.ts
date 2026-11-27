import { describeTarget, isNamedKey } from './case.ts';
import type { Case } from './case.ts';
import type { Located, Report } from './report.ts';
import { isObject } from './value.ts';

export const TYPED = '[typed]';
const SHORT = 4;

export type Hide = (text: string) => string;

function typedBy({ steps }: Case): string[] {
  const values: string[] = [];
  let run = '';
  let on = '';
  const end = () => {
    if ([...run].length > 1) values.push(run);
    run = '';
  };
  for (const step of steps) {
    const key = step.action === 'press' && !isNamedKey(step.key) ? step.key : undefined;
    const target = step.action === 'press' ? describeTarget(step.target) : '';
    if (key === undefined || [...key].length > 1 || target !== on) end();
    on = target;
    if (key !== undefined) {
      if ([...key].length > 1) values.push(key);
      else run += key;
    }
    if (step.action === 'fill') values.push(step.value);
  }
  end();
  return values;
}

function forms(value: string): string[] {
  const whole = value.toWellFormed();
  return [whole, whole.trim(), ...whole.split(/[\r\n]+/)]
    .flatMap((line) => [
      line,
      line.replace(/\s+/g, ' ').trim(),
      JSON.stringify(line).slice(1, -1),
      encodeURIComponent(line),
      encodeURI(line),
      new URLSearchParams({ v: line }).toString().slice(2),
    ])
    .filter((form) => form.trim() !== '');
}

export function hider(cases: Case[]): Hide {
  const all = [...new Set(cases.flatMap(typedBy).flatMap(forms))].sort((a, b) => b.length - a.length);
  if (all.length === 0) return (text) => text;
  const alternatives = all.map((form) => {
    const exact = form.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    return [...form].length < SHORT ? `(?<![\\p{L}\\p{N}])${exact}(?![\\p{L}\\p{N}])` : exact;
  });
  const typed = new RegExp(alternatives.join('|'), 'giu');
  return (text) => {
    const [step = ''] = /^\s*step \d+/.exec(text) ?? [];
    return step + text.slice(step.length).replace(typed, TYPED);
  };
}

function hideValue(value: unknown, hide: Hide): unknown {
  if (typeof value === 'string') return hide(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    const shown = hide(String(value));
    return shown === String(value) ? value : shown;
  }
  if (Array.isArray(value)) return value.map((each) => hideValue(each, hide));
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, each]) => [hide(key), hideValue(each, hide)]));
}

function hideDifference<T extends Pick<Located, 'path' | 'expected' | 'actual' | 'at'>>(difference: T, hide: Hide): T {
  const expected = hideValue(difference.expected, hide);
  const actual = hideValue(difference.actual, hide);
  const changed = JSON.stringify([expected, actual]) !== JSON.stringify([difference.expected, difference.actual]);
  return {
    ...difference,
    path: hide(difference.path),
    expected,
    actual,
    ...(difference.at && changed ? { at: { offset: difference.at.offset } } : {}),
  };
}

export function hideReport(report: Report, hide: Hide): Report {
  const copy = structuredClone(report);
  for (const item of copy.cases) {
    if (item.error !== undefined) item.error = hide(item.error);
    for (const step of item.steps) {
      step.action = hide(step.action);
      step.reads = step.reads.map(hide);
      step.convention = step.convention.map(hide);
      for (const result of Object.values(step.layers)) {
        result.first = result.first.map((difference) => hideDifference(difference, hide));
      }
    }
  }
  for (const group of copy.distinct?.differences ?? []) {
    group.path = hide(group.path);
    group.example = hideDifference(group.example, hide);
  }
  for (const literal of copy.literals?.found ?? []) literal.value = hideValue(literal.value, hide) as typeof literal.value;
  return copy;
}
