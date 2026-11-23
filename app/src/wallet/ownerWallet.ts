import * as Keychain from 'react-native-keychain';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { Hex } from 'viem';

/**
 * The person's own wallet: a normal Ethereum key, kept encrypted with a key held in Android
 * Keystore (react-native-keychain). It only signs; the settlement agent submits and pays gas.
 * Testnet only: there is no backup phrase in this version.
 */
const SERVICE = 'io.bridgewise.aevumpay.owner_key';

let cached: PrivateKeyAccount | null = null;

export async function ownerWallet(): Promise<PrivateKeyAccount> {
  if (cached) {
    return cached;
  }
  const found = await Keychain.getGenericPassword({ service: SERVICE });
  let key = found ? (found.password as Hex) : null;
  if (!key) {
    key = generatePrivateKey();
    const ok = await Keychain.setGenericPassword('owner', key, { service: SERVICE });
    if (!ok) {
      throw new Error('Could not save your wallet key securely on this phone.');
    }
  }
  cached = privateKeyToAccount(key);
  return cached;
}

/** Tests only */
export function resetOwnerWalletCache() {
  cached = null;
}
