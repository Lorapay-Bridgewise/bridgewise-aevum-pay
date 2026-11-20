import { z } from "zod";
import type { Address, Hex } from "viem";

/**
 * Messages between the phone and the agent. They travel as the `body` of a Bridgewise Mesh
 * app data message (at most 2048 bytes), JSON encoded. Amounts are decimal strings in tUSD8 units.
 */

const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const uint = z.string().regex(/^[0-9]{1,78}$/);

export const VOUCHER_CT = "application/vnd.bwpay.voucher+json";
export const STATUS_CT = "application/vnd.bwpay.status+json";
export const RECEIPT_CT = "application/vnd.bwpay.receipt+json";

export const voucherMessage = z.object({
  t: z.literal("voucher"),
  chainId: z.number().int(),
  vault: address,
  v: z.object({
    sessionId: bytes32,
    payee: address,
    amount: uint,
    maxFee: uint,
    nonce: bytes32,
    validBefore: z.number().int().nonnegative(),
  }),
  r: bytes32,
  s: bytes32,
});

export const statusMessage = z.object({
  t: z.literal("status"),
  sessionId: bytes32,
  nonce: bytes32,
});

export const phoneMessage = z.discriminatedUnion("t", [voucherMessage, statusMessage]);

export type VoucherMessage = z.infer<typeof voucherMessage>;
export type StatusMessage = z.infer<typeof statusMessage>;

export type Voucher = {
  sessionId: Hex;
  payee: Address;
  amount: bigint;
  maxFee: bigint;
  nonce: Hex;
  validBefore: bigint;
};

export function toVoucher(m: VoucherMessage): Voucher {
  return {
    sessionId: m.v.sessionId as Hex,
    payee: m.v.payee as Address,
    amount: BigInt(m.v.amount),
    maxFee: BigInt(m.v.maxFee),
    nonce: m.v.nonce as Hex,
    validBefore: BigInt(m.v.validBefore),
  };
}

/**
 * - submitted: sent to the chain, not yet mined. Ask again with a status message.
 * - confirmed: mined; the payee has the money.
 * - rejected: the vault refused it (see reason). It will never settle.
 * - retry: the agent could not reach the chain. Send the same voucher again later; it is safe.
 * - unknown: the agent has never seen this voucher.
 */
export type SettlementStatus = "submitted" | "confirmed" | "rejected" | "retry" | "unknown";

export type Receipt = {
  t: "receipt";
  sessionId: Hex;
  nonce: Hex;
  status: SettlementStatus;
  reason?: string;
  txHash?: Hex;
  block?: string;
  fee?: string;
  agent: Address;
  issuedAt: number;
  sig?: Hex;
};
