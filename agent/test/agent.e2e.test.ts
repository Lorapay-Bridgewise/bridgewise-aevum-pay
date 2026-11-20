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
import { RECEIPT_TYPES, Settler } from "../src/settler.js";
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
  };
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
