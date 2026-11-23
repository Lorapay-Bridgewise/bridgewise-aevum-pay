import type { Hex } from 'viem';
import type { AppConfig } from './config';
import type { Receipt } from './receipt';
import type { signDepositPermit, signOpenSession, signRevoke, signWithdraw } from './owner';

/**
 * Calls to the settlement agent over the internet, for the moments the phone is online:
 * setting up the wallet, adding or removing this phone, paying straight to the agent, money in,
 * registered names and the allowance agent. Without internet, payments go through the mesh
 * (src/mesh.ts).
 */
export type RelayResult = { status: 'confirmed' | 'submitted' | 'rejected' | 'retry'; txHash?: Hex; reason?: string };

export type AgentInfo = { chainId: number; vault: Hex; agent: Hex; registry: Hex | null; allowanceAgent: 'claude' | 'rules'; commit: string };

export type IncomingPayment = {
  txHash: Hex;
  block: string;
  time: number | null;
  sessionId: Hex;
  nonce: Hex;
  amount: string;
  from: Hex | null;
  fromName: string | null;
};

export type AllowanceAnswer =
  | { perPaymentCap: string; dailyCap: string; days: number; summary: string; source: 'claude' | 'rules' }
  | { question: string; source: 'claude' | 'rules' };

export class AgentApi {
  constructor(
    private readonly cfg: Pick<AppConfig, 'agentUrl'>,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  deposit(body: Awaited<ReturnType<typeof signDepositPermit>>): Promise<RelayResult> {
    return this.post('/v1/owner/deposit', body);
  }

  openSession(body: Awaited<ReturnType<typeof signOpenSession>>): Promise<RelayResult> {
    return this.post('/v1/owner/session', body);
  }

  revoke(body: Awaited<ReturnType<typeof signRevoke>>): Promise<RelayResult> {
    return this.post('/v1/owner/revoke', body);
  }

  withdraw(body: Awaited<ReturnType<typeof signWithdraw>>): Promise<RelayResult> {
    return this.post('/v1/owner/withdraw', body);
  }

  /** Starter money for a brand new wallet (a small tUSD8 gift from the agent's pool). */
  starter(address: Hex): Promise<RelayResult & { amount?: string }> {
    return this.post('/v1/starter', { address });
  }

  /** A voucher (or a status question) sent straight to the agent, for a phone with its own internet. */
  async pay(message: unknown): Promise<Receipt> {
    // A phone that only looked online must not wait long before trying the mesh
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 10_000);
    const res = await this.fetchFn(`${this.cfg.agentUrl}/v1/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
      signal: stop.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`Agent answered ${res.status}`);
    return (await res.json()) as Receipt;
  }

  info(): Promise<AgentInfo> {
    return this.get('/v1/config');
  }

  async incoming(address: Hex): Promise<IncomingPayment[]> {
    return (await this.get<{ payments: IncomingPayment[] }>(`/v1/payments/to/${address}`)).payments;
  }

  /** The registered name of an address, null for none, undefined when the agent has no registry. */
  async nameOf(address: Hex): Promise<string | null | undefined> {
    const res = await this.fetchFn(`${this.cfg.agentUrl}/v1/names/${address}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Agent answered ${res.status}`);
    return ((await res.json()) as { name: string | null }).name;
  }

  /** Who holds a registered name (any case), or null. */
  async findName(name: string): Promise<{ name: string; address: Hex } | null> {
    const res = await this.fetchFn(`${this.cfg.agentUrl}/v1/names?name=${encodeURIComponent(name)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Agent answered ${res.status}`);
    const j = (await res.json()) as { name: string; address: Hex | null };
    return j.address ? { name: j.name, address: j.address } : null;
  }

  registerName(body: { account: Hex; name: string; deadline: string; signature: Hex }): Promise<RelayResult> {
    return this.post('/v1/names', body);
  }

  releaseName(body: { account: Hex; deadline: string; signature: Hex }): Promise<RelayResult> {
    return this.post('/v1/names/release', body);
  }

  /** The allowance agent: limits proposed from the person's own words. Changes nothing. */
  async allowance(text: string): Promise<AllowanceAnswer> {
    const res = await this.fetchFn(`${this.cfg.agentUrl}/v1/allowance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`Agent answered ${res.status}`);
    return (await res.json()) as AllowanceAnswer;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${this.cfg.agentUrl}${path}`);
    if (!res.ok) throw new Error(`Agent answered ${res.status}`);
    return (await res.json()) as T;
  }

  async receipt(sessionId: Hex, nonce: Hex): Promise<Receipt> {
    const res = await this.fetchFn(`${this.cfg.agentUrl}/v1/vouchers/${sessionId}/${nonce}`);
    if (!res.ok) {
      throw new Error(`Agent answered ${res.status}`);
    }
    return (await res.json()) as Receipt;
  }

  private async post(path: string, body: unknown): Promise<RelayResult> {
    const res = await this.fetchFn(`${this.cfg.agentUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Partial<RelayResult> & { error?: string };
    if (!res.ok && !json.status) {
      return { status: 'rejected', reason: json.error ?? `HTTP ${res.status}` };
    }
    return json as RelayResult;
  }
}
