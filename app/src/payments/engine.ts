import { isAddress, type Address, type Hex, type PublicClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { Mesh } from '@bridgewise/mesh-react-native';
import { AgentApi } from '../core/agentApi';
import { publicClient, readWalletState, type WalletState } from '../core/chain';
import { AEVUM_TESTNET, type AppConfig } from '../core/config';
import { isGenuineReceipt, type Receipt } from '../core/receipt';
import { payeeRegistryAbi } from '../core/abi';
import { newVoucher, publicKeyXY, sessionIdOf, signVoucher } from '../core/voucher';
import { nameProblem, signDepositPermit, signOpenSession, signRegisterName, signReleaseName, signRevoke, signWithdraw, type SessionLimits } from '../core/owner';
import { authKind, keystoreSigner, nativeKeystore, softwareSigner, unlockPhoneKey, type AuthKind, type KeySigner } from '../native/keystore';
import { usd } from '../core/money';
import { getMesh } from '../mesh';
import { ownerWallet } from '../wallet/ownerWallet';
import { contactFor, isFinal, registeredName, useApp, type Payment, type Snapshot } from '../state/store';

export const VOUCHER_CT = 'application/vnd.bwpay.voucher+json';
const MESH_TIMEOUT_MS = 60_000;

/** Everything the engine talks to, so tests can swap each one. */
export type Deps = {
  cfg: AppConfig;
  mesh: () => Mesh;
  api: AgentApi;
  client: PublicClient;
  owner: () => Promise<PrivateKeyAccount>;
  signer: (alias: string) => KeySigner;
  /** How this phone confirms a payment (fingerprint, screen lock, or the app PIN only) */
  authKind: () => AuthKind;
  /** The phone's fingerprint or screen lock prompt; true when the person passed it */
  unlock: (title: string, subtitle: string) => Promise<boolean>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const softKeys = new Map<string, KeySigner>();

export function appDeps(cfg: AppConfig = AEVUM_TESTNET): Deps {
  return {
    cfg,
    mesh: getMesh,
    api: new AgentApi(cfg),
    client: publicClient(cfg),
    owner: ownerWallet,
    signer: alias => {
      const native = nativeKeystore();
      if (native) {
        return keystoreSigner(native, alias);
      }
      // No Keystore module in this build (tests, or not Android): a software key for this run only
      if (!softKeys.has(alias)) softKeys.set(alias, softwareSigner(alias));
      return softKeys.get(alias)!;
    },
    authKind,
    unlock: unlockPhoneKey,
    now: Date.now,
    sleep: ms => new Promise(r => setTimeout(r, ms)),
  };
}

// ---------------------------------------------------------------- reading the wallet

export function toSnapshot(w: WalletState): Snapshot {
  return {
    walletUnits: w.walletUnits.toString(),
    vaultUnits: w.vaultUnits.toString(),
    tokenNonce: w.tokenNonce.toString(),
    ownerNonce: w.ownerNonce.toString(),
    session: w.session && {
      expiresAt: w.session.expiresAt.toString(),
      revoked: w.session.revoked,
      perPaymentCap: w.session.perPaymentCap.toString(),
      dailyCap: w.session.dailyCap.toString(),
      remainingToday: w.session.remainingToday.toString(),
    },
    readAt: w.readAt,
  };
}

/** Online: read the wallet from the chain and keep it for offline use. False when offline. */
export async function refreshWallet(d: Deps): Promise<boolean> {
  const st = useApp.getState();
  try {
    const owner = await d.owner();
    if (st.owner !== owner.address) st.setOwner(owner.address);
    const w = await readWalletState(d.cfg, d.client, owner.address, st.session?.sessionId ?? null);
    st.setSnapshot(toSnapshot(w));
    st.setOnline(true);
    return true;
  } catch {
    st.setOnline(false);
    return false;
  }
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * What this phone may still pay, worked out offline: the last chain reading, minus payments made
 * since that the chain didn't know about yet. The vault checks the same limits on chain, so this
 * only stops the person from signing payments that would bounce.
 */
export function spendable(now = Date.now()) {
  const { snapshot, payments } = useApp.getState();
  if (!snapshot?.session) {
    return null;
  }
  const s = snapshot.session;
  const since = payments.filter(p => p.createdAt > snapshot.readAt && p.status !== 'rejected');
  const spentSince = since.reduce((a, p) => a + BigInt(p.amount) + BigInt(p.maxFee), 0n);
  const sameDay = utcDay(snapshot.readAt) === utcDay(now);
  const todaySince = since.filter(p => utcDay(p.createdAt) === utcDay(now)).reduce((a, p) => a + BigInt(p.amount), 0n);
  const todayLeft = (sameDay ? BigInt(s.remainingToday) : BigInt(s.dailyCap)) - todaySince;
  const balance = BigInt(snapshot.vaultUnits) - spentSince;
  const expired = BigInt(Math.floor(now / 1000)) >= BigInt(s.expiresAt);
  return {
    balance: balance < 0n ? 0n : balance,
    todayLeft: todayLeft < 0n ? 0n : todayLeft,
    perPaymentCap: BigInt(s.perPaymentCap),
    expiresAt: Number(s.expiresAt),
    revoked: s.revoked,
    expired,
    readAt: snapshot.readAt,
  };
}

// ---------------------------------------------------------------- paying

export class PayError extends Error {}

/** Checks, signs and saves a payment, then hands it to the mesh. Works with no signal. */
export async function pay(d: Deps, payee: string, amount: bigint, payeeName?: string): Promise<Payment> {
  const st = useApp.getState();
  if (!st.session) throw new PayError('Set up offline payments on this phone first.');
  if (!isAddress(payee)) throw new PayError('That is not a valid wallet address.');
  if (st.owner && payee.toLowerCase() === st.owner.toLowerCase()) throw new PayError('That is your own wallet.');
  const left = spendable(d.now());
  if (!left) throw new PayError('Go online once so this phone can read your wallet.');
  if (left.revoked) throw new PayError('This phone was removed from your wallet.');
  if (left.expired) throw new PayError('Offline pay needs renewing. Open Safety while you have signal.');
  if (amount <= 0n) throw new PayError('Enter an amount.');
  if (amount > left.perPaymentCap) throw new PayError(`This phone can pay up to ${usd(left.perPaymentCap)} at once.`);
  if (amount > left.todayLeft) throw new PayError(`You can pay ${usd(left.todayLeft)} more today.`);
  if (amount + d.cfg.maxFeeUnits > left.balance) throw new PayError('You do not have enough money ready for this.');

  const signer = d.signer(st.session.keyAlias);
  const v = newVoucher(d.cfg, { sessionId: st.session.sessionId, payee: payee as Address, amount, nowSec: Math.floor(d.now() / 1000) });
  const message = await signVoucher(d.cfg, v, signer);
  const name = payeeName ?? contactFor(st.contacts, payee)?.name;
  const p: Payment = {
    id: v.nonce,
    payee: payee as Address,
    ...(name ? { payeeName: name } : {}),
    amount: amount.toString(),
    maxFee: v.maxFee.toString(),
    createdAt: d.now(),
    status: 'signed',
    attempts: 0,
    message,
  };
  st.addPayment(p);
  st.touchContact(p.payee, p.createdAt);
  void deliver(d, p.id);
  return p;
}

/**
 * The confirm step. On a phone with a screen lock the payment key is tied to the person, so the
 * phone's own fingerprint (or PIN) prompt has to pass before Keystore will sign. On a phone
 * without one, the app PIN is the check: the screen passes pinChecked once it was entered.
 */
export async function confirmAndPay(
  d: Deps,
  o: { payee: string; amount: bigint; payeeName?: string; pinChecked?: boolean },
): Promise<Payment> {
  const st = useApp.getState();
  if (!st.session) throw new PayError('Turn on offline pay first.');
  if (st.session.protected) {
    const who = o.payeeName ?? contactFor(st.contacts, o.payee)?.name ?? 'this person';
    const ok = await d.unlock('Confirm payment', `${usd(o.amount)} to ${who}`);
    if (!ok) throw new PayError('Payment not confirmed. Nothing was sent.');
  } else if (!o.pinChecked) {
    throw new PayError('Enter your PIN to confirm.');
  }
  return pay(d, o.payee, o.amount, o.payeeName);
}

const inFlight = new Set<string>();

/**
 * Hand a payment to the mesh (or ask about it), and apply a genuine receipt. Safe to call any
 * number of times: the agent answers a repeated voucher from its records, and the vault never
 * pays a voucher twice.
 */
export async function deliver(d: Deps, id: Hex): Promise<void> {
  const key = id.toLowerCase();
  if (inFlight.has(key)) return;
  const p = useApp.getState().payments.find(x => x.id.toLowerCase() === key);
  if (!p || isFinal(p.status)) return;
  inFlight.add(key);
  const update = (patch: Partial<Payment>) => useApp.getState().updatePayment(id, patch);
  try {
    // Online and already sent: ask the agent directly, it is quicker than the mesh
    if (p.status === 'submitted' && useApp.getState().online) {
      const r = await d.api.receipt(p.message.v.sessionId, p.id).catch(() => null);
      if (r && (await apply(d, p, r))) return;
    }
    update({ attempts: p.attempts + 1, lastTriedAt: d.now(), status: p.status === 'signed' ? 'waiting' : p.status });
    // With its own internet the phone needs nobody nearby: straight to the agent
    if (useApp.getState().online) {
      const direct = await d.api.pay(p.message).catch(() => null);
      if (direct && (await apply(d, p, direct))) return;
    }
    const reply = await d.mesh().sendData(JSON.stringify(p.message), { contentType: VOUCHER_CT, timeoutMs: MESH_TIMEOUT_MS });
    if (reply.status === 'delivered' && reply.body) {
      const r = safeJson(utf8Decode(reply.body));
      await apply(d, p, r);
    }
    update({ peers: d.mesh().peerCount() });
  } catch {
    // stays waiting; tried again later
  } finally {
    inFlight.delete(key);
  }
}

/** Applies a receipt only if our agent signed it for this payment. Returns whether it did. */
async function apply(d: Deps, p: Payment, r: unknown): Promise<boolean> {
  if (!(await isGenuineReceipt(d.cfg, r, { sessionId: p.message.v.sessionId, nonce: p.id }))) {
    return false;
  }
  const rc = r as Receipt;
  const update = (patch: Partial<Payment>) => useApp.getState().updatePayment(p.id, patch);
  switch (rc.status) {
    case 'confirmed':
      update({ status: 'confirmed', txHash: rc.txHash, fee: rc.fee, reason: rc.reason });
      break;
    case 'submitted':
      update({ status: 'submitted', txHash: rc.txHash });
      break;
    case 'rejected':
      update({ status: 'rejected', reason: rc.reason });
      break;
    case 'retry':
    case 'unknown':
      update({ status: 'waiting', reason: rc.reason });
      break;
  }
  return true;
}

/** Every open payment, once. Called on a timer and when the app comes back to the front. */
export async function deliverOpen(d: Deps): Promise<void> {
  const open = useApp.getState().payments.filter(p => !isFinal(p.status));
  for (const p of open) {
    await deliver(d, p.id);
  }
}

// ---------------------------------------------------------------- wallet setup (online)

export type ActionResult = { ok: boolean; message?: string; txHash?: Hex };

/** Starting limits for a new phone: $5 a payment, $10 a day, renewed every 7 days. */
export function defaultLimits(nowMs: number): SessionLimits {
  return { perPaymentCap: 5_000_000n, dailyCap: 10_000_000n, expiresAt: BigInt(Math.floor(nowMs / 1000) + 7 * 86_400) };
}

const deadline = (d: Deps) => BigInt(Math.floor(d.now() / 1000) + 3600);

function result(r: { status: string; txHash?: Hex; reason?: string }, done: string): ActionResult {
  if (r.status === 'confirmed' || r.status === 'submitted') return { ok: true, message: done, txHash: r.txHash };
  if (r.status === 'retry') return { ok: false, message: 'The payment service is busy. Please try again in a minute.' };
  return { ok: false, message: r.reason ? `That did not work (${r.reason}).` : 'That did not work. Please try again.' };
}

/** Move tUSD8 from the wallet into the vault, with a permit the wallet signs. No gas needed. */
export async function deposit(d: Deps, amount: bigint): Promise<ActionResult> {
  const owner = await d.owner();
  const w = await readWalletState(d.cfg, d.client, owner.address, null);
  if (amount > w.walletUnits) return { ok: false, message: 'Your balance is not that much.' };
  const body = await signDepositPermit(d.cfg, owner, { amount, tokenNonce: w.tokenNonce, deadline: deadline(d) });
  const r = result(await d.api.deposit(body), 'Ready to spend without signal.');
  await refreshWallet(d);
  return r;
}

/** Make this phone's Keystore key and allow it to pay offline within `limits`. */
export async function addThisPhone(d: Deps, limits: SessionLimits): Promise<ActionResult> {
  const owner = await d.owner();
  if (d.authKind() !== 'none' && !(await d.unlock('Turn on offline pay', 'Confirm it is you, so only you can pay from this phone'))) {
    return { ok: false, message: 'Offline pay was not turned on. Try again and confirm with your fingerprint or screen lock.' };
  }
  const alias = `aevum_session_${d.now()}`; // a revoked key is never reused: each session gets a new one
  const signer = d.signer(alias);
  const { qx, qy } = publicKeyXY(signer.publicKey);
  const w = await readWalletState(d.cfg, d.client, owner.address, null);
  const body = await signOpenSession(d.cfg, owner, { qx, qy, limits, ownerNonce: w.ownerNonce, deadline: deadline(d) });
  const r = result(await d.api.openSession(body), 'This phone can now pay offline.');
  if (r.ok) {
    useApp.getState().setSession({
      sessionId: sessionIdOf(owner.address, qx, qy),
      keyAlias: alias,
      hardware: signer.hardware,
      protected: signer.protected,
    });
    await refreshWallet(d);
  }
  return r;
}

export async function removeThisPhone(d: Deps): Promise<ActionResult> {
  const st = useApp.getState();
  if (!st.session) return { ok: false, message: 'This phone is not set up.' };
  const owner = await d.owner();
  const body = await signRevoke(d.cfg, owner, { sessionId: st.session.sessionId, deadline: deadline(d) });
  const r = result(await d.api.revoke(body), 'Offline pay is off on this phone.');
  await refreshWallet(d);
  return r;
}

export async function withdrawAll(d: Deps): Promise<ActionResult> {
  const owner = await d.owner();
  const w = await readWalletState(d.cfg, d.client, owner.address, null);
  if (w.vaultUnits === 0n) return { ok: false, message: 'There is no offline money to move.' };
  const body = await signWithdraw(d.cfg, owner, { to: owner.address, amount: w.vaultUnits, ownerNonce: w.ownerNonce, deadline: deadline(d) });
  const r = result(await d.api.withdraw(body), 'Moved back to your balance.');
  await refreshWallet(d);
  return r;
}

// ---------------------------------------------------------------- first run

/** Smallest amount worth making ready for offline (the agent refuses deposits under 0.1). */
const MIN_READY = 100_000n;

/** Move everything in the balance into offline money, so it can be spent without signal. */
export async function makeReady(d: Deps): Promise<ActionResult> {
  const owner = await d.owner();
  const w = await readWalletState(d.cfg, d.client, owner.address, null);
  if (w.walletUnits < MIN_READY) return { ok: false, message: 'There is nothing to make ready.' };
  return deposit(d, w.walletUnits);
}

export type SetupStep = 'wallet' | 'money' | 'offline';
export type StepState = { state: 'active' | 'done' | 'skipped' | 'failed'; message?: string };

/**
 * One tap setup, online: read the new wallet, get starter money if it is empty, make the money
 * ready for offline, and turn on offline pay with the default limits. Each step reports as it
 * goes. Safe to run again after a failure: finished steps find nothing to do.
 */
export async function setUpWallet(d: Deps, report: (step: SetupStep, s: StepState) => void): Promise<boolean> {
  report('wallet', { state: 'active' });
  const owner = await d.owner();
  if (!(await refreshWallet(d))) {
    report('wallet', { state: 'failed', message: 'No internet. Setup needs signal once.' });
    return false;
  }
  report('wallet', { state: 'done', message: 'Your keys are kept in this phone’s secure chip.' });

  report('money', { state: 'active' });
  try {
    let w = await readWalletState(d.cfg, d.client, owner.address, null);
    if (w.walletUnits === 0n && w.vaultUnits === 0n) {
      const gift = await d.api.starter(owner.address).catch(() => null);
      if (gift && (gift.status === 'confirmed' || gift.status === 'submitted')) {
        for (let i = 0; i < 20 && w.walletUnits === 0n; i++) {
          await d.sleep(1000);
          w = await readWalletState(d.cfg, d.client, owner.address, null);
        }
      }
    }
    if (w.walletUnits >= MIN_READY) {
      const r = await deposit(d, w.walletUnits);
      if (!r.ok) throw new Error(r.message);
      w = await readWalletState(d.cfg, d.client, owner.address, null);
    }
    if (w.vaultUnits > 0n) {
      report('money', { state: 'done', message: `${usd(w.vaultUnits)} of test money, ready to use. It has no real value.` });
    } else {
      report('money', { state: 'skipped', message: 'Free test money is not available right now. You can add some later.' });
    }
  } catch {
    report('money', { state: 'skipped', message: 'Could not add test money right now. You can add some later.' });
  }

  if (useApp.getState().session && !spendable(d.now())?.revoked && !spendable(d.now())?.expired) {
    report('offline', { state: 'done', message: 'Already on.' });
    return true;
  }
  report('offline', { state: 'active', message: 'Saving your limits on the network.' });
  const r = await addThisPhone(d, defaultLimits(d.now()));
  report('offline', r.ok ? { state: 'done', message: 'You can now pay without signal.' } : { state: 'failed', message: r.message });
  return r.ok;
}

/**
 * New limits: a new phone key with the new limits. The old key is turned off only when no payment
 * signed with it is still on its way; otherwise it simply runs out.
 */
export async function changeLimits(d: Deps, limits: SessionLimits): Promise<ActionResult> {
  const st = useApp.getState();
  const old = st.session;
  const pending = st.payments.some(p => !isFinal(p.status) && old && p.message.v.sessionId === old.sessionId);
  const r = await addThisPhone(d, limits);
  if (r.ok && old && !pending) {
    const owner = await d.owner();
    const body = await signRevoke(d.cfg, owner, { sessionId: old.sessionId, deadline: deadline(d) }).catch(() => null);
    if (body) await d.api.revoke(body).catch(() => null);
  }
  return r.ok ? { ...r, message: 'New limits saved.' } : r;
}

// ---------------------------------------------------------------- money in, names, allowance

/** Money paid to this wallet, as the agent saw it on chain. Online only. */
export async function refreshIncoming(d: Deps): Promise<void> {
  const st = useApp.getState();
  if (!st.online || !st.owner) return;
  const list = await d.api.incoming(st.owner).catch(() => null);
  if (!list) return;
  st.setIncoming(
    list.map(x => ({
      id: `${x.txHash}:${x.nonce}`,
      amount: x.amount,
      from: x.from,
      fromName: x.fromName,
      at: (x.time ?? 0) * 1000,
      txHash: x.txHash,
    })),
  );
  for (const x of list) if (x.from && x.fromName) st.rememberName(x.from, x.fromName, d.now());
}

/** Whether the agent has a payee registry (asked once while online). */
export async function registryAddress(d: Deps): Promise<Address | null> {
  const st = useApp.getState();
  if (st.registry !== undefined) return st.registry;
  const info = await d.api.info().catch(() => null);
  if (!info) return null;
  st.setRegistry((info.registry as Address | null) ?? null);
  return (info.registry as Address | null) ?? null;
}

/**
 * The registered name of an address: read fresh when online, else from the saved copy.
 * Returns undefined when it has never been checked (offline, first time).
 */
export async function lookUpName(d: Deps, a: Address | string): Promise<string | null | undefined> {
  const st = useApp.getState();
  if (st.online) {
    const n = await d.api.nameOf(a as Hex).catch(() => undefined);
    if (n !== undefined) {
      st.rememberName(a as Address, n, d.now());
      return n;
    }
  }
  return registeredName(st.names, a);
}

/** Refresh the saved copy for every contact and for this wallet, so names still show offline. */
export async function refreshNames(d: Deps): Promise<void> {
  const st = useApp.getState();
  if (!st.online || !(await registryAddress(d))) return;
  const all = [...st.contacts.map(c => c.address), ...(st.owner ? [st.owner] : [])];
  for (const a of all) await lookUpName(d, a);
}

export async function findByName(d: Deps, name: string): Promise<{ name: string; address: Address } | null> {
  const r = await d.api.findName(name.trim());
  if (r) useApp.getState().rememberName(r.address as Address, r.name, d.now());
  return r as { name: string; address: Address } | null;
}

/** Register this wallet's name in the PayeeRegistry, gasless. */
export async function registerMyName(d: Deps, name: string): Promise<ActionResult> {
  const problem = nameProblem(name);
  if (problem) return { ok: false, message: problem };
  const registry = await registryAddress(d);
  if (!registry) return { ok: false, message: 'Name registration is not open yet.' };
  const owner = await d.owner();
  const nonce = (await d.client.readContract({ address: registry, abi: payeeRegistryAbi, functionName: 'nonces', args: [owner.address] })) as bigint;
  const body = await signRegisterName({ chainId: d.cfg.chainId, registry, name, nonce, deadline: deadline(d) }, owner);
  const r = await d.api.registerName(body);
  if (r.status === 'rejected' && r.reason === 'NameTaken') return { ok: false, message: 'Someone else has registered that name. Try another.' };
  if (r.status === 'rejected' && r.reason === 'BadName') return { ok: false, message: "That name can't be registered. Use letters, numbers and spaces." };
  const out = result(r, `"${name}" is now your registered name.`);
  if (out.ok) {
    useApp.getState().rememberName(owner.address, name, d.now());
    useApp.getState().setName(name);
  }
  return out;
}

export async function releaseMyName(d: Deps): Promise<ActionResult> {
  const registry = await registryAddress(d);
  if (!registry) return { ok: false, message: 'Name registration is not open yet.' };
  const owner = await d.owner();
  const nonce = (await d.client.readContract({ address: registry, abi: payeeRegistryAbi, functionName: 'nonces', args: [owner.address] })) as bigint;
  const body = await signReleaseName({ chainId: d.cfg.chainId, registry, nonce, deadline: deadline(d) }, owner);
  const out = result(await d.api.releaseName(body), 'Your registered name was given up.');
  if (out.ok) useApp.getState().rememberName(owner.address, null, d.now());
  return out;
}

export type Proposal = { limits: SessionLimits; summary: string; source: 'claude' | 'rules' };

/** The allowance agent: limits proposed from the person's own words. The person still approves them. */
export async function proposeLimits(d: Deps, text: string): Promise<Proposal | { question: string }> {
  const a = await d.api.allowance(text);
  if ('question' in a) return { question: a.question };
  return {
    limits: { perPaymentCap: BigInt(a.perPaymentCap), dailyCap: BigInt(a.dailyCap), expiresAt: BigInt(Math.floor(d.now() / 1000) + a.days * 86_400) },
    summary: a.summary,
    source: a.source,
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** UTF-8 bytes to text (Hermes has TextEncoder but no TextDecoder). */
/* eslint-disable no-bitwise */
export function utf8Decode(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i++];
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c < 0xe0) cp = ((c & 0x1f) << 6) | (b[i++] & 0x3f);
    else if (c < 0xf0) cp = ((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
    else cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}
/* eslint-enable no-bitwise */
