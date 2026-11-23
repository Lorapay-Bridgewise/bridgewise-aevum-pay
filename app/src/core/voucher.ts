import { bytesToHex, encodeAbiParameters, hashTypedData, keccak256, type Address, type Hex } from 'viem';
import type { AppConfig } from './config';

/**
 * Offline payment vouchers for the OfflineVault contract (src/OfflineVault.sol).
 *
 * The phone computes the EIP-712 digest and signs it with its Keystore key using SHA256withECDSA,
 * so the signature covers sha256(digest): exactly what the vault checks (voucherSigningHash).
 */
export type Voucher = {
  sessionId: Hex;
  payee: Address;
  amount: bigint;
  maxFee: bigint;
  nonce: Hex;
  validBefore: bigint;
};

/** Signs like Android Keystore's SHA256withECDSA: P-256 over SHA-256 of `message`, raw r||s (64 bytes). */
export type PhoneSigner = {
  /** Uncompressed public key, 65 bytes (0x04 || x || y). */
  publicKey: Uint8Array;
  sign(message: Uint8Array): Uint8Array | Promise<Uint8Array>;
};

export const VOUCHER_TYPES = {
  Voucher: [
    { name: 'sessionId', type: 'bytes32' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'validBefore', type: 'uint64' },
  ],
} as const;

export function vaultDomain(cfg: Pick<AppConfig, 'chainId' | 'vault'>) {
  return { name: 'Bridgewise OfflineVault', version: '1', chainId: cfg.chainId, verifyingContract: cfg.vault } as const;
}

/** The phone key's x and y as bytes32, from the 65-byte uncompressed point. */
export function publicKeyXY(publicKey: Uint8Array): { qx: Hex; qy: Hex } {
  if (publicKey.length !== 65 || publicKey[0] !== 4) {
    throw new Error('Expected an uncompressed P-256 public key (65 bytes).');
  }
  return { qx: bytesToHex(publicKey.slice(1, 33)), qy: bytesToHex(publicKey.slice(33, 65)) };
}

/** Same as OfflineVault.sessionIdOf(owner, qx, qy). */
export function sessionIdOf(owner: Address, qx: Hex, qy: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }], [owner, qx, qy]));
}

export function randomNonce(): Hex {
  const b = new Uint8Array(32);
  // react-native-get-random-values provides this on the phone (index.js imports it first)
  (globalThis as unknown as { crypto: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto.getRandomValues(b);
  return bytesToHex(b);
}

export function newVoucher(
  cfg: Pick<AppConfig, 'maxFeeUnits' | 'voucherValiditySec'>,
  p: { sessionId: Hex; payee: Address; amount: bigint; nowSec?: number },
): Voucher {
  if (p.amount <= 0n) {
    throw new Error('Amount must be more than zero.');
  }
  const now = p.nowSec ?? Math.floor(Date.now() / 1000);
  return {
    sessionId: p.sessionId,
    payee: p.payee,
    amount: p.amount,
    maxFee: cfg.maxFeeUnits,
    nonce: randomNonce(),
    validBefore: BigInt(now + cfg.voucherValiditySec),
  };
}

export function voucherDigest(cfg: Pick<AppConfig, 'chainId' | 'vault'>, v: Voucher): Hex {
  return hashTypedData({ domain: vaultDomain(cfg), types: VOUCHER_TYPES, primaryType: 'Voucher', message: v });
}

/** What travels over the mesh to the settlement agent (agent/src/messages.ts). */
export type VoucherMessage = {
  t: 'voucher';
  chainId: number;
  vault: Address;
  v: { sessionId: Hex; payee: Address; amount: string; maxFee: string; nonce: Hex; validBefore: number };
  r: Hex;
  s: Hex;
};

export async function signVoucher(cfg: Pick<AppConfig, 'chainId' | 'vault'>, v: Voucher, signer: PhoneSigner): Promise<VoucherMessage> {
  const digest = voucherDigest(cfg, v);
  const sig = await signer.sign(hexBytes(digest));
  if (sig.length !== 64) {
    throw new Error('The phone key returned a signature of the wrong size.');
  }
  return {
    t: 'voucher',
    chainId: cfg.chainId,
    vault: cfg.vault,
    v: {
      sessionId: v.sessionId,
      payee: v.payee,
      amount: v.amount.toString(),
      maxFee: v.maxFee.toString(),
      nonce: v.nonce,
      validBefore: Number(v.validBefore),
    },
    r: bytesToHex(sig.slice(0, 32)),
    s: bytesToHex(sig.slice(32, 64)),
  };
}

export function fromMessage(m: VoucherMessage): Voucher {
  return {
    sessionId: m.v.sessionId,
    payee: m.v.payee,
    amount: BigInt(m.v.amount),
    maxFee: BigInt(m.v.maxFee),
    nonce: m.v.nonce,
    validBefore: BigInt(m.v.validBefore),
  };
}

export function hexBytes(hex: Hex): Uint8Array {
  const h = hex.slice(2);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
