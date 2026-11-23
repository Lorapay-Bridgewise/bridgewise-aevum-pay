import { z } from "zod";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const hex = (len?: number) =>
  z
    .string()
    .regex(len ? new RegExp(`^0x[0-9a-fA-F]{${len}}$`) : /^0x[0-9a-fA-F]*$/, "must be 0x hex");

const schema = z.object({
  PORT: z.coerce.number().int().default(8787),
  RPC_URL: z.string().url().default("https://rpc-test.qday.info"),
  CHAIN_ID: z.coerce.number().int().default(44005),
  EXPLORER_URL: z.string().url().default("https://explorer-test.qday.info"),
  VAULT_ADDRESS: hex(40),
  AGENT_PRIVATE_KEY: hex(64),
  /** Shared with the Mesh Cloud: the organisation's webhook secret. */
  MESH_WEBHOOK_SECRET: z.string().min(16),
  /** Optional. Enables POST /v1/vouchers for testing with curl. */
  TEST_API_KEY: z.string().min(16).optional(),
  /** Fee the agent takes per voucher, in tUSD8 units (6 decimals). Never more than the signed maxFee. */
  FEE_UNITS: z.coerce.bigint().default(10_000n), // 0.01 tUSD8
  /** How long a request may wait for the transaction to be mined. The Cloud times out at 5 s. */
  CONFIRM_WAIT_MS: z.coerce.number().int().default(3000),
  DB_PATH: z.string().default("./data/agent.db"),
  /** Warn in /health below this gas balance (wei). */
  MIN_GAS_WEI: z.coerce.bigint().default(10n ** 15n),

  // Rails: limits that stop anyone burning the agent's gas.
  /** Longest a voucher may stay valid (validBefore - now), in seconds. Offline payments can take days to arrive. */
  MAX_VOUCHER_TTL_SEC: z.coerce.number().int().positive().default(7 * 86_400),
  /** New vouchers per session key per hour. Repeats and status questions do not count. */
  RATE_PER_SESSION_HOUR: z.coerce.number().int().positive().default(30),
  /** New vouchers per mesh node (gateway phone) per hour. */
  RATE_PER_NODE_HOUR: z.coerce.number().int().positive().default(120),
  /** Owner actions (deposit, add or remove a phone key, withdraw) per wallet per hour. */
  RATE_PER_OWNER_HOUR: z.coerce.number().int().positive().default(20),
  /** Smallest deposit the agent submits, in tUSD8 units (0.1 tUSD8). */
  MIN_DEPOSIT_UNITS: z.coerce.bigint().default(100_000n),
  /** Settlement transactions per UTC day. */
  DAILY_TX_CAP: z.coerce.number().int().positive().default(1_000),
  /** Gas the agent may spend per UTC day, in wei. 0.05 tQDAY by default. */
  DAILY_GAS_BUDGET_WEI: z.coerce.bigint().default(5n * 10n ** 16n),

  // Starter money: a small tUSD8 gift to each new wallet, from the agent's own tUSD8.
  /** Gift size in tUSD8 units. 0 turns starter money off. */
  STARTER_UNITS: z.coerce.bigint().default(2_000_000n),
  /** Gifts per UTC day, all wallets together. */
  STARTER_PER_DAY: z.coerce.number().int().nonnegative().default(50),
  /** Gifts per IP address per UTC day. */
  STARTER_PER_IP_DAY: z.coerce.number().int().nonnegative().default(3),

  /** First block to read for the activity page (the vault's deploy block). */
  VAULT_FROM_BLOCK: z.coerce.bigint().default(3_646_498n),

  // Confirmation of Payee
  /** The PayeeRegistry contract. Empty turns the name routes off. */
  PAYEE_REGISTRY: z.union([hex(40), z.literal("")]).optional(),
  /** First block to read registry events from (its deploy block). 0 = the latest 50,000 blocks. */
  REGISTRY_FROM_BLOCK: z.coerce.bigint().default(0n),

  // Allowance agent
  /** Anthropic API key. Without one the allowance agent uses its simple rules. */
  ANTHROPIC_API_KEY: z.string().optional(),
  ALLOWANCE_MODEL: z.string().default("claude-haiku-5-5"),
  /** Naira per dollar for wording like "5,000 naira a day". Empty: ask the person to use dollars. */
  NGN_PER_USD: z.coerce.number().positive().optional(),

  /** The commit this build came from, shown in /health. Set by the deploy. */
  AGENT_COMMIT: z.string().default("unknown"),
});

export type Config = {
  port: number;
  rpcUrl: string;
  chainId: number;
  explorerUrl: string;
  vault: Address;
  agentKey: Hex;
  webhookSecret: string;
  testApiKey?: string;
  feeUnits: bigint;
  confirmWaitMs: number;
  dbPath: string;
  minGasWei: bigint;
  maxVoucherTtlSec: number;
  ratePerSessionHour: number;
  ratePerNodeHour: number;
  ratePerOwnerHour: number;
  minDepositUnits: bigint;
  dailyTxCap: number;
  dailyGasBudgetWei: bigint;
  vaultFromBlock: bigint;
  starterUnits: bigint;
  starterPerDay: number;
  starterPerIpDay: number;
  registry?: Address;
  registryFromBlock: bigint;
  anthropicKey?: string;
  allowanceModel: string;
  ngnPerUsd?: number;
  commit: string;
};

/**
 * anvil's and Hardhat's well known dev accounts. Their keys are public, so anyone could drain
 * an agent using one. Refused on any chain except a local one.
 */
const PUBLIC_DEV_ADDRESSES = new Set(
  [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
    "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
    "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
    "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
    "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
  ].map((a) => a.toLowerCase()),
);
const LOCAL_CHAIN_IDS = new Set([31337, 1337, 440050]);

export function assertSafeAgentKey(chainId: number, key: Hex) {
  const address = privateKeyToAccount(key).address.toLowerCase();
  if (PUBLIC_DEV_ADDRESSES.has(address) && !LOCAL_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `AGENT_PRIVATE_KEY is a public test key (${address}). Anyone can use it. Make a new wallet with "cast wallet new".`,
    );
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid configuration:\n  ${issues}`);
  }
  const e = parsed.data;
  assertSafeAgentKey(e.CHAIN_ID, e.AGENT_PRIVATE_KEY as Hex);
  return {
    port: e.PORT,
    rpcUrl: e.RPC_URL,
    chainId: e.CHAIN_ID,
    explorerUrl: e.EXPLORER_URL,
    vault: e.VAULT_ADDRESS as Address,
    agentKey: e.AGENT_PRIVATE_KEY as Hex,
    webhookSecret: e.MESH_WEBHOOK_SECRET,
    testApiKey: e.TEST_API_KEY,
    feeUnits: e.FEE_UNITS,
    confirmWaitMs: e.CONFIRM_WAIT_MS,
    dbPath: e.DB_PATH,
    minGasWei: e.MIN_GAS_WEI,
    maxVoucherTtlSec: e.MAX_VOUCHER_TTL_SEC,
    ratePerSessionHour: e.RATE_PER_SESSION_HOUR,
    ratePerNodeHour: e.RATE_PER_NODE_HOUR,
    ratePerOwnerHour: e.RATE_PER_OWNER_HOUR,
    minDepositUnits: e.MIN_DEPOSIT_UNITS,
    dailyTxCap: e.DAILY_TX_CAP,
    dailyGasBudgetWei: e.DAILY_GAS_BUDGET_WEI,
    vaultFromBlock: e.VAULT_FROM_BLOCK,
    starterUnits: e.STARTER_UNITS,
    starterPerDay: e.STARTER_PER_DAY,
    starterPerIpDay: e.STARTER_PER_IP_DAY,
    registry: e.PAYEE_REGISTRY ? (e.PAYEE_REGISTRY as Address) : undefined,
    registryFromBlock: e.REGISTRY_FROM_BLOCK,
    anthropicKey: e.ANTHROPIC_API_KEY || undefined,
    allowanceModel: e.ALLOWANCE_MODEL,
    ngnPerUsd: e.NGN_PER_USD,
    commit: e.AGENT_COMMIT,
  };
}
