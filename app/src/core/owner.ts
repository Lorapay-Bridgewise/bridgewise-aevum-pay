import type { Address, Hex, LocalAccount } from 'viem';
import type { AppConfig } from './config';
import { vaultDomain } from './voucher';

/**
 * The person's own wallet (a normal Ethereum key kept encrypted on the phone). It never sends
 * transactions: it signs, and the settlement agent submits and pays the gas. So the wallet only
 * ever needs tUSD8, never tQDAY.
 */

export type SessionLimits = {
  perPaymentCap: bigint;
  dailyCap: bigint;
  /** Unix seconds */
  expiresAt: bigint;
};

/** EIP-2612 permit on tUSD8, letting the vault pull `amount` for a deposit. */
export async function signDepositPermit(
  cfg: Pick<AppConfig, 'chainId' | 'token' | 'tokenDomain' | 'vault'>,
  owner: LocalAccount,
  p: { amount: bigint; tokenNonce: bigint; deadline: bigint },
) {
  const signature = await owner.signTypedData!({
    domain: { ...cfg.tokenDomain, chainId: cfg.chainId, verifyingContract: cfg.token },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    message: { owner: owner.address, spender: cfg.vault, value: p.amount, nonce: p.tokenNonce, deadline: p.deadline },
  });
  return { owner: owner.address, amount: p.amount.toString(), deadline: p.deadline.toString(), ...splitSig(signature) };
}

export async function signOpenSession(
  cfg: Pick<AppConfig, 'chainId' | 'vault'>,
  owner: LocalAccount,
  p: { qx: Hex; qy: Hex; limits: SessionLimits; ownerNonce: bigint; deadline: bigint },
) {
  const signature = await owner.signTypedData!({
    domain: vaultDomain(cfg),
    types: {
      OpenSession: [
        { name: 'owner', type: 'address' },
        { name: 'qx', type: 'bytes32' },
        { name: 'qy', type: 'bytes32' },
        { name: 'perPaymentCap', type: 'uint128' },
        { name: 'dailyCap', type: 'uint128' },
        { name: 'expiresAt', type: 'uint64' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'OpenSession',
    message: {
      owner: owner.address,
      qx: p.qx,
      qy: p.qy,
      perPaymentCap: p.limits.perPaymentCap,
      dailyCap: p.limits.dailyCap,
      expiresAt: p.limits.expiresAt,
      nonce: p.ownerNonce,
      deadline: p.deadline,
    },
  });
  return {
    owner: owner.address,
    params: {
      qx: p.qx,
      qy: p.qy,
      perPaymentCap: p.limits.perPaymentCap.toString(),
      dailyCap: p.limits.dailyCap.toString(),
      expiresAt: p.limits.expiresAt.toString(),
    },
    deadline: p.deadline.toString(),
    sig: signature,
  };
}

export async function signRevoke(cfg: Pick<AppConfig, 'chainId' | 'vault'>, owner: LocalAccount, p: { sessionId: Hex; deadline: bigint }) {
  const signature = await owner.signTypedData!({
    domain: vaultDomain(cfg),
    types: { Revoke: [{ name: 'sessionId', type: 'bytes32' }, { name: 'deadline', type: 'uint256' }] },
    primaryType: 'Revoke',
    message: { sessionId: p.sessionId, deadline: p.deadline },
  });
  return { sessionId: p.sessionId, deadline: p.deadline.toString(), sig: signature };
}

export async function signWithdraw(
  cfg: Pick<AppConfig, 'chainId' | 'vault'>,
  owner: LocalAccount,
  p: { to: Address; amount: bigint; ownerNonce: bigint; deadline: bigint },
) {
  const signature = await owner.signTypedData!({
    domain: vaultDomain(cfg),
    types: {
      Withdraw: [
        { name: 'owner', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Withdraw',
    message: { owner: owner.address, to: p.to, amount: p.amount, nonce: p.ownerNonce, deadline: p.deadline },
  });
  return { owner: owner.address, to: p.to, amount: p.amount.toString(), deadline: p.deadline.toString(), sig: signature };
}

function splitSig(sig: Hex): { v: number; r: Hex; s: Hex } {
  const r = `0x${sig.slice(2, 66)}` as Hex;
  const s = `0x${sig.slice(66, 130)}` as Hex;
  let v = parseInt(sig.slice(130, 132), 16);
  if (v < 27) {
    v += 27;
  }
  return { v, r, s };
}

// ---------------------------------------------------------------- PayeeRegistry

const registryDomain = (chainId: number, registry: Address) => ({ name: 'Bridgewise PayeeRegistry', version: '1', chainId, verifyingContract: registry });

/** Register (or change) this wallet's public name. The agent submits it and pays the gas. */
export async function signRegisterName(
  p: { chainId: number; registry: Address; name: string; nonce: bigint; deadline: bigint },
  owner: LocalAccount,
) {
  const signature = await owner.signTypedData!({
    domain: registryDomain(p.chainId, p.registry),
    types: {
      Register: [
        { name: 'account', type: 'address' },
        { name: 'name', type: 'string' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Register',
    message: { account: owner.address, name: p.name, nonce: p.nonce, deadline: p.deadline },
  });
  return { account: owner.address, name: p.name, deadline: p.deadline.toString(), signature };
}

export async function signReleaseName(p: { chainId: number; registry: Address; nonce: bigint; deadline: bigint }, owner: LocalAccount) {
  const signature = await owner.signTypedData!({
    domain: registryDomain(p.chainId, p.registry),
    types: {
      Release: [
        { name: 'account', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Release',
    message: { account: owner.address, nonce: p.nonce, deadline: p.deadline },
  });
  return { account: owner.address, deadline: p.deadline.toString(), signature };
}

/**
 * The rules the PayeeRegistry contract applies to a name, checked before asking for a
 * signature: 3 to 32 characters, letters, digits, spaces and . ' & - only, no leading,
 * trailing or double spaces, at least one letter or digit.
 */
export function nameProblem(name: string): string | null {
  if (name.length < 3) return 'Use at least 3 characters.';
  if (name.length > 32) return 'Use 32 characters or fewer.';
  if (!/^[A-Za-z0-9 .'&-]+$/.test(name)) return "Use only letters, numbers, spaces and . ' & -";
  if (/^ | $|  /.test(name)) return 'No spaces at the start or end, and no double spaces.';
  if (!/[A-Za-z0-9]/.test(name)) return 'Include at least one letter or number.';
  return null;
}
