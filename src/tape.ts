import type { Entry } from './noise.ts';
import { isNumberNode } from './parts.ts';
import type { Body, UrlParts } from './parts.ts';
import { parsePath } from './path.ts';
import { isPlaceholder, kindOf, maskable, nodesOf, placeholder, walkLayer } from './value.ts';

export type Asked = { method: string; url: UrlParts; body: Body; credentials: string[] };
export type Answer = { status: number; headers: Record<string, string>; body: string; base64?: true };
export type TapeEntry = Asked & { step: number; epoch: number; answer: Answer | null };
export type Taken = Asked & { step: number };
export type Finding = { step: number; request: string; expected: unknown; actual: unknown; differs?: string[]; absent?: true };

export const CREDENTIAL_HEADERS = ['authorization', 'x-xsrf-token', 'x-csrf-token'];
export const ANSWER_HEADERS = ['content-type', 'location'];

export const isMutation = (method: string): boolean => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

const wrapped = ({ method, url, body }: Asked) =>
  isMutation(method)
    ? { effects: { requests: [structuredClone({ method, url, body })] } }
    : { effects: { gets: [structuredClone(url)] } };

function masking<T extends Asked>(request: T, hidden: (path: string) => boolean): T {
  const probe = wrapped(request);
  walkLayer('effects', probe, (path, value, set) => {
    if (maskable(kindOf(value)) && hidden(path)) set(placeholder(kindOf(value)));
  });
  return unwrapped(request, probe);
}

const unwrapped = <T extends Asked>(request: T, { effects }: ReturnType<typeof wrapped>): T =>
  'requests' in effects ? { ...request, ...effects.requests![0] } : { ...request, url: effects.gets![0] };

export function maskRequest<T extends Asked>(request: T, noise: Entry[]): T {
  const relaxed = noise.filter((entry) => entry.layer === 'effects');
  if (relaxed.length === 0) return request;
  return masking(request, (path) => relaxed.some((entry) => entry.matcher.matches(path, true)));
}

const masks = (entry: Asked): Set<string> =>
  new Set([...nodesOf('effects', wrapped(entry))].filter(([, value]) => isPlaceholder(value)).map(([path]) => path));

const maskedAs = <T extends Asked>(request: T, entry: Asked): T => {
  const hidden = masks(entry);
  return hidden.size === 0 ? request : masking(request, (path) => hidden.has(path));
};

const fits = (request: Asked, entry: Asked): boolean => requestKey(maskedAs(request, entry)) === requestKey(entry);

export type Withheld = (text: string, names: string[]) => boolean;

export function agreedTape(tape: TapeEntry[], again: Taken[], noise: Entry[], withheld: Withheld): TapeEntry[] {
  const keyed = again.map((request) => ({ request, loose: requestKey(request, noise), exact: requestKey(request) }));
  const partners = new Map<TapeEntry, (typeof keyed)[number]>();
  const used = new Set<(typeof keyed)[number]>();
  for (const entry of tape) {
    const exact = requestKey(entry);
    const same = keyed.find((each) => !used.has(each) && each.request.step === entry.step && each.exact === exact);
    if (!same) continue;
    partners.set(entry, same);
    used.add(same);
  }
  for (const entry of tape) {
    if (partners.has(entry)) continue;
    const loose = requestKey(entry, noise);
    const rank = (each: (typeof keyed)[number]) => [
      Number(used.has(each)),
      Number(each.request.step !== entry.step),
      differing(entry, each.request).length,
    ];
    const [nearest] = keyed
      .filter((each) => each.loose === loose)
      .map((each) => ({ each, rank: rank(each) }))
      .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
    if (!nearest) continue;
    partners.set(entry, nearest.each);
    used.add(nearest.each);
  }
  return tape.map((entry) => {
    const masked = maskRequest(entry, noise);
    const partner = partners.get(entry);
    if (!partner || masked === entry) return masked;
    const [first, second] = [entry, partner.request].map((each) => nodesOf('effects', wrapped(each)));
    const probe = wrapped(masked);
    const dropped = (path: string) =>
      noise.some((each) => each.keep === false && each.layer === 'effects' && each.matcher.matches(path, true));
    walkLayer('effects', probe, (path, value, set) => {
      const was = first.get(path);
      if (!isPlaceholder(value) || JSON.stringify(was) !== JSON.stringify(second.get(path)) || dropped(path)) return;
      const names = parsePath(path).flatMap((token) => (typeof token === 'object' && 'key' in token ? [token.key] : []));
      const text = isNumberNode(was) ? was.source.replace(/e(\d+)$/, (_, zeros: string) => '0'.repeat(Number(zeros))) : String(was);
      if (!withheld(text, names)) set(was);
    });
    return unwrapped(masked, probe);
  });
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
    .map((entry) => ({ entry, count: differing(entry, maskedAs(request, entry)).length }))
    .sort((a, b) => a.count - b.count)[0]?.entry;

const samePath = (a: Asked, b: Asked) => {
  const path = ({ method, url }: Asked) => JSON.stringify([method, url.origin, url.path]);
  return path(a) === path(b);
};

const times = (count: number) => `${count} time${count === 1 ? '' : 's'}`;
const ABSENT = 'the tape does not hold it, so it was aborted';

export type Player = {
  findings: Finding[];
  taken: Taken[];
  take(request: Asked, step: number, epoch: number): TapeEntry | undefined;
  unsent(steps: number): Finding[];
};

export function player(tape: TapeEntry[], second = false): Player {
  const loose = new Map(tape.map((entry) => [entry, masks(entry).size]));
  const closestFits = (matches: TapeEntry[]) => {
    const fewest = Math.min(...matches.map((entry) => loose.get(entry)!));
    return matches.filter((entry) => loose.get(entry) === fewest);
  };
  const counts = new Map<string, number>();
  const used = new Set<TapeEntry>();
  const findings: Finding[] = [];
  const taken: Taken[] = [];

  const count = (id: string): number => {
    const seen = counts.get(id) ?? 0;
    counts.set(id, seen + 1);
    return seen;
  };

  function read(request: Asked, step: number, epoch: number, matches: TapeEntry[]): TapeEntry | undefined {
    const finding = { step, request: describeRequest(request) };
    if (matches.length === 0) {
      const near = closest(request, tape.filter((entry) => entry.method === request.method));
      const differs = near ? differing(near, maskedAs(request, near)) : [];
      findings.push({ ...finding, expected: 'a request that the tape holds', actual: ABSENT, differs });
      return second ? near : undefined;
    }
    const inEpoch = closestFits(matches.filter((entry) => entry.epoch === epoch));
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
    const id = `${step} ${inStep.map((entry) => tape.indexOf(entry))}`;
    if (inStep.length > 0) return inStep[Math.min(count(id), inStep.length - 1)];
    return inEpoch.filter((entry) => entry.step < step).at(-1) ?? inEpoch[0];
  }

  function mutation(request: Asked, step: number, matches: TapeEntry[]): TapeEntry | undefined {
    const name = describeRequest(request);
    if (matches.length > 0) {
      const found = [...matches].sort((a, b) => loose.get(a)! - loose.get(b)!).find((entry) => !used.has(entry));
      if (!found) {
        findings.push({ step, request: name, expected: `sent ${times(matches.length)}`, actual: 'sent once more, so it was aborted', differs: [] });
      }
      return found;
    }
    const near = tape.find((entry) => isMutation(entry.method) && !used.has(entry) && samePath(entry, maskedAs(request, entry)));
    if (!near) {
      findings.push({ step, request: name, expected: 'a request that the tape holds', actual: ABSENT, differs: [] });
      return undefined;
    }
    const sent = maskedAs(request, near);
    findings.push({
      step,
      request: `${name} (changed mutation)`,
      expected: { url: near.url, body: near.body },
      actual: { url: sent.url, body: sent.body },
      differs: differing(near, sent),
    });
    return near;
  }

  return {
    findings,
    taken,
    unsent(steps) {
      return tape
        .filter((entry) => isMutation(entry.method) && entry.step <= steps && !used.has(entry))
        .map((entry) => ({
          step: entry.step,
          request: describeRequest(entry),
          expected: 'sent in this step',
          actual: 'the page did not send it, or cancelled it before it was let go',
          differs: [],
          absent: true,
        }));
    },
    take(request, step, epoch) {
      taken.push({ ...request, step });
      const matches = tape.filter((entry) => fits(request, entry));
      const found = isMutation(request.method) ? mutation(request, step, matches) : read(request, step, epoch, matches);
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
