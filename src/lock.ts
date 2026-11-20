import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const LOCK_FORMAT = 'angular-anything/lock@0';
export const LOCK_FILE = 'lock.json';

// What a recording is tied to: the versions that produced it and the SHA-256 of the case it was recorded from.
export type Pins = { playwright: string; browser: string; case: string };

export type Lock = Pins & { format: typeof LOCK_FORMAT; files: Record<string, string>; root: string };

export const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

const rootHash = (pins: Pins, files: Record<string, string>): string =>
  sha256(JSON.stringify([pins.playwright, pins.browser, pins.case, Object.entries(files).sort()]));

async function hashFiles(directory: string): Promise<Record<string, string>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name !== LOCK_FILE && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  const files: Record<string, string> = {};
  for (const name of names) files[name] = sha256(await readFile(join(directory, name)));
  return files;
}

export async function writeLock(directory: string, pins: Pins): Promise<Lock> {
  const files = await hashFiles(directory);
  const lock: Lock = {
    format: LOCK_FORMAT,
    playwright: pins.playwright,
    browser: pins.browser,
    case: pins.case,
    files,
    root: rootHash(pins, files),
  };
  await writeFile(join(directory, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}

// Returns what is wrong with the recording in the directory. An empty list means it matches its lock.
export async function checkLock(directory: string, pins: Pins): Promise<string[]> {
  let lock: Lock;
  try {
    lock = JSON.parse(await readFile(join(directory, LOCK_FILE), 'utf8'));
  } catch {
    return [`no readable ${LOCK_FILE}: record the case first`];
  }
  if (lock.format !== LOCK_FORMAT || typeof lock.files !== 'object' || lock.files === null) {
    return [`${LOCK_FILE} is not in the format ${LOCK_FORMAT}`];
  }
  const problems: string[] = [];
  const files = await hashFiles(directory);
  for (const name of Object.keys(lock.files).sort()) {
    if (!Object.hasOwn(files, name)) problems.push(`${name} is missing`);
    else if (files[name] !== lock.files[name]) problems.push(`${name} does not match its SHA-256 in ${LOCK_FILE}`);
  }
  for (const name of Object.keys(files)) {
    if (!Object.hasOwn(lock.files, name)) problems.push(`${name} is not in ${LOCK_FILE}`);
  }
  if (lock.root !== rootHash(lock, lock.files)) problems.push(`the root hash in ${LOCK_FILE} does not match its content`);
  if (lock.case !== pins.case) problems.push('stale: case.json changed after the recording');
  if (lock.playwright !== pins.playwright || lock.browser !== pins.browser) {
    problems.push(
      `stale: recorded with Playwright ${lock.playwright} and ${lock.browser}, now running Playwright ${pins.playwright} and ${pins.browser}`,
    );
  }
  return problems;
}
