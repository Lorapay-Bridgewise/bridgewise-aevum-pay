#!/usr/bin/env bash
# Runs on the server, from the GitHub Actions deploy job, after the repo is checked out at the
# commit being deployed. Builds the agent image tagged with that commit, starts it, checks it
# answers, and goes back to the previous image if it does not.
#
#   bash agent/deploy/remote-deploy.sh <commit sha>
set -euo pipefail

SHA="${1:?usage: remote-deploy.sh <commit sha>}"
cd "$(dirname "$0")/.."   # the agent/ folder

if [[ ! -f .env ]]; then
  echo "agent/.env is missing on the server. Copy .env.example to .env and fill it in first." >&2
  exit 1
fi

PORT="$(grep -E '^AGENT_HOST_PORT=' .env | cut -d= -f2 | tr -d '[:space:]' || true)"
PORT="${PORT:-8787}"
PREV="$(cat .deployed-sha 2>/dev/null || true)"

echo "Deploying ${SHA:0:12} (previous: ${PREV:0:12})"
export AGENT_TAG="$SHA"
docker compose build --pull
docker compose up -d --remove-orphans

ok=""
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/live" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done

if [[ -z "$ok" ]]; then
  echo "The new version did not answer on port ${PORT}. Last logs:" >&2
  docker compose logs --tail 60 agent >&2 || true
  if [[ -n "$PREV" ]] && docker image inspect "bwpay-agent:${PREV}" >/dev/null 2>&1; then
    echo "Rolling back to ${PREV:0:12}" >&2
    AGENT_TAG="$PREV" docker compose up -d --remove-orphans
  fi
  exit 1
fi

echo "$SHA" > .deployed-sha
docker tag "bwpay-agent:${SHA}" bwpay-agent:latest
echo "Live on port ${PORT}:"
curl -sS "http://127.0.0.1:${PORT}/health" || true
echo

# Keep the three newest commit images for rollbacks; remove older ones.
docker images bwpay-agent --format '{{.Tag}}' | grep -v '^latest$' | tail -n +4 \
  | xargs -r -I{} docker rmi "bwpay-agent:{}" >/dev/null 2>&1 || true
