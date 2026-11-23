import { addThisPhone, changeLimits, confirmAndPay, deliverOpen, lookUpName, proposeLimits, refreshIncoming, registerMyName, deposit, pay, PayError, refreshWallet, removeThisPhone, spendable, VOUCHER_CT } from '../src/payments/engine';
import { publicKeyXY, sessionIdOf } from '../src/core/voucher';
import { useApp } from '../src/state/store';
import { chain, makeWorld, ONE, OWNER, PAYEE, phone, receiptFor, receiptJson, REGISTRY, resetState, STRANGER } from './helpers/world';

const payment = (id: string) => useApp.getState().payments.find(p => p.id === id)!;
const settle = () => new Promise<void>(r => setTimeout(r, 0));
async function waitFor(ok: () => boolean) {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise(r => setTimeout(r, 10));
  expect(ok()).toBe(true);
}

async function setUp() {
  const w = makeWorld();
  expect((await addThisPhone(w.deps, { perPaymentCap: 2n * ONE, dailyCap: 3n * ONE, expiresAt: chain.session.expiresAt })).ok).toBe(true);
  return w;
}

beforeEach(resetState);

describe('setting up (online, no gas)', () => {
  test('adds this phone with its own key and remembers the session', async () => {
    const w = await setUp();
    const s = useApp.getState().session!;
    const key = w.keys.get(s.keyAlias)!;
    const { qx, qy } = publicKeyXY(key.publicKey);
    expect(s.sessionId).toBe(sessionIdOf(OWNER.address, qx, qy));
    const req = w.relayed.find(r => r.path === '/v1/owner/session')!;
    expect(req.body.owner).toBe(OWNER.address);
    expect(req.body.params).toMatchObject({ qx, qy, perPaymentCap: '2000000', dailyCap: '3000000' });
    expect(useApp.getState().snapshot?.session?.dailyCap).toBe('3000000');
  });

  test('deposits with a permit and refuses more than the wallet holds', async () => {
    const w = makeWorld();
    expect((await deposit(w.deps, 2n * ONE)).ok).toBe(true);
    expect(w.relayed[0].path).toBe('/v1/owner/deposit');
    expect(w.relayed[0].body).toMatchObject({ owner: OWNER.address, amount: '2000000' });
    expect((await deposit(w.deps, 50n * ONE)).ok).toBe(false);
  });

  test('removes this phone', async () => {
    const w = await setUp();
    expect((await removeThisPhone(w.deps)).ok).toBe(true);
    expect(w.relayed.at(-1)!.body.sessionId).toBe(useApp.getState().session!.sessionId);
  });
});

describe('paying offline', () => {
  test('signs a voucher, sends it over the mesh, and shows it paid on a genuine receipt', async () => {
    const w = await setUp();
    w.mesh.answerData(body => receiptFor(body, 'confirmed', { txHash: `0x${'cd'.repeat(32)}`, fee: '10000' }));
    chain.offline = true; // no signal on this phone
    const p = await pay(w.deps, PAYEE, ONE);
    await settle();
    await settle();
    expect(w.mesh.sentData).toHaveLength(1);
    expect(w.mesh.sentData[0].contentType).toBe(VOUCHER_CT);
    const sent = JSON.parse(new TextDecoder().decode(w.mesh.sentData[0].body));
    expect(sent).toMatchObject({ t: 'voucher', chainId: 44005, v: { payee: PAYEE, amount: '1000000', maxFee: '20000' } });
    expect(payment(p.id)).toMatchObject({ status: 'confirmed', txHash: `0x${'cd'.repeat(32)}`, fee: '10000' });
  });

  test('ignores a receipt not signed by our agent', async () => {
    const w = await setUp();
    w.mesh.answerData(body => receiptFor(body, 'confirmed', {}, STRANGER));
    const p = await pay(w.deps, PAYEE, ONE);
    await settle();
    await settle();
    expect(payment(p.id).status).toBe('waiting');
  });

  test('keeps the payment when no phone with signal is near, and sends the same voucher again later', async () => {
    const w = await setUp();
    const p = await pay(w.deps, PAYEE, ONE); // FakeMesh: no answer, timeout
    await settle();
    expect(payment(p.id).status).toBe('waiting');

    w.mesh.answerData(body => receiptFor(body, 'confirmed'));
    await deliverOpen(w.deps);
    expect(payment(p.id).status).toBe('confirmed');
    expect(w.mesh.sentData[1].body).toEqual(w.mesh.sentData[0].body); // identical voucher: never paid twice
  });

  test('shows why a payment was refused', async () => {
    const w = await setUp();
    w.mesh.answerData(body => receiptFor(body, 'rejected', { reason: 'SessionRevokedErr' }));
    const p = await pay(w.deps, PAYEE, ONE);
    await settle();
    await settle();
    expect(payment(p.id)).toMatchObject({ status: 'rejected', reason: 'SessionRevokedErr' });
  });

  test('refuses payments over the limits before signing anything', async () => {
    const w = await setUp();
    await expect(pay(w.deps, PAYEE, 3n * ONE)).rejects.toThrow(/at once/);
    await expect(pay(w.deps, 'not-an-address', ONE)).rejects.toThrow(PayError);
    await expect(pay(w.deps, OWNER.address, ONE)).rejects.toThrow(/own wallet/);
    await pay(w.deps, PAYEE, 2n * ONE);
    await expect(pay(w.deps, PAYEE, 2n * ONE)).rejects.toThrow(/today/); // 3 a day
    expect(useApp.getState().payments).toHaveLength(1);
  });

  test('works out what is left offline from the last reading and the payments since', async () => {
    const w = await setUp();
    chain.offline = true;
    await pay(w.deps, PAYEE, ONE);
    const left = spendable()!;
    expect(left.todayLeft).toBe(2n * ONE);
    expect(left.balance).toBe(4n * ONE - ONE - 20_000n);
    expect(await refreshWallet(w.deps)).toBe(false);
    expect(useApp.getState().online).toBe(false);
  });

  test('refuses to pay once the phone was removed', async () => {
    const w = await setUp();
    chain.session = { ...chain.session, revoked: true };
    await refreshWallet(w.deps);
    await expect(pay(w.deps, PAYEE, ONE)).rejects.toThrow(/removed/);
  });
});

describe('fingerprint and limits', () => {
  test('a protected phone key needs the fingerprint for every payment', async () => {
    const w = await setUp();
    expect(useApp.getState().session!.protected).toBe(true);
    phone.passes = false;
    await expect(confirmAndPay(w.deps, { payee: PAYEE, amount: ONE })).rejects.toThrow('Nothing was sent');
    phone.passes = true;
    const p = await confirmAndPay(w.deps, { payee: PAYEE, amount: ONE, payeeName: 'Musa' });
    expect(p.payeeName).toBe('Musa');
    expect(phone.prompts.at(-1)).toBe('Confirm payment');
  });

  test('without a screen lock the app PIN must have been checked', async () => {
    phone.auth = 'none';
    const w = await setUp();
    expect(useApp.getState().session!.protected).toBe(false);
    await expect(confirmAndPay(w.deps, { payee: PAYEE, amount: ONE })).rejects.toThrow('Enter your PIN');
    expect((await confirmAndPay(w.deps, { payee: PAYEE, amount: ONE, pinChecked: true })).amount).toBe('1000000');
  });

  test('new limits make a new phone key, and turn the old one off only when nothing is on its way', async () => {
    const w = await setUp();
    const first = useApp.getState().session!.sessionId;
    const limits = { perPaymentCap: ONE, dailyCap: 2n * ONE, expiresAt: chain.session.expiresAt };
    expect((await changeLimits(w.deps, limits)).ok).toBe(true);
    expect(useApp.getState().session!.sessionId).not.toBe(first);
    expect(w.relayed.filter(r => r.path === '/v1/owner/revoke').map(r => r.body.sessionId)).toEqual([first]);

    chain.offline = true;
    await pay(w.deps, PAYEE, ONE); // stays on its way: nobody answers on the mesh
    chain.offline = false;
    const second = useApp.getState().session!.sessionId;
    expect((await changeLimits(w.deps, limits)).ok).toBe(true);
    expect(w.relayed.filter(r => r.path === '/v1/owner/revoke').map(r => r.body.sessionId)).not.toContain(second);
  });
});

describe('with its own internet', () => {
  test('pays straight to the agent, with no phone nearby', async () => {
    const w = await setUp();
    w.replies.push(async (path, body) => (path === '/v1/pay' ? { json: await receiptJson(body, 'confirmed', { txHash: `0x${'cd'.repeat(32)}` }) } : undefined));
    const p = await pay(w.deps, PAYEE, ONE);
    await waitFor(() => useApp.getState().payments[0].status === 'confirmed');
    expect(useApp.getState().payments[0].txHash).toBe(`0x${'cd'.repeat(32)}`);
    expect(w.mesh.sentData).toHaveLength(0);
    expect(p.id).toBeTruthy();
  });

  test('a receipt from the wrong signer is ignored and the mesh is tried', async () => {
    const w = await setUp();
    w.replies.push(async (path, body) => (path === '/v1/pay' ? { json: { ...(await receiptJson(body, 'confirmed')), sig: `0x${'11'.repeat(65)}` } } : undefined));
    w.mesh.answerData(body => receiptFor(body, 'confirmed'));
    await pay(w.deps, PAYEE, ONE);
    await waitFor(() => useApp.getState().payments[0].status === 'confirmed');
    expect(w.mesh.sentData).toHaveLength(1);
  });
});

describe('money in, names and the allowance agent', () => {
  test('keeps the money paid to this wallet, and the payers\' registered names', async () => {
    const w = await setUp();
    w.replies.push(path =>
      path.startsWith('/v1/payments/to/')
        ? { json: { payments: [{ txHash: `0x${'aa'.repeat(32)}`, block: '9', time: 1_766_000_000, sessionId: `0x${'01'.repeat(32)}`, nonce: `0x${'02'.repeat(32)}`, amount: '500000', from: STRANGER.address, fromName: 'Tunde Bello' }] } }
        : undefined,
    );
    await refreshIncoming(w.deps);
    expect(useApp.getState().incoming).toEqual([
      expect.objectContaining({ amount: '500000', from: STRANGER.address, fromName: 'Tunde Bello', at: 1_766_000_000_000 }),
    ]);
    expect(await lookUpName({ ...w.deps }, STRANGER.address)).toBe('Tunde Bello'); // saved copy (the agent has no registry here)
  });

  test('registers a name with a signature, and explains a taken name', async () => {
    const w = await setUp();
    w.replies.push((path, body) => {
      if (path === '/v1/config') return { json: { registry: REGISTRY } };
      if (path === '/v1/names') return { json: body.name === 'Ada Stores' ? { status: 'confirmed' } : { status: 'rejected', reason: 'NameTaken' } };
      return undefined;
    });
    expect((await registerMyName(w.deps, 'Musa Kiosk')).message).toBe('Someone else has registered that name. Try another.');
    expect((await registerMyName(w.deps, 'Bad  name')).message).toMatch('double spaces');
    const ok = await registerMyName(w.deps, 'Ada Stores');
    expect(ok.ok).toBe(true);
    const sent = w.relayed.filter(r => r.path === '/v1/names').at(-1)!.body;
    expect(sent).toMatchObject({ account: OWNER.address, name: 'Ada Stores' });
    expect(useApp.getState().names[OWNER.address.toLowerCase()].name).toBe('Ada Stores');
    expect(useApp.getState().name).toBe('Ada Stores');
  });

  test('turns the allowance agent\'s proposal into limits, or passes its question on', async () => {
    const w = await setUp();
    w.replies.push((path, body) =>
      path === '/v1/allowance'
        ? { json: body.text.includes('$') ? { perPaymentCap: '3000000', dailyCap: '10000000', days: 3, summary: 'Up to $3 a payment and $10 a day, for 3 days.', source: 'claude' } : { question: 'How much?', source: 'rules' } }
        : undefined,
    );
    const p = await proposeLimits(w.deps, '$10 a day, $3 at once, until Wednesday');
    expect(p).toMatchObject({ summary: 'Up to $3 a payment and $10 a day, for 3 days.', limits: { perPaymentCap: 3n * ONE, dailyCap: 10n * ONE } });
    expect(await proposeLimits(w.deps, 'make it safe')).toEqual({ question: 'How much?' });
  });
});
