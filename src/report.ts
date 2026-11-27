import { join } from 'node:path';
import { LAYERS, LAYER_NAMES } from './compare.ts';
import type { Difference, DifferenceKind, Layer, LayerResult } from './compare.ts';
import { FAILING_LITERALS } from './literals.ts';
import type { LiteralCheck } from './literals.ts';
import { sha256 } from './lock.ts';
import type { Unread } from './page.ts';
import { collapseIndices, keyPath } from './path.ts';
import { stepFile } from './record.ts';
import { isObject, kindOf } from './value.ts';

export const REPORT_FORMAT = 'angular-anything/report@1';
const KEPT_DIFFERENCES = 10;
const LISTED_GROUPS = 20;
const CONTEXT = 16;

export type At = { offset: number; expected?: string; actual?: string };

export type Located = Difference & { layer: Layer; kind: DifferenceKind; at?: At };

export type Found = { case: string; step: number; difference: Located };

export type Group = {
  id: string;
  layer: Layer;
  path: string;
  kind: DifferenceKind;
  count: number;
  cases: number;
  example: { case: string; step: number; path: string; expected?: unknown; actual?: unknown; at?: At };
};

export type Distinct = { cases: number; differences: Group[] };

function firstCharacter(expected: string, actual: string): At {
  const [left, right] = [[...expected], [...actual]];
  let offset = 0;
  while (offset < left.length && left[offset] === right[offset]) offset++;
  const context = (text: string[]) =>
    `${text.slice(Math.max(0, offset - CONTEXT), offset).join('')}⟨${text[offset] ?? ''}⟩${text.slice(offset + 1, offset + 1 + CONTEXT).join('')}`;
  return { offset, expected: context(left), actual: context(right) };
}

function kindBetween(expected: unknown, actual: unknown): DifferenceKind {
  if (actual === undefined) return 'missing';
  if (expected === undefined) return 'extra';
  if (typeof expected === 'string' && typeof actual === 'string') return 'text';
  return kindOf(expected) === kindOf(actual) ? 'value' : 'type';
}

export function locate(layer: Layer, { path, expected, actual, kind = kindBetween(expected, actual) }: Difference): Located {
  const located: Located = { layer, path, kind, expected, actual };
  if (kind === 'text') located.at = firstCharacter(expected as string, actual as string);
  return located;
}

export function distinct(found: Found[]): Distinct {
  const groups = new Map<string, { group: Group; seen: Set<string> }>();
  for (const { case: id, step, difference } of found) {
    const { layer, kind, path, expected, actual, at } = difference;
    const collapsed = path.startsWith('tape ') ? path : collapseIndices(path);
    const key = sha256(JSON.stringify([layer, collapsed, kind])).slice(0, 8);
    let entry = groups.get(key);
    if (!entry) {
      const example = { case: id, step, path, expected, actual, ...(at ? { at } : {}) };
      entry = { group: { id: key, layer, path: collapsed, kind, count: 0, cases: 0, example }, seen: new Set() };
      groups.set(key, entry);
    }
    entry.group.count++;
    entry.group.cases = entry.seen.add(id).size;
  }
  return {
    cases: new Set(found.map((each) => each.case)).size,
    differences: [...groups.values()].map(({ group }) => group).sort((a, b) => b.count - a.count || b.cases - a.cases),
  };
}

export type StepReport = {
  step: number;
  action: string;
  result: 'pass' | 'fail';
  settleMs: number;
  captures: number;
  frames: number;
  screenshot: 'identical' | 'different' | 'masked' | 'not compared';
  layers: Record<Layer, { differences: number; masked: number; first: Located[] }>;
  convention: string[];
  reads: string[];
};

export type DriftState = 'matches' | 'differs' | 'not checked';

export type CaseReport = {
  id: string;
  result: 'pass' | 'fail';
  stepCount: number;
  steps: StepReport[];
  root?: string;
  lock?: string[];
  error?: string;
  credentials?: string[];
  drift?: { original: DriftState; port: DriftState; sizes?: 'differ' };
};

export type Report = {
  format: typeof REPORT_FORMAT;
  command: 'replay' | 'gate' | 'drift';
  suite: string;
  source: string;
  url: string;
  original: string | null;
  playwright: string;
  browser: string;
  result: 'pass' | 'fail';
  cases: CaseReport[];
  distinct?: Distinct;
  literals?: LiteralCheck;
};

function onlyUnreadAttributes(differences: Difference[], unread: Unread): string[] {
  if (differences.length === 0) return [];
  const single = new Map<string, string>();
  const all = new Map<string, Set<string>>();
  for (const { path, attribute } of unread) {
    const attrs = keyPath(path, 'attrs');
    single.set(keyPath(attrs, attribute), attribute);
    all.set(attrs, (all.get(attrs) ?? new Set()).add(attribute));
  }
  const found: string[] = [];
  for (const { path, expected, actual } of differences) {
    const name = single.get(path);
    const group = all.get(path);
    if (name !== undefined && expected === undefined && actual === '') {
      found.push(name);
    } else if (group && expected === undefined && isObject(actual) && Object.keys(actual).length > 0) {
      const entries = Object.entries(actual);
      if (!entries.every(([key, value]) => group.has(key) && value === '')) return [];
      found.push(...entries.map(([key]) => key));
    } else {
      return [];
    }
  }
  return [...new Set(found)].sort();
}

export function stepReport(
  step: number,
  action: string,
  timing: { settleMs: number; captures: number; frames: number },
  screenshot: StepReport['screenshot'],
  layers: Record<Layer, LayerResult>,
  unread: Unread = [],
  reads: string[] = [],
): StepReport {
  const { settleMs, captures, frames } = timing;
  const report = { step, action, result: 'pass', settleMs, captures, frames, screenshot, layers: {} } as StepReport;
  report.reads = reads;
  report.convention = onlyUnreadAttributes(layers.dom.differences, unread);
  for (const layer of LAYERS) {
    const { differences, masked } = layers[layer];
    const first = differences.slice(0, KEPT_DIFFERENCES).map((difference) => locate(layer, difference));
    report.layers[layer] = { differences: differences.length, masked, first };
    if (differences.length > 0) report.result = 'fail';
  }
  return report;
}

export function finish(report: Report): Report {
  for (const item of report.cases) {
    const clean = !item.lock && !item.error && item.steps.length === item.stepCount;
    item.result = clean && item.steps.every((step) => step.result === 'pass') ? 'pass' : 'fail';
  }
  const cases = report.cases.length > 0 && report.cases.every((item) => item.result === 'pass');
  report.result = cases && report.literals?.result !== 'fail' ? 'pass' : 'fail';
  return report;
}

function urlText(value: unknown): string | undefined {
  if (!isObject(value) || !Array.isArray(value.path) || !isObject(value.query)) return undefined;
  const query = Object.entries(value.query).flatMap(([name, values]) => (Array.isArray(values) ? values : []).map((each) => `${name}=${each}`));
  const origin = typeof value.origin === 'string' ? value.origin : '';
  const fragment = typeof value.fragment === 'string' && value.fragment !== '' ? `#${value.fragment}` : '';
  return `${origin}/${value.path.join('/')}${query.length > 0 ? `?${query.join('&')}` : ''}${fragment}`;
}

function show(value: unknown): string {
  if (value === undefined) return 'nothing';
  const text = JSON.stringify(value);
  const shown = text.length > 300 ? `${text.slice(0, 300)}...` : text;
  const url = urlText(value) ?? (isObject(value) ? urlText(value.url) : undefined);
  return url === undefined ? shown : `${shown} (the URL ${url})`;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

const firstAt = (indent: string, at: At | undefined): string[] =>
  at === undefined
    ? []
    : [
        at.expected === undefined
          ? `${indent}first difference at char ${at.offset}`
          : `${indent}at char ${at.offset}: expected ${JSON.stringify(at.expected)}, actual ${JSON.stringify(at.actual)}`,
      ];

function grouped({ cases, differences }: Distinct): string[] {
  if (differences.length === 0) return [];
  const lines = ['', `${count(differences.length, 'distinct difference')} in ${count(cases, 'case')}:`];
  for (const group of differences.slice(0, LISTED_GROUPS)) {
    const { example } = group;
    lines.push(
      `  ${group.count}x  ${group.id}  ${LAYER_NAMES[group.layer]} ${group.path} (${group.kind}), in ${count(group.cases, 'case')}`,
      `      example: ${example.case}, step ${example.step}, ${example.path}: expected ${show(example.expected)}, actual ${show(example.actual)}`,
      ...firstAt('      ', example.at),
    );
  }
  if (differences.length > LISTED_GROUPS) lines.push(`  and ${differences.length - LISTED_GROUPS} more in report.json`);
  return lines;
}

function verdict({ cases, result }: Report): string[] {
  if (result === 'pass') return [`no drift: the original and the port match the recording in all ${count(cases.length, 'case')}`];
  const lines: string[] = [];
  const say = (words: string, test: (item: CaseReport) => boolean, then = '') => {
    const ids = cases.filter(test).map((item) => item.id);
    if (ids.length > 0) lines.push(`${words} ${ids.join(', ')} (${ids.length} of ${count(cases.length, 'case')})${then}`);
  };
  say('the original changed:', (item) => item.drift?.original === 'differs');
  say('the port regressed:', (item) => item.drift?.port === 'differs');
  const both = cases.filter((item) => item.drift?.original === 'differs' && item.drift.port === 'differs').map((item) => item.id);
  if (both.length > 0) lines.push(`both differ in ${both.join(', ')}: record again, then gate the port against the new recording`);
  say(
    'sizes or positions differ between the original and the port in',
    (item) => item.drift?.sizes === 'differ',
    ': the recording holds none, so which side moved is not known',
  );
  say('not checked: the recording of', (item) => !item.drift);
  say('not checked: the original in', (item) => item.drift?.original === 'not checked');
  say('not checked: the port in', (item) => item.drift?.port === 'not checked');
  return lines;
}

function copied({ found, named }: LiteralCheck): string[] {
  const listed = <T extends { file: string; line: number }>(list: T[], text: (each: T) => string) => [
    ...list.slice(0, LISTED_GROUPS).map((each) => `      ${each.file}:${each.line}: ${text(each)}`),
    ...(list.length > LISTED_GROUPS ? [`      and ${list.length - LISTED_GROUPS} more in report.json`] : []),
  ];
  const lines: string[] = [];
  if (named.length > 0) lines.push('FAIL  the port source names recording files', ...listed(named, (each) => each.name));
  if (found.length > 0) {
    const fails = found.length >= FAILING_LITERALS;
    const [equal, are] = found.length === 1 ? ['equals', 'is'] : ['equal', 'are'];
    lines.push(
      `${fails ? 'FAIL  ' : 'note: '}recorded literals in the port: ${found.length} ${equal} recorded values and ${are} not in the original source` +
        (fails ? '' : ` (${FAILING_LITERALS} fail the gate)`),
      ...listed(found, (each) => show(each.value)),
      '      a value that the port may hold as it is stays with a comment "recorded-literal: reason" on its line',
    );
  }
  return lines.length > 0 ? ['', ...lines] : [];
}

function differentShots({ source, cases }: Report, images: boolean): string[] {
  const shots = cases.flatMap(({ id, steps }) =>
    steps.filter((step) => step.screenshot === 'different').map(({ step }) => {
      const file = join('reports', source, id, stepFile(step - 1));
      return `      ${id}, step ${step}${images ? `: ${file}.png and ${file}.original.png` : ''}`;
    }),
  );
  if (shots.length <= LISTED_GROUPS) return shots;
  return [...shots.slice(0, LISTED_GROUPS), `      and ${shots.length - LISTED_GROUPS} more in report.json`];
}

function checked({ command, literals }: Report): string[] {
  if (command !== 'gate') return [];
  if (!literals) return ['Recorded values in the port were not checked: no --original-source and --port-source were given.'];
  return literals.found.length + literals.named.length === 0 ? ['Recorded values in the port were checked: nothing found.'] : [];
}

export function summarize(report: Report, images = true): string {
  const lines = [
    `angular-anything ${report.command}: ${report.result === 'pass' ? 'PASS' : 'FAIL'}`,
    `suite ${report.suite}, source ${report.source}, url ${report.url}${report.original ? `, original ${report.original}` : ''}`,
    `Playwright ${report.playwright}, ${report.browser}`,
    '',
    ...(report.command === 'drift' && report.cases.length > 0 ? [...verdict(report), ''] : []),
  ];
  if (report.cases.length === 0) lines.push(`FAIL  the suite ${report.suite} has no cases`);
  const width = Math.max(0, ...report.cases.map((item) => item.id.length));
  for (const item of report.cases) {
    const id = item.id.padEnd(width);
    const notes = item.steps.flatMap((step) => step.reads.map((note) => `      note: step ${step.step}: ${note}`));
    if (item.result === 'pass') {
      lines.push(`PASS  ${id}  ${count(item.steps.length, 'step')}, frames: ${item.steps.map((step) => step.frames).join(' ')}`);
      lines.push(...notes);
      continue;
    }
    lines.push(`FAIL  ${item.id}`);
    for (const problem of item.lock ?? []) lines.push(`      lock: ${problem}`);
    const [first, ...rest] = item.steps.filter((step) => step.result === 'fail');
    if (first) {
      lines.push(`      step ${first.step} of ${item.stepCount}: ${first.action} (${first.frames} frames)`);
      for (const layer of LAYERS) {
        const { differences, first: kept } = first.layers[layer];
        if (differences === 0) continue;
        lines.push(`        ${LAYER_NAMES[layer]}: ${count(differences, 'difference')}, the first at ${kept[0].path}`);
        lines.push(`          expected: ${show(kept[0].expected)}`);
        lines.push(`          actual:   ${show(kept[0].actual)}`);
        lines.push(...firstAt('          ', kept[0].at));
      }
      if (first.convention.length > 0) {
        lines.push(
          `      The only differences in the DOM are empty attributes that only the port has and the browser does not read on that element: ${first.convention.join(', ')}.`,
          '      If one of them is the selector of a component, give the component a selector that the original element already matches',
          '      (tag and class such as li.task, or an existing attribute such as [id=root]), else an input alias that is bound.',
        );
      }
    }
    if (rest.length > 0) lines.push(`      also differs at step ${rest.map((step) => step.step).join(', ')}`);
    for (const step of item.steps) {
      const findings = step.layers.effects.first.filter((difference) => difference.path.startsWith('tape '));
      for (const { path, expected, actual } of findings.slice(step === first ? 1 : 0)) {
        lines.push(`      also at step ${step.step}, ${path}: expected ${show(expected)}, actual ${show(actual)}`);
      }
    }
    if (item.error) lines.push(`      error: ${item.error}`);
    lines.push(...notes);
  }

  if (report.distinct) lines.push(...grouped(report.distinct));
  if (report.literals) lines.push(...copied(report.literals));

  const steps = report.cases.flatMap((item) => item.steps);
  const failedCases = report.cases.filter((item) => item.result === 'fail').length;
  const shots = (state: StepReport['screenshot']) => steps.filter((step) => step.screenshot === state).length;
  const masked = steps.reduce((sum, step) => sum + LAYERS.reduce((n, layer) => n + step.layers[layer].masked, 0), 0);
  lines.push(
    '',
    `${failedCases} of ${report.cases.length} cases failed. ` +
      `${steps.filter((step) => step.result === 'fail').length} of ${steps.length} compared steps differ.`,
    `Values not compared because the case names them as noise: ${masked}.`,
    `Screenshots (soft, they never fail the gate): ${shots('identical')} identical, ${shots('different')} different, ${shots('masked')} masked, ${shots('not compared')} not compared.`,
    ...differentShots(report, images),
  );
  const credentials = [...new Set(report.cases.flatMap((item) => item.credentials ?? []))].sort();
  if (credentials.length > 0) lines.push(`Values of credential headers (${credentials.join(', ')}) were not compared.`);
  if (!report.original) lines.push('Sizes, positions and screenshots were not compared: no --original-url was given.');
  lines.push(...checked(report));
  return lines.join('\n');
}
