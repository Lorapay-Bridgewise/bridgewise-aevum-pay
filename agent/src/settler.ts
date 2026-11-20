import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { offlineVaultAbi } from "./abi.js";
import type { Config } from "./config.js";
import { toVoucher, type Receipt, type VoucherMessage, type Voucher } from "./messages.js";
import { Store, type Row } from "./store.js";
import { RateLimiter } from "./rateLimit.js";

export const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

/** Where a voucher came from: the mesh node that uploaded it, or "api" for the direct endpoint. */
export type Origin = { node?: string };

export type OwnerAction = "depositWithPermit" | "openSessionBySig" | "revokeBySig" | "withdrawBySig";
export type RelayResult = { status: "confirmed" | "submitted" | "rejected" | "retry"; txHash?: Hex; reason?: string };

const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;
const STATUS_CODE = { unknown: 0, submitted: 1, confirmed: 2, rejected: 3, retry: 4 } as const;

/** Vault errors that mean the voucher can never settle. Anything else is treated as temporary. */
const FINAL_ERRORS = new Set([
  "UnknownSession",
  "SessionRevokedErr",
  "SessionExpired",
  "VoucherExpired",
  "VoucherReused",
  "ZeroAmount",
  "OverPaymentCap",
  "FeeTooHigh",
  "BadSignature",
]);
/** Vault errors that may clear later (a new day, a new deposit). The phone may send the voucher again. */
const LATER_ERRORS = new Set(["OverDailyCap", "InsufficientBalance"]);

export class Settler {
  readonly chain: Chain;
  readonly account: Account;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  private sendQueue: Promise<unknown> = Promise.resolve();
  private readonly perSession: RateLimiter;
  private readonly perNode: RateLimiter;

  constructor(
    readonly cfg: Config,
    readonly store: Store,
  ) {
    this.chain = defineChain({
      id: cfg.chainId,
      name: "QDay Aevum Testnet",
      nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 },
      rpcUrls: { default: { http: [cfg.rpcUrl] } },
      blockExplorers: { default: { name: "Aevum explorer", url: cfg.explorerUrl } },
    });
    this.account = privateKeyToAccount(cfg.agentKey);
    const transport = http(cfg.rpcUrl, { retryCount: 2, timeout: 10_000 });
    this.publicClient = createPublicClient({ chain: this.chain, transport, pollingInterval: 500 }) as PublicClient;
    this.walletClient = createWalletClient({ chain: this.chain, transport, account: this.account });
    this.perSession = new RateLimiter(cfg.ratePerSessionHour);
    this.perNode = new RateLimiter(cfg.ratePerNodeHour);
  }

  get agentAddress(): Address {
    return this.account.address;
  }

  // ---------------------------------------------------------------- entry points

  /** A voucher from a phone. Idempotent: the same voucher always gets the same outcome. */
  async handleVoucher(
    msg: VoucherMessage,
    deadlineMs = Date.now() + this.cfg.confirmWaitMs,
    origin: Origin = {},
  ): Promise<Receipt> {
    const v = toVoucher(msg);
    const answer = (status: "rejected" | "retry", reason: string) =>
      this.receipt({ sessionId: v.sessionId, nonce: v.nonce, status, reason });

    if (msg.chainId !== this.cfg.chainId || msg.vault.toLowerCase() !== this.cfg.vault.toLowerCase()) {
      return answer("rejected", "WrongVault");
    }

    // A voucher the agent already knows always gets the same answer, outside every limit.
    const known = this.store.get(v.sessionId, v.nonce);
    if (known) return this.refresh(known, deadlineMs);

    // Rails, checked before any RPC call so a bad voucher costs nothing.
    const now = Math.floor(Date.now() / 1000);
    if (v.maxFee < this.cfg.feeUnits) return answer("rejected", "FeeTooLow");
    if (v.validBefore <= BigInt(now)) return answer("rejected", "VoucherExpired");
    if (v.validBefore > BigInt(now + this.cfg.maxVoucherTtlSec)) return answer("rejected", "ValidityTooLong");

    const sessionKey = v.sessionId.toLowerCase();
    const nodeKey = origin.node ?? "api";
    if (!this.perSession.allows(sessionKey) || !this.perNode.allows(nodeKey)) {
      log("warn", "rate_limited", { sessionId: v.sessionId, node: nodeKey });
      return answer("retry", "RateLimited");
    }
    this.perSession.record(sessionKey);
    this.perNode.record(nodeKey);

    try {
      // Already settled by someone else (settlement is permissionless)?
      if (await this.isUsed(v)) {
        const fromBlock = (await this.publicClient.getBlockNumber({ cacheTime: 0 })) - 5_000n;
        this.store.claim(v.sessionId, v.nonce, JSON.stringify(msg), fromBlock < 0n ? 0n : fromBlock);
        return this.refresh(this.store.get(v.sessionId, v.nonce)!, deadlineMs);
      }

      const fee = this.cfg.feeUnits < v.maxFee ? this.cfg.feeUnits : v.maxFee;
      const args = this.settleArgs(v, msg.r as Hex, msg.s as Hex, fee);

      // Dry run first: a voucher the vault would refuse never costs gas.
      const sim = await this.simulate(args);
      if (sim.kind === "revert") {
        if (LATER_ERRORS.has(sim.error)) {
          return this.receipt({ sessionId: v.sessionId, nonce: v.nonce, status: "retry", reason: sim.error });
        }
        // Remember final refusals so a replayed message gets the same answer without an RPC call.
        this.store.claim(v.sessionId, v.nonce, JSON.stringify(msg), 0n);
        this.store.update(v.sessionId, v.nonce, { status: "rejected", reason: sim.error });
        return this.fromRow(this.store.get(v.sessionId, v.nonce)!);
      }

      const budget = this.budgetLeft();
      if (budget) return answer("retry", budget);

      const fromBlock = await this.publicClient.getBlockNumber({ cacheTime: 0 });
      if (!this.store.claim(v.sessionId, v.nonce, JSON.stringify(msg), fromBlock)) {
        // Another request for the same voucher got here first.
        return this.refresh(this.store.get(v.sessionId, v.nonce)!, deadlineMs);
      }
      this.store.update(v.sessionId, v.nonce, { fee: fee.toString() });

      const hash = await this.send(args, v);
      this.store.update(v.sessionId, v.nonce, { status: "submitted", tx_hash: hash });
      return this.refresh(this.store.get(v.sessionId, v.nonce)!, deadlineMs);
    } catch (err) {
      log("warn", "voucher_failed_temporarily", { sessionId: v.sessionId, nonce: v.nonce, err: short(err) });
      const row = this.store.get(v.sessionId, v.nonce);
      if (row) return this.fromRow(row);
      return this.receipt({ sessionId: v.sessionId, nonce: v.nonce, status: "retry", reason: "ChainUnavailable" });
    }
  }

  /** A phone asking about an earlier voucher. */
  async handleStatus(sessionId: Hex, nonce: Hex, deadlineMs = Date.now() + this.cfg.confirmWaitMs): Promise<Receipt> {
    const row = this.store.get(sessionId, nonce);
    if (!row) return this.receipt({ sessionId, nonce, status: "unknown" });
    try {
      return await this.refresh(row, deadlineMs);
    } catch {
      return this.fromRow(row);
    }
  }

  /** Background pass: settle what is still open (crashes, dropped transactions, slow blocks). */
  async sweep(): Promise<void> {
    for (const row of this.store.pending()) {
      try {
        await this.refresh(row, Date.now() + 1_000);
        const after = this.store.get(row.session_id, row.nonce)!;
        const age = Date.now() - after.updated_at;
        // "sending" rows younger than 15 s may still be in flight in a request; leave them alone.
        if ((after.status === "sending" && age > 15_000) || (after.status === "submitted" && age > 120_000)) {
          await this.resubmit(after);
        }
      } catch (err) {
        log("warn", "sweep_failed", { key: row.key, err: short(err) });
      }
    }
  }

  async health() {
    const [block, gas] = await Promise.all([
      this.publicClient.getBlockNumber({ cacheTime: 0 }),
      this.publicClient.getBalance({ address: this.agentAddress }),
    ]);
    return {
      ok: gas >= this.cfg.minGasWei,
      chainId: this.cfg.chainId,
      block: block.toString(),
      vault: this.cfg.vault,
      agent: this.agentAddress,
      gasBalanceWei: gas.toString(),
      lowGas: gas < this.cfg.minGasWei,
      feeUnits: this.cfg.feeUnits.toString(),
      settlements: this.store.counts(),
      today: (() => {
        const t = this.store.spend(utcDay());
        return {
          transactions: t.txCount,
          gasWei: t.gasWei.toString(),
          txCap: this.cfg.dailyTxCap,
          gasBudgetWei: this.cfg.dailyGasBudgetWei.toString(),
          paused: this.budgetLeft(),
        };
      })(),
    };
  }

  // ---------------------------------------------------------------- internals

  private settleArgs(v: Voucher, r: Hex, s: Hex, fee: bigint) {
    return [
      {
        sessionId: v.sessionId,
        payee: v.payee,
        amount: v.amount,
        maxFee: v.maxFee,
        nonce: v.nonce,
        validBefore: v.validBefore,
      },
      r,
      s,
      fee,
      this.agentAddress,
    ] as const;
  }

  private async isUsed(v: { sessionId: Hex; nonce: Hex }): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.cfg.vault,
      abi: offlineVaultAbi,
      functionName: "voucherUsed",
      args: [v.sessionId, v.nonce],
    });
  }

  private async simulate(
    args: ReturnType<Settler["settleArgs"]>,
  ): Promise<{ kind: "ok" } | { kind: "revert"; error: string }> {
    try {
      await this.publicClient.simulateContract({
        address: this.cfg.vault,
        abi: offlineVaultAbi,
        functionName: "settle",
        args,
        account: this.account,
      });
      return { kind: "ok" };
    } catch (err) {
      const name = revertName(err);
      if (name) return { kind: "revert", error: name };
      throw err; // RPC trouble: not the voucher's fault
    }
  }

  /**
   * Submit an owner action the owner signed (deposit by permit, open session, revoke, withdraw).
   * The vault checks the owner's signature and nonce, so a repeat or a forgery fails the dry run
   * and costs nothing. Waits up to the deadline for the block.
   */
  async relayOwnerAction(
    functionName: OwnerAction,
    args: readonly unknown[],
    deadlineMs = Date.now() + this.cfg.confirmWaitMs,
  ): Promise<RelayResult> {
    const budget = this.budgetLeft();
    if (budget) return { status: "retry", reason: budget };
    const call = { address: this.cfg.vault, abi: offlineVaultAbi, functionName, args, account: this.account } as const;
    try {
      await this.publicClient.simulateContract(call as never);
    } catch (err) {
      const name = revertName(err);
      if (name) return { status: "rejected", reason: name };
      return { status: "retry", reason: "ChainUnavailable" };
    }
    let hash: Hex;
    try {
      const job = this.sendQueue.then(async () => {
        const h = await this.walletClient.writeContract({
          address: this.cfg.vault,
          abi: offlineVaultAbi,
          functionName,
          args,
          account: this.account,
          chain: this.chain,
          gas: 400_000n,
        } as never);
        this.store.addSpend(utcDay(), 1, 0n);
        log("info", "owner_action_submitted", { action: functionName, hash: h });
        return h;
      });
      this.sendQueue = job.catch(() => undefined);
      hash = await job;
    } catch (err) {
      log("warn", "owner_action_failed", { action: functionName, err: short(err) });
      return { status: "retry", reason: "ChainUnavailable" };
    }
    const wait = Math.max(0, deadlineMs - Date.now());
    const rcpt = await this.publicClient
      .waitForTransactionReceipt({ hash, timeout: wait, pollingInterval: 400 })
      .catch(() => null);
    if (!rcpt) return { status: "submitted", txHash: hash };
    this.store.addSpend(utcDay(), 0, rcpt.gasUsed * (rcpt.effectiveGasPrice ?? 0n));
    return rcpt.status === "success"
      ? { status: "confirmed", txHash: hash }
      : { status: "rejected", txHash: hash, reason: "Reverted" };
  }

  /** null if the agent may send another transaction today, otherwise the reason it may not. */
  budgetLeft(): string | null {
    const today = this.store.spend(utcDay());
    if (today.txCount >= this.cfg.dailyTxCap) return "AgentDailyCapReached";
    if (today.gasWei >= this.cfg.dailyGasBudgetWei) return "AgentGasBudgetReached";
    return null;
  }

  /** Transactions go out one at a time so the account nonce never races. */
  private send(args: ReturnType<Settler["settleArgs"]>, v: Voucher): Promise<Hex> {
    const job = this.sendQueue.then(async () => {
      this.store.bumpAttempts(v.sessionId, v.nonce);
      const hash = await this.walletClient.writeContract({
        address: this.cfg.vault,
        abi: offlineVaultAbi,
        functionName: "settle",
        args,
        account: this.account,
        chain: this.chain,
        gas: 600_000n, // P-256 check in Solidity uses about 376k
      });
      this.store.addSpend(utcDay(), 1, 0n);
      log("info", "submitted", { sessionId: v.sessionId, nonce: v.nonce, hash });
      return hash;
    });
    this.sendQueue = job.catch(() => undefined);
    return job;
  }

  /** Bring a row up to date with the chain, waiting up to the deadline for it to be mined. */
  private async refresh(row: Row, deadlineMs: number): Promise<Receipt> {
    if (row.status === "confirmed" || row.status === "rejected") return this.fromRow(row);

    if (row.tx_hash) {
      const wait = Math.max(0, deadlineMs - Date.now());
      const rcpt = await this.publicClient
        .waitForTransactionReceipt({ hash: row.tx_hash, timeout: wait, pollingInterval: 400 })
        .catch(() => null);
      if (rcpt) {
        // Count the gas once, when the agent first sees the receipt of its own transaction.
        if (rcpt.from.toLowerCase() === this.agentAddress.toLowerCase()) {
          this.store.addSpend(utcDay(), 0, rcpt.gasUsed * (rcpt.effectiveGasPrice ?? 0n));
        }
        if (rcpt.status === "success") {
          this.store.update(row.session_id, row.nonce, { status: "confirmed", block: rcpt.blockNumber.toString() });
        } else {
          // Reverted on chain: find out why with a fresh dry run, or whether someone else settled it.
          await this.afterRevert(row);
        }
        return this.fromRow(this.store.get(row.session_id, row.nonce)!);
      }
      return this.fromRow(row);
    }

    // No hash yet ("sending"): either we crashed before storing it, or someone else settled it.
    if (await this.isUsed({ sessionId: row.session_id, nonce: row.nonce })) {
      await this.recoverFromLogs(row);
    }
    return this.fromRow(this.store.get(row.session_id, row.nonce)!);
  }

  private async afterRevert(row: Row) {
    if (await this.isUsed({ sessionId: row.session_id, nonce: row.nonce })) {
      await this.recoverFromLogs(row);
      return;
    }
    const msg = JSON.parse(row.voucher_json) as VoucherMessage;
    const v = toVoucher(msg);
    const sim = await this.simulate(this.settleArgs(v, msg.r as Hex, msg.s as Hex, BigInt(row.fee ?? "0")));
    if (sim.kind === "revert" && FINAL_ERRORS.has(sim.error)) {
      this.store.update(row.session_id, row.nonce, { status: "rejected", reason: sim.error });
    } else {
      this.store.update(row.session_id, row.nonce, { status: "sending", tx_hash: null });
    }
  }

  /** Find the VoucherSettled event for this voucher (sessionId and nonce are indexed). */
  private async recoverFromLogs(row: Row) {
    const latest = await this.publicClient.getBlockNumber({ cacheTime: 0 });
    let from = BigInt(row.from_block);
    while (from <= latest) {
      const to = from + 999n < latest ? from + 999n : latest; // Aevum: at most 1000 blocks per eth_getLogs
      const logs = await this.publicClient.getContractEvents({
        address: this.cfg.vault,
        abi: offlineVaultAbi,
        eventName: "VoucherSettled",
        args: { sessionId: row.session_id, nonce: row.nonce },
        fromBlock: from,
        toBlock: to,
      });
      const hit = logs[0];
      if (hit) {
        this.store.update(row.session_id, row.nonce, {
          status: "confirmed",
          tx_hash: hit.transactionHash,
          block: hit.blockNumber.toString(),
          fee: (hit.args.fee ?? 0n).toString(),
          reason: hit.args.feeTo?.toLowerCase() === this.agentAddress.toLowerCase() ? null : "SettledByOther",
        });
        return;
      }
      from = to + 1n;
    }
    this.store.update(row.session_id, row.nonce, { status: "confirmed", reason: "SettledByOther" });
  }

  private async resubmit(row: Row) {
    const msg = JSON.parse(row.voucher_json) as VoucherMessage;
    const v = toVoucher(msg);
    if (BigInt(Math.floor(Date.now() / 1000)) >= v.validBefore) {
      this.store.update(row.session_id, row.nonce, { status: "rejected", reason: "VoucherExpired" });
      return;
    }
    const fee = BigInt(row.fee ?? (this.cfg.feeUnits < v.maxFee ? this.cfg.feeUnits : v.maxFee).toString());
    const args = this.settleArgs(v, msg.r as Hex, msg.s as Hex, fee);
    const sim = await this.simulate(args);
    if (sim.kind === "revert") {
      if (sim.error === "VoucherReused") return this.recoverFromLogs(row);
      if (FINAL_ERRORS.has(sim.error)) {
        this.store.update(row.session_id, row.nonce, { status: "rejected", reason: sim.error });
      }
      return;
    }
    if (this.budgetLeft()) return; // try again tomorrow; the voucher stays open until it expires
    const hash = await this.send(args, v);
    this.store.update(row.session_id, row.nonce, { status: "submitted", tx_hash: hash, fee: fee.toString() });
  }

  // ---------------------------------------------------------------- receipts

  private fromRow(row: Row): Promise<Receipt> {
    return this.receipt({
      sessionId: row.session_id,
      nonce: row.nonce,
      status: row.status === "sending" ? "submitted" : row.status,
      reason: row.reason ?? undefined,
      txHash: row.tx_hash ?? undefined,
      block: row.block ?? undefined,
      fee: row.fee ?? undefined,
    });
  }

  /**
   * Every answer is signed by the agent (EIP-712), so the phone can check it came from this agent,
   * not only from the Cloud that carried it. The phone can also check confirmed receipts on chain.
   */
  async receipt(r: Omit<Receipt, "t" | "agent" | "issuedAt" | "sig">): Promise<Receipt> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const sig = await this.account.signTypedData!({
      domain: {
        name: "Bridgewise Settlement Agent",
        version: "1",
        chainId: this.cfg.chainId,
        verifyingContract: this.cfg.vault,
      },
      types: RECEIPT_TYPES,
      primaryType: "Receipt",
      message: {
        sessionId: r.sessionId,
        nonce: r.nonce,
        status: STATUS_CODE[r.status],
        reason: r.reason ?? "",
        txHash: r.txHash ?? ZERO_HASH,
        fee: BigInt(r.fee ?? "0"),
        issuedAt: BigInt(issuedAt),
      },
    });
    return { t: "receipt", ...r, agent: this.agentAddress, issuedAt, sig };
  }
}

export const RECEIPT_TYPES = {
  Receipt: [
    { name: "sessionId", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
    { name: "status", type: "uint8" },
    { name: "reason", type: "string" },
    { name: "txHash", type: "bytes32" },
    { name: "fee", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
  ],
} as const;

export function revertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    return reverted.data?.errorName ?? reverted.reason ?? "Reverted";
  }
  return undefined;
}

function short(err: unknown): string {
  if (err instanceof BaseError) return err.shortMessage;
  return err instanceof Error ? err.message : String(err);
}

export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  (level === "info" ? console.log : console.error)(line);
}
