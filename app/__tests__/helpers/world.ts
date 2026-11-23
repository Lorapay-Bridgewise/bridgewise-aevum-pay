import { FakeMesh } from '@bridgewise/mesh-react-native/testing';
import type { Address, Hex, PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AgentApi } from '../../src/core/agentApi';
import { AEVUM_TESTNET, type AppConfig } from '../../src/core/config';
import { RECEIPT_TYPES, type SettlementStatus } from '../../src/core/receipt';
import { softwareSigner, type AuthKind, type KeySigner } from '../../src/native/keystore';
import type { Deps } from '../../src/payments/engine';
import { useApp } from '../../src/state/store';

export const ONE = 1_000_000n;
export const AGENT = privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba');
export const STRANGER = privateKeyToAccount('0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e');
export const OWNER = privateKeyToAccount('0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356');
export const PAYEE = '0xA3AaA23EC0e8BEF5C83a9ea59cD2f4127Fd8DC81' as Address;

export const cfg: AppConfig = { ...AEVUM_TESTNET, agentAddress: AGENT.address };

/** A pretend chain: what readWalletState reads. */
export const chain = {
  walletUnits: 5n * ONE,
  vaultUnits: 4n * ONE,
  tokenNonce: 0n,
  ownerNonce: 0n,
  session: { owner: OWNER.address as Address, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400), revoked: false, perPaymentCap: 2n * ONE, dailyCap: 3n * ONE },
  remainingToday: 3n * ONE,
  offline: false,
};

export const fakeClient = {
  async readContract({ address, functionName }: { address: Address; functionName: string }) {
    if (chain.offline) throw new Error('no signal');
    switch (functionName) {
      case 'balanceOf':
        return address.toLowerCase() === cfg.token.toLowerCase() ? chain.walletUnits : chain.vaultUnits;
      case 'nonces':
        return chain.tokenNonce;
      case 'ownerNonce':
        return chain.ownerNonce;
      case 'getSession':
        return chain.session;
      case 'remainingToday':
        return chain.remainingToday;
    }
    throw new Error(`unexpected ${functionName}`);
  },
} as unknown as PublicClient;

/** A receipt the agent would send back, as JSON (for /v1/pay). */
export async function receiptJson(message: unknown, status: SettlementStatus, extra: { reason?: string; txHash?: Hex; fee?: string } = {}) {
  const r = await receiptFor(new TextEncoder().encode(JSON.stringify(message)), status, extra);
  return JSON.parse(new TextDecoder().decode(r.body));
}

export async function receiptFor(
  body: Uint8Array,
  status: SettlementStatus,
  extra: { reason?: string; txHash?: Hex; fee?: string } = {},
  by = AGENT,
) {
  const msg = JSON.parse(new TextDecoder().decode(body));
  const sessionId = msg.v?.sessionId ?? msg.sessionId;
  const nonce = msg.v?.nonce ?? msg.nonce;
  const code = { unknown: 0, submitted: 1, confirmed: 2, rejected: 3, retry: 4 }[status];
  const issuedAt = 1_766_000_000;
  const txHash = extra.txHash ?? (`0x${'0'.repeat(64)}` as Hex);
  const sig = await by.signTypedData({
    domain: { name: 'Bridgewise Settlement Agent', version: '1', chainId: cfg.chainId, verifyingContract: cfg.vault },
    types: RECEIPT_TYPES,
    primaryType: 'Receipt',
    message: { sessionId, nonce, status: code, reason: extra.reason ?? '', txHash, fee: BigInt(extra.fee ?? '0'), issuedAt: BigInt(issuedAt) },
  });
  const r = { t: 'receipt', sessionId, nonce, status, agent: by.address, issuedAt, sig, ...extra };
  return { status: 'delivered' as const, body: new TextEncoder().encode(JSON.stringify(r)), contentType: 'application/vnd.bwpay.receipt+json', code: null, message: null };
}

/** The phone: what kind of lock it has, and whether the person passes the fingerprint prompt. */
export const phone = { auth: 'biometric' as AuthKind, passes: true, prompts: [] as string[] };

export const REGISTRY = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address;

/**
 * The pretend agent. Each test may answer a path its own way (return undefined to fall through);
 * by default owner actions are confirmed, /v1/pay is unreachable (so payments use the mesh),
 * and there is no registry.
 */
type Answer = { status?: number; json: unknown } | undefined;
export type AgentReply = (path: string, body: any) => Answer | Promise<Answer>;

export function makeWorld() {
  const mesh = new FakeMesh();
  mesh.running = true; // started, as the app does at launch
  const relayed: { path: string; body: any }[] = [];
  const replies: AgentReply[] = [];
  const fetchFn = (async (url: string, init?: { body?: string }) => {
    const path = url.replace(cfg.agentUrl, '');
    const body = init?.body ? JSON.parse(init.body) : null;
    relayed.push({ path, body });
    for (const r of replies) {
      const a = await r(path, body);
      if (a) return { ok: (a.status ?? 200) < 400, status: a.status ?? 200, json: async () => a.json };
    }
    if (path === '/v1/pay' || path.startsWith('/v1/names') || path.startsWith('/v1/payments')) {
      return { ok: false, status: path === '/v1/pay' ? 503 : 404, json: async () => ({ error: 'off' }) };
    }
    if (path === '/v1/config') return { ok: true, status: 200, json: async () => ({ registry: null, allowanceAgent: 'rules' }) };
    return { ok: true, status: 200, json: async () => ({ status: 'confirmed', txHash: `0x${'ab'.repeat(32)}` }) };
  }) as unknown as typeof fetch;
  const keys = new Map<string, KeySigner>();
  const deps: Deps = {
    cfg,
    mesh: () => mesh,
    api: new AgentApi(cfg, fetchFn),
    client: fakeClient,
    owner: async () => OWNER,
    signer: alias => {
      if (!keys.has(alias)) keys.set(alias, { ...softwareSigner(alias), protected: phone.auth !== 'none' });
      return keys.get(alias)!;
    },
    authKind: () => phone.auth,
    unlock: async (title: string) => {
      phone.prompts.push(title);
      return phone.passes;
    },
    now: Date.now,
    sleep: async () => undefined,
  };
  return { mesh, deps, relayed, keys, replies };
}

export function resetState() {
  useApp.setState({
    owner: null,
    session: null,
    snapshot: null,
    payments: [],
    online: false,
    name: '',
    onboarded: false,
    contacts: [],
    settings: { biometricUnlock: true, showTechnical: false },
    incoming: [],
    names: {},
    registry: undefined,
  });
  Object.assign(phone, { auth: 'biometric', passes: true, prompts: [] });
  Object.assign(chain, {
    walletUnits: 5n * ONE,
    vaultUnits: 4n * ONE,
    tokenNonce: 0n,
    ownerNonce: 0n,
    remainingToday: 3n * ONE,
    offline: false,
  });
  chain.session = { ...chain.session, revoked: false, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400) };
}
