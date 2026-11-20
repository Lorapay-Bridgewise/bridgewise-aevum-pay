import type { Address, Hex } from "viem";
import type { ActivityFeed, VaultEvent } from "./activity.js";

export type PageInfo = {
  explorerUrl: string;
  vault: Address;
  agent: Address;
  repoUrl: string;
  health?: { gasBalanceWei: string; today: { transactions: number; paused: string | null } };
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** tUSD8 has 6 decimals. */
export function tusd(units: string | bigint | undefined): string {
  const v = BigInt(units ?? 0);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole.toLocaleString("en-US")}.${frac}`;
}

const short = (x?: string) => (x ? `${x.slice(0, 6)}…${x.slice(-4)}` : "");

function when(t?: number): string {
  if (!t) return "";
  return new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function addr(info: PageInfo, a?: Address, label?: string) {
  if (!a) return "";
  const isAgent = a.toLowerCase() === info.agent.toLowerCase();
  return `<a href="${esc(info.explorerUrl)}/address/${esc(a)}" title="${esc(a)}">${esc(label ?? (isAgent ? "this agent" : short(a)))}</a>`;
}

function details(e: VaultEvent, info: PageInfo): string {
  switch (e.kind) {
    case "VoucherSettled":
      return `<strong>${tusd(e.amount)} tUSD8</strong> to ${addr(info, e.payee)}
        <span class="muted">· fee ${tusd(e.fee)} to ${addr(info, e.feeTo)}<span class="extra"> · session ${esc(short(e.sessionId))}</span></span>`;
    case "Deposited":
      return `<strong>${tusd(e.amount)} tUSD8</strong> deposited by ${addr(info, e.owner)}`;
    case "Withdrawn":
      return `<strong>${tusd(e.amount)} tUSD8</strong> withdrawn by ${addr(info, e.owner)} to ${addr(info, e.to)}`;
    case "SessionOpened":
      return `Phone key ${esc(short(e.sessionId))} for ${addr(info, e.owner)}
        <span class="muted">· up to ${tusd(e.perPaymentCap)} a payment, ${tusd(e.dailyCap)} a day, until ${esc(when(e.expiresAt))}</span>`;
    case "SessionRevoked":
      return `Phone key ${esc(short(e.sessionId))} revoked by ${addr(info, e.owner)}`;
  }
}

const LABEL: Record<VaultEvent["kind"], string> = {
  VoucherSettled: "Payment",
  Deposited: "Deposit",
  Withdrawn: "Withdrawal",
  SessionOpened: "Key added",
  SessionRevoked: "Key revoked",
};

export function renderActivity(feed: ActivityFeed, info: PageInfo, head?: bigint): string {
  const t = feed.totals;
  const rows = feed
    .latest(100)
    .map(
      (e) => `<tr>
        <td class="nowrap muted">${esc(when(e.time)) || `block ${esc(e.block)}`}</td>
        <td><span class="tag tag-${esc(e.kind)}">${LABEL[e.kind]}</span></td>
        <td>${details(e, info)}</td>
        <td class="nowrap"><a href="${esc(info.explorerUrl)}/tx/${esc(e.txHash)}">${esc(short(e.txHash))}</a></td>
      </tr>`,
    )
    .join("");

  const h = info.health;
  const gas = h ? (Number(BigInt(h.gasBalanceWei) / 10n ** 12n) / 1e6).toFixed(4) : "unknown";
  const status = !h ? "unreachable" : h.today.paused ? `paused (${h.today.paused})` : "settling";
  const syncing = feed.caughtUp
    ? ""
    : `<p class="note">Reading the vault's history from the chain: block ${esc(feed.scannedTo)} of ${esc(head ?? "?")}. This page fills in as it goes.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Offline payments on Aevum · activity</title>
<style>
  :root { color-scheme: light dark; --bg:#fbfaf7; --fg:#1d1d1b; --muted:#6b6a65; --line:#e6e3dc; --card:#fff; --accent:#0f766e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141413; --fg:#ecebe6; --muted:#9c9a92; --line:#2c2b28; --card:#1c1b19; --accent:#5eead4; } }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.01em; }
  .lede { color: var(--muted); margin: 0 0 24px; max-width: 70ch; }
  a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
  .stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px,1fr)); gap:12px; margin-bottom: 20px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .stat b { display:block; font-size:22px; font-variant-numeric: tabular-nums; }
  .stat span { color:var(--muted); font-size:13px; }
  .facts { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 16px; margin-bottom:24px; display:flex; flex-wrap:wrap; gap:8px 28px; font-size:14px; }
  .facts span { color: var(--muted); }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:top; font-size:14px; }
  th { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); font-weight:600; }
  tr:last-child td { border-bottom:0; }
  .muted { color: var(--muted); } .nowrap { white-space: nowrap; }
  .tag { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:600; border:1px solid var(--line); white-space:nowrap; }
  .tag-VoucherSettled { color:#0f766e; border-color:#0f766e55; }
  .tag-SessionRevoked { color:#b45309; border-color:#b4530955; }
  .note { background:var(--card); border:1px dashed var(--line); padding:10px 14px; border-radius:8px; color:var(--muted); }
  footer { margin-top: 28px; color: var(--muted); font-size: 13px; }
  @media (max-width: 640px) {
    main { padding: 24px 14px 48px; }
    .stats { grid-template-columns: 1fr 1fr; }
    thead { display: none; }
    tr { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
    tr:last-child { border-bottom: 0; }
    td { border: 0; padding: 0; }
    td:nth-child(2) { order: 1; }
    td:nth-child(4) { order: 2; justify-self: end; }
    td:nth-child(3) { order: 3; grid-column: 1 / -1; }
    td:nth-child(1) { order: 4; grid-column: 1 / -1; font-size: 12px; }
    .extra { display: none; }
  }
</style>
</head>
<body>
<main>
  <h1>Offline payments on Aevum</h1>
  <p class="lede">Payments signed on a phone with no signal, carried over Bluetooth by other phones,
  and settled on Aevum testnet by the settlement agent. Every row below is read from the chain.</p>

  <div class="stats">
    <div class="stat"><b>${t.settled}</b><span>payments settled</span></div>
    <div class="stat"><b>${tusd(t.volume)}</b><span>tUSD8 paid</span></div>
    <div class="stat"><b>${tusd(t.fees)}</b><span>tUSD8 in fees</span></div>
    <div class="stat"><b>${t.sessions}</b><span>phone keys added</span></div>
    <div class="stat"><b>${t.revoked}</b><span>phone keys revoked</span></div>
  </div>

  <div class="facts">
    <div><span>Vault</span> ${addr(info, info.vault, short(info.vault))}</div>
    <div><span>Agent</span> ${addr(info, info.agent, short(info.agent))} · ${esc(status)}</div>
    <div><span>Agent gas</span> ${esc(gas)} tQDAY</div>
    <div><span>Today</span> ${h ? h.today.transactions : "?"} settlements sent</div>
    <div><span>Network</span> QDay Aevum testnet (44005)</div>
    <div><a href="${esc(info.repoUrl)}">Source code</a></div>
  </div>

  ${syncing}

  <table>
    <thead><tr><th>Time</th><th>Event</th><th>Details</th><th>Transaction</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4" class="muted">No vault activity yet.</td></tr>`}</tbody>
  </table>

  <footer>Refreshes every 30 seconds. JSON at <a href="/v1/activity">/v1/activity</a>. Receipts the agent signs can be checked at /v1/vouchers/&lt;sessionId&gt;/&lt;nonce&gt;.</footer>
</main>
</body>
</html>`;
}
