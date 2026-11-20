import { LAYERS, LAYER_NAMES } from './compare.ts';
import type { Difference, Layer, LayerResult } from './compare.ts';

export const REPORT_FORMAT = 'angular-anything/report@0';
const KEPT_DIFFERENCES = 10;

export type StepReport = {
  step: number;
  action: string;
  result: 'pass' | 'fail';
  settleMs: number;
  captures: number;
  // Soft: it never changes a result.
  screenshot: 'identical' | 'different' | 'masked';
  // "first" holds the first differences of the layer, "differences" counts all of them.
  layers: Record<Layer, { differences: number; masked: number; first: Difference[] }>;
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

export function stepReport(
  step: number,
  action: string,
  timing: { settleMs: number; captures: number },
  screenshot: StepReport['screenshot'],
  layers: Record<Layer, LayerResult>,
): StepReport {
  const { settleMs, captures } = timing;
  const report = { step, action, result: 'pass', settleMs, captures, screenshot, layers: {} } as StepReport;
  for (const layer of LAYERS) {
    const { differences, masked } = layers[layer];
    report.layers[layer] = { differences: differences.length, masked, first: differences.slice(0, KEPT_DIFFERENCES) };
    if (differences.length > 0) report.result = 'fail';
  }
  return report;
}

// A case passes when every step ran and no hard layer differs. A suite with no cases fails.
export function finish(report: Report): Report {
  for (const item of report.cases) {
    const clean = !item.lock && !item.error && item.steps.length === item.stepCount;
    item.result = clean && item.steps.every((step) => step.result === 'pass') ? 'pass' : 'fail';
  }
  report.result = report.cases.length > 0 && report.cases.every((item) => item.result === 'pass') ? 'pass' : 'fail';
  return report;
}

function show(value: unknown): string {
  if (value === undefined) return 'nothing';
  const text = JSON.stringify(value);
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
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
      lines.push(`PASS  ${id}  ${count(item.steps.length, 'step')}`);
      continue;
    }
    lines.push(`FAIL  ${item.id}`);
    for (const problem of item.lock ?? []) lines.push(`      lock: ${problem}`);
    const [first, ...rest] = item.steps.filter((step) => step.result === 'fail');
    if (first) {
      lines.push(`      step ${first.step} of ${item.stepCount}: ${first.action}`);
      for (const layer of LAYERS) {
        const { differences, first: kept } = first.layers[layer];
        if (differences === 0) continue;
        lines.push(`        ${LAYER_NAMES[layer]}: ${count(differences, 'difference')}, the first at ${kept[0].path}`);
        lines.push(`          expected: ${show(kept[0].expected)}`);
        lines.push(`          actual:   ${show(kept[0].actual)}`);
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
    `Differences ignored because the original itself varied between its two recording runs: ${masked}.`,
    `Screenshots (soft, they never fail the gate): ${shots('identical')} identical, ${shots('different')} different, ${shots('masked')} masked.`,
  );
  return lines.join('\n');
}
