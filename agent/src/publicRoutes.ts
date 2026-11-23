import type { Context, Hono } from "hono";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { payeeRegistryAbi } from "./abi.js";
import type { ActivityFeed } from "./activity.js";
import { phoneMessage, type Receipt } from "./messages.js";
import { RateLimiter } from "./rateLimit.js";
import { log, type Settler } from "./settler.js";

/**
 * What a phone with its own internet uses, with no other phone in between:
 *
 *   GET  /v1/config                   what this agent offers (vault, registry, allowance agent)
 *   POST /v1/pay                      a voucher (or a status question), answered with a signed receipt
 *   GET  /v1/payments/to/:address     money paid to an address, with who paid and their name
 *   GET  /v1/names/:address           the registered name of an address
 *   GET  /v1/names?name=...           the address holding a registered name
 *   POST /v1/names                    register a name (gasless: the owner's EIP-712 signature)
 *   POST /v1/names/release            give a name up (gasless)
 *
 * /v1/pay goes through exactly the same checks and rails as the mesh webhook. The caller's IP
 * address takes the place of the mesh node in the per node limit.
 */
const MAX_BODY = 2048;
const NAME_CACHE_MS = 60_000;

const hex = /^0x[0-9a-fA-F]+$/;
const registerBody = z.object({
  account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  name: z.string().min(1).max(64),
  deadline: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
  signature: z.string().regex(hex).max(200),
});
const releaseBody = registerBody.omit({ name: true });

export function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  return (fwd?.split(",")[0] ?? c.req.header("x-real-ip") ?? "unknown").trim();
}

async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.length > MAX_BODY) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Registered names, read from the PayeeRegistry, kept a minute. */
export class Names {
  private cache = new Map<string, { name: string; at: number }>();

  constructor(private readonly settler: Settler) {}

  get enabled(): boolean {
    return !!this.settler.cfg.registry;
  }

  private get address(): Address {
    return this.settler.cfg.registry!;
  }

  async of(accounts: Address[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.enabled || accounts.length === 0) return out;
    const now = Date.now();
    const missing = [...new Set(accounts.map((a) => a.toLowerCase()))].filter((a) => {
      const hit = this.cache.get(a);
      if (hit && now - hit.at < NAME_CACHE_MS) {
        if (hit.name) out.set(a, hit.name);
        return false;
      }
      return true;
    });
    if (missing.length) {
      const names = (await this.settler.publicClient.readContract({
        address: this.address,
        abi: payeeRegistryAbi,
        functionName: "namesOf",
        args: [missing.map((a) => getAddress(a))],
      })) as readonly string[];
      missing.forEach((a, i) => {
        this.cache.set(a, { name: names[i], at: now });
        if (names[i]) out.set(a, names[i]);
      });
    }
    return out;
  }

  async holder(name: string): Promise<Address | null> {
    if (!this.enabled) return null;
    try {
      const a = (await this.settler.publicClient.readContract({
        address: this.address,
        abi: payeeRegistryAbi,
        functionName: "lookup",
        args: [name],
      })) as Address;
      return a === "0x0000000000000000000000000000000000000000" ? null : a;
    } catch {
      return null; // BadName: no such name can exist
    }
  }

  forget(account: string) {
    this.cache.delete(account.toLowerCase());
  }
}

export function addPublicRoutes(app: Hono, settler: Settler, feed?: ActivityFeed) {
  const cfg = settler.cfg;
  const names = new Names(settler);
  const perIp = new RateLimiter(60);
  const perAccount = new RateLimiter(5);

  app.get("/v1/config", (c) =>
    c.json({
      chainId: cfg.chainId,
      vault: cfg.vault,
      agent: settler.agentAddress,
      registry: cfg.registry ?? null,
      feeUnits: cfg.feeUnits.toString(),
      allowanceAgent: cfg.anthropicKey ? "claude" : "rules",
      starterUnits: cfg.starterUnits.toString(),
      commit: cfg.commit,
    }),
  );

  // ---------------------------------------------------------------- pay with your own internet

  app.post("/v1/pay", async (c) => {
    const parsed = phoneMessage.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "invalid_message" }, 400);
    const m = parsed.data;
    const deadline = Date.now() + cfg.confirmWaitMs;
    const answer: Receipt =
      m.t === "voucher"
        ? await settler.handleVoucher(m, deadline, { node: `ip:${clientIp(c)}` })
        : await settler.handleStatus(m.sessionId as Hex, m.nonce as Hex, deadline);
    log("info", "direct_message", { t: m.t, status: answer.status, reason: answer.reason });
    return c.json(answer);
  });

  // ---------------------------------------------------------------- money in

  app.get("/v1/payments/to/:address", async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a, { strict: false })) return c.json({ error: "invalid_address" }, 400);
    if (!feed) return c.json({ payments: [] });
    await Promise.race([feed.sync(), new Promise((r) => setTimeout(r, 3_000))]).catch(() => {});
    const list = feed.paidTo(getAddress(a));
    const known = await names.of(list.map((e) => e.from).filter((x): x is Address => !!x)).catch(() => new Map<string, string>());
    return c.json({
      payments: list.map((e) => ({
        txHash: e.txHash,
        block: e.block,
        time: e.time ?? null,
        sessionId: e.sessionId,
        nonce: e.nonce,
        amount: e.amount,
        from: e.from ?? null,
        fromName: e.from ? (known.get(e.from.toLowerCase()) ?? null) : null,
      })),
    });
  });

  // ---------------------------------------------------------------- names

  app.get("/v1/names", async (c) => {
    if (!names.enabled) return c.json({ error: "registry_off" }, 404);
    const name = c.req.query("name") ?? "";
    if (!name || name.length > 64) return c.json({ error: "invalid_name" }, 400);
    const holder = await names.holder(name);
    if (!holder) return c.json({ name, address: null });
    const registered = (await names.of([holder])).get(holder.toLowerCase()) ?? name;
    return c.json({ name: registered, address: holder });
  });

  app.get("/v1/names/:address", async (c) => {
    if (!names.enabled) return c.json({ error: "registry_off" }, 404);
    const a = c.req.param("address");
    if (!isAddress(a, { strict: false })) return c.json({ error: "invalid_address" }, 400);
    try {
      const n = (await names.of([getAddress(a)])).get(a.toLowerCase()) ?? null;
      return c.json({ address: getAddress(a), name: n });
    } catch {
      return c.json({ error: "chain_unreachable" }, 503);
    }
  });

  const relay = async (c: Context, functionName: "registerBySig" | "releaseBySig") => {
    if (!names.enabled) return c.json({ error: "registry_off" }, 404);
    const raw = await readJson(c);
    const r = (functionName === "registerBySig" ? registerBody : releaseBody).safeParse(raw);
    if (!r.success) return c.json({ error: "invalid_request" }, 400);
    const b = r.data as z.infer<typeof registerBody>;
    const ip = clientIp(c);
    const who = b.account.toLowerCase();
    if (!perIp.allows(ip) || !perAccount.allows(who)) return c.json({ status: "retry", reason: "RateLimited" });
    perIp.record(ip);
    perAccount.record(who);
    const deadline = BigInt(b.deadline);
    const args =
      functionName === "registerBySig"
        ? [getAddress(b.account), b.name, deadline, b.signature as Hex]
        : [getAddress(b.account), deadline, b.signature as Hex];
    const res = await settler.relayCall(cfg.registry!, payeeRegistryAbi, functionName, args);
    names.forget(b.account);
    log("info", "name_action", { action: functionName, account: b.account, status: res.status, reason: res.reason });
    return c.json(res);
  };

  app.post("/v1/names", (c) => relay(c, "registerBySig"));
  app.post("/v1/names/release", (c) => relay(c, "releaseBySig"));
}
