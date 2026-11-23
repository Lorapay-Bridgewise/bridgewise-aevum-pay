import type { Address } from 'viem';

/** Everything the app needs to know about the network, the contracts and the settlement agent. */
export type AppConfig = {
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  vault: Address;
  token: Address;
  /** tUSD8's EIP-712 domain (USDC style), used for permit signatures. */
  tokenDomain: { name: string; version: string };
  /** The settlement agent: online calls go here; offline ones reach it through the mesh. */
  agentUrl: string;
  /** Receipts must be signed by this address. */
  agentAddress: Address;
  /** Highest fee the phone signs for one payment, in tUSD8 units. The agent takes 0.01 today. */
  maxFeeUnits: bigint;
  /** How long an offline voucher stays valid. The agent refuses more than 7 days. */
  voucherValiditySec: number;
  /** Mesh Cloud */
  meshBaseUrl: string;
  meshAppKey: string;
};

export const AEVUM_TESTNET: AppConfig = {
  chainId: 44005,
  rpcUrl: 'https://rpc-test.qday.info',
  explorerUrl: 'https://explorer-test.qday.info',
  vault: '0x5E6f3d12AaeB6732840432D19BCc26a35e0F0184',
  token: '0x456569838f1d43009A91ebA4263147Afd7233483',
  tokenDomain: { name: 'tUSD8', version: '2' },
  agentUrl: 'https://agent.lorapay.io',
  agentAddress: '0x969a0f3711BdFD15BCFF3904ADF69e04107f64F5',
  maxFeeUnits: 20_000n, // 0.02 tUSD8
  voucherValiditySec: 3 * 86_400,
  meshBaseUrl: 'https://mesh.lorapay.io',
  // The "Aevum Pay" test app of the "Bridgewise Aevum Pay" organisation. App keys are public: they ship in the APK.
  meshAppKey: 'mk_test_GGcAney7OkYHdsbxDEjffCSBOlYXluAQ',
};
