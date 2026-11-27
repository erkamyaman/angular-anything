import type { CDPSession, Request } from 'playwright';

export const ARRIVE_MS = 1000;
const BARRIER_MS = 1000;
const POLL_MS = 5;

type Sent = {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Buffer;
  seen: boolean;
  gone: boolean;
};

export type SendOrder = {
  sorted(requests: Request[]): Promise<Request[]>;
  next(requests: Request[], inFlight: Set<Request>): Promise<Request | undefined>;
};

export async function sendOrder(session: CDPSession, arriveMs = ARRIVE_MS): Promise<SendOrder> {
  const sent: Sent[] = [];
  const places = new WeakMap<Request, number>();
  session.on('Network.requestWillBeSent', ({ requestId, request }) => {
    const parts = request.postDataEntries?.map((entry) => entry.bytes);
    const body = parts?.every((part) => part !== undefined)
      ? Buffer.concat(parts.map((part) => Buffer.from(part, 'base64')))
      : undefined;
    const { method, url, headers } = request;
    sent.push({ id: requestId, method, url, headers, body, seen: false, gone: false });
  });
  const gone = ({ requestId }: { requestId: string }) => {
    for (const each of sent) if (each.id === requestId) each.gone = true;
  };
  session.on('Network.loadingFinished', gone);
  session.on('Network.loadingFailed', gone);
  await session.send('Network.enable');

  const heard = async () => {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      session.send('Runtime.evaluate', { expression: '0' }).catch(() => {}),
      new Promise((resolve) => {
        timer = setTimeout(resolve, BARRIER_MS);
      }),
    ]);
    clearTimeout(timer);
  };

  const place = (request: Request) => {
    if (places.has(request)) return;
    const headers = request.headers();
    const missed = (each: Sent) =>
      Object.entries(each.headers).filter(([name, value]) => headers[name.toLowerCase()] !== value).length;
    const matched = (each: Sent) => Object.keys(each.headers).length - missed(each);
    const found = sent
      .filter(
        (each) =>
          !each.seen &&
          each.method === request.method() &&
          each.url === request.url() &&
          (each.body === undefined || each.body.equals(request.postDataBuffer() ?? Buffer.alloc(0))),
      )
      .sort((a, b) => missed(a) - missed(b) || matched(b) - matched(a))[0];
    if (!found) return;
    found.seen = true;
    places.set(request, sent.indexOf(found));
  };

  const sorted = async (requests: Request[]) => {
    await heard();
    requests.forEach(place);
    const known = requests.filter((request) => places.has(request)).sort((a, b) => places.get(a)! - places.get(b)!);
    let at = 0;
    return requests.map((request) => (places.has(request) ? known[at++] : request));
  };

  return {
    sorted,
    async next(requests, inFlight) {
      const until = Date.now() + arriveMs;
      for (;;) {
        const first = (await sorted([...new Set([...requests, ...inFlight])])).find((request) => inFlight.has(request));
        if (!first) return undefined;
        const missing = sent.slice(0, places.get(first) ?? 0).filter((each) => !each.seen && !each.gone);
        if (missing.length === 0) return first;
        if (Date.now() > until) {
          for (const each of missing) each.gone = true;
          return first;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    },
  };
}
