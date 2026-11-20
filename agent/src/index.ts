import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp } from "./server.js";
import { log, Settler } from "./settler.js";
import { Store } from "./store.js";
import { ActivityFeed } from "./activity.js";

const cfg = loadConfig();
const store = new Store(cfg.dbPath);
const settler = new Settler(cfg, store);
const feed = new ActivityFeed(settler.publicClient, cfg.vault, cfg.vaultFromBlock);
const app = createApp(settler, feed);

const server = serve({ fetch: app.fetch, port: cfg.port, hostname: "0.0.0.0" }, (info) => {
  log("info", "started", { port: info.port, agent: settler.agentAddress, vault: cfg.vault, chainId: cfg.chainId });
});

// Background sweep: finish anything left open by a crash, a slow block or a dropped transaction.
let sweeping = false;
const timer = setInterval(async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    await settler.sweep();
  } finally {
    sweeping = false;
  }
}, 10_000);

// Activity page: read the vault's events in the background (Aevum has no WebSocket RPC, so poll).
let feeding = false;
const feedTimer = setInterval(async () => {
  if (feeding) return;
  feeding = true;
  try {
    await feed.sync();
  } catch (err) {
    log("warn", "activity_sync_failed", { err: err instanceof Error ? err.message : String(err) });
  } finally {
    feeding = false;
  }
}, 15_000);
feed.sync().catch(() => {});

function shutdown(signal: string) {
  log("info", "stopping", { signal });
  clearInterval(timer);
  clearInterval(feedTimer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
