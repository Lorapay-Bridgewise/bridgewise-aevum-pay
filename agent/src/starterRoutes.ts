import type { Context, Hono } from "hono";
import type { Address } from "viem";
import { z } from "zod";
import { offlineVaultAbi } from "./abi.js";
import { log, utcDay, type Settler } from "./settler.js";

/**
 * Starter money: a small tUSD8 gift to each new wallet, so a person can try Aevum Pay without
 * visiting the Discord faucet. It comes out of the agent's own tUSD8 (top it up by sending tUSD8
 * to the agent address).
 *
 *   GET  /v1/starter   {amount, available}: whether gifts are on and the pool can pay one
 *   POST /v1/starter   {address}: one gift per address, only to a wallet that holds nothing yet
 *
 * Rails: one per address ever, STARTER_PER_IP_DAY per IP address and STARTER_PER_DAY in all per
 * UTC day, and the same daily transaction and gas budget as settlements.
 */
const request = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

/** The caller's IP. Behind Caddy, the first X-Forwarded-For entry. */
function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  return (fwd?.split(",")[0] ?? c.req.header("x-real-ip") ?? "unknown").trim();
}

export function addStarterRoutes(app: Hono, settler: Settler) {
  const cfg = settler.cfg;

  app.get("/v1/starter", async (c) => {
    if (cfg.starterUnits === 0n) return c.json({ amount: "0", available: false });
    const pool = await settler.tokenBalance(settler.agentAddress).catch(() => 0n);
    const open = settler.store.startersOn(utcDay()) < cfg.starterPerDay;
    return c.json({ amount: cfg.starterUnits.toString(), available: open && pool >= cfg.starterUnits });
  });

  app.post("/v1/starter", async (c) => {
    let parsed: z.infer<typeof request> | null = null;
    try {
      const r = request.safeParse(JSON.parse(await c.req.text()));
      parsed = r.success ? r.data : null;
    } catch {
      parsed = null;
    }
    if (!parsed) return c.json({ error: "invalid_request" }, 400);
    const to = parsed.address as Address;
    const amount = cfg.starterUnits;
    const day = utcDay();
    const ip = clientIp(c);
    const no = (status: "rejected" | "retry", reason: string) => c.json({ status, reason, amount: amount.toString() });

    if (amount === 0n) return no("rejected", "StarterOff");
    if (settler.store.startersOn(day) >= cfg.starterPerDay) return no("retry", "StarterDailyLimit");
    if (settler.store.startersFromIp(ip, day) >= cfg.starterPerIpDay) return no("retry", "RateLimited");

    // Only wallets that hold nothing: in the wallet and in the vault
    try {
      const [inWallet, inVault, pool] = await Promise.all([
        settler.tokenBalance(to),
        settler.publicClient.readContract({ address: cfg.vault, abi: offlineVaultAbi, functionName: "balanceOf", args: [to] }),
        settler.tokenBalance(settler.agentAddress),
      ]);
      if (inWallet > 0n || (inVault as bigint) > 0n) return no("rejected", "NotANewWallet");
      if (pool < amount) return no("retry", "StarterPoolEmpty");
    } catch {
      return no("retry", "ChainUnavailable");
    }

    if (!settler.store.claimStarter(to, ip, day)) return no("rejected", "AlreadyGiven");
    const res = await settler.sendToken(to, amount);
    if (res.txHash) settler.store.setStarterTx(to, res.txHash);
    else settler.store.releaseStarter(to);
    log("info", "starter", { to, amount: amount.toString(), status: res.status, reason: res.reason });
    return c.json({ ...res, amount: amount.toString() });
  });
}
