import type { Incoming, Payment } from '../state/store';

/** Money out and money in, newest first, as one list. */
export type FeedItem = { key: string; at: number; out?: Payment; in?: Incoming };

export function makeFeed(payments: Payment[], incoming: Incoming[]): FeedItem[] {
  return [
    ...payments.map((p): FeedItem => ({ key: `out:${p.id}`, at: p.createdAt, out: p })),
    ...incoming.map((i): FeedItem => ({ key: `in:${i.id}`, at: i.at, in: i })),
  ].sort((a, b) => b.at - a.at);
}
