import { z } from "zod";
import type { Address, Hex } from "viem";

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
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid configuration:\n  ${issues}`);
  }
  const e = parsed.data;
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
  };
}
