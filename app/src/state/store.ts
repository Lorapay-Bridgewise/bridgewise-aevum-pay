import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Address, Hex } from 'viem';
import type { VoucherMessage } from '../core/voucher';

/**
 * What the app keeps on the phone, so it works offline: the last wallet state it read online,
 * the phone key's session, and every payment with where it got to. Amounts are decimal strings
 * (JSON has no bigint).
 */
export type PaymentStatus =
  | 'signed' // signed on this phone, not handed to the mesh yet
  | 'waiting' // handed to the mesh; no answer yet (no phone with signal nearby)
  | 'submitted' // the agent sent it to the chain
  | 'confirmed' // on chain: the payee has the money
  | 'rejected'; // it will never settle; see reason

export type Payment = {
  id: Hex; // the voucher nonce
  payee: Address;
  /** The name shown when paying, if the payee was a contact or shared one in their code */
  payeeName?: string;
  amount: string;
  maxFee: string;
  createdAt: number;
  status: PaymentStatus;
  reason?: string;
  txHash?: Hex;
  fee?: string;
  attempts: number;
  lastTriedAt?: number;
  /** Nearby phones it last reached */
  peers?: number;
  message: VoucherMessage;
};

export type Snapshot = {
  walletUnits: string;
  vaultUnits: string;
  tokenNonce: string;
  ownerNonce: string;
  session: null | {
    expiresAt: string;
    revoked: boolean;
    perPaymentCap: string;
    dailyCap: string;
    remainingToday: string;
  };
  readAt: number;
};

export type SessionSetup = {
  sessionId: Hex;
  keyAlias: string;
  hardware: boolean;
  /** The key signs only after the person's fingerprint or screen lock (Keystore enforces it) */
  protected?: boolean;
};

/**
 * Someone the person pays. name is what the person saved, or what the payee shared in their
 * code; neither is checked by anyone, so the app never calls it verified.
 */
export type Contact = { address: Address; name: string; addedAt: number; lastPaidAt?: number };

/** Money someone paid this wallet, as the agent saw it on chain. */
export type Incoming = { id: string; amount: string; from: Address | null; fromName: string | null; at: number; txHash: Hex };

/** A registered name (PayeeRegistry) as last read, kept for when the phone is offline. */
export type KnownName = { name: string | null; checkedAt: number };

export type Settings = {
  /** Open the app with the fingerprint instead of the PIN */
  biometricUnlock: boolean;
  /** Refuse to pay anyone without a registered name (checked from the saved copy when offline) */
  onlyRegistered?: boolean;
  /** Show addresses and network links */
  showTechnical: boolean;
};

type State = {
  /** The name this person shows others in their code */
  name: string;
  /** Welcome, setup and PIN done */
  onboarded: boolean;
  contacts: Contact[];
  settings: Settings;
  incoming: Incoming[];
  /** Registered names by lower case address */
  names: Record<string, KnownName>;
  /** The agent's registry, if it has one (null: none; undefined: not asked yet) */
  registry?: Address | null;
  owner: Address | null;
  session: SessionSetup | null;
  snapshot: Snapshot | null;
  payments: Payment[];
  online: boolean;
  setName(n: string): void;
  setOnboarded(o: boolean): void;
  saveContact(c: { address: Address; name: string }): void;
  removeContact(a: Address): void;
  touchContact(a: Address, at: number): void;
  setSettings(patch: Partial<Settings>): void;
  setIncoming(list: Incoming[]): void;
  rememberName(a: Address, name: string | null, at: number): void;
  setRegistry(r: Address | null): void;
  setOwner(a: Address): void;
  setSession(s: SessionSetup | null): void;
  setSnapshot(s: Snapshot): void;
  setOnline(o: boolean): void;
  addPayment(p: Payment): void;
  updatePayment(id: Hex, patch: Partial<Payment>): void;
};

export const useApp = create<State>()(
  persist(
    set => ({
      name: '',
      onboarded: false,
      contacts: [],
      settings: { biometricUnlock: true, showTechnical: false },
      setName: name => set({ name: name.trim().slice(0, 40) }),
      setOnboarded: onboarded => set({ onboarded }),
      saveContact: c =>
        set(s => {
          const same = (x: Contact) => x.address.toLowerCase() === c.address.toLowerCase();
          const name = c.name.trim().slice(0, 40);
          const old = s.contacts.find(same);
          const next: Contact = old ? { ...old, name: name || old.name } : { address: c.address, name, addedAt: Date.now() };
          return { contacts: [next, ...s.contacts.filter(x => !same(x))] };
        }),
      removeContact: a => set(s => ({ contacts: s.contacts.filter(x => x.address.toLowerCase() !== a.toLowerCase()) })),
      touchContact: (a, at) =>
        set(s => ({ contacts: s.contacts.map(x => (x.address.toLowerCase() === a.toLowerCase() ? { ...x, lastPaidAt: at } : x)) })),
      setSettings: patch => set(s => ({ settings: { ...s.settings, ...patch } })),
      incoming: [],
      names: {},
      setIncoming: incoming => set({ incoming: incoming.slice(0, 100) }),
      rememberName: (a, name, at) => set(s => ({ names: { ...s.names, [a.toLowerCase()]: { name, checkedAt: at } } })),
      setRegistry: registry => set({ registry }),
      owner: null,
      session: null,
      snapshot: null,
      payments: [],
      online: false,
      setOwner: owner => set({ owner }),
      setSession: session => set({ session }),
      setSnapshot: snapshot => set({ snapshot }),
      setOnline: online => set({ online }),
      addPayment: p => set(s => ({ payments: [p, ...s.payments] })),
      updatePayment: (id, patch) =>
        set(s => ({ payments: s.payments.map(p => (p.id.toLowerCase() === id.toLowerCase() ? { ...p, ...patch } : p)) })),
    }),
    {
      name: 'aevum-pay-state-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: s => ({
        name: s.name,
        onboarded: s.onboarded,
        contacts: s.contacts,
        settings: s.settings,
        incoming: s.incoming,
        names: s.names,
        registry: s.registry,
        owner: s.owner,
        session: s.session,
        snapshot: s.snapshot,
        payments: s.payments,
      }),
    },
  ),
);

export function isFinal(s: PaymentStatus) {
  return s === 'confirmed' || s === 'rejected';
}

/** The contact for an address, if the person saved one. */
export function contactFor(contacts: Contact[], a: Address | string): Contact | undefined {
  return contacts.find(c => c.address.toLowerCase() === a.toLowerCase());
}

/** A short form of an address for people who asked to see it: 0xA3Aa…DC81 */
export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** The registered name of an address from the saved copy: a string, null (none), or undefined (never checked). */
export function registeredName(names: Record<string, KnownName>, a: Address | string): string | null | undefined {
  const k = names[a.toLowerCase()];
  return k ? k.name : undefined;
}
