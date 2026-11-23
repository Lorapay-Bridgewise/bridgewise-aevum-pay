import { createPublicClient, defineChain, http, type Address, type Hex, type PublicClient } from 'viem';
import { offlineVaultAbi } from './abi';
import type { AppConfig } from './config';

export const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export function publicClient(cfg: AppConfig): PublicClient {
  const chain = defineChain({
    id: cfg.chainId,
    name: 'QDay Aevum Testnet',
    nativeCurrency: { name: 'tQDAY', symbol: 'tQDAY', decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  // Aevum has no WebSocket RPC: plain HTTPS
  return createPublicClient({ chain, transport: http(cfg.rpcUrl, { timeout: 10_000, retryCount: 1 }) }) as PublicClient;
}

export type SessionInfo = {
  owner: Address;
  expiresAt: bigint;
  revoked: boolean;
  perPaymentCap: bigint;
  dailyCap: bigint;
  remainingToday: bigint;
};

export type WalletState = {
  /** tUSD8 in the person's own wallet (not yet in the vault) */
  walletUnits: bigint;
  /** tUSD8 in the vault, spendable offline */
  vaultUnits: bigint;
  tokenNonce: bigint;
  ownerNonce: bigint;
  session: SessionInfo | null;
  readAt: number;
};

/** One online read of everything the app shows. Offline, the app shows the last one it kept. */
export async function readWalletState(cfg: AppConfig, client: PublicClient, owner: Address, sessionId: Hex | null): Promise<WalletState> {
  const [walletUnits, tokenNonce, vaultUnits, ownerNonce] = await Promise.all([
    client.readContract({ address: cfg.token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
    client.readContract({ address: cfg.token, abi: erc20Abi, functionName: 'nonces', args: [owner] }),
    client.readContract({ address: cfg.vault, abi: offlineVaultAbi, functionName: 'balanceOf', args: [owner] }),
    client.readContract({ address: cfg.vault, abi: offlineVaultAbi, functionName: 'ownerNonce', args: [owner] }),
  ]);
  let session: SessionInfo | null = null;
  if (sessionId) {
    const [s, remainingToday] = await Promise.all([
      client.readContract({ address: cfg.vault, abi: offlineVaultAbi, functionName: 'getSession', args: [sessionId] }),
      client.readContract({ address: cfg.vault, abi: offlineVaultAbi, functionName: 'remainingToday', args: [sessionId] }),
    ]);
    if (s.owner !== '0x0000000000000000000000000000000000000000') {
      session = {
        owner: s.owner,
        expiresAt: s.expiresAt,
        revoked: s.revoked,
        perPaymentCap: s.perPaymentCap,
        dailyCap: s.dailyCap,
        remainingToday,
      };
    }
  }
  return { walletUnits, vaultUnits, tokenNonce, ownerNonce, session, readAt: Date.now() };
}
