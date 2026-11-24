import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './lock.ts';
import { parseNoise } from './noise.ts';
import type { Noise } from './noise.ts';

export const CASE_FORMAT = 'angular-anything/case@1';
export const FRAME_MS = 16;

export type Target = { role: string; name?: string; index?: number; within?: Target };

export type Step =
  | { action: 'goto'; path: string }
  | { action: 'click' | 'dblclick' | 'hover' | 'check' | 'uncheck'; target: Target }
  | { action: 'fill'; target: Target; value: string }
  | { action: 'press'; target: Target; key: string }
  | { action: 'reload' }
  | { action: 'advance'; frames: number };

export type Case = {
  format: typeof CASE_FORMAT;
  id: string;
  description?: string;
  viewport: { width: number; height: number };
  steps: Step[];
  noise?: Noise[];
};

export type LoadedCase = { case: Case; sha256: string };

export class UsageError extends Error {}

const CASE_KEYS = ['format', 'id', 'description', 'viewport', 'steps', 'noise'];

export const NAME = /^[a-z0-9][a-z0-9-]*$/;

export function checkName(kind: string, name: string): string {
  if (!NAME.test(name)) throw new UsageError(`${kind} "${name}" must be lower case letters, digits and dashes`);
  return name;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const TARGET_KEYS = ['role', 'name', 'index', 'within'];
const isTarget = (value: unknown): boolean =>
  isObject(value) &&
  isText(value.role) &&
  Object.keys(value).every((key) => TARGET_KEYS.includes(key)) &&
  (value.name === undefined || isText(value.name)) &&
  (value.index === undefined || (Number.isInteger(value.index) && (value.index as number) > 0)) &&
  (value.within === undefined || isTarget(value.within));
const TARGET_PROBLEM = 'needs a "target": a "role", and as needed a "name", an "index" from 1 and a "within" target';
const isSize = (value: unknown) => Number.isInteger(value) && (value as number) > 0;

function stepProblem(step: unknown): string | undefined {
  if (!isObject(step)) return 'is not an object';
  switch (step.action) {
    case 'goto':
      if (!isText(step.path) || !step.path.startsWith('/')) return 'needs a "path" that starts with /';
      return /^\/[\\/]/.test(step.path)
        ? 'needs a "path" that starts with / and stays on the page: it must not start with // or /\\'
        : undefined;
    case 'click':
    case 'dblclick':
    case 'hover':
    case 'check':
    case 'uncheck':
      return isTarget(step.target) ? undefined : TARGET_PROBLEM;
    case 'fill':
      if (!isTarget(step.target)) return TARGET_PROBLEM;
      return typeof step.value === 'string' ? undefined : 'needs a string "value"';
    case 'press':
      if (!isTarget(step.target)) return TARGET_PROBLEM;
      return isText(step.key) ? undefined : 'needs a "key"';
    case 'reload':
      return undefined;
    case 'advance':
      if ('ms' in step) {
        const refusal = `takes "frames" and no "ms": one frame is ${FRAME_MS} ms`;
        if (typeof step.ms !== 'number' || !(step.ms > 0)) return refusal;
        return `${refusal}, so ${step.ms} ms are ${Math.ceil(step.ms / FRAME_MS)} frames`;
      }
      return Number.isInteger(step.frames) && (step.frames as number) > 0
        ? undefined
        : 'needs "frames", a whole number above 0';
    default:
      return `has the unknown action ${JSON.stringify(step.action)}`;
  }
}

export function parseCase(text: string, id: string): Case {
  const data: unknown = JSON.parse(text);
  if (!isObject(data)) throw new Error('the case is not an object');
  if (data.format !== CASE_FORMAT) throw new Error(`"format" must be "${CASE_FORMAT}"`);
  const unknown = Object.keys(data).find((name) => !CASE_KEYS.includes(name));
  if (unknown !== undefined) throw new Error(`the key ${JSON.stringify(unknown)} is not known, a case has ${CASE_KEYS.join(', ')}`);
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
  if ('noise' in data) parseNoise(data.noise);
  return data as Case;
}

export async function loadSuite(root: string, suite: string): Promise<LoadedCase[]> {
  const directory = join(root, 'cases', checkName('suite', suite));
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
    throw new UsageError(`no suite "${suite}": ${directory} does not exist`);
  });
  const cases: LoadedCase[] = [];
  const link = entries.find((entry) => entry.isSymbolicLink());
  if (link) throw new Error(`${join(directory, link.name)} is a symbolic link, a case is a folder of its own`);
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

export const describeTarget = (target: Target): string =>
  [
    target.role,
    target.name === undefined ? '' : ` ${JSON.stringify(target.name)}`,
    target.index === undefined ? '' : ` #${target.index}`,
    target.within === undefined ? '' : ` in ${describeTarget(target.within)}`,
  ].join('');

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
      return `advance ${step.frames} frames`;
    default:
      return `${step.action} ${describeTarget(step.target)}`;
  }
}
