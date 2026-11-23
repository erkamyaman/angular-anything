import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describeStep, loadSuite } from './case.ts';
import { compareCase } from './compare.ts';
import type { Observation } from './compare.ts';
import { checkLock, LOCK_FILE } from './lock.ts';
import { compile, normalize, placeholdersOutside } from './noise.ts';
import { RECORDING_FILE, RECORDING_FORMAT, stepFile, toJson, versions } from './record.ts';
import type { Options, Recording } from './record.ts';
import { finish, REPORT_FORMAT, stepReport, summarize } from './report.ts';
import type { CaseReport, Report, StepReport } from './report.ts';
import { runCase } from './run.ts';

export async function replay({ root, suite, source, url, gate }: Options & { gate: boolean }): Promise<number> {
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
        const run = await runCase(browser, testCase, url, undefined, frames);
        const expected: Observation[] = [];
        for (const index of run.steps.keys()) {
          expected.push(JSON.parse(await readFile(join(recorded, `${stepFile(index)}.json`), 'utf8')));
        }
        const outside = placeholdersOutside(noise, expected);
        if (outside.length > 0) {
          throw new Error(`it masks values that the case does not name as noise (${outside[0]}), so it has to be recorded again`);
        }
        const results = compareCase(
          expected,
          run.steps.map((step) => normalize(step.observation, noise)),
        );
        for (const [index, step] of run.steps.entries()) {
          const name = stepFile(index);
          const layers = results[index];
          let screenshot: StepReport['screenshot'] = 'masked';
          if (!recording.screenshotNoise.includes(index + 1)) {
            const same = step.screenshot.equals(await readFile(join(recorded, `${name}.png`)));
            screenshot = same ? 'identical' : 'different';
          }
          if (screenshot === 'different') {
            await mkdir(join(out, testCase.id), { recursive: true });
            await writeFile(join(out, testCase.id, `${name}.png`), step.screenshot);
          }
          item.steps.push(stepReport(index + 1, describeStep(testCase.steps[index]), step, screenshot, layers, step.unread));
        }
        item.error = run.error;
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
