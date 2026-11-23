import { LAYERS, LAYER_NAMES } from './compare.ts';
import type { Difference, Layer, LayerResult } from './compare.ts';
import type { Unread } from './page.ts';
import { keyPath } from './path.ts';
import { isObject } from './value.ts';

export const REPORT_FORMAT = 'angular-anything/report@0';
const KEPT_DIFFERENCES = 10;

export type StepReport = {
  step: number;
  action: string;
  result: 'pass' | 'fail';
  settleMs: number;
  captures: number;
  frames: number;
  screenshot: 'identical' | 'different' | 'masked';
  layers: Record<Layer, { differences: number; masked: number; first: Difference[] }>;
  convention: string[];
};

export type CaseReport = {
  id: string;
  result: 'pass' | 'fail';
  stepCount: number;
  steps: StepReport[];
  root?: string;
  lock?: string[];
  error?: string;
};

export type Report = {
  format: typeof REPORT_FORMAT;
  command: 'replay' | 'gate';
  suite: string;
  source: string;
  url: string;
  playwright: string;
  browser: string;
  result: 'pass' | 'fail';
  cases: CaseReport[];
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
): StepReport {
  const { settleMs, captures, frames } = timing;
  const report = { step, action, result: 'pass', settleMs, captures, frames, screenshot, layers: {} } as StepReport;
  report.convention = onlyUnreadAttributes(layers.dom.differences, unread);
  for (const layer of LAYERS) {
    const { differences, masked } = layers[layer];
    report.layers[layer] = { differences: differences.length, masked, first: differences.slice(0, KEPT_DIFFERENCES) };
    if (differences.length > 0) report.result = 'fail';
  }
  return report;
}

export function finish(report: Report): Report {
  for (const item of report.cases) {
    const clean = !item.lock && !item.error && item.steps.length === item.stepCount;
    item.result = clean && item.steps.every((step) => step.result === 'pass') ? 'pass' : 'fail';
  }
  report.result = report.cases.length > 0 && report.cases.every((item) => item.result === 'pass') ? 'pass' : 'fail';
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

export function summarize(report: Report): string {
  const lines = [
    `angular-anything ${report.command}: ${report.result === 'pass' ? 'PASS' : 'FAIL'}`,
    `suite ${report.suite}, source ${report.source}, url ${report.url}`,
    `Playwright ${report.playwright}, ${report.browser}`,
    '',
  ];
  if (report.cases.length === 0) lines.push(`FAIL  the suite ${report.suite} has no cases`);
  const width = Math.max(0, ...report.cases.map((item) => item.id.length));
  for (const item of report.cases) {
    const id = item.id.padEnd(width);
    if (item.result === 'pass') {
      lines.push(`PASS  ${id}  ${count(item.steps.length, 'step')}, frames: ${item.steps.map((step) => step.frames).join(' ')}`);
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
    if (item.error) lines.push(`      error: ${item.error}`);
  }

  const steps = report.cases.flatMap((item) => item.steps);
  const failedCases = report.cases.filter((item) => item.result === 'fail').length;
  const shots = (state: StepReport['screenshot']) => steps.filter((step) => step.screenshot === state).length;
  const masked = steps.reduce((sum, step) => sum + LAYERS.reduce((n, layer) => n + step.layers[layer].masked, 0), 0);
  lines.push(
    '',
    `${failedCases} of ${report.cases.length} cases failed. ` +
      `${steps.filter((step) => step.result === 'fail').length} of ${steps.length} compared steps differ.`,
    `Values not compared because the case names them as noise: ${masked}.`,
    `Screenshots (soft, they never fail the gate): ${shots('identical')} identical, ${shots('different')} different, ${shots('masked')} masked.`,
  );
  return lines.join('\n');
}
