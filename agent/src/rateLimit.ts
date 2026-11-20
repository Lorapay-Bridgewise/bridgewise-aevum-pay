/**
 * Sliding one hour window per key, in memory. The agent runs as one container, so memory is
 * enough; a restart forgets the counts, which only ever makes the limit looser for an hour.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limitPerHour: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True if one more hit is allowed now. Does not record it. */
  allows(key: string): boolean {
    return this.recent(key).length < this.limitPerHour;
  }

  record(key: string) {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - 3_600_000;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }
}
