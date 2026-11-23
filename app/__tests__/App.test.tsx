import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import App from '../App';
import { useLock } from '../src/app/lock';
import { setMeshForTests } from '../src/mesh';
import { addThisPhone } from '../src/payments/engine';
import { clearPin, setPin } from '../src/security/pin';
import { useApp } from '../src/state/store';
import { chain, makeWorld, ONE, PAYEE, phone, receiptFor, REGISTRY, resetState, STRANGER } from './helpers/world';

const STRANGER_ADDRESS = STRANGER.address;

beforeEach(async () => {
  resetState();
  useLock.setState({ locked: true, hiddenAt: null });
  await clearPin();
});

async function typeKeys(keys: string) {
  for (const k of keys) await fireEvent.press(screen.getByTestId(`key-${k}`));
}

/** A phone that finished first run, with offline pay on and the app unlocked. */
async function readyPhone() {
  const w = makeWorld();
  setMeshForTests(w.mesh);
  await addThisPhone(w.deps, { perPaymentCap: 2n * ONE, dailyCap: 3n * ONE, expiresAt: chain.session.expiresAt });
  await setPin('135790');
  useApp.setState({ onboarded: true, name: 'Ada' });
  useApp.getState().saveContact({ address: PAYEE, name: "Musa's Kiosk" });
  useLock.getState().unlock();
  phone.prompts.length = 0;
  return w;
}

test('first run: welcome, one tap setup, a PIN, then home', async () => {
  const w = makeWorld();
  setMeshForTests(w.mesh);
  await render(<App deps={w.deps} />);

  await fireEvent.press(await screen.findByTestId('get-started'));
  await fireEvent.changeText(await screen.findByTestId('name'), 'Ada');
  await fireEvent.press(screen.getByTestId('start-setup'));

  await screen.findByTestId('setup-continue');
  expect(screen.getByTestId('step-wallet-done')).toBeTruthy();
  expect(screen.getByTestId('step-money-done')).toBeTruthy();
  expect(screen.getByTestId('step-offline-done')).toBeTruthy();
  expect(phone.prompts).toEqual(['Turn on offline pay']);
  expect(w.relayed.map(r => r.path).filter(p => p.startsWith('/v1/owner') || p === '/v1/starter')).toEqual(['/v1/owner/deposit', '/v1/owner/session']);

  await fireEvent.press(screen.getByTestId('setup-continue'));
  expect(await screen.findByText('Create a 6 digit PIN')).toBeTruthy();
  await typeKeys('123456');
  expect(await screen.findByText('That PIN is easy to guess. Choose another.')).toBeTruthy();
  await typeKeys('135790');
  expect(await screen.findByText('Type your PIN again')).toBeTruthy();
  await typeKeys('135790');

  expect(await screen.findByTestId('home')).toBeTruthy();
  expect(screen.getByText('Ada')).toBeTruthy();
  expect(screen.getByLabelText('Balance $9.00')).toBeTruthy(); // 4 ready + 5 in the (pretend) wallet
});

test('a brand new wallet gets starter money from the agent', async () => {
  const w = makeWorld();
  setMeshForTests(w.mesh);
  chain.walletUnits = 0n;
  chain.vaultUnits = 0n;
  await render(<App deps={w.deps} />);
  await fireEvent.press(await screen.findByTestId('get-started'));
  await fireEvent.changeText(await screen.findByTestId('name'), 'Ada');
  await fireEvent.press(screen.getByTestId('start-setup'));
  await screen.findByTestId('setup-continue');
  expect(w.relayed.find(r => r.path.startsWith('/v1/owner') || r.path === '/v1/starter')!.path).toBe('/v1/starter');
  // the pretend chain never receives the gift, so the step says so instead of pretending
  expect(screen.getByTestId('step-money-skipped')).toBeTruthy();
});

test('pays a contact with the fingerprint and shows it paid', async () => {
  const w = await readyPhone();
  w.mesh.answerData(body => receiptFor(body, 'confirmed', { txHash: `0x${'ef'.repeat(32)}`, fee: '10000' }));
  await render(<App deps={w.deps} />);

  await fireEvent.press(await screen.findByTestId('go-contacts'));
  await fireEvent.press(await screen.findByLabelText("Pay Musa's Kiosk"));
  await typeKeys('1.5');
  expect(screen.getByLabelText('Amount $1.50')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('amount-continue'));

  expect(await screen.findByText('Check before you pay')).toBeTruthy();
  expect(screen.getByText('2 cents at most')).toBeTruthy();
  expect(screen.getByText('$1.52')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('confirm-pay'));

  expect(await screen.findByTestId('look-paid')).toBeTruthy();
  expect(screen.getByText("Musa's Kiosk has the money.")).toBeTruthy();
  expect(phone.prompts).toEqual(['Confirm payment']);
  expect(w.mesh.sentData).toHaveLength(1);
});

test('nothing is sent when the fingerprint is not given', async () => {
  const w = await readyPhone();
  phone.passes = false;
  await render(<App deps={w.deps} />);
  await fireEvent.press(await screen.findByTestId('go-contacts'));
  await fireEvent.press(await screen.findByLabelText("Pay Musa's Kiosk"));
  await typeKeys('1');
  await fireEvent.press(screen.getByTestId('amount-continue'));
  await fireEvent.press(await screen.findByTestId('confirm-pay'));
  expect(await screen.findByText('Payment not confirmed. Nothing was sent.')).toBeTruthy();
  expect(w.mesh.sentData).toHaveLength(0);
  expect(useApp.getState().payments).toHaveLength(0);
});

test('on a phone with no screen lock, the app PIN confirms the payment', async () => {
  phone.auth = 'none';
  const w = await readyPhone();
  phone.auth = 'none';
  w.mesh.answerData(body => receiptFor(body, 'confirmed'));
  await render(<App deps={w.deps} />);
  await fireEvent.press(await screen.findByTestId('go-contacts'));
  await fireEvent.press(await screen.findByLabelText("Pay Musa's Kiosk"));
  await typeKeys('1');
  await fireEvent.press(screen.getByTestId('amount-continue'));
  expect(await screen.findByText('Enter your PIN to pay')).toBeTruthy();
  await typeKeys('000000');
  expect(await screen.findByText('Wrong PIN. Nothing was sent.')).toBeTruthy();
  await typeKeys('135790');
  expect(await screen.findByTestId('look-paid')).toBeTruthy();
  expect(phone.prompts).toEqual([]);
});

test('the lock screen opens with the PIN, and says how many tries are left', async () => {
  const w = await readyPhone();
  useApp.getState().setSettings({ biometricUnlock: false });
  useLock.getState().lock();
  await render(<App deps={w.deps} />);
  expect(await screen.findByText('Welcome back, Ada')).toBeTruthy();
  await typeKeys('111111');
  expect(await screen.findByText('Wrong PIN. 4 tries left before a wait.')).toBeTruthy();
  await typeKeys('135790');
  await waitFor(() => expect(screen.getByTestId('home')).toBeTruthy());
});

test('shows the registered name, warns when a code claims another, and can refuse unregistered payees', async () => {
  const w = await readyPhone();
  useApp.setState({ contacts: [] });
  w.replies.push(path => {
    if (path === '/v1/config') return { json: { registry: REGISTRY } };
    if (path === `/v1/names/${PAYEE}`) return { json: { address: PAYEE, name: "Musa's Kiosk" } };
    if (path.startsWith('/v1/names/')) return { json: { name: null } };
    return undefined;
  });
  await render(<App deps={w.deps} />);

  Clipboard.setString(`aevumpay:${PAYEE}?name=Musa%20Foods`);
  await fireEvent.press(await screen.findByTestId('go-scan'));
  await fireEvent.press(await screen.findByTestId('paste-address'));
  expect(await screen.findByText("Musa's Kiosk")).toBeTruthy();
  expect(screen.getByText('Registered name')).toBeTruthy();
  expect(screen.getByText(/This code says "Musa Foods", but the registered name is "Musa's Kiosk"/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Back'));

  useApp.getState().setSettings({ onlyRegistered: true });
  Clipboard.setString(STRANGER_ADDRESS);
  await fireEvent.press(await screen.findByTestId('go-scan'));
  await fireEvent.press(await screen.findByTestId('paste-address'));
  expect(await screen.findByText('You chose to pay only registered names. This person has no registered name.')).toBeTruthy();
  await typeKeys('1');
  expect(screen.getByTestId('amount-continue')).toBeDisabled();
});

test('the allowance agent proposes limits from plain words, and they are saved with the fingerprint', async () => {
  const w = await readyPhone();
  w.replies.push(path =>
    path === '/v1/allowance'
      ? { json: { perPaymentCap: '3000000', dailyCap: '10000000', days: 3, summary: 'Up to $3 a payment and $10 a day, for 3 days.', source: 'claude' } }
      : undefined,
  );
  await render(<App deps={w.deps} />);
  await fireEvent.press(await screen.findByText('Safety'));
  await fireEvent.press(await screen.findByTestId('change-limits'));
  await fireEvent.changeText(await screen.findByTestId('allowance-words'), '$10 a day until Wednesday, nothing over $3');
  await fireEvent.press(screen.getByTestId('allowance-ask'));
  expect(await screen.findByText('Up to $3 a payment and $10 a day, for 3 days.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('allowance-use'));
  await waitFor(() => expect(w.relayed.filter(r => r.path === '/v1/owner/session')).toHaveLength(2));
  const sent = w.relayed.filter(r => r.path === '/v1/owner/session').at(-1)!.body;
  expect(sent.params).toMatchObject({ perPaymentCap: '3000000', dailyCap: '10000000' });
  expect(phone.prompts).toContain('Turn on offline pay');
});
