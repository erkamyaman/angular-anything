import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import playwrightPackage from 'playwright/package.json' with { type: 'json' };
import { describeStep, loadSuite } from './case.ts';
import { writeLock } from './lock.ts';
import { audit, compile, maskObservations, normalize } from './noise.ts';
import { measure, stored as storedLayers } from './layout.ts';
import { launchBrowser, runCase } from './run.ts';
import { describeFinding, isAccepted, isSecret, kindsOf, newSeen, scanCase, scanUrl } from './secrets.ts';
import type { Finding as Secret } from './secrets.ts';
import { agreedTape, maskRequest } from './tape.ts';
import type { Finding } from './tape.ts';
import { hider } from './typed.ts';

export const RECORDING_FORMAT = 'angular-anything/recording@4';
export const RECORDING_FILE = 'recording.json';
export const TAPE_FILE = 'tape.json';

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

function misfit({ step, request, actual, differs = [], absent }: Finding): string {
  if (absent) return `step ${step}: the second run did not send ${request.split('?')[0]}, which the first run sent`;
  const reason = typeof actual === 'string' ? `: ${actual}` : '';
  const parts = differs.length > 0 ? `, the parts that differ: ${differs.join(', ')}` : '';
  return `step ${step}: the second run sent ${request.split('?')[0]}, which does not fit the tape of the first run${reason}${parts}`;
}

const refusal = (id: string, findings: Secret[]): string[] => {
  const lines = [...new Set(findings.map(describeFinding))];
  return [
    `FAIL  ${id}`,
    '      refused, a detected secret:',
    ...lines.slice(0, LISTED).map((line) => `      ${line}`),
    ...(lines.length > LISTED ? [`      and ${lines.length - LISTED} more`] : []),
  ];
};

export const versions = (browser: Browser) => ({
  playwright: playwrightPackage.version,
  browser: `${browser.browserType().name()} ${browser.version()}`,
});

export async function record({ root, suite, source, url }: Options): Promise<number> {
  const cases = await loadSuite(root, suite);
  const hide = hider(cases.map((loaded) => loaded.case));
  const say = (lines: string[]) => console.log(lines.map(hide).join('\n'));
  const browser = await launchBrowser();
  try {
    const pins = versions(browser);
    const stored = join(root, 'recordings', source);
    const ownerOf = async (id: string): Promise<Partial<Recording>> =>
      readFile(join(stored, id, RECORDING_FILE), 'utf8')
        .then((text) => JSON.parse(text) ?? {})
        .catch(() => ({}));
    const forget = async () => {
      for (const { case: testCase } of cases) {
        const { suite: owner } = await ownerOf(testCase.id);
        if (typeof owner !== 'string' || owner === suite) await rm(join(stored, testCase.id), { recursive: true, force: true });
      }
    };
    const inQuery = scanUrl(url, newSeen());
    if (inQuery.length > 0) {
      await forget();
      for (const { case: testCase } of cases) console.log(refusal(testCase.id, inQuery).join('\n'));
      return 1;
    }
    const address = `${url.origin}/${url.search === '' ? '' : ' (its query is not shown)'}`;
    console.log(`angular-anything record: suite ${suite}, source ${source}, url ${address}`);
    console.log(`Playwright ${pins.playwright}, ${pins.browser}\n`);
    let recorded = 0;
    if (cases.length === 0) console.log(`FAIL  the suite ${suite} has no cases`);
    const known = new Set(cases.map((loaded) => loaded.case.id));
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
      const directory = join(stored, testCase.id);
      const owner = await ownerOf(testCase.id);
      if (typeof owner.suite === 'string' && owner.suite !== suite) {
        console.log(
          `FAIL  ${testCase.id}\n      ${join('recordings', source, testCase.id)} holds the recording of the suite ${owner.suite}: ` +
            `record the suite ${suite} with another --source`,
        );
        continue;
      }
      await rm(directory, { recursive: true, force: true });
      const seen = newSeen();
      const run = (replayed?: Parameters<typeof runCase>[6]) =>
        runCase(browser, testCase, url, undefined, undefined, undefined, replayed, seen);
      const noise = compile(testCase.noise ?? []);
      const first = await run();
      const stopped = first.refusals.length > 0 || first.error !== undefined;
      const second = stopped ? first : await run({ entries: first.tape.map((entry) => maskRequest(entry, noise)), second: true });
      const misfits = second.findings.map(misfit);
      const refusals = first.refusals.length > 0 ? first.refusals : second.refusals;
      const error = refusals.length > 0 ? undefined : (first.error ?? second.error);

      const tape = agreedTape(first.tape, second.taken, noise, (text, names) => hide(text) !== text || isSecret(text, names, seen.credentials));
      const measured = testCase.measured ?? [];
      const matched = new Set<(typeof measured)[number]>();
      const read = (done: typeof first) => done.steps.map((step) => normalize(measure(step.observation, measured, matched), noise));
      const left = read(first);
      const written = maskObservations(noise, left, left).observations.map(storedLayers);
      const found = scanCase({ seen, observations: written, fields: first.steps.map((step) => step.secretFields), tape: first.tape, noise });
      const inUrl = scanUrl(url, seen);
      const accepted = found.filter((each) => isAccepted(each, testCase.accept ?? []));
      const secrets = [...inUrl, ...found.filter((each) => !accepted.includes(each))];
      const report = (lines: string[]) => {
        for (const line of lines) {
          const kinds = kindsOf(line, seen.credentials);
          console.log(`      ${kinds.length > 0 ? `a line is left out, it holds a detected secret: ${kinds.join(', ')}` : hide(line)}`);
        }
      };
      if (secrets.length > 0) {
        say(refusal(testCase.id, secrets));
        report(refusals);
        if (error) report([error]);
        if (inUrl.length > 0) {
          await forget();
          recorded = 0;
          break;
        }
        continue;
      }
      if (refusals.length > 0 || error) {
        console.log(`FAIL  ${testCase.id}`);
        report([...refusals, ...(error ? [error] : []), ...misfits]);
        continue;
      }

      const different = first.steps.findIndex((step, index) => step.frames !== second.steps[index].frames);
      if (different >= 0) {
        const name = describeStep(testCase.steps[different]);
        console.log(`FAIL  ${testCase.id}`);
        report([
          `step ${different + 1} (${name}): the first run took ${first.steps[different].frames} frames, ` +
            `the second ${second.steps[different].frames}`,
          ...misfits,
        ]);
        continue;
      }

      const right = read(second);
      const unmatched = measured.filter((entry) => !matched.has(entry));
      if (unmatched.length > 0) {
        console.log(`FAIL  ${testCase.id}`);
        say(unmatched.map((entry) => `      the measured entry ${entry.layer} ${entry.path} matches nothing in any step`));
        continue;
      }
      const audited = audit(noise, left, right);
      if (misfits.length > 0 || audited.problems.length > 0 || audited.unnamed.length > 0) {
        console.log(`FAIL  ${testCase.id}`);
        report([...misfits.slice(0, LISTED), ...audited.problems.slice(0, LISTED)]);
        if (audited.problems.length > LISTED) console.log(`      and ${audited.problems.length - LISTED} more`);
        if (audited.unnamed.length > 0) {
          console.log('      The two runs of the original differ at these paths, and the case does not name them in "noise". Add them:');
          report(audited.unnamed.slice(0, LISTED).map((entry) => `  ${JSON.stringify({ layer: entry.layer, path: entry.path })}`));
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
        await writeFile(join(directory, `${stepFile(index)}.json`), toJson(storedLayers(observations[index])));
      }
      await writeFile(join(directory, TAPE_FILE), toJson(tape));
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
      for (const line of new Set(accepted.map(describeFinding))) say([`      accepted: ${line}`]);
      noise.forEach((entry, at) => console.log(`      noise ${entry.layer} ${hide(entry.path)}: ${counts[at]} values masked`));
      for (const entry of audited.agreed) say([`      noise entry without a difference between the two runs: ${entry.layer} ${entry.path}`]);
      if (screenshotNoise.length > 0) console.log(`      screenshots that differed between the two runs, at step ${screenshotNoise.join(', ')}`);
    }
    console.log(`\nRecorded ${recorded} of ${cases.length} cases into ${join('recordings', source)}.`);
    return cases.length > 0 && recorded === cases.length ? 0 : 1;
  } finally {
    await browser.close();
  }
}
