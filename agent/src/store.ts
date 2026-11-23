import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Hex } from "viem";
import type { SettlementStatus } from "./messages.js";

export type Row = {
  key: string;
  session_id: Hex;
  nonce: Hex;
  status: "sending" | Exclude<SettlementStatus, "unknown" | "retry">;
  tx_hash: Hex | null;
  block: string | null;
  fee: string | null;
  reason: string | null;
  voucher_json: string;
  from_block: string;
  attempts: number;
  created_at: number;
  updated_at: number;
};

/** One row per voucher (session id + nonce). The vault refuses a nonce twice, so retries are always safe. */
export class Store {
  private db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      create table if not exists settlements (
        key text primary key,
        session_id text not null,
        nonce text not null,
        status text not null,
        tx_hash text,
        block text,
        fee text,
        reason text,
        voucher_json text not null,
        from_block text not null,
        attempts integer not null default 0,
        created_at integer not null,
        updated_at integer not null
      );
      create index if not exists settlements_status on settlements(status);
      create table if not exists starter_gifts (
        address text primary key,
        ip text not null,
        day text not null,
        tx_hash text,
        created_at integer not null
      );
      create table if not exists daily_spend (
        day text primary key,
        tx_count integer not null default 0,
        gas_wei text not null default '0'
      );
    `);
  }

  static key(sessionId: Hex, nonce: Hex): string {
    return `${sessionId.toLowerCase()}:${nonce.toLowerCase()}`;
  }

  get(sessionId: Hex, nonce: Hex): Row | undefined {
    return this.db.prepare("select * from settlements where key = ?").get(Store.key(sessionId, nonce)) as
      | Row
      | undefined;
  }

  /** Insert a new row in state "sending". Returns false if the voucher is already known. */
  claim(sessionId: Hex, nonce: Hex, voucherJson: string, fromBlock: bigint): boolean {
    const now = Date.now();
    const res = this.db
      .prepare(
        `insert or ignore into settlements (key, session_id, nonce, status, voucher_json, from_block, created_at, updated_at)
         values (?, ?, ?, 'sending', ?, ?, ?, ?)`,
      )
      .run(Store.key(sessionId, nonce), sessionId, nonce, voucherJson, fromBlock.toString(), now, now);
    return res.changes === 1;
  }

  update(sessionId: Hex, nonce: Hex, fields: Partial<Pick<Row, "status" | "tx_hash" | "block" | "fee" | "reason">>) {
    const sets = Object.keys(fields).map((k) => `${k} = @${k}`);
    this.db
      .prepare(`update settlements set ${sets.join(", ")}, updated_at = @now where key = @key`)
      .run({ ...fields, now: Date.now(), key: Store.key(sessionId, nonce) });
  }

  bumpAttempts(sessionId: Hex, nonce: Hex) {
    this.db
      .prepare("update settlements set attempts = attempts + 1, updated_at = ? where key = ?")
      .run(Date.now(), Store.key(sessionId, nonce));
  }

  forget(sessionId: Hex, nonce: Hex) {
    this.db.prepare("delete from settlements where key = ?").run(Store.key(sessionId, nonce));
  }

  pending(): Row[] {
    return this.db
      .prepare("select * from settlements where status in ('sending', 'submitted') order by created_at limit 100")
      .all() as Row[];
  }

  counts(): Record<string, number> {
    const rows = this.db.prepare("select status, count(*) as n from settlements group by status").all() as {
      status: string;
      n: number;
    }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  /** What the agent has spent on gas on a UTC day (YYYY-MM-DD). */
  spend(day: string): { txCount: number; gasWei: bigint } {
    const r = this.db.prepare("select tx_count, gas_wei from daily_spend where day = ?").get(day) as
      | { tx_count: number; gas_wei: string }
      | undefined;
    return { txCount: r?.tx_count ?? 0, gasWei: BigInt(r?.gas_wei ?? "0") };
  }

  addSpend(day: string, txCount: number, gasWei: bigint) {
    this.db.transaction(() => {
      const cur = this.spend(day);
      this.db
        .prepare(
          `insert into daily_spend (day, tx_count, gas_wei) values (?, ?, ?)
           on conflict(day) do update set tx_count = excluded.tx_count, gas_wei = excluded.gas_wei`,
        )
        .run(day, cur.txCount + txCount, (cur.gasWei + gasWei).toString());
    })();
  }

  // ---------------------------------------------------------------- starter money

  /** Claims the one gift an address may get. False if it already had one (or one is in flight). */
  claimStarter(address: string, ip: string, day: string): boolean {
    const res = this.db
      .prepare("insert or ignore into starter_gifts (address, ip, day, created_at) values (?, ?, ?, ?)")
      .run(address.toLowerCase(), ip, day, Date.now());
    return res.changes === 1;
  }

  setStarterTx(address: string, txHash: Hex) {
    this.db.prepare("update starter_gifts set tx_hash = ? where address = ?").run(txHash, address.toLowerCase());
  }

  /** The send failed before reaching the chain: let the address try again. */
  releaseStarter(address: string) {
    this.db.prepare("delete from starter_gifts where address = ? and tx_hash is null").run(address.toLowerCase());
  }

  startersOn(day: string): number {
    return (this.db.prepare("select count(*) as n from starter_gifts where day = ?").get(day) as { n: number }).n;
  }

  startersFromIp(ip: string, day: string): number {
    return (
      this.db.prepare("select count(*) as n from starter_gifts where ip = ? and day = ?").get(ip, day) as { n: number }
    ).n;
  }

  close() {
    this.db.close();
  }
}
