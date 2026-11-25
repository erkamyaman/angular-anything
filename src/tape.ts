import type { Entry } from './noise.ts';
import type { Body, UrlParts } from './parts.ts';
import { isPlaceholder, kindOf, maskable, nodesOf, placeholder, walkLayer } from './value.ts';

export type Asked = { method: string; url: UrlParts; body: Body; credentials: string[] };
export type Answer = { status: number; headers: Record<string, string>; body: string; base64?: true };
export type TapeEntry = Asked & { step: number; epoch: number; answer: Answer | null };
export type Taken = Asked & { step: number };
export type Finding = { step: number; request: string; expected: unknown; actual: unknown; differs?: string[] };

export const CREDENTIAL_HEADERS = ['authorization', 'x-xsrf-token', 'x-csrf-token'];
export const ANSWER_HEADERS = ['content-type', 'location'];

export const isMutation = (method: string): boolean => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

const wrapped = ({ method, url, body }: Asked) =>
  isMutation(method)
    ? { effects: { requests: [structuredClone({ method, url, body })] } }
    : { effects: { gets: [structuredClone(url)] } };

export function maskRequest<T extends Asked>(request: T, noise: Entry[]): T {
  const relaxed = noise.filter((entry) => entry.layer === 'effects');
  if (relaxed.length === 0) return request;
  const probe = wrapped(request);
  walkLayer('effects', probe, (path, value, set) => {
    if (maskable(kindOf(value)) && relaxed.some((entry) => entry.matcher.matches(path, true))) set(placeholder(kindOf(value)));
  });
  const { effects } = probe;
  return 'requests' in effects ? { ...request, ...effects.requests![0] } : { ...request, url: effects.gets![0] };
}

export function maskedOutside(tape: TapeEntry[], noise: Entry[]): string[] {
  const outside: string[] = [];
  for (const entry of tape) {
    walkLayer('effects', wrapped(entry), (path, value) => {
      if (isPlaceholder(value) && !noise.some((each) => each.layer === 'effects' && each.matcher.matches(path, true))) outside.push(path);
    });
  }
  return outside;
}

const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted((value as Record<string, unknown>)[key])]));
};

export function requestKey(request: Asked, noise: Entry[] = []): string {
  const { method, url, body } = maskRequest(request, noise);
  return JSON.stringify(sorted({ method, url: { ...url, origin: url.origin ?? 'page' }, body }));
}

export function describeRequest({ method, url }: Asked): string {
  const shown = (value: unknown) => (isPlaceholder(value) ? '*' : String(value));
  const query = Object.entries(url.query).flatMap(([name, values]) => values.map((value) => `${name}=${shown(value)}`));
  return `${method} ${url.origin ?? ''}/${url.path.map(shown).join('/')}${query.length > 0 ? `?${query.join('&')}` : ''}`;
}

const leaves = (request: Asked) =>
  new Map(
    [...nodesOf('effects', wrapped(request))]
      .filter(([, value]) => typeof value !== 'object' || value === null)
      .map(([path, value]) => [path.replace('[0]', '[*]'), value]),
  );

function differing(left: Asked, right: Asked): string[] {
  const [a, b] = [leaves(left), leaves(right)];
  return [...new Set([...a.keys(), ...b.keys()])].filter((path) => a.get(path) !== b.get(path));
}

const closest = (request: Asked, candidates: TapeEntry[]): TapeEntry | undefined =>
  candidates
    .map((entry) => ({ entry, count: differing(entry, request).length }))
    .sort((a, b) => a.count - b.count)[0]?.entry;

const samePath = (a: Asked, b: Asked, noise: Entry[]) => {
  const path = (request: Asked) => {
    const { url } = maskRequest(request, noise);
    return JSON.stringify([request.method, url.origin, url.path]);
  };
  return path(a) === path(b);
};

const times = (count: number) => `${count} time${count === 1 ? '' : 's'}`;
const ABSENT = 'the tape does not hold it, so it was aborted';

export type Player = { findings: Finding[]; taken: Taken[]; take(request: Asked, step: number, epoch: number): TapeEntry | undefined };

export function player(tape: TapeEntry[], noise: Entry[] = [], second = false): Player {
  const keyed = tape.map((entry) => ({ entry, key: requestKey(entry, noise) }));
  const counts = new Map<string, number>();
  const used = new Set<TapeEntry>();
  const findings: Finding[] = [];
  const taken: Taken[] = [];

  const count = (id: string): number => {
    const seen = counts.get(id) ?? 0;
    counts.set(id, seen + 1);
    return seen;
  };

  function read(request: Asked, step: number, epoch: number, key: string, matches: TapeEntry[]): TapeEntry | undefined {
    const finding = { step, request: describeRequest(request) };
    if (matches.length === 0) {
      const near = closest(request, tape.filter((entry) => entry.method === request.method));
      findings.push({ ...finding, expected: 'a request that the tape holds', actual: ABSENT, differs: near ? differing(near, request) : [] });
      return second ? near : undefined;
    }
    const inEpoch = matches.filter((entry) => entry.epoch === epoch);
    if (inEpoch.length === 0) {
      findings.push({
        ...finding,
        expected: 'an answer on the tape for this state',
        actual: 'the tape has no answer for this state: the case needs a step in which the original asks',
      });
      const earlier = matches.filter((entry) => entry.epoch < epoch);
      if (earlier.length > 0) {
        const nearest = Math.max(...earlier.map((entry) => entry.epoch));
        return earlier.filter((entry) => entry.epoch === nearest).at(-1);
      }
      const next = Math.min(...matches.map((entry) => entry.epoch));
      return matches.find((entry) => entry.epoch === next);
    }
    const inStep = inEpoch.filter((entry) => entry.step === step);
    if (inStep.length > 0) return inStep[Math.min(count(`${epoch} ${step} ${key}`), inStep.length - 1)];
    return inEpoch.filter((entry) => entry.step < step).at(-1) ?? inEpoch[0];
  }

  function mutation(request: Asked, step: number, key: string, matches: TapeEntry[]): TapeEntry | undefined {
    const name = describeRequest(request);
    if (matches.length > 0) {
      const found = matches[count(key)];
      if (!found) {
        findings.push({ step, request: name, expected: `sent ${times(matches.length)}`, actual: 'sent once more, so it was aborted', differs: [] });
      }
      return found;
    }
    const masked = maskRequest(request, noise);
    const near = tape.find((entry) => isMutation(entry.method) && !used.has(entry) && samePath(entry, request, noise));
    if (!near) {
      findings.push({ step, request: name, expected: 'a request that the tape holds', actual: ABSENT, differs: [] });
      return undefined;
    }
    const recorded = maskRequest(near, noise);
    findings.push({
      step,
      request: `${name} (changed mutation)`,
      expected: { url: recorded.url, body: recorded.body },
      actual: { url: masked.url, body: masked.body },
      differs: differing(recorded, masked),
    });
    return near;
  }

  return {
    findings,
    taken,
    take(request, step, epoch) {
      taken.push({ ...request, step });
      const key = requestKey(request, noise);
      const matches = keyed.filter((item) => item.key === key).map((item) => item.entry);
      const found = isMutation(request.method)
        ? mutation(request, step, key, matches)
        : read(request, step, epoch, key, matches);
      if (!found) return undefined;
      used.add(found);
      for (const header of CREDENTIAL_HEADERS) {
        const [recorded, sent] = [found, request].map((each) => each.credentials.includes(header));
        if (recorded === sent) continue;
        const word = (has: boolean) => `${has ? 'with' : 'without'} the header ${header}`;
        findings.push({ step, request: describeRequest(request), expected: word(recorded), actual: word(sent) });
      }
      return found;
    },
  };
}

export function readNotes(tape: TapeEntry[], taken: Taken[], step: number, noise: Entry[] = []): string[] {
  const names = new Map<string, string>();
  const keys = (list: (TapeEntry | Taken)[]) =>
    list
      .filter((entry) => entry.step === step && !isMutation(entry.method))
      .map((entry) => {
        const key = requestKey(entry, noise);
        if (!names.has(key)) names.set(key, describeRequest(maskRequest(entry, noise)));
        return key;
      });
  const [original, port] = [keys(tape), keys(taken)];
  const occurrences = (list: string[], key: string) => list.filter((each) => each === key).length;
  const notes: string[] = [];
  for (const key of new Set([...original, ...port])) {
    const [was, is] = [occurrences(original, key), occurrences(port, key)];
    if (was !== is) notes.push(`${names.get(key)}: the original sent it ${times(was)}, the port ${times(is)}`);
  }
  const shared = (list: string[], other: string[]) =>
    list.filter((key, at) => occurrences(list.slice(0, at), key) < occurrences(other, key));
  const [left, right] = [shared(original, port), shared(port, original)];
  if (left.join('\n') !== right.join('\n')) {
    const listed = (list: string[]) => list.map((key) => names.get(key)).join(', ');
    notes.push(`the order of the reads differs: the original ${listed(left)}, the port ${listed(right)}`);
  }
  return notes;
}
