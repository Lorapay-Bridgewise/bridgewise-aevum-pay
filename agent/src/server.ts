import { Hono } from "hono";
import type { Hex } from "viem";
import { z } from "zod";
import { MESH_SIGNATURE_HEADER, verifyMesh } from "./meshSignature.js";
import { phoneMessage, RECEIPT_CT, type Receipt } from "./messages.js";
import { log, type Settler } from "./settler.js";

const MAX_MESH_BYTES = 2048;

const meshEvent = z.object({
  type: z.literal("mesh.message"),
  id: z.string(),
  ik: z.string(),
  app_id: z.union([z.string(), z.number()]).optional(),
  node: z.object({ mesh_node_id: z.string(), install_id: z.string().optional() }).optional(),
  created_at_ms: z.number().optional(),
  hop_count: z.number().optional(),
  body: z.string(),
  ct: z.string().optional(),
});

export function createApp(settler: Settler) {
  const app = new Hono();
  const cfg = settler.cfg;

  /** Leave a margin under the Cloud's 5 s webhook timeout. */
  const deadline = () => Date.now() + cfg.confirmWaitMs;

  async function dispatch(raw: unknown): Promise<Receipt | { error: string }> {
    const parsed = phoneMessage.safeParse(raw);
    if (!parsed.success) return { error: "invalid_message" };
    const m = parsed.data;
    if (m.t === "voucher") return settler.handleVoucher(m, deadline());
    return settler.handleStatus(m.sessionId as Hex, m.nonce as Hex, deadline());
  }

  /** Liveness only (used by Docker and the deploy check). /health also checks the chain and gas. */
  app.get("/live", (c) => c.json({ ok: true }));

  app.get("/health", async (c) => {
    try {
      const h = await settler.health();
      return c.json(h, h.ok ? 200 : 503);
    } catch (err) {
      return c.json({ ok: false, error: "chain_unreachable" }, 503);
    }
  });

  /** Mesh Cloud webhook (webhook mode). */
  app.post("/mesh/webhook", async (c) => {
    const body = await c.req.text();
    if (!verifyMesh(cfg.webhookSecret, c.req.header(MESH_SIGNATURE_HEADER), body)) {
      log("warn", "webhook_bad_signature");
      return c.json({ error: "bad_signature" }, 401);
    }
    const ev = meshEvent.safeParse(safeJson(body));
    if (!ev.success) return c.json({ error: "invalid_event" }, 400);

    const inner = safeJson(Buffer.from(ev.data.body, "base64").toString("utf8"));
    const answer = await dispatch(inner);
    log("info", "mesh_message", {
      id: ev.data.id,
      node: ev.data.node?.mesh_node_id,
      hops: ev.data.hop_count,
      result: "status" in answer ? answer.status : answer.error,
    });

    const out = Buffer.from(JSON.stringify(answer), "utf8");
    if (out.length > MAX_MESH_BYTES) {
      log("error", "reply_too_large", { bytes: out.length });
      return c.json({ error: "reply_too_large" }, 500);
    }
    return c.json({ body: out.toString("base64"), ct: RECEIPT_CT });
  });

  /** Direct API for tests and for a gateway that is online. Needs TEST_API_KEY. */
  app.post("/v1/vouchers", async (c) => {
    if (!cfg.testApiKey || c.req.header("x-api-key") !== cfg.testApiKey) return c.json({ error: "unauthorized" }, 401);
    const answer = await dispatch(safeJson(await c.req.text()));
    return c.json(answer, "error" in answer ? 400 : 200);
  });

  /** Public lookup: receipts only say what is already public on chain. */
  app.get("/v1/vouchers/:sessionId/:nonce", async (c) => {
    const { sessionId, nonce } = c.req.param();
    if (!/^0x[0-9a-fA-F]{64}$/.test(sessionId) || !/^0x[0-9a-fA-F]{64}$/.test(nonce)) {
      return c.json({ error: "invalid_id" }, 400);
    }
    return c.json(await settler.handleStatus(sessionId as Hex, nonce as Hex, Date.now() + 500));
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  return app;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
