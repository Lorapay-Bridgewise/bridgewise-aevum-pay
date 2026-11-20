# Settlement agent

Takes offline payment vouchers that arrive over Bridgewise Mesh and settles them on the
`OfflineVault` contract on Aevum testnet. It pays the gas in tQDAY, takes a small fee in tUSD8 (never
more than the `maxFee` the payer signed), and answers with a receipt it signs itself.

```
phone ──BLE mesh──▶ gateway ──▶ Mesh Cloud (mesh.lorapay.io) ──webhook──▶ agent ──tx──▶ OfflineVault
phone ◀─────────────────────── sealed reply ◀──────────────── signed receipt ◀──────── mined
```

## What it guarantees

| Property | How |
|---|---|
| Never pays twice | The vault refuses a used nonce, so every retry is safe. The agent also stores one row per voucher and answers repeats from it |
| No gas on bad vouchers | Every voucher is simulated first. Tampered, expired, revoked or over cap vouchers are refused before sending |
| Answers inside the Cloud's 5 s timeout | Waits up to `CONFIRM_WAIT_MS` (3 s) for the block, otherwise answers `submitted` with the tx hash |
| Finishes what it started | A sweep every 10 s completes transactions left open by a crash, a slow block or a dropped transaction |
| Settled by someone else | Settlement is permissionless. If another relayer settled a voucher first, the agent finds the `VoucherSettled` event and reports it |
| Verifiable receipts | Every answer is signed by the agent (EIP-712 `Receipt`), and confirmed ones can be checked on chain |
| Only the Cloud can call the webhook | `Mesh-Signature` HMAC with the organisation's webhook secret, 5 minute window |

## Rails

Settlement costs the agent gas, so it refuses work that would let anyone burn it. Every check below
runs before any call to the chain, so a refused voucher costs nothing.

| Rail | Default | Answer |
|---|---|---|
| The signed `maxFee` must cover the agent's fee | `FEE_UNITS` = 0.01 tUSD8 | `rejected`, `FeeTooLow` |
| No expired vouchers, and none valid for longer than a week | `MAX_VOUCHER_TTL_SEC` = 7 days | `rejected`, `VoucherExpired` / `ValidityTooLong` |
| New vouchers per phone key per hour | `RATE_PER_SESSION_HOUR` = 30 | `retry`, `RateLimited` |
| New vouchers per gateway phone per hour | `RATE_PER_NODE_HOUR` = 120 | `retry`, `RateLimited` |
| Settlement transactions per UTC day | `DAILY_TX_CAP` = 1,000 | `retry`, `AgentDailyCapReached` |
| Gas per UTC day | `DAILY_GAS_BUDGET_WEI` = 0.05 tQDAY | `retry`, `AgentGasBudgetReached` |
| Public test keys (anvil, Hardhat) as the agent key | refused on any real network | the agent does not start |

| Owner actions per wallet per hour | `RATE_PER_OWNER_HOUR` = 20 | `retry`, `RateLimited` |
| Smallest deposit it submits | `MIN_DEPOSIT_UNITS` = 0.1 tUSD8 | `rejected`, `DepositTooSmall` |

A voucher the agent already knows is always answered from its records, whatever the limits.

Owner actions answer `{status, txHash?, reason?}` with status `confirmed`, `submitted`, `rejected` or
`retry`. The vault checks the owner's signature and nonce, so a forged or repeated request fails the
dry run and costs no gas.
The week limit is longer than the starter kit's one hour on purpose: an offline payment can take
days to reach a phone with signal. Limits live in memory and in the agent's SQLite file, which is
fine for one server.

## Messages

They travel as the `body` of a mesh app data message (JSON, at most 2048 bytes).

**Voucher** (`ct: application/vnd.bwpay.voucher+json`)

```json
{
  "t": "voucher",
  "chainId": 44005,
  "vault": "0x5E6f3d12AaeB6732840432D19BCc26a35e0F0184",
  "v": {
    "sessionId": "0x…32 bytes",
    "payee": "0x…",
    "amount": "1000000",
    "maxFee": "20000",
    "nonce": "0x…32 random bytes",
    "validBefore": 1766000000
  },
  "r": "0x…",
  "s": "0x…"
}
```

**Status** (ask about an earlier voucher): `{"t": "status", "sessionId": "0x…", "nonce": "0x…"}`

**Receipt** (the answer, `ct: application/vnd.bwpay.receipt+json`)

```json
{
  "t": "receipt",
  "sessionId": "0x…",
  "nonce": "0x…",
  "status": "confirmed",
  "txHash": "0x…",
  "block": "3646594",
  "fee": "10000",
  "agent": "0x…",
  "issuedAt": 1766000000,
  "sig": "0x…"
}
```

| status | Meaning | What the phone does |
|---|---|---|
| `confirmed` | Mined. The payee has the money | Show paid, link to the explorer |
| `submitted` | Sent, not mined yet | Show pending, send a status message later |
| `rejected` | It will never settle; `reason` says why (`BadSignature`, `OverPaymentCap`, `SessionRevokedErr`, `VoucherExpired`, `FeeTooLow`, `ValidityTooLong`, …) | Show failed |
| `retry` | Could not settle now (`OverDailyCap`, `InsufficientBalance`, `ChainUnavailable`, `RateLimited`, `AgentDailyCapReached`, `AgentGasBudgetReached`) | Keep it, send it again later |
| `unknown` | The agent has never seen this voucher | Send the voucher itself |

The receipt signature is EIP-712, domain `{name: "Bridgewise Settlement Agent", version: "1", chainId, verifyingContract: vault}`:

```
Receipt(bytes32 sessionId,bytes32 nonce,uint8 status,string reason,bytes32 txHash,uint256 fee,uint64 issuedAt)
status: 0 unknown, 1 submitted, 2 confirmed, 3 rejected, 4 retry
```

## Endpoints

| Endpoint | Auth | What |
|---|---|---|
| `POST /mesh/webhook` | `Mesh-Signature` | The Mesh Cloud's webhook |
| `POST /v1/vouchers` | `x-api-key: $TEST_API_KEY` | Same messages without the mesh, for curl tests |
| `GET /v1/vouchers/:sessionId/:nonce` | none | Receipt for a voucher (public data) |
| `GET /health` | none | Chain, agent address, gas balance, counts. 503 when gas is low |
| `POST /v1/owner/deposit` | the owner's tUSD8 permit | Deposit into the vault without tQDAY (`depositWithPermit`) |
| `POST /v1/owner/session` | the owner's signature | Add a phone key with limits (`openSessionBySig`) |
| `POST /v1/owner/revoke` | the owner's signature | Remove a phone key (`revokeBySig`) |
| `POST /v1/owner/withdraw` | the owner's signature | Take money back out (`withdrawBySig`) |
| `GET /activity` | none | Activity page: every vault event read from the chain, with explorer links |
| `GET /v1/activity` | none | The same as JSON |
| `GET /live` | none | Liveness only (Docker and the deploy check) |

## Run locally

```bash
cd agent
npm ci
cp .env.example .env      # fill it in
npm run dev
```

Tests run against a local node with the real contracts (needs Foundry):

```bash
forge build               # in the repo root, once
cd agent && npm test
```

## Deploy on a server that already runs other apps

The container listens on `127.0.0.1:8787` only, so it never competes for ports 80 and 443.
Your existing reverse proxy forwards `agent.lorapay.io` to it.

1. **DNS.** Add an A record `agent` pointing to the server's IP.
2. **Code and settings.**
   ```bash
   git clone https://github.com/Lorapay-Bridgewise/bridgewise-aevum-pay.git
   cd bridgewise-aevum-pay/agent
   cp .env.example .env && nano .env
   ```
3. **Start it.**
   ```bash
   docker compose up -d --build
   curl -s http://127.0.0.1:8787/health
   ```
4. **Reverse proxy.** Add a site for `agent.lorapay.io` that forwards to `http://127.0.0.1:8787`.
   For nginx on the host:
   ```nginx
   server {
       server_name agent.lorapay.io;
       location / {
           proxy_pass http://127.0.0.1:8787;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_read_timeout 15s;
       }
       listen 80;
   }
   ```
   Then `sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx -d agent.lorapay.io`.
5. **Connect the Cloud.** In `https://mesh.lorapay.io/portal`, set the webhook URL to
   `https://agent.lorapay.io/mesh/webhook`, copy the webhook secret into `.env` as
   `MESH_WEBHOOK_SECRET`, and run `docker compose up -d` again.

Logs: `docker compose logs -f agent`. The database lives in the `agent-data` volume and survives
rebuilds and rollbacks.

## Automatic deploys (GitHub Actions)

`.github/workflows/agent.yml` runs on every push to `main` that touches `agent/` or the contracts:

1. **Test:** `forge build`, `forge test`, then the agent's type check and tests against a local chain.
2. **Deploy** (only if the tests pass): SSH to the server, check out that exact commit, and run
   `agent/deploy/remote-deploy.sh`. It builds an image tagged with the commit, starts it, and waits
   for `/live` to answer. If it does not answer within a minute, it switches back to the previous image
   and the job fails. The three newest images are kept for rollbacks.

Pull requests run the tests only. You can also start a deploy by hand from the Actions tab.

### One-time setup

**On the server** (as root or with sudo). This uses the server's existing Docker; nothing else changes.

```bash
adduser --disabled-password --gecos "" deploy        # skip if a deploy user exists
usermod -aG docker deploy
mkdir -p /opt/bwpay-agent && chown deploy:deploy /opt/bwpay-agent
sudo -u deploy git clone https://github.com/Lorapay-Bridgewise/bridgewise-aevum-pay.git /opt/bwpay-agent
sudo -u deploy cp /opt/bwpay-agent/agent/.env.example /opt/bwpay-agent/agent/.env
sudo -u deploy nano /opt/bwpay-agent/agent/.env
```

Membership of the `docker` group gives the deploy user full control of Docker on this server,
so its SSH key is only ever stored in GitHub secrets.

**A deploy key** (on your PC, in Git Bash):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/bwpay_deploy -N "" -C "github-actions-bwpay"
cat ~/.ssh/bwpay_deploy.pub        # add this line to /home/deploy/.ssh/authorized_keys on the server
ssh-keyscan -p 22 YOUR_SERVER_IP   # the output is SSH_KNOWN_HOSTS
```

On the server, as the deploy user:

```bash
sudo -u deploy mkdir -p /home/deploy/.ssh && sudo -u deploy chmod 700 /home/deploy/.ssh
sudo -u deploy nano /home/deploy/.ssh/authorized_keys      # paste the .pub line
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

**GitHub repository secrets** (Settings, Secrets and variables, Actions):

| Secret | Value |
|---|---|
| `SSH_HOST` | The server's IP address |
| `SSH_USER` | `deploy` |
| `SSH_PRIVATE_KEY` | The whole content of `~/.ssh/bwpay_deploy`, including the BEGIN and END lines |
| `SSH_KNOWN_HOSTS` | The output of `ssh-keyscan` |
| `SSH_PORT` | Only if SSH is not on port 22 |

Optional repository variable `AGENT_DIR` if the repo is not cloned to `/opt/bwpay-agent`.
