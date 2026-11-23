/** tUSD8 has 6 decimals. Amounts are bigint units everywhere; text only at the edges. */
export const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);

/** "1.5" → 1500000n. Null for anything that is not a plain positive amount with at most 6 decimals. */
export function parseAmount(text: string): bigint | null {
  const t = text.trim().replace(/,/g, '');
  const m = /^(\d{1,12})(?:\.(\d{0,6}))?$/.exec(t);
  if (!m) {
    return null;
  }
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? '').padEnd(DECIMALS, '0') || '0');
  return whole * UNIT + frac;
}

/** 1500000n → "1.50", 1234567n → "1.234567". At least two decimals, no trailing zeros past them. */
export function formatAmount(units: bigint): string {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const whole = (v / UNIT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (v % UNIT).toString().padStart(DECIMALS, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/**
 * tUSD8 is a test dollar, so the app shows dollars: 1500000n → "$1.50". Cents are rounded
 * down, so the app never shows more than is there. A small non zero amount shows as "under $0.01".
 */
export function usd(units: bigint): string {
  const neg = units < 0n;
  const v = neg ? -units : units;
  if (v > 0n && v < UNIT / 100n) return `${neg ? '-' : ''}under $0.01`;
  const cents = v / (UNIT / 100n);
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (cents % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}$${whole}.${frac}`;
}

/** Whole dollars without cents when there are none: "$5", "$2.50". For limits. */
export function usdShort(units: bigint): string {
  const s = usd(units);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}

/** A fee in plain words: 20000n → "2 cents", 1000000n → "$1.00". */
export function feeWords(units: bigint): string {
  const cents = units / (UNIT / 100n);
  if (units < UNIT) return cents === 1n ? '1 cent' : `${cents} cents`;
  return usd(units);
}

/**
 * What the amount keypad builds: digits, one point, two decimals at most, no leading zeros.
 * Returns the new text, or the old one when the key would make it invalid.
 */
export function keypadInput(text: string, key: string): string {
  if (key === 'back') return text.slice(0, -1);
  if (key === '.') return text.includes('.') ? text : (text === '' ? '0.' : `${text}.`);
  if (!/^\d$/.test(key)) return text;
  if (text === '0') return key;
  const [, frac] = text.split('.');
  if (frac !== undefined && frac.length >= 2) return text;
  if (!text.includes('.') && text.length >= 6) return text;
  return text + key;
}
