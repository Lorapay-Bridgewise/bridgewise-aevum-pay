import { create } from 'zustand';

/**
 * Whether the app is locked. Not saved: every cold start begins locked, and the app locks again
 * after LOCK_AFTER_MS in the background.
 */
export const LOCK_AFTER_MS = 60_000;

type Lock = { locked: boolean; hiddenAt: number | null; unlock(): void; lock(): void; hidden(at: number): void; shown(at: number): void };

export const useLock = create<Lock>()(set => ({
  locked: true,
  hiddenAt: null,
  unlock: () => set({ locked: false, hiddenAt: null }),
  lock: () => set({ locked: true }),
  hidden: at => set(s => ({ hiddenAt: s.hiddenAt ?? at })),
  shown: at => set(s => ({ hiddenAt: null, locked: s.locked || (s.hiddenAt !== null && at - s.hiddenAt > LOCK_AFTER_MS) })),
}));
