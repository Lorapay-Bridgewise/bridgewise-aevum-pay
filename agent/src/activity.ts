import type { Address, Hex, PublicClient } from "viem";
import { offlineVaultAbi } from "./abi.js";
import { log } from "./settler.js";

/** Aevum serves at most 1,000 blocks per eth_getLogs call. */
const CHUNK = 1_000n;
/** At most this many chunks per sync pass, so a long backlog never blocks a request for long. */
const MAX_CHUNKS_PER_SYNC = 200;
const KEEP = 5_000;

export type VaultEvent = {
  kind: "Deposited" | "Withdrawn" | "SessionOpened" | "SessionRevoked" | "VoucherSettled";
  block: string;
  time?: number;
  txHash: Hex;
  logIndex: number;
  owner?: Address;
  sessionId?: Hex;
  nonce?: Hex;
  payee?: Address;
  to?: Address;
  amount?: string;
  fee?: string;
  feeTo?: Address;
  perPaymentCap?: string;
  dailyCap?: string;
  expiresAt?: number;
};

/**
 * Every event the OfflineVault has emitted, read from the chain in 1,000 block chunks from the
 * deploy block, then kept up to date by polling (Aevum has no WebSocket RPC). The chain is the
 * source: the page shows settlements by anyone, not only by this agent.
 */
export class ActivityFeed {
  private events: VaultEvent[] = [];
  private nextBlock: bigint;
  private head = 0n;
  private syncing: Promise<void> | null = null;
  totals = { settled: 0, volume: 0n, fees: 0n, deposits: 0n, sessions: 0, revoked: 0 };
  /** Every session's owner, all time: who paid, for the payee's list of money in. */
  private owners = new Map<string, Address>();

  constructor(
    private readonly client: PublicClient,
    private readonly vault: Address,
    fromBlock: bigint,
  ) {
    this.nextBlock = fromBlock;
  }

  get caughtUp(): boolean {
    return this.head > 0n && this.nextBlock > this.head;
  }

  get scannedTo(): bigint {
    return this.nextBlock - 1n;
  }

  latest(n = 100): VaultEvent[] {
    return this.events.slice(-n).reverse();
  }

  /** Settlements paid to an address, newest first, with the paying wallet. */
  paidTo(payee: Address, n = 50): (VaultEvent & { from?: Address })[] {
    const want = payee.toLowerCase();
    const out: (VaultEvent & { from?: Address })[] = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < n; i--) {
      const e = this.events[i];
      if (e.kind === "VoucherSettled" && e.payee?.toLowerCase() === want) {
        out.push({ ...e, from: e.sessionId ? this.owners.get(e.sessionId.toLowerCase()) : undefined });
      }
    }
    return out;
  }

  /** One pass. Concurrent callers share the same pass. */
  sync(): Promise<void> {
    this.syncing ??= this.doSync().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async doSync() {
    this.head = await this.client.getBlockNumber({ cacheTime: 0 });
    const found: VaultEvent[] = [];
    for (let i = 0; i < MAX_CHUNKS_PER_SYNC && this.nextBlock <= this.head; i++) {
      const from = this.nextBlock;
      const to = from + CHUNK - 1n < this.head ? from + CHUNK - 1n : this.head;
      const logs = await this.client.getContractEvents({
        address: this.vault,
        abi: offlineVaultAbi,
        fromBlock: from,
        toBlock: to,
      });
      for (const l of logs) {
        const e = toEvent(l as unknown as RawLog);
        if (e) found.push(e);
      }
      this.nextBlock = to + 1n;
    }
    if (!found.length) return;

    // Block times, one call per block
    const blocks = [...new Set(found.map((e) => e.block))];
    const times = new Map<string, number>();
    await Promise.all(
      blocks.map(async (b) => {
        try {
          const blk = await this.client.getBlock({ blockNumber: BigInt(b) });
          times.set(b, Number(blk.timestamp));
        } catch (err) {
          log("warn", "activity_block_time_failed", { block: b });
        }
      }),
    );
    for (const e of found) {
      e.time = times.get(e.block);
      this.count(e);
    }
    this.events.push(...found);
    if (this.events.length > KEEP) this.events = this.events.slice(-KEEP);
  }

  private count(e: VaultEvent) {
    const t = this.totals;
    if (e.kind === "VoucherSettled") {
      t.settled++;
      t.volume += BigInt(e.amount ?? 0);
      t.fees += BigInt(e.fee ?? 0);
    } else if (e.kind === "Deposited") t.deposits += BigInt(e.amount ?? 0);
    else if (e.kind === "SessionOpened") {
      t.sessions++;
      if (e.sessionId && e.owner) this.owners.set(e.sessionId.toLowerCase(), e.owner);
    }
    else if (e.kind === "SessionRevoked") t.revoked++;
  }
}

type RawLog = {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
};

function toEvent(l: RawLog): VaultEvent | null {
  const a = l.args;
  const base = { block: l.blockNumber.toString(), txHash: l.transactionHash, logIndex: l.logIndex };
  const str = (x: unknown) => (x === undefined ? undefined : String(x));
  switch (l.eventName) {
    case "VoucherSettled":
      return {
        kind: "VoucherSettled",
        ...base,
        sessionId: a.sessionId as Hex,
        nonce: a.nonce as Hex,
        payee: a.payee as Address,
        amount: str(a.amount),
        fee: str(a.fee),
        feeTo: a.feeTo as Address,
      };
    case "Deposited":
      return { kind: "Deposited", ...base, owner: a.owner as Address, amount: str(a.amount) };
    case "Withdrawn":
      return { kind: "Withdrawn", ...base, owner: a.owner as Address, to: a.to as Address, amount: str(a.amount) };
    case "SessionOpened":
      return {
        kind: "SessionOpened",
        ...base,
        sessionId: a.sessionId as Hex,
        owner: a.owner as Address,
        perPaymentCap: str(a.perPaymentCap),
        dailyCap: str(a.dailyCap),
        expiresAt: Number(a.expiresAt),
      };
    case "SessionRevoked":
      return { kind: "SessionRevoked", ...base, sessionId: a.sessionId as Hex, owner: a.owner as Address };
    default:
      return null;
  }
}
