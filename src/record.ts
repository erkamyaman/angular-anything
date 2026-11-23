import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import playwrightPackage from 'playwright/package.json' with { type: 'json' };
import { describeStep, loadSuite } from './case.ts';
import { writeLock } from './lock.ts';
import { audit, compile, maskObservations, normalize } from './noise.ts';
import { runCase } from './run.ts';

export const RECORDING_FORMAT = 'angular-anything/recording@2';
export const RECORDING_FILE = 'recording.json';

export type Recording = {
  format: typeof RECORDING_FORMAT;
  suite: string;
  case: string;
  source: string;
  url: string;
  steps: number;
  frames: number[];
  screenshotNoise: number[];
};

const LISTED = 100;

export type Options = { root: string; suite: string; source: string; url: URL };

export const stepFile = (index: number): string => String(index + 1).padStart(2, '0');

export const toJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export const versions = (browser: Browser) => ({
  playwright: playwrightPackage.version,
  browser: `${browser.browserType().name()} ${browser.version()}`,
});

export async function record({ root, suite, source, url }: Options): Promise<number> {
  const cases = await loadSuite(root, suite);
  const browser = await chromium.launch();
  try {
    const pins = versions(browser);
    console.log(`angular-anything record: suite ${suite}, source ${source}, url ${url.href}`);
    console.log(`Playwright ${pins.playwright}, ${pins.browser}\n`);
    let recorded = 0;
    if (cases.length === 0) console.log(`FAIL  the suite ${suite} has no cases`);
    const known = new Set(cases.map((loaded) => loaded.case.id));
    const stored = join(root, 'recordings', source);
    for (const entry of cases.length === 0 ? [] : await readdir(stored, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || known.has(entry.name)) continue;
      const old: Partial<Recording> = await readFile(join(stored, entry.name, RECORDING_FILE), 'utf8')
        .then(JSON.parse)
        .catch(() => ({}));
      if (old.suite !== suite) continue;
      await rm(join(stored, entry.name), { recursive: true, force: true });
      console.log(`removed the recording of "${entry.name}", the suite ${suite} has no such case`);
    }
    for (const { case: testCase, sha256 } of cases) {
      const directory = join(root, 'recordings', source, testCase.id);
      await rm(directory, { recursive: true, force: true });
      const first = await runCase(browser, testCase, url);
      const second = first.error ? first : await runCase(browser, testCase, url);
      const error = first.error ?? second.error;
      if (error) {
        console.log(`FAIL  ${testCase.id}\n      ${error}`);
        continue;
      }

      const different = first.steps.findIndex((step, index) => step.frames !== second.steps[index].frames);
      if (different >= 0) {
        const name = describeStep(testCase.steps[different]);
        console.log(
          `FAIL  ${testCase.id}\n      step ${different + 1} (${name}): the first run took ${first.steps[different].frames} frames, ` +
            `the second ${second.steps[different].frames}`,
        );
        continue;
      }

      const noise = compile(testCase.noise ?? []);
      const left = first.steps.map((step) => normalize(step.observation, noise));
      const right = second.steps.map((step) => normalize(step.observation, noise));
      const audited = audit(noise, left, right);
      if (audited.problems.length > 0 || audited.unnamed.length > 0) {
        console.log(`FAIL  ${testCase.id}`);
        for (const problem of audited.problems.slice(0, LISTED)) console.log(`      ${problem}`);
        if (audited.problems.length > LISTED) console.log(`      and ${audited.problems.length - LISTED} more`);
        if (audited.unnamed.length > 0) {
          console.log('      The two runs of the original differ at these paths, and the case does not name them in "noise". Add them:');
          for (const entry of audited.unnamed.slice(0, LISTED)) console.log(`        ${JSON.stringify({ layer: entry.layer, path: entry.path })}`);
          if (audited.unnamed.length > LISTED) console.log(`        and ${audited.unnamed.length - LISTED} more`);
        }
        continue;
      }
      const { observations, counts } = maskObservations(noise, left, right);
      const screenshotNoise: number[] = [];
      first.steps.forEach((step, index) => {
        if (!step.screenshot.equals(second.steps[index].screenshot)) screenshotNoise.push(index + 1);
      });
      const masked = counts.reduce((sum, count) => sum + count, 0);

      await mkdir(directory, { recursive: true });
      for (const [index, step] of first.steps.entries()) {
        await writeFile(join(directory, `${stepFile(index)}.json`), toJson(observations[index]));
        await writeFile(join(directory, `${stepFile(index)}.png`), step.screenshot);
      }
      const recording: Recording = {
        format: RECORDING_FORMAT,
        suite,
        case: testCase.id,
        source,
        url: url.href,
        steps: first.steps.length,
        frames: first.steps.map((step) => step.frames),
        screenshotNoise,
      };
      await writeFile(join(directory, RECORDING_FILE), toJson(recording));
      const lock = await writeLock(directory, { ...pins, case: sha256 });
      recorded++;
      console.log(`ok    ${testCase.id}  steps: ${first.steps.length}, frames: ${recording.frames.join(' ')}, masked: ${masked}, root: ${lock.root}`);
      noise.forEach((entry, at) => console.log(`      noise ${entry.layer} ${entry.path}: ${counts[at]} values masked`));
      for (const entry of audited.agreed) console.log(`      noise entry without a difference between the two runs: ${entry.layer} ${entry.path}`);
      if (screenshotNoise.length > 0) console.log(`      screenshots that differed between the two runs, at step ${screenshotNoise.join(', ')}`);
    }
    console.log(`\nRecorded ${recorded} of ${cases.length} cases into ${join('recordings', source)}.`);
    return cases.length > 0 && recorded === cases.length ? 0 : 1;
  } finally {
    await browser.close();
  }
}
