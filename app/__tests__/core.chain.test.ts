/**
 * @jest-environment node
 *
 * The payment core against the real contracts (../out, run `forge build` in the repo root first)
 * on a local chain with Aevum's settings (anvil, chain 44005, Shanghai). The phone key is a
 * @noble/curves P-256 key that signs exactly like Android Keystore's SHA256withECDSA.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { p256 } from '@noble/curves/nist.js';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { offlineVaultAbi } from '../src/core/abi';
import type { AppConfig } from '../src/core/config';
import { readWalletState } from '../src/core/chain';
import { signDepositPermit, signOpenSession, signRevoke, signWithdraw } from '../src/core/owner';
import { isGenuineReceipt, RECEIPT_TYPES } from '../src/core/receipt';
import { fromMessage, newVoucher, publicKeyXY, sessionIdOf, signVoucher, type PhoneSigner } from '../src/core/voucher';

const PORT = 8900 + Math.floor(Math.random() * 90);
const RPC = `http://127.0.0.1:${PORT}`;
const ONE = 1_000_000n;
// anvil's public dev key, local only: plays the settlement agent that submits everything
const RELAYER = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const DEPLOYER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

const chain = defineChain({
  id: 44005,
  name: 'local',
  nativeCurrency: { name: 'tQDAY', symbol: 'tQDAY', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC), pollingInterval: 100 }) as PublicClient;
const relayer = createWalletClient({ chain, transport: http(RPC), account: RELAYER });
const deployer = createWalletClient({ chain, transport: http(RPC), account: DEPLOYER });

const artifact = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../out/${name}.sol/${name}.json`), 'utf8'));
const tokenAbi = [
  { type: 'function', name: 'mint', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'balanceOf', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;

let anvil: ChildProcess;
let cfg: AppConfig;

/** A phone key that signs like Keystore: SHA-256 of the message, then P-256, raw r||s. */
function keystoreLikeSigner(): PhoneSigner {
  const secret = p256.utils.randomSecretKey();
  return {
    publicKey: p256.getPublicKey(secret, false),
    sign: msg => p256.sign(msg, secret, { prehash: true, lowS: false }),
  };
}

async function deploy(name: string, args: unknown[] = []): Promise<Address> {
  const a = artifact(name);
  const hash = await deployer.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
}

async function mined(hash: Hex) {
  const r = await pub.waitForTransactionReceipt({ hash });
  expect(r.status).toBe('success');
  return r;
}

/**
 * Foundry's anvil: ANVIL_BIN, then anvil on the PATH, then Foundry's default install folder
 * (~/.foundry/bin, also on Windows). Without anvil or the built contracts these tests are
 * skipped with a note instead of failing.
 */
function findAnvil(): string | null {
  const home = homedir();
  const tries = [process.env.ANVIL_BIN, 'anvil', join(home, '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil')];
  for (const bin of tries) {
    if (bin && spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0) return bin;
  }
  return null;
}
const ANVIL = findAnvil();
const BUILT = existsSync(resolve(__dirname, '../../out/OfflineVault.sol/OfflineVault.json'));
const suite = ANVIL && BUILT ? describe : describe.skip;
if (!ANVIL) console.warn('Skipping the chain tests: anvil not found. Install Foundry, or set ANVIL_BIN to anvil\'s full path.');
else if (!BUILT) console.warn('Skipping the chain tests: run `forge build` in the repo root first.');

suite('the payment core on a local chain', () => {
beforeAll(async () => {
  anvil = spawn(ANVIL!, ['--port', String(PORT), '--chain-id', '44005', '--hardfork', 'shanghai', '--silent'], {
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      await pub.getBlockNumber();
      break;
    } catch {
      await new Promise<void>(r => setTimeout(r, 100));
    }
  }
  const token = await deploy('MockTUSD8');
  const vault = await deploy('OfflineVault', [token]);
  cfg = {
    chainId: 44005,
    rpcUrl: RPC,
    explorerUrl: '',
    vault,
    token,
    // The mock is OpenZeppelin ERC20Permit("Test USD8"), version "1". Real tUSD8: "tUSD8", "2".
    tokenDomain: { name: 'Test USD8', version: '1' },
    agentUrl: '',
    agentAddress: RELAYER.address,
    maxFeeUnits: 20_000n,
    voucherValiditySec: 3 * 86_400,
    meshBaseUrl: '',
    meshAppKey: '',
  };
}, 60_000);

afterAll(() => anvil?.kill());

test('a new wallet with no gas deposits, adds a phone key, pays offline, revokes and withdraws', async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const phone = keystoreLikeSigner();
  const payee = privateKeyToAccount(generatePrivateKey()).address;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const vault = { address: cfg.vault, abi: offlineVaultAbi } as const;

  // The wallet holds tUSD8 and no tQDAY at all
  await mined(await deployer.writeContract({ address: cfg.token, abi: tokenAbi, functionName: 'mint', args: [owner.address, 10n * ONE] }));
  expect(await pub.getBalance({ address: owner.address })).toBe(0n);

  // 1. Deposit by permit: the owner signs, the agent submits
  let state = await readWalletState(cfg, pub, owner.address, null);
  const permit = await signDepositPermit(cfg, owner, { amount: 5n * ONE, tokenNonce: state.tokenNonce, deadline });
  await mined(
    await relayer.writeContract({
      ...vault,
      functionName: 'depositWithPermit',
      args: [permit.owner, BigInt(permit.amount), BigInt(permit.deadline), permit.v, permit.r, permit.s],
    }),
  );

  // 2. Add this phone's key with limits
  const { qx, qy } = publicKeyXY(phone.publicKey);
  const sessionId = sessionIdOf(owner.address, qx, qy);
  const limits = { perPaymentCap: 2n * ONE, dailyCap: 3n * ONE, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400) };
  const open = await signOpenSession(cfg, owner, { qx, qy, limits, ownerNonce: state.ownerNonce, deadline });
  await mined(
    await relayer.writeContract({
      ...vault,
      functionName: 'openSessionBySig',
      args: [
        open.owner,
        {
          qx: open.params.qx,
          qy: open.params.qy,
          perPaymentCap: BigInt(open.params.perPaymentCap),
          dailyCap: BigInt(open.params.dailyCap),
          expiresAt: BigInt(open.params.expiresAt),
        },
        BigInt(open.deadline),
        open.sig,
      ],
    }),
  );
  state = await readWalletState(cfg, pub, owner.address, sessionId);
  expect(state.vaultUnits).toBe(5n * ONE);
  expect(state.walletUnits).toBe(5n * ONE);
  expect(state.session?.dailyCap).toBe(3n * ONE);
  expect(state.session?.remainingToday).toBe(3n * ONE);

  // 3. Offline: the phone signs a voucher; anyone online settles it
  const msg = await signVoucher(cfg, newVoucher(cfg, { sessionId, payee, amount: ONE + ONE / 2n }), phone);
  expect(JSON.stringify(msg).length).toBeLessThan(2048); // fits one mesh message
  const v = fromMessage(msg);
  await mined(await relayer.writeContract({ ...vault, functionName: 'settle', args: [v, msg.r, msg.s, 10_000n, RELAYER.address] }));
  expect(await pub.readContract({ address: cfg.token, abi: tokenAbi, functionName: 'balanceOf', args: [payee] })).toBe(ONE + ONE / 2n);

  // The same voucher cannot be paid twice
  await expect(pub.simulateContract({ ...vault, functionName: 'settle', args: [v, msg.r, msg.s, 0n, RELAYER.address], account: RELAYER })).rejects.toThrow(
    /VoucherReused/,
  );

  // 4. Revoke from the wallet: the phone's next voucher is refused
  state = await readWalletState(cfg, pub, owner.address, sessionId);
  const revoke = await signRevoke(cfg, owner, { sessionId, deadline });
  await mined(await relayer.writeContract({ ...vault, functionName: 'revokeBySig', args: [revoke.sessionId, BigInt(revoke.deadline), revoke.sig] }));
  const after = await signVoucher(cfg, newVoucher(cfg, { sessionId, payee, amount: ONE }), phone);
  await expect(
    pub.simulateContract({ ...vault, functionName: 'settle', args: [fromMessage(after), after.r, after.s, 0n, RELAYER.address], account: RELAYER }),
  ).rejects.toThrow(/SessionRevokedErr/);

  // 5. Take the rest back out
  state = await readWalletState(cfg, pub, owner.address, sessionId);
  const left = state.vaultUnits;
  const w = await signWithdraw(cfg, owner, { to: owner.address, amount: left, ownerNonce: state.ownerNonce, deadline });
  await mined(await relayer.writeContract({ ...vault, functionName: 'withdrawBySig', args: [w.owner, w.to, BigInt(w.amount), BigInt(w.deadline), w.sig] }));
  state = await readWalletState(cfg, pub, owner.address, sessionId);
  expect(state.vaultUnits).toBe(0n);
  expect(state.session?.revoked).toBe(true);
  expect(await pub.getBalance({ address: owner.address })).toBe(0n); // never needed gas
});

describe('receipts', () => {
  const sessionId = `0x${'11'.repeat(32)}` as Hex;
  const nonce = `0x${'22'.repeat(32)}` as Hex;

  async function signed(by = RELAYER, overrides: Record<string, unknown> = {}) {
    const base = { sessionId, nonce, status: 'confirmed' as const, txHash: `0x${'33'.repeat(32)}` as Hex, fee: '10000', issuedAt: 1_766_000_000, reason: '' };
    const sig = await by.signTypedData({
      domain: { name: 'Bridgewise Settlement Agent', version: '1', chainId: cfg.chainId, verifyingContract: cfg.vault },
      types: RECEIPT_TYPES,
      primaryType: 'Receipt',
      message: { sessionId, nonce, status: 2, reason: '', txHash: base.txHash, fee: 10_000n, issuedAt: BigInt(base.issuedAt) },
    });
    return { t: 'receipt', agent: by.address, ...base, sig, ...overrides };
  }

  test('accepts the agent signature for this voucher', async () => {
    expect(await isGenuineReceipt(cfg, await signed(), { sessionId, nonce })).toBe(true);
  });

  test('refuses a changed status, another signer, or another voucher', async () => {
    expect(await isGenuineReceipt(cfg, await signed(RELAYER, { status: 'rejected' }), { sessionId, nonce })).toBe(false);
    expect(await isGenuineReceipt(cfg, await signed(DEPLOYER), { sessionId, nonce })).toBe(false);
    expect(await isGenuineReceipt(cfg, await signed(), { sessionId, nonce: `0x${'44'.repeat(32)}` })).toBe(false);
    expect(await isGenuineReceipt(cfg, null, { sessionId, nonce })).toBe(false);
  });
});
});
