import type { Hex } from 'viem';

/** Amounts travel between screens as unit strings (navigation params must be plain JSON). */
export type RootStack = {
  // First run
  Welcome: undefined;
  Setup: undefined;
  CreatePin: undefined;
  // Locked
  Lock: undefined;
  // The app
  Tabs: undefined;
  Scan: undefined;
  Amount: { address: string; name?: string; amount?: string };
  Confirm: { address: string; name?: string; amount: string };
  Payment: { id: Hex; fresh?: boolean };
  Receive: undefined;
  AddContact: { address?: string; name?: string } | undefined;
  Limits: undefined;
  Activity: undefined;
};

export type Tabs = {
  Home: undefined;
  Contacts: undefined;
  Safety: undefined;
};
