import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describeStep, loadSuite } from './case.ts';
import { compareCase, LAYERS, LAYER_NAMES } from './compare.ts';
import type { Layer, LayerResult } from './compare.ts';
import { laidOut, stored } from './layout.ts';
import type { Observation } from './compare.ts';
import { checkLock, LOCK_FILE } from './lock.ts';
import { compile, maskObservations, normalize, placeholdersOutside } from './noise.ts';
import { RECORDING_FILE, RECORDING_FORMAT, stepFile, toJson, versions } from './record.ts';
import type { Options, Recording } from './record.ts';
import { finish, REPORT_FORMAT, stepReport, summarize } from './report.ts';
import type { CaseReport, Report, StepReport } from './report.ts';
import { runCase } from './run.ts';

function firstDifference(results: Record<Layer, LayerResult>[]): string | undefined {
  for (const [index, layers] of results.entries()) {
    for (const layer of LAYERS) {
      const [first] = layers[layer].differences;
      if (first) return `step ${index + 1}, ${LAYER_NAMES[layer]} at ${first.path}: expected ${JSON.stringify(first.expected)}, actual ${JSON.stringify(first.actual)}`;
    }
  }
  return undefined;
}

export async function replay({ root, suite, source, url, gate, original }: Options & { gate: boolean; original?: URL }): Promise<number> {
  const out = join(root, 'reports', source);
  const cases = await loadSuite(root, suite);
  const browser = await chromium.launch();
  try {
    const pins = versions(browser);
    const report: Report = {
      format: REPORT_FORMAT,
      command: gate ? 'gate' : 'replay',
      suite,
      source,
      url: url.href,
      original: original?.href ?? null,
      ...pins,
      result: 'fail',
      cases: [],
    };
    await mkdir(out, { recursive: true });

    for (const { case: testCase, sha256 } of cases) {
      const recorded = join(root, 'recordings', source, testCase.id);
      const item: CaseReport = { id: testCase.id, result: 'fail', stepCount: testCase.steps.length, steps: [] };
      report.cases.push(item);
      try {
        if (gate) {
          const problems = await checkLock(recorded, { ...pins, case: sha256 });
          if (problems.length > 0) {
            item.lock = problems;
            continue;
          }
          item.root = JSON.parse(await readFile(join(recorded, LOCK_FILE), 'utf8')).root;
        }
        const recording: Recording = JSON.parse(await readFile(join(recorded, RECORDING_FILE), 'utf8'));
        if (typeof recording !== 'object' || recording === null) {
          throw new Error('it is not a recording object, so it has to be recorded again');
        }
        if (recording.format !== RECORDING_FORMAT) {
          throw new Error(`it is in the format ${recording.format}, not ${RECORDING_FORMAT}, so it has to be recorded again`);
        }
        if (recording.suite !== suite || recording.source !== source || recording.case !== testCase.id) {
          throw new Error(
            `it was made for suite ${recording.suite}, source ${recording.source}, case ${recording.case}`,
          );
        }
        if (recording.steps !== testCase.steps.length) {
          throw new Error(`the recording has ${recording.steps} steps, the case has ${testCase.steps.length}`);
        }
        if (!Array.isArray(recording.screenshotNoise)) {
          throw new Error('it has no list of screenshots that varied, so it has to be recorded again');
        }
        const frames = recording.frames;
        if (!Array.isArray(frames)) {
          throw new Error('it has no stored frames, so it has to be recorded again');
        }
        if (frames.length !== recording.steps || !frames.every((count) => Number.isInteger(count) && count > 0)) {
          throw new Error('its stored frames are not a whole number above 0 for each step, so it has to be recorded again');
        }
        const noise = compile(testCase.noise ?? []);
        const expected: Observation[] = [];
        for (const index of frames.keys()) {
          expected.push(JSON.parse(await readFile(join(recorded, `${stepFile(index)}.json`), 'utf8')));
        }
        const outside = placeholdersOutside(noise, expected);
        if (outside.length > 0) {
          throw new Error(`it masks values that the case does not name as noise (${outside[0]}), so it has to be recorded again`);
        }
        let again: Awaited<ReturnType<typeof runCase>> | undefined;
        let mismatch: string | undefined;
        if (original) {
          again = await runCase(browser, testCase, original, undefined, frames);
          mismatch = again.error ?? firstDifference(compareCase(expected, again.steps.map((step) => stored(normalize(step.observation, noise)))));
        }
        const run = await runCase(browser, testCase, url, undefined, frames);
        const actual = run.steps.map((step) => normalize(step.observation, noise));
        const results = compareCase(expected.slice(0, actual.length), actual.map(stored));
        const sameSession = again && !mismatch && again.steps.length === run.steps.length ? again : undefined;
        if (sameSession) {
          const masked = maskObservations(noise, sameSession.steps.map((step) => step.observation), sameSession.steps.map((step) => step.observation)).observations;
          const sizes = compareCase(masked.map(laidOut), actual.map(laidOut));
          sizes.forEach((layers, index) => {
            for (const layer of LAYERS) {
              results[index][layer].differences.push(...layers[layer].differences);
              results[index][layer].masked += layers[layer].masked;
            }
          });
        }
        for (const [index, step] of run.steps.entries()) {
          const name = stepFile(index);
          const layers = results[index];
          let screenshot: StepReport['screenshot'] = 'not compared';
          const before = sameSession?.steps[index]?.screenshot;
          if (before && recording.screenshotNoise.includes(index + 1)) screenshot = 'masked';
          else if (before) screenshot = step.screenshot.equals(before) ? 'identical' : 'different';
          if (screenshot === 'different' && before) {
            await mkdir(join(out, testCase.id), { recursive: true });
            await writeFile(join(out, testCase.id, `${name}.png`), step.screenshot);
            await writeFile(join(out, testCase.id, `${name}.original.png`), before);
          }
          item.steps.push(stepReport(index + 1, describeStep(testCase.steps[index]), step, screenshot, layers, step.unread));
        }
        item.error = mismatch ? `the original at ${original!.href} does not match its recording: ${mismatch}; sizes, positions and screenshots were not compared` : run.error;
        if (mismatch && run.error) item.error += `; the port: ${run.error}`;
      } catch (error) {
        item.error = `cannot replay against the recording: ${(error as Error).message}`;
      }
    }

    if (gate) {
      const recordings = join(root, 'recordings', source);
      const ids = new Set(cases.map((loaded) => loaded.case.id));
      for (const entry of await readdir(recordings, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory() || ids.has(entry.name)) continue;
        const recording: Partial<Recording> = await readFile(join(recordings, entry.name, RECORDING_FILE), 'utf8')
          .then(JSON.parse)
          .catch(() => ({}));
        if (recording.suite !== undefined && recording.suite !== suite) continue;
        const lock = [`the suite ${suite} has no case for this recording`];
        report.cases.push({ id: entry.name, result: 'fail', stepCount: 0, steps: [], lock });
      }
    }

    const summary = summarize(finish(report));
    await writeFile(join(out, 'report.json'), toJson(report));
    await writeFile(join(out, 'summary.txt'), `${summary}\n`);
    console.log(`${summary}\n\nReport: ${join('reports', source, 'report.json')}`);
    return report.result === 'pass' ? 0 : 1;
  } finally {
    await browser.close();
  }
}
