import * as Keychain from 'react-native-keychain';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * The app's own 6 digit PIN. It opens the app, and confirms payments on a phone with no screen
 * lock (where Keystore cannot tie the payment key to a fingerprint). Only a salted PBKDF2 hash is
 * kept, in the keychain. After 5 wrong tries the app waits, longer each time.
 */
const SERVICE = 'io.bridgewise.aevumpay.pin';
/**
 * Kept low on purpose: React Native runs this in plain JavaScript on the UI's thread, and a debug
 * build on a mid range phone took many seconds at 10,000. The record is already encrypted by a
 * Keystore key that never leaves the phone, so the hash is a second layer, not the main one.
 * Each record keeps its own count, so older PINs still check.
 */
const ITERATIONS = 1_000;
export const PIN_LENGTH = 6;
const FREE_TRIES = 5;

type Saved = { salt: string; hash: string; iterations: number; wrong: number; lockedUntil: number };

async function read(): Promise<Saved | null> {
  const found = await Keychain.getGenericPassword({ service: SERVICE });
  if (!found) return null;
  try {
    return JSON.parse(found.password) as Saved;
  } catch {
    return null;
  }
}

async function write(s: Saved) {
  const ok = await Keychain.setGenericPassword('pin', JSON.stringify(s), { service: SERVICE });
  if (!ok) throw new Error('Could not save your PIN on this phone.');
}

const derive = (pin: string, salt: Uint8Array, iterations: number) =>
  bytesToHex(pbkdf2(sha256, utf8ToBytes(pin), salt, { c: iterations, dkLen: 32 }));

export const isValidPin = (pin: string) => new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);

/** Too easy to guess: all one digit, or a straight run like 123456. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const up = '01234567890';
  const down = '09876543210';
  return up.includes(pin) || down.includes(pin);
}

export async function hasPin(): Promise<boolean> {
  return (await read()) !== null;
}

/** Lets the screen draw its "checking" state before the hashing holds the JavaScript thread. */
const nextFrame = () => new Promise<void>(r => setTimeout(r, 30));

export async function setPin(pin: string): Promise<void> {
  await nextFrame();
  if (!isValidPin(pin)) throw new Error(`The PIN must be ${PIN_LENGTH} digits.`);
  const salt = randomBytes(16);
  await write({ salt: bytesToHex(salt), hash: derive(pin, salt, ITERATIONS), iterations: ITERATIONS, wrong: 0, lockedUntil: 0 });
}

export type PinCheck = { ok: true } | { ok: false; triesLeft: number; waitSec: number };

export async function checkPin(pin: string, now = Date.now()): Promise<PinCheck> {
  await nextFrame();
  const s = await read();
  if (!s) return { ok: false, triesLeft: 0, waitSec: 0 };
  if (now < s.lockedUntil) return { ok: false, triesLeft: 0, waitSec: Math.ceil((s.lockedUntil - now) / 1000) };
  const match = derive(pin, hexToBytes(s.salt), s.iterations) === s.hash;
  if (match) {
    if (s.wrong) await write({ ...s, wrong: 0, lockedUntil: 0 });
    return { ok: true };
  }
  const wrong = s.wrong + 1;
  const over = wrong - FREE_TRIES;
  const lockedUntil = over >= 0 ? now + 30_000 * 2 ** Math.min(over, 8) : 0;
  await write({ ...s, wrong, lockedUntil });
  return { ok: false, triesLeft: Math.max(0, FREE_TRIES - wrong), waitSec: lockedUntil ? Math.ceil((lockedUntil - now) / 1000) : 0 };
}

/** Tests only */
export async function clearPin() {
  await Keychain.resetGenericPassword({ service: SERVICE });
}
