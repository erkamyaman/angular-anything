import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './lock.ts';

export const CASE_FORMAT = 'angular-anything/case@0';

export type Target = { role: string; name: string };

export type Step =
  | { action: 'goto'; path: string }
  | { action: 'click' | 'check' | 'uncheck'; target: Target }
  | { action: 'fill'; target: Target; value: string }
  | { action: 'press'; target: Target; key: string }
  | { action: 'reload' }
  | { action: 'advance'; ms: number };

export type Case = {
  format: typeof CASE_FORMAT;
  id: string;
  description?: string;
  viewport: { width: number; height: number };
  steps: Step[];
};

export type LoadedCase = { case: Case; sha256: string };

export class UsageError extends Error {}

const NAME = /^[a-z0-9][a-z0-9-]*$/;

export function checkName(kind: string, name: string): string {
  if (!NAME.test(name)) throw new UsageError(`${kind} "${name}" must be lower case letters, digits and dashes`);
  return name;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isTarget = (value: unknown) => isObject(value) && isText(value.role) && isText(value.name);
const isSize = (value: unknown) => Number.isInteger(value) && (value as number) > 0;

function stepProblem(step: unknown): string | undefined {
  if (!isObject(step)) return 'is not an object';
  switch (step.action) {
    case 'goto':
      return isText(step.path) && step.path.startsWith('/') ? undefined : 'needs a "path" that starts with /';
    case 'click':
    case 'check':
    case 'uncheck':
      return isTarget(step.target) ? undefined : 'needs a "target" with "role" and "name"';
    case 'fill':
      if (!isTarget(step.target)) return 'needs a "target" with "role" and "name"';
      return typeof step.value === 'string' ? undefined : 'needs a string "value"';
    case 'press':
      if (!isTarget(step.target)) return 'needs a "target" with "role" and "name"';
      return isText(step.key) ? undefined : 'needs a "key"';
    case 'reload':
      return undefined;
    case 'advance':
      return typeof step.ms === 'number' && step.ms > 0 ? undefined : 'needs "ms" above 0';
    default:
      return `has the unknown action ${JSON.stringify(step.action)}`;
  }
}

export function parseCase(text: string, id: string): Case {
  const data: unknown = JSON.parse(text);
  if (!isObject(data)) throw new Error('the case is not an object');
  if (data.format !== CASE_FORMAT) throw new Error(`"format" must be "${CASE_FORMAT}"`);
  if (data.id !== id) throw new Error(`"id" must be "${id}", the name of its folder`);
  if (!isObject(data.viewport) || !isSize(data.viewport.width) || !isSize(data.viewport.height)) {
    throw new Error('"viewport" needs a "width" and a "height" in whole pixels');
  }
  if (!Array.isArray(data.steps) || data.steps.length === 0) throw new Error('"steps" must hold at least one step');
  data.steps.forEach((step, index) => {
    const problem = stepProblem(step);
    if (problem) throw new Error(`step ${index + 1} ${problem}`);
  });
  if (data.steps[0].action !== 'goto') throw new Error('step 1 must be a "goto"');
  return data as Case;
}

export async function loadSuite(root: string, suite: string): Promise<LoadedCase[]> {
  const directory = join(root, 'cases', checkName('suite', suite));
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
    throw new UsageError(`no suite "${suite}": ${directory} does not exist`);
  });
  const cases: LoadedCase[] = [];
  for (const entry of entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(directory, entry.name, 'case.json');
    try {
      const bytes = await readFile(file);
      cases.push({ case: parseCase(bytes.toString('utf8'), checkName('case id', entry.name)), sha256: sha256(bytes) });
    } catch (error) {
      throw new Error(`${file}: ${(error as Error).message}`);
    }
  }
  return cases;
}

const describeTarget = (target: Target) => `${target.role} ${JSON.stringify(target.name)}`;

export function describeStep(step: Step): string {
  switch (step.action) {
    case 'goto':
      return `goto ${step.path}`;
    case 'fill':
      return `fill ${describeTarget(step.target)} with ${JSON.stringify(step.value)}`;
    case 'press':
      return `press ${step.key} on ${describeTarget(step.target)}`;
    case 'reload':
      return 'reload';
    case 'advance':
      return `advance ${step.ms} ms`;
    default:
      return `${step.action} ${describeTarget(step.target)}`;
  }
}
