import { NativeModules, Platform } from 'react-native';
import { p256 } from '@noble/curves/nist.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { PhoneSigner } from '../core/voucher';

/**
 * The phone's offline payment key, in Android Keystore
 * (android/app/src/main/java/io/bridgewise/aevumpay/keystore/KeystoreModule.kt).
 */
type NativeKeystore = {
  publicKey(alias: string, requireAuth: boolean): string;
  sign(alias: string, messageHex: string): string;
  delete(alias: string): boolean;
  isHardwareBacked(alias: string): boolean;
  needsAuth(alias: string): boolean;
  authKind(): AuthKind;
  authenticate(title: string, subtitle: string): Promise<boolean>;
};

/**
 * How this phone confirms a payment: its fingerprint or face (with the phone's PIN as fallback),
 * its screen lock only, or nothing (no screen lock: the app's own PIN is the only check).
 */
export type AuthKind = 'biometric' | 'credential' | 'none';

/** hardware: the key is in secure hardware. protected: it signs only after the person unlocks it. */
export type KeySigner = PhoneSigner & { alias: string; hardware: boolean; protected: boolean };

export function nativeKeystore(): NativeKeystore | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  return (NativeModules as { AevumKeystore?: NativeKeystore }).AevumKeystore ?? null;
}

/**
 * The Keystore key for `alias` (made on first use). Only used once a signature by it checks out
 * against its public key, the same check the vault will do.
 */
export function keystoreSigner(native: NativeKeystore, alias: string): KeySigner {
  const publicKey = hexToBytes(native.publicKey(alias, true));
  const signer: KeySigner = {
    alias,
    publicKey,
    hardware: safe(() => native.isHardwareBacked(alias), false),
    protected: safe(() => native.needsAuth(alias), false),
    sign: message => hexToBytes(native.sign(alias, bytesToHex(message))),
  };
  const probe = utf8ToBytes('aevum-pay-keystore-check');
  const sig = signer.sign(probe) as Uint8Array;
  if (publicKey.length !== 65 || sig.length !== 64 || !p256.verify(sig, probe, publicKey, { lowS: false })) {
    throw new Error('This phone could not make a working payment key in its secure storage.');
  }
  return signer;
}

/** A software key, for builds without the native module (tests). Never used for real money. */
export function softwareSigner(alias: string, secret = p256.utils.randomSecretKey()): KeySigner {
  return {
    alias,
    publicKey: p256.getPublicKey(secret, false),
    hardware: false,
    protected: false,
    sign: message => p256.sign(message, secret, { prehash: true, lowS: false }),
  };
}

export function authKind(): AuthKind {
  const native = nativeKeystore();
  return native ? safe(() => native.authKind(), 'none') : 'none';
}

/**
 * The phone's own fingerprint or screen lock prompt. True when the person passed it. After that,
 * a protected key may sign for 30 seconds.
 */
export async function unlockPhoneKey(title: string, subtitle: string): Promise<boolean> {
  const native = nativeKeystore();
  if (!native || authKind() === 'none') return false;
  try {
    return await native.authenticate(title, subtitle);
  } catch {
    return false;
  }
}

export function deletePhoneKey(alias: string): void {
  const native = nativeKeystore();
  if (native) {
    safe(() => native.delete(alias), false);
  }
}

function safe<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch {
    return fallback;
  }
}
