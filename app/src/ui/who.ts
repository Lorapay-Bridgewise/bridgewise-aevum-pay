import { shortAddress } from '../state/store';
import type { IconName } from './icons';

/**
 * Who a payee is, in the order that deserves the most trust: the name registered on chain
 * (PayeeRegistry), the name the person saved, the name the payee put in their own code.
 * Only a registered name gets the green mark. A code whose name does not match the registered
 * one gets a warning, because that is exactly what a fake code looks like.
 */
export type Who = {
  title: string;
  badge: { text: string; tone: 'green' | 'grey' | 'amber'; icon?: IconName };
  warning?: string;
  note?: string;
  registered: boolean;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function whoIs(o: { address: string; contactName?: string; sharedName?: string; registered?: string | null }): Who {
  const { address, contactName, sharedName, registered } = o;
  if (registered) {
    const w: Who = { title: registered, badge: { text: 'Registered name', tone: 'green', icon: 'shieldCheck' }, registered: true };
    if (sharedName && !same(sharedName, registered)) w.warning = `This code says "${sharedName}", but the registered name is "${registered}". Make sure you are paying the right person.`;
    else if (contactName && !same(contactName, registered)) w.note = `You saved them as "${contactName}".`;
    return w;
  }
  if (contactName) return { title: contactName, badge: { text: 'Saved in your contacts', tone: 'grey' }, registered: false };
  if (sharedName) return { title: sharedName, badge: { text: 'Name they shared. Check it with them.', tone: 'amber' }, registered: false };
  return { title: shortAddress(address), badge: { text: 'Not in your contacts', tone: 'grey' }, registered: false };
}
