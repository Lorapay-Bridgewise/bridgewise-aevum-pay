import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp } from "./server.js";
import { log, Settler } from "./settler.js";
import { Store } from "./store.js";

const cfg = loadConfig();
const store = new Store(cfg.dbPath);
const settler = new Settler(cfg, store);
const app = createApp(settler);

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

function shutdown(signal: string) {
  log("info", "stopping", { signal });
  clearInterval(timer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
