import { feeWords, keypadInput, usd, usdShort } from '../src/core/money';
import { encodePayCode, parsePayCode } from '../src/core/qr';
import { formatAmount } from '../src/core/money';
import { checkPin, clearPin, isWeakPin, setPin } from '../src/security/pin';
import { LOCK_AFTER_MS, useLock } from '../src/app/lock';

const ADDR = '0xA3AaA23EC0e8BEF5C83a9ea59cD2f4127Fd8DC81';

describe('money in plain dollars', () => {
  test('shows dollars and cents, rounding down', () => {
    expect(usd(1_500_000n)).toBe('$1.50');
    expect(usd(1_234_567n)).toBe('$1.23');
    expect(usd(12_345_000_000n)).toBe('$12,345.00');
    expect(usd(5_000n)).toBe('under $0.01');
    expect(usd(0n)).toBe('$0.00');
    expect(usdShort(5_000_000n)).toBe('$5');
    expect(feeWords(20_000n)).toBe('2 cents');
    expect(feeWords(10_000n)).toBe('1 cent');
  });

  test('the keypad builds amounts with at most two decimals', () => {
    const type = (keys: string[]) => keys.reduce((t, k) => keypadInput(t, k), '');
    expect(type(['1', '.', '5', '0', '9'])).toBe('1.50');
    expect(type(['.', '5'])).toBe('0.5');
    expect(type(['0', '7'])).toBe('7');
    expect(type(['1', '.', '.', '2'])).toBe('1.2');
    expect(type(['9', '9', '9', '9', '9', '9', '9'])).toBe('999999');
    expect(type(['4', '2', 'back'])).toBe('4');
  });
});

describe('payment codes', () => {
  test('round trip with a name and an amount', () => {
    const code = encodePayCode({ address: ADDR, name: "Musa's Kiosk", amount: 1_200_000n }, formatAmount);
    expect(code).toBe(`aevumpay:${ADDR}?name=Musa's%20Kiosk&amount=1.20`);
    expect(parsePayCode(code)).toEqual({ address: ADDR, name: "Musa's Kiosk", amount: 1_200_000n });
  });

  test('reads a bare address and an EIP-681 link, and refuses anything else', () => {
    expect(parsePayCode(ADDR.toLowerCase())).toEqual({ address: ADDR });
    expect(parsePayCode(`ethereum:${ADDR}@44005`)).toEqual({ address: ADDR });
    expect(parsePayCode('https://example.com')).toBeNull();
    expect(parsePayCode('0x1234')).toBeNull();
    expect(parsePayCode(`aevumpay:${ADDR}?amount=-3&name=%E0%A4%A`)?.amount).toBeUndefined();
  });
});

describe('the app PIN', () => {
  beforeEach(clearPin);

  test('checks the PIN and waits after five wrong tries', async () => {
    await setPin('135790');
    expect(await checkPin('135790')).toEqual({ ok: true });
    for (let i = 4; i >= 1; i--) expect(await checkPin('000000')).toEqual({ ok: false, triesLeft: i, waitSec: 0 });
    const fifth = await checkPin('000000');
    expect(fifth).toMatchObject({ ok: false, triesLeft: 0 });
    expect((fifth as { waitSec: number }).waitSec).toBe(30);
    expect((await checkPin('135790')).ok).toBe(false); // still waiting, even with the right PIN
    expect((await checkPin('135790', Date.now() + 31_000)).ok).toBe(true);
  });

  test('refuses easy PINs', () => {
    expect(isWeakPin('111111')).toBe(true);
    expect(isWeakPin('123456')).toBe(true);
    expect(isWeakPin('654321')).toBe(true);
    expect(isWeakPin('135790')).toBe(false);
  });
});

test('the app locks again after a minute in the background', () => {
  useLock.setState({ locked: false, hiddenAt: null });
  useLock.getState().hidden(1_000);
  useLock.getState().shown(1_000 + LOCK_AFTER_MS - 1);
  expect(useLock.getState().locked).toBe(false);
  useLock.getState().hidden(5_000);
  useLock.getState().shown(5_000 + LOCK_AFTER_MS + 1);
  expect(useLock.getState().locked).toBe(true);
});
