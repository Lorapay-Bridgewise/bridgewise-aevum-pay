import { explainReason } from '../core/receipt';
import { shortAddress, type Payment } from '../state/store';

/** How a payment reads to the person: three states, plain words. */
export type Look = 'sending' | 'paid' | 'failed';

export function lookOf(p: Payment): Look {
  if (p.status === 'confirmed') return 'paid';
  if (p.status === 'rejected') return 'failed';
  return 'sending';
}

export const lookWords: Record<Look, string> = { sending: 'On its way', paid: 'Paid', failed: 'Could not be paid' };
export const lookTone = { sending: 'amber', paid: 'green', failed: 'red' } as const;

export function payeeLabel(p: Pick<Payment, 'payee' | 'payeeName'>): string {
  return p.payeeName || shortAddress(p.payee);
}

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** "Today, 7:42 PM", "Yesterday", "Thu 20 Nov" */
export function whenText(ms: number, now = Date.now()): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(ms) === day(now)) return `Today, ${time(ms)}`;
  if (day(ms) === day(now - 86_400_000)) return 'Yesterday';
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function headline(p: Payment): { title: string; sub: string } {
  const who = payeeLabel(p);
  switch (lookOf(p)) {
    case 'paid':
      return { title: 'Paid', sub: `${who} has the money.` };
    case 'failed':
      return { title: 'Could not be paid', sub: `${explainReason(p.reason) || 'It was refused.'} No money left your wallet.` };
    default:
      return {
        title: 'On its way',
        sub:
          p.status === 'submitted'
            ? 'It reached the network and is being settled now.'
            : 'You can close the app. It keeps trying until a phone nearby has signal.',
      };
  }
}

export type TimelineStep = { title: string; when: string; done: boolean; current: boolean };

/** Signed, passed on, arrived: what happened so far. */
export function timeline(p: Payment): TimelineStep[] {
  const look = lookOf(p);
  const passed = p.status !== 'signed';
  const steps: TimelineStep[] = [
    { title: 'Signed on your phone', when: whenText(p.createdAt), done: true, current: false },
    {
      title: p.status === 'submitted' || look !== 'sending' ? 'Reached the network' : 'Passing to nearby phones',
      when: passed ? (p.lastTriedAt ? whenText(p.lastTriedAt) : '') : 'Looking for a phone nearby',
      done: passed && (p.status === 'submitted' || look !== 'sending'),
      current: look === 'sending' && p.status !== 'submitted',
    },
  ];
  if (look === 'failed') steps.push({ title: 'Not accepted', when: explainReason(p.reason), done: false, current: true });
  else
    steps.push({
      title: 'Money arrived',
      when: look === 'paid' ? whenText(p.lastTriedAt ?? p.createdAt) : 'Waiting for a phone with signal',
      done: look === 'paid',
      current: p.status === 'submitted',
    });
  return steps;
}
