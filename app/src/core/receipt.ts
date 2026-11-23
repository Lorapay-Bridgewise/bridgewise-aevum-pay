import { recoverTypedDataAddress, type Address, type Hex } from 'viem';
import type { AppConfig } from './config';

/** The settlement agent's answer (agent/src/messages.ts). */
export type SettlementStatus = 'submitted' | 'confirmed' | 'rejected' | 'retry' | 'unknown';

export type Receipt = {
  t: 'receipt';
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

const STATUS_CODE: Record<SettlementStatus, number> = { unknown: 0, submitted: 1, confirmed: 2, rejected: 3, retry: 4 };
const ZERO = `0x${'0'.repeat(64)}` as Hex;

export const RECEIPT_TYPES = {
  Receipt: [
    { name: 'sessionId', type: 'bytes32' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'status', type: 'uint8' },
    { name: 'reason', type: 'string' },
    { name: 'txHash', type: 'bytes32' },
    { name: 'fee', type: 'uint256' },
    { name: 'issuedAt', type: 'uint64' },
  ],
} as const;

/**
 * True only if the receipt was signed by our settlement agent, for this exact voucher. The mesh
 * Cloud and every relay phone carried it, so the phone trusts the signature, not the carrier.
 */
export async function isGenuineReceipt(
  cfg: Pick<AppConfig, 'chainId' | 'vault' | 'agentAddress'>,
  r: unknown,
  expect: { sessionId: Hex; nonce: Hex },
): Promise<boolean> {
  const x = r as Partial<Receipt> | null;
  if (!x || x.t !== 'receipt' || !x.sig || !x.status || !(x.status in STATUS_CODE) || typeof x.issuedAt !== 'number') {
    return false;
  }
  if (x.sessionId?.toLowerCase() !== expect.sessionId.toLowerCase() || x.nonce?.toLowerCase() !== expect.nonce.toLowerCase()) {
    return false;
  }
  try {
    const signer = await recoverTypedDataAddress({
      domain: { name: 'Bridgewise Settlement Agent', version: '1', chainId: cfg.chainId, verifyingContract: cfg.vault },
      types: RECEIPT_TYPES,
      primaryType: 'Receipt',
      message: {
        sessionId: x.sessionId as Hex,
        nonce: x.nonce as Hex,
        status: STATUS_CODE[x.status],
        reason: x.reason ?? '',
        txHash: x.txHash ?? ZERO,
        fee: BigInt(x.fee ?? '0'),
        issuedAt: BigInt(x.issuedAt),
      },
      signature: x.sig,
    });
    return signer.toLowerCase() === cfg.agentAddress.toLowerCase();
  } catch {
    return false;
  }
}

/** Words for the person, by the agent's reason codes. */
/** A settlement or vault reason in plain words, for the person paying. */
export function explainReason(reason?: string): string {
  switch (reason) {
    case 'OverPaymentCap':
      return 'It was more than this phone may pay at once.';
    case 'OverDailyCap':
      return "Your daily limit was reached. It will go through tomorrow.";
    case 'InsufficientBalance':
      return 'There was not enough money for it.';
    case 'SessionRevokedErr':
    case 'UnknownSession':
      return 'Offline pay was turned off on this phone.';
    case 'SessionExpired':
      return 'Offline pay on this phone needs renewing. Open the app once with signal.';
    case 'VoucherExpired':
      return 'It took too long to reach a phone with signal, so it was cancelled.';
    case 'VoucherReused':
      return 'This payment was already made.';
    case 'BadSignature':
      return 'It was changed on the way, so it was refused.';
    case 'FeeTooLow':
    case 'FeeTooHigh':
      return 'The fee did not match. Please pay again.';
    case 'RateLimited':
    case 'AgentDailyCapReached':
    case 'AgentGasBudgetReached':
      return 'The payment service is busy. It will try again.';
    case 'ChainUnavailable':
      return 'The network could not be reached. It will try again.';
    case 'SettledByOther':
      return '';
    default:
      return reason ? 'Something went wrong on the network.' : '';
  }
}
