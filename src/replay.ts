import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describeStep, loadSuite } from './case.ts';
import { compareCase, LAYERS, LAYER_NAMES } from './compare.ts';
import type { Layer, LayerResult } from './compare.ts';
import { laidOut, measure, stored } from './layout.ts';
import { checkLiterals } from './literals.ts';
import type { Sources } from './literals.ts';
import type { Observation } from './compare.ts';
import { checkLock, LOCK_FILE } from './lock.ts';
import { compile, maskObservations, normalize, placeholdersOutside } from './noise.ts';
import { redactReport, redactStep } from './redact.ts';
import { RECORDING_FILE, RECORDING_FORMAT, stepFile, TAPE_FILE, toJson, versions } from './record.ts';
import type { Options, Recording } from './record.ts';
import { distinct, finish, locate, REPORT_FORMAT, stepReport, summarize } from './report.ts';
import type { CaseReport, DriftState, Found, Report, StepReport } from './report.ts';
import { launchBrowser, runCase } from './run.ts';
import { maskedOutside, readNotes } from './tape.ts';
import type { TapeEntry } from './tape.ts';
import { hider, hideReport } from './typed.ts';
import { isObject } from './value.ts';

const UNREACHABLE = /net::ERR_(CONNECTION_|NAME_NOT_RESOLVED|ADDRESS_|TIMED_OUT)/;

export const unreachable = (error: string | undefined): boolean => error !== undefined && UNREACHABLE.test(error);

const differing = (results: Record<Layer, LayerResult>[]) =>
  results.some((layers) => LAYERS.some((layer) => layers[layer].differences.length > 0));

const answers = ({ answer }: TapeEntry) =>
  answer === null ||
  (typeof answer?.body === 'string' &&
    Number.isInteger(answer.status) &&
    isObject(answer.headers) &&
    Object.values(answer.headers).every((header) => typeof header === 'string'));

function firstDifference(results: Record<Layer, LayerResult>[]): string | undefined {
  for (const [index, layers] of results.entries()) {
    for (const layer of LAYERS) {
      const [first] = layers[layer].differences;
      if (first) return `step ${index + 1}, ${LAYER_NAMES[layer]} at ${first.path}: expected ${JSON.stringify(first.expected)}, actual ${JSON.stringify(first.actual)}`;
    }
  }
  return undefined;
}

type Replaying = Options & { gate: boolean; original?: URL; redact?: boolean; drift?: boolean; sources?: Sources };

export async function replay(options: Replaying): Promise<number> {
  const { root, suite, source, url, gate, original, redact, drift, sources } = options;
  const out = join(root, 'reports', source);
  const cases = await loadSuite(root, suite);
  const literals =
    sources &&
    (await checkLiterals({
      recordings: join(root, 'recordings'),
      ids: cases.map((loaded) => loaded.case.id),
      source,
      originalSource: resolve(root, sources.originalSource),
      portSource: resolve(root, sources.portSource),
    }));
  const browser = await launchBrowser();
  try {
    const pins = versions(browser);
    const report: Report = {
      format: REPORT_FORMAT,
      command: drift ? 'drift' : gate ? 'gate' : 'replay',
      suite,
      source,
      url: `${url.origin}/`,
      original: original ? `${original.origin}/` : null,
      ...pins,
      result: 'fail',
      cases: [],
      ...(literals ? { literals } : {}),
    };
    await mkdir(out, { recursive: true });
    const found: Found[] = [];

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
        const tape: TapeEntry[] = JSON.parse(await readFile(join(recorded, TAPE_FILE), 'utf8'));
        if (!Array.isArray(tape)) throw new Error('its tape is not a list, so it has to be recorded again');
        if (!tape.every(answers)) throw new Error('its tape holds an answer that is not one, so it has to be recorded again');
        const [unnamed] = maskedOutside(tape, noise);
        if (unnamed !== undefined) {
          throw new Error(`it masks values that the case does not name as noise (tape: ${unnamed}), so it has to be recorded again`);
        }
        item.credentials = [...new Set(tape.flatMap((entry) => entry.credentials))];
        let again: Awaited<ReturnType<typeof runCase>> | undefined;
        let mismatch: string | undefined;
        let departed: string | undefined;
        const measuredRun = async (address: URL) => {
          const done = await runCase(browser, testCase, address, undefined, frames, undefined, { entries: tape });
          for (const step of done.steps) step.observation = measure(step.observation, testCase.measured ?? []);
          return done;
        };
        if (original) {
          again = await measuredRun(original);
          const [found] = again.findings;
          const completed = again.steps.map((step) => stored(normalize(step.observation, noise)));
          departed =
            (found ? `step ${found.step}, tape ${found.request}: ${JSON.stringify(found.actual)}` : undefined) ??
            firstDifference(compareCase(expected.slice(0, completed.length), completed));
          mismatch = [departed, again.error].filter((each) => each !== undefined).join('; ') || undefined;
        }
        const run = await measuredRun(url);
        const actual = run.steps.map((step) => normalize(step.observation, noise));
        const results = compareCase(expected.slice(0, actual.length), actual.map(stored));
        const departs = run.findings.length > 0 || differing(results);
        let resized = false;
        const sameSession = again && !mismatch && again.steps.length === run.steps.length ? again : undefined;
        if (sameSession) {
          const masked = maskObservations(noise, sameSession.steps.map((step) => step.observation), sameSession.steps.map((step) => step.observation)).observations;
          const sizes = compareCase(masked.map(laidOut), actual.map(laidOut));
          resized = differing(sizes);
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
          if (screenshot === 'different' && before && !redact) {
            await mkdir(join(out, testCase.id), { recursive: true });
            await writeFile(join(out, testCase.id, `${name}.png`), step.screenshot);
            await writeFile(join(out, testCase.id, `${name}.original.png`), before);
          }
          const findings = run.findings.filter((finding) => finding.step === index + 1);
          layers.effects.differences.unshift(
            ...findings.map(({ request, expected, actual }) => ({ path: `tape ${request}`, expected, actual, kind: 'tape' as const })),
          );
          for (const layer of LAYERS) {
            for (const difference of layers[layer].differences) {
              found.push({ case: testCase.id, step: index + 1, difference: locate(layer, difference) });
            }
          }
          const reads = readNotes(tape, run.taken, index + 1, noise);
          item.steps.push(stepReport(index + 1, (redact ? redactStep : describeStep)(testCase.steps[index]), step, screenshot, layers, step.unread, reads));
        }
        if (drift) {
          const state = (differs: boolean, { error, hung, own }: Awaited<ReturnType<typeof runCase>>): DriftState => {
            if (differs) return 'differs';
            if (error === undefined) return 'matches';
            return !own && (hung || unreachable(error)) ? 'not checked' : 'differs';
          };
          item.drift = {
            original: state(departed !== undefined, again!),
            port: state(departs, run),
            ...(resized && !departs ? { sizes: 'differ' as const } : {}),
          };
        }
        item.error = mismatch ? `the original at ${original!.origin}/ does not match its recording: ${mismatch}; sizes, positions and screenshots were not compared` : run.error;
        if (mismatch && run.error) item.error += `; the port: ${run.error}`;
        for (const { step, request, actual } of run.findings) {
          if (step > run.steps.length) item.error += `; tape: ${request}: ${typeof actual === 'string' ? actual : JSON.stringify(actual)}`;
        }
      } catch (error) {
        const why = error instanceof SyntaxError ? 'a file of it is not valid JSON' : (error as Error).message;
        item.error = `cannot replay against the recording: ${why}`;
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

    report.distinct = distinct(found);
    const finished = finish(report);
    const shown = redact ? redactReport(finished) : hideReport(finished, hider(cases.map((loaded) => loaded.case)));
    const summary = summarize(shown);
    await writeFile(join(out, 'report.json'), toJson(shown));
    await writeFile(join(out, 'summary.txt'), `${summary}\n`);
    console.log(`${summary}\n\nReport: ${join('reports', source, 'report.json')}`);
    return report.result === 'pass' ? 0 : 1;
  } finally {
    await browser.close();
  }
}
