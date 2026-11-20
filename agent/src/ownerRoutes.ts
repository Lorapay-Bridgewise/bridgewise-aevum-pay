import type { Hono } from "hono";
import type { Hex } from "viem";
import { z } from "zod";
import { RateLimiter } from "./rateLimit.js";
import { log, type Settler } from "./settler.js";

/**
 * Owner actions, relayed so the person's wallet never needs tQDAY. Each body carries the owner's
 * own signature; the vault checks it, so the agent cannot change anything and a forged or repeated
 * request fails the dry run without costing gas.
 *
 *   POST /v1/owner/deposit   tUSD8 permit, then the vault pulls the deposit (depositWithPermit)
 *   POST /v1/owner/session   add a phone key with limits (openSessionBySig)
 *   POST /v1/owner/revoke    remove a phone key (revokeBySig)
 *   POST /v1/owner/withdraw  take money back out of the vault (withdrawBySig)
 */
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const uint = z.string().regex(/^[0-9]{1,78}$/);
const sig = z.string().regex(/^0x[0-9a-fA-F]{130}$/);

const deposit = z.object({ owner: address, amount: uint, deadline: uint, v: z.number().int().min(27).max(28), r: bytes32, s: bytes32 });
const session = z.object({
  owner: address,
  params: z.object({ qx: bytes32, qy: bytes32, perPaymentCap: uint, dailyCap: uint, expiresAt: uint }),
  deadline: uint,
  sig,
});
const revoke = z.object({ sessionId: bytes32, deadline: uint, sig });
const withdraw = z.object({ owner: address, to: address, amount: uint, deadline: uint, sig });

export function addOwnerRoutes(app: Hono, settler: Settler) {
  const cfg = settler.cfg;
  const limiter = new RateLimiter(cfg.ratePerOwnerHour);

  /** Common checks; null when the request may go ahead. */
  function refuse(key: string, deadline: string): { status: "rejected" | "retry"; reason: string } | null {
    if (BigInt(deadline) <= BigInt(Math.floor(Date.now() / 1000))) return { status: "rejected", reason: "DeadlinePassed" };
    if (!limiter.allows(key.toLowerCase())) return { status: "retry", reason: "RateLimited" };
    limiter.record(key.toLowerCase());
    return null;
  }

  async function body<T>(raw: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
      const r = schema.safeParse(JSON.parse(raw));
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  }

  app.post("/v1/owner/deposit", async (c) => {
    const b = await body(await c.req.text(), deposit);
    if (!b) return c.json({ error: "invalid_request" }, 400);
    if (BigInt(b.amount) < cfg.minDepositUnits) return c.json({ status: "rejected", reason: "DepositTooSmall" });
    const no = refuse(b.owner, b.deadline);
    if (no) return c.json(no);
    const res = await settler.relayOwnerAction("depositWithPermit", [
      b.owner,
      BigInt(b.amount),
      BigInt(b.deadline),
      b.v,
      b.r as Hex,
      b.s as Hex,
    ]);
    log("info", "owner_deposit", { owner: b.owner, amount: b.amount, status: res.status, reason: res.reason });
    return c.json(res);
  });

  app.post("/v1/owner/session", async (c) => {
    const b = await body(await c.req.text(), session);
    if (!b) return c.json({ error: "invalid_request" }, 400);
    const no = refuse(b.owner, b.deadline);
    if (no) return c.json(no);
    const p = b.params;
    const res = await settler.relayOwnerAction("openSessionBySig", [
      b.owner,
      {
        qx: p.qx as Hex,
        qy: p.qy as Hex,
        perPaymentCap: BigInt(p.perPaymentCap),
        dailyCap: BigInt(p.dailyCap),
        expiresAt: BigInt(p.expiresAt),
      },
      BigInt(b.deadline),
      b.sig as Hex,
    ]);
    log("info", "owner_session", { owner: b.owner, status: res.status, reason: res.reason });
    return c.json(res);
  });

  app.post("/v1/owner/revoke", async (c) => {
    const b = await body(await c.req.text(), revoke);
    if (!b) return c.json({ error: "invalid_request" }, 400);
    const no = refuse(b.sessionId, b.deadline);
    if (no) return c.json(no);
    const res = await settler.relayOwnerAction("revokeBySig", [b.sessionId as Hex, BigInt(b.deadline), b.sig as Hex]);
    log("info", "owner_revoke", { sessionId: b.sessionId, status: res.status, reason: res.reason });
    return c.json(res);
  });

  app.post("/v1/owner/withdraw", async (c) => {
    const b = await body(await c.req.text(), withdraw);
    if (!b) return c.json({ error: "invalid_request" }, 400);
    const no = refuse(b.owner, b.deadline);
    if (no) return c.json(no);
    const res = await settler.relayOwnerAction("withdrawBySig", [
      b.owner,
      b.to,
      BigInt(b.amount),
      BigInt(b.deadline),
      b.sig as Hex,
    ]);
    log("info", "owner_withdraw", { owner: b.owner, amount: b.amount, status: res.status, reason: res.reason });
    return c.json(res);
  });
}
