import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import playwrightPackage from 'playwright/package.json' with { type: 'json' };
import { loadSuite } from './case.ts';
import { noiseMask } from './compare.ts';
import type { Mask } from './compare.ts';
import { writeLock } from './lock.ts';
import { runCase } from './run.ts';

export const RECORDING_FORMAT = 'angular-anything/recording@0';
export const RECORDING_FILE = 'recording.json';

export type Recording = {
  format: typeof RECORDING_FORMAT;
  suite: string;
  case: string;
  source: string;
  url: string;
  steps: number;
  // Paths that differed between the two recording runs. Replay does not compare them.
  masked: Mask[];
};

export type Options = { root: string; suite: string; source: string; url: URL };

// Step 1 is stored as 01.json and 01.png.
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
    for (const { case: testCase, sha256 } of cases) {
      const first = await runCase(browser, testCase, url);
      const second = first.error ? first : await runCase(browser, testCase, url);
      const error = first.error ?? second.error;
      if (error) {
        console.log(`FAIL  ${testCase.id}\n      ${error}`);
        continue;
      }

      const masked = noiseMask(
        first.steps.map((step) => step.observation),
        second.steps.map((step) => step.observation),
      );
      first.steps.forEach((step, index) => {
        if (!step.screenshot.equals(second.steps[index].screenshot)) {
          masked.push({ step: index + 1, layer: 'screenshot', path: '' });
        }
      });

      const directory = join(root, 'recordings', source, testCase.id);
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true });
      for (const [index, step] of first.steps.entries()) {
        await writeFile(join(directory, `${stepFile(index)}.json`), toJson(step.observation));
        await writeFile(join(directory, `${stepFile(index)}.png`), step.screenshot);
      }
      const recording: Recording = {
        format: RECORDING_FORMAT,
        suite,
        case: testCase.id,
        source,
        url: url.href,
        steps: first.steps.length,
        masked,
      };
      await writeFile(join(directory, RECORDING_FILE), toJson(recording));
      const lock = await writeLock(directory, { ...pins, case: sha256 });
      recorded++;
      console.log(`ok    ${testCase.id}  steps: ${first.steps.length}, masked: ${masked.length}, root: ${lock.root}`);
      for (const mask of masked) console.log(`      masked at step ${mask.step}: ${`${mask.layer} ${mask.path}`.trim()}`);
    }
    console.log(`\nRecorded ${recorded} of ${cases.length} cases into ${join('recordings', source)}.`);
    return cases.length > 0 && recorded === cases.length ? 0 : 1;
  } finally {
    await browser.close();
  }
}
