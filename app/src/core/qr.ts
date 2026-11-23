import { getAddress, isAddress, type Address } from 'viem';
import { parseAmount } from './money';

/**
 * What an Aevum Pay code holds: the wallet address, the name the person chose, and optionally an
 * amount they ask for. aevumpay:0xAbc…?name=Ada&amount=1.20
 *
 * The name is what the person typed about themselves: the app shows it as "Name they shared",
 * never as verified.
 */
export type PayCode = { address: Address; name?: string; amount?: bigint };

export function encodePayCode(c: { address: Address; name?: string; amount?: bigint | null }, format: (u: bigint) => string): string {
  const q: string[] = [];
  if (c.name) q.push(`name=${encodeURIComponent(c.name.slice(0, 40))}`);
  if (c.amount && c.amount > 0n) q.push(`amount=${format(c.amount)}`);
  return `aevumpay:${c.address}${q.length ? `?${q.join('&')}` : ''}`;
}

/** Reads our own codes, a bare address, or an EIP-681 "ethereum:" link. Null for anything else. */
export function parsePayCode(raw: string): PayCode | null {
  const text = raw.trim();
  const m = /^(?:aevumpay:|ethereum:)?(0x[0-9a-fA-F]{40})(?:@\d+)?(?:\?(.*))?$/.exec(text);
  if (!m || !isAddress(m[1], { strict: false })) return null;
  const out: PayCode = { address: getAddress(m[1]) };
  for (const part of (m[2] ?? '').split('&')) {
    const [k, v = ''] = part.split('=');
    let value = '';
    try {
      value = decodeURIComponent(v);
    } catch {
      continue;
    }
    if (k === 'name') {
      const name = value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
      if (name) out.name = name;
    }
    if (k === 'amount') {
      const a = parseAmount(value);
      if (a && a > 0n) out.amount = a;
    }
  }
  return out;
}
