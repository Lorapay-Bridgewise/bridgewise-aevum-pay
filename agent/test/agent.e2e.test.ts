/**
 * End to end against a local node (anvil, chain id 44005, Shanghai), using the real contracts from
 * ../out (run `forge build` in the repo root first). A Node P-256 key stands in for Android
 * Keystore and signs exactly as Keystore does (SHA256withECDSA over the EIP-712 digest).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, sign as nodeSign, randomBytes, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  verifyTypedData,
  hashTypedData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { offlineVaultAbi } from "../src/abi.js";
import { createApp } from "../src/server.js";
import { RECEIPT_TYPES, Settler, utcDay } from "../src/settler.js";
import { assertSafeAgentKey } from "../src/config.js";
import { ActivityFeed } from "../src/activity.js";
import { tusd } from "../src/page.js";
import { Store } from "../src/store.js";
import { signMesh } from "../src/meshSignature.js";
import type { Config } from "../src/config.js";
import type { Receipt } from "../src/messages.js";

const PORT = 8600 + Math.floor(Math.random() * 300);
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 44005;
const SECRET = "test-webhook-secret-0123456789";
const ONE = 1_000_000n;

// anvil's well known dev keys (local only)
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const AGENT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const OTHER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;
const PAYEE = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;

const chain = defineChain({
  id: CHAIN_ID,
  name: "local aevum",
  nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC), pollingInterval: 100 });
const owner = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(OWNER_KEY) });
const other = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(OTHER_KEY) });

const artifact = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../out/${name}.sol/${name}.json`, import.meta.url), "utf8"));

let anvil: ChildProcess;
let token: Address;
let vault: Address;
let settler: Settler;
let baseCfg: Config;
let app: ReturnType<typeof createApp>;
let phone: { priv: KeyObject; qx: Hex; qy: Hex };
let sessionId: Hex;

const tokenAbi = [
  { type: "function", name: "mint", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

async function deploy(name: string, args: unknown[] = []): Promise<Address> {
  const a = artifact(name);
  const hash = await owner.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  return r.contractAddress!;
}

async function tx(p: Promise<Hex>) {
  await pub.waitForTransactionReceipt({ hash: await p });
}

function p256Key() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const toHex = (b64u: string) => `0x${Buffer.from(b64u, "base64url").toString("hex").padStart(64, "0")}` as Hex;
  return { priv: privateKey, qx: toHex(jwk.x!), qy: toHex(jwk.y!) };
}

/** What the phone does offline: EIP-712 digest, then Keystore style SHA256withECDSA. */
function signVoucher(v: { payee: Address; amount: bigint; maxFee: bigint; nonce: Hex; validBefore: bigint }, key = phone) {
  const digest = hashTypedData({
    domain: { name: "Bridgewise OfflineVault", version: "1", chainId: CHAIN_ID, verifyingContract: vault },
    types: {
      Voucher: [
        { name: "sessionId", type: "bytes32" },
        { name: "payee", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "maxFee", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "validBefore", type: "uint64" },
      ],
    },
    primaryType: "Voucher",
    message: { sessionId, ...v },
  });
  const sig = nodeSign("sha256", Buffer.from(digest.slice(2), "hex"), { key: key.priv, dsaEncoding: "ieee-p1363" });
  return {
    t: "voucher" as const,
    chainId: CHAIN_ID,
    vault,
    v: {
      sessionId,
      payee: v.payee,
      amount: v.amount.toString(),
      maxFee: v.maxFee.toString(),
      nonce: v.nonce,
      validBefore: Number(v.validBefore),
    },
    r: `0x${sig.subarray(0, 32).toString("hex")}` as Hex,
    s: `0x${sig.subarray(32).toString("hex")}` as Hex,
  };
}

function newVoucher(amount = ONE, extra: Partial<{ maxFee: bigint; validBefore: bigint }> = {}) {
  return signVoucher({
    payee: PAYEE,
    amount,
    maxFee: extra.maxFee ?? ONE / 50n,
    nonce: `0x${randomBytes(32).toString("hex")}` as Hex,
    validBefore: extra.validBefore ?? BigInt(Math.floor(Date.now() / 1000) + 3600),
  });
}

/** Send a phone message through the webhook exactly as the Mesh Cloud does. */
async function viaMesh(inner: unknown, secret = SECRET): Promise<{ status: number; receipt?: Receipt }> {
  const event = JSON.stringify({
    type: "mesh.message",
    id: crypto.randomUUID(),
    ik: randomBytes(8).toString("hex"),
    app_id: 1,
    node: { mesh_node_id: "0011223344556677", install_id: "test" },
    created_at_ms: Date.now(),
    hop_count: 2,
    body: Buffer.from(JSON.stringify(inner)).toString("base64"),
    ct: "application/vnd.bwpay.voucher+json",
  });
  const res = await app.request("/mesh/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "Mesh-Signature": signMesh(secret, event) },
    body: event,
  });
  if (res.status !== 200) return { status: res.status };
  const out = (await res.json()) as { body: string; ct: string };
  expect(out.ct).toBe("application/vnd.bwpay.receipt+json");
  return { status: 200, receipt: JSON.parse(Buffer.from(out.body, "base64").toString("utf8")) };
}

const balance = (a: Address) => pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [a] });

beforeAll(async () => {
  anvil = spawn(process.env.ANVIL_BIN ?? "anvil", ["--port", String(PORT), "--chain-id", String(CHAIN_ID), "--hardfork", "shanghai", "--silent"], {
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      await pub.getBlockNumber();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  token = await deploy("MockTUSD8");
  vault = await deploy("OfflineVault", [token]);
  phone = p256Key();

  const ownerAddr = owner.account.address;
  await tx(owner.writeContract({ address: token, abi: tokenAbi, functionName: "mint", args: [ownerAddr, 100n * ONE] }));
  await tx(owner.writeContract({ address: token, abi: tokenAbi, functionName: "approve", args: [vault, 100n * ONE] }));
  await tx(owner.writeContract({ address: vault, abi: offlineVaultAbi, functionName: "deposit", args: [20n * ONE] }));
  const expires = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
  await tx(
    owner.writeContract({
      address: vault,
      abi: offlineVaultAbi,
      functionName: "openSession",
      args: [phone.qx, phone.qy, 5n * ONE, 10n * ONE, expires],
    }),
  );
  sessionId = await pub.readContract({
    address: vault,
    abi: offlineVaultAbi,
    functionName: "sessionIdOf",
    args: [ownerAddr, phone.qx, phone.qy],
  });

  const cfg: Config = {
    port: 0,
    rpcUrl: RPC,
    chainId: CHAIN_ID,
    explorerUrl: "http://localhost",
    vault,
    agentKey: AGENT_KEY,
    webhookSecret: SECRET,
    testApiKey: "test-api-key-0123456789",
    feeUnits: 10_000n,
    confirmWaitMs: 3000,
    dbPath: ":memory:",
    minGasWei: 1n,
    maxVoucherTtlSec: 7 * 86_400,
    ratePerSessionHour: 30,
    ratePerNodeHour: 120,
    ratePerOwnerHour: 20,
    minDepositUnits: 100_000n,
    dailyTxCap: 1_000,
    dailyGasBudgetWei: 10n ** 18n,
    vaultFromBlock: 0n,
  };
  baseCfg = cfg;
  settler = new Settler(cfg, new Store(":memory:"));
  app = createApp(settler);
}, 60_000);

afterAll(() => {
  anvil?.kill();
});

describe("settlement agent", () => {
  it("settles a voucher from the mesh and pays payee and agent", async () => {
    const before = await balance(PAYEE);
    const v = newVoucher(2n * ONE);
    const { status, receipt } = await viaMesh(v);

    expect(status).toBe(200);
    expect(receipt!.status).toBe("confirmed");
    expect(receipt!.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(receipt!.fee).toBe("10000");
    expect(await balance(PAYEE)).toBe(before + 2n * ONE);
    expect(await balance(settler.agentAddress)).toBeGreaterThanOrEqual(10_000n);
  });

  it("signs receipts the phone can verify", async () => {
    const { receipt } = await viaMesh(newVoucher(ONE));
    const ok = await verifyTypedData({
      address: receipt!.agent,
      domain: { name: "Bridgewise Settlement Agent", version: "1", chainId: CHAIN_ID, verifyingContract: vault },
      types: RECEIPT_TYPES,
      primaryType: "Receipt",
      message: {
        sessionId: receipt!.sessionId,
        nonce: receipt!.nonce,
        status: 2,
        reason: receipt!.reason ?? "",
        txHash: receipt!.txHash!,
        fee: BigInt(receipt!.fee!),
        issuedAt: BigInt(receipt!.issuedAt),
      },
      signature: receipt!.sig!,
    });
    expect(ok).toBe(true);
  });

  it("is idempotent: the same voucher twice gives the same transaction", async () => {
    const v = newVoucher(ONE);
    const a = await viaMesh(v);
    const nonceBefore = await pub.getTransactionCount({ address: settler.agentAddress });
    const b = await viaMesh(v);
    expect(b.receipt!.txHash).toBe(a.receipt!.txHash);
    expect(await pub.getTransactionCount({ address: settler.agentAddress })).toBe(nonceBefore);
  });

  it("answers status questions", async () => {
    const v = newVoucher(ONE);
    const a = await viaMesh(v);
    const s = await viaMesh({ t: "status", sessionId, nonce: v.v.nonce });
    expect(s.receipt!.status).toBe("confirmed");
    expect(s.receipt!.txHash).toBe(a.receipt!.txHash);

    const unknown = await viaMesh({ t: "status", sessionId, nonce: `0x${"ab".repeat(32)}` });
    expect(unknown.receipt!.status).toBe("unknown");
  });

  it("rejects a tampered voucher without spending gas", async () => {
    const v = newVoucher(ONE);
    v.v.amount = (4n * ONE).toString(); // a relay tries to raise the amount
    const nonceBefore = await pub.getTransactionCount({ address: settler.agentAddress });
    const { receipt } = await viaMesh(v);
    expect(receipt!.status).toBe("rejected");
    expect(receipt!.reason).toBe("BadSignature");
    expect(await pub.getTransactionCount({ address: settler.agentAddress })).toBe(nonceBefore);
  });

  it("rejects over the per payment cap, and says retry over the daily cap", async () => {
    const big = await viaMesh(newVoucher(6n * ONE));
    expect(big.receipt!.status).toBe("rejected");
    expect(big.receipt!.reason).toBe("OverPaymentCap");

    // spent so far today: 2 + 1 + 1 + 1 = 5 of 10. Fill it up, then one more.
    await viaMesh(newVoucher(5n * ONE));
    const over = await viaMesh(newVoucher(ONE));
    expect(over.receipt!.status).toBe("retry");
    expect(over.receipt!.reason).toBe("OverDailyCap");
  });

  it("refuses webhooks without the Cloud's signature", async () => {
    const { status } = await viaMesh(newVoucher(ONE), "wrong-secret-0123456789");
    expect(status).toBe(401);
  });

  it("recovers a voucher someone else settled while it was in flight", async () => {
    // advance a day so the daily cap is free again
    await pub.request({ method: "evm_increaseTime" as never, params: [86_400] as never });
    await pub.request({ method: "evm_mine" as never, params: [] as never });

    const v = newVoucher(ONE, { validBefore: BigInt(Math.floor(Date.now() / 1000) + 3 * 86400) });
    // The agent "crashed" after claiming the voucher but before storing a tx hash...
    settler.store.claim(sessionId, v.v.nonce as Hex, JSON.stringify(v), await pub.getBlockNumber());
    // ...and meanwhile another relayer settled it.
    const hash = await other.writeContract({
      address: vault,
      abi: offlineVaultAbi,
      functionName: "settle",
      args: [
        { ...v.v, amount: BigInt(v.v.amount), maxFee: BigInt(v.v.maxFee), validBefore: BigInt(v.v.validBefore) } as never,
        v.r,
        v.s,
        0n,
        other.account.address,
      ],
    });
    await pub.waitForTransactionReceipt({ hash });

    const s = await viaMesh({ t: "status", sessionId, nonce: v.v.nonce });
    expect(s.receipt!.status).toBe("confirmed");
    expect(s.receipt!.txHash).toBe(hash);
    expect(s.receipt!.reason).toBe("SettledByOther");
  });

  it("reports health", async () => {
    const res = await app.request("/health");
    const h = (await res.json()) as { ok: boolean; agent: string; settlements: Record<string, number> };
    expect(h.ok).toBe(true);
    expect(h.agent).toBe(settler.agentAddress);
    expect(h.settlements.confirmed).toBeGreaterThan(0);
  });
});

describe("rails", () => {
  // The chain clock is a day ahead after the recovery test, so these vouchers live for two days.
  const later = () => BigInt(Math.floor(Date.now() / 1000) + 2 * 86_400);
  const txCount = () => pub.getTransactionCount({ address: settler.agentAddress });

  it("refuses a voucher whose signed max fee is below the agent's fee, without an RPC call", async () => {
    const before = await txCount();
    const { receipt } = await viaMesh(newVoucher(ONE, { maxFee: 5_000n, validBefore: later() }));
    expect(receipt!.status).toBe("rejected");
    expect(receipt!.reason).toBe("FeeTooLow");
    expect(await txCount()).toBe(before);
  });

  it("refuses vouchers that are already expired or valid for too long", async () => {
    const past = await viaMesh(newVoucher(ONE, { validBefore: BigInt(Math.floor(Date.now() / 1000) - 10) }));
    expect(past.receipt!.reason).toBe("VoucherExpired");
    const forever = await viaMesh(newVoucher(ONE, { validBefore: BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400) }));
    expect(forever.receipt!.status).toBe("rejected");
    expect(forever.receipt!.reason).toBe("ValidityTooLong");
  });

  it("rate limits new vouchers per session, but still answers repeats", async () => {
    const limited = new Settler({ ...baseCfg, ratePerSessionHour: 2 }, new Store(":memory:"));
    const limitedApp = createApp(limited);
    const send = async (v: unknown) => {
      const res = await limitedApp.request("/v1/vouchers", {
        method: "POST",
        headers: { "x-api-key": baseCfg.testApiKey! },
        body: JSON.stringify(v),
      });
      return (await res.json()) as Receipt;
    };
    const first = newVoucher(ONE, { validBefore: later() });
    expect((await send(first)).status).toBe("confirmed");
    expect((await send(newVoucher(ONE, { validBefore: later() }))).status).toBe("confirmed");
    const third = await send(newVoucher(ONE, { validBefore: later() }));
    expect(third.status).toBe("retry");
    expect(third.reason).toBe("RateLimited");
    // A voucher it already settled is answered from its records, limit or not
    expect((await send(first)).status).toBe("confirmed");
  });

  it("stops sending at its daily transaction cap, and counts the gas it spent", async () => {
    const store = new Store(":memory:");
    const capped = new Settler({ ...baseCfg, dailyTxCap: 1 }, store);
    expect((await capped.handleVoucher(newVoucher(ONE, { validBefore: later() }))).status).toBe("confirmed");
    const spent = store.spend(utcDay());
    expect(spent.txCount).toBe(1);
    expect(spent.gasWei).toBeGreaterThan(0n);

    const before = await txCount();
    const next = await capped.handleVoucher(newVoucher(ONE, { validBefore: later() }));
    expect(next.status).toBe("retry");
    expect(next.reason).toBe("AgentDailyCapReached");
    expect(await txCount()).toBe(before);
  });

  it("refuses a public test key as the agent key on a real network", () => {
    expect(() => assertSafeAgentKey(44005, AGENT_KEY)).toThrow(/public test key/);
    expect(() => assertSafeAgentKey(31337, AGENT_KEY)).not.toThrow();
    expect(() =>
      assertSafeAgentKey(44005, `0x${randomBytes(32).toString("hex")}` as Hex),
    ).not.toThrow();
  });
});

describe("activity page", () => {
  it("reads every vault event from the chain and shows it", async () => {
    const feed = new ActivityFeed(pub as never, vault, 0n);
    await feed.sync();
    expect(feed.caughtUp).toBe(true);
    const kinds = new Set(feed.latest(500).map((e) => e.kind));
    expect([...kinds]).toEqual(expect.arrayContaining(["Deposited", "SessionOpened", "VoucherSettled"]));
    expect(feed.totals.settled).toBeGreaterThan(5);
    expect(feed.totals.sessions).toBe(1);

    const withFeed = createApp(settler, feed);
    const html = await (await withFeed.request("/activity")).text();
    expect(html).toContain("Offline payments on Aevum");
    expect(html).toContain(`${feed.totals.settled}</b><span>payments settled`);
    expect(html).toContain("/tx/0x");

    const json = (await (await withFeed.request("/v1/activity")).json()) as {
      totals: { settled: number };
      events: { kind: string }[];
    };
    expect(json.totals.settled).toBe(feed.totals.settled);
    expect(json.events[0]).toHaveProperty("txHash");
  });

  it("never asks for more than 1,000 blocks per call", async () => {
    const ranges: [bigint, bigint][] = [];
    const fake = {
      getBlockNumber: async () => 2_500n,
      getContractEvents: async (q: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([q.fromBlock, q.toBlock]);
        return [];
      },
      getBlock: async () => ({ timestamp: 0n }),
    };
    const feed = new ActivityFeed(fake as never, vault, 0n);
    await feed.sync();
    expect(ranges).toEqual([
      [0n, 999n],
      [1_000n, 1_999n],
      [2_000n, 2_500n],
    ]);
    expect(feed.caughtUp).toBe(true);
  });

  it("formats tUSD8 amounts", () => {
    expect(tusd(1_000_000n)).toBe("1.00");
    expect(tusd("10000")).toBe("0.01");
    expect(tusd(1_234_567_000n)).toBe("1,234.567");
  });
});

describe("owner relay (the phone's wallet never needs gas)", () => {
  const wallet = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);
  // The chain clock is a day ahead after the recovery test
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 2 * 86_400);
  const vaultDomain = () => ({ name: "Bridgewise OfflineVault", version: "1", chainId: CHAIN_ID, verifyingContract: vault });
  const post = async (path: string, body: unknown) => {
    const res = await app.request(path, { method: "POST", body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) });
    return { http: res.status, ...((await res.json()) as { status?: string; reason?: string; txHash?: string; error?: string }) };
  };
  const ownerNonce = () => pub.readContract({ address: vault, abi: offlineVaultAbi, functionName: "ownerNonce", args: [wallet.address] });
  let key: ReturnType<typeof p256Key>;
  let sid: Hex;

  it("deposits with a permit the wallet signed", async () => {
    await tx(owner.writeContract({ address: token, abi: tokenAbi, functionName: "mint", args: [wallet.address, 10n * ONE] }));
    const nonce = await pub.readContract({
      address: token,
      abi: [{ type: "function", name: "nonces", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }] as const,
      functionName: "nonces",
      args: [wallet.address],
    });
    const dl = deadline();
    const sig = await wallet.signTypedData({
      domain: { name: "Test USD8", version: "1", chainId: CHAIN_ID, verifyingContract: token },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner: wallet.address, spender: vault, value: 4n * ONE, nonce, deadline: dl },
    });
    const res = await post("/v1/owner/deposit", {
      owner: wallet.address,
      amount: 4n * ONE,
      deadline: dl,
      v: parseInt(sig.slice(130, 132), 16),
      r: `0x${sig.slice(2, 66)}`,
      s: `0x${sig.slice(66, 130)}`,
    });
    expect(res.status).toBe("confirmed");
    expect(await pub.readContract({ address: vault, abi: offlineVaultAbi, functionName: "balanceOf", args: [wallet.address] })).toBe(4n * ONE);
    expect(await pub.getBalance({ address: wallet.address })).toBe(0n);
  });

  async function sessionBody(k: ReturnType<typeof p256Key>, nonce: bigint) {
    const dl = deadline();
    const params = { qx: k.qx, qy: k.qy, perPaymentCap: 2n * ONE, dailyCap: 3n * ONE, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400) };
    const sig = await wallet.signTypedData({
      domain: vaultDomain(),
      types: {
        OpenSession: [
          { name: "owner", type: "address" },
          { name: "qx", type: "bytes32" },
          { name: "qy", type: "bytes32" },
          { name: "perPaymentCap", type: "uint128" },
          { name: "dailyCap", type: "uint128" },
          { name: "expiresAt", type: "uint64" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "OpenSession",
      message: { owner: wallet.address, ...params, nonce, deadline: dl },
    });
    return { owner: wallet.address, params, deadline: dl, sig };
  }

  it("adds a phone key, and refuses the same request twice without spending gas", async () => {
    key = p256Key();
    const body = await sessionBody(key, await ownerNonce());
    expect((await post("/v1/owner/session", body)).status).toBe("confirmed");
    sid = await pub.readContract({ address: vault, abi: offlineVaultAbi, functionName: "sessionIdOf", args: [wallet.address, key.qx, key.qy] });
    expect((await pub.readContract({ address: vault, abi: offlineVaultAbi, functionName: "getSession", args: [sid] })).owner).toBe(wallet.address);

    const before = await pub.getTransactionCount({ address: settler.agentAddress });
    const again = await post("/v1/owner/session", body);
    expect(again.status).toBe("rejected");
    expect(await pub.getTransactionCount({ address: settler.agentAddress })).toBe(before);
  });

  it("removes the phone key, after which its vouchers are refused", async () => {
    const dl = deadline();
    const sig = await wallet.signTypedData({
      domain: vaultDomain(),
      types: { Revoke: [{ name: "sessionId", type: "bytes32" }, { name: "deadline", type: "uint256" }] },
      primaryType: "Revoke",
      message: { sessionId: sid, deadline: dl },
    });
    expect((await post("/v1/owner/revoke", { sessionId: sid, deadline: dl, sig })).status).toBe("confirmed");
    expect((await pub.readContract({ address: vault, abi: offlineVaultAbi, functionName: "getSession", args: [sid] })).revoked).toBe(true);
  });

  it("withdraws what is left", async () => {
    const dl = deadline();
    const amount = await pub.readContract({ address: vault, abi: offlineVaultAbi, functionName: "balanceOf", args: [wallet.address] });
    const sig = await wallet.signTypedData({
      domain: vaultDomain(),
      types: {
        Withdraw: [
          { name: "owner", type: "address" },
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Withdraw",
      message: { owner: wallet.address, to: wallet.address, amount, nonce: await ownerNonce(), deadline: dl },
    });
    expect((await post("/v1/owner/withdraw", { owner: wallet.address, to: wallet.address, amount, deadline: dl, sig })).status).toBe("confirmed");
    expect(await balance(wallet.address)).toBe(10n * ONE);
  });

  it("refuses tiny deposits, passed deadlines and malformed requests", async () => {
    const tiny = await post("/v1/owner/deposit", { owner: wallet.address, amount: 1n, deadline: deadline(), v: 27, r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}` });
    expect(tiny.reason).toBe("DepositTooSmall");
    const late = await post("/v1/owner/revoke", { sessionId: sid, deadline: 1n, sig: `0x${"11".repeat(65)}` });
    expect(late.reason).toBe("DeadlinePassed");
    expect((await post("/v1/owner/withdraw", { owner: "nope" })).http).toBe(400);
  });
});
