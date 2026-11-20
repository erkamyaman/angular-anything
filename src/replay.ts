import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describeStep, loadSuite } from './case.ts';
import { compareMasked } from './compare.ts';
import type { Observation } from './compare.ts';
import { checkLock, LOCK_FILE } from './lock.ts';
import { RECORDING_FILE, stepFile, toJson, versions } from './record.ts';
import type { Options, Recording } from './record.ts';
import { finish, REPORT_FORMAT, stepReport, summarize } from './report.ts';
import type { CaseReport, Report, StepReport } from './report.ts';
import { runCase } from './run.ts';

// Replays every case of the suite against the url and compares each step with the recording.
// With gate, a recording that does not match its lock is refused and not replayed.
export async function replay({ root, suite, source, url, gate }: Options & { gate: boolean }): Promise<number> {
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
    const out = join(root, 'reports', source);
    await rm(out, { recursive: true, force: true });
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
        if (recording.steps !== testCase.steps.length) {
          throw new Error(`the recording has ${recording.steps} steps, the case has ${testCase.steps.length}`);
        }
        const run = await runCase(browser, testCase, url);
        for (const [index, step] of run.steps.entries()) {
          const name = stepFile(index);
          const expected: Observation = JSON.parse(await readFile(join(recorded, `${name}.json`), 'utf8'));
          const layers = compareMasked(expected, step.observation, recording.masked, index + 1);
          let screenshot: StepReport['screenshot'] = 'masked';
          if (!recording.masked.some((mask) => mask.step === index + 1 && mask.layer === 'screenshot')) {
            const same = step.screenshot.equals(await readFile(join(recorded, `${name}.png`)));
            screenshot = same ? 'identical' : 'different';
          }
          if (screenshot === 'different') {
            await mkdir(join(out, testCase.id), { recursive: true });
            await writeFile(join(out, testCase.id, `${name}.png`), step.screenshot);
          }
          item.steps.push(stepReport(index + 1, describeStep(testCase.steps[index]), step, screenshot, layers));
        }
        item.error = run.error;
      } catch (error) {
        item.error = `cannot replay against the recording: ${(error as Error).message}`;
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
