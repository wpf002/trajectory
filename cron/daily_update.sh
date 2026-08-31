#!/usr/bin/env bash
# Trajectory daily-forecast cron helper.
#
# Ensures the production server is running and prints the API base URL on
# stdout so the caller can curl against it. Everything else goes to stderr.
#
# Usage:  cron/daily_update.sh
# Env:    PORT (default 5000), LOG (default /tmp/trajectory-server.log)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-5000}"
LOG="${LOG:-/tmp/trajectory-server.log}"
BASE="http://localhost:${PORT}"

ready() { curl -sSf "${BASE}/api/scenarios" >/dev/null 2>&1; }

if ! ready; then
  echo "[trajectory-cron] Server not responding on ${PORT} — starting it." >&2
  if [ ! -f "${REPO_ROOT}/dist/index.cjs" ]; then
    echo "[trajectory-cron] dist/index.cjs missing — running build." >&2
    (cd "${REPO_ROOT}" && npm run build >>"$LOG" 2>&1)
  fi
  (cd "${REPO_ROOT}" && nohup env NODE_ENV=production PORT="${PORT}" \
    node dist/index.cjs >>"$LOG" 2>&1 &)
  for i in $(seq 1 15); do
    ready && { echo "[trajectory-cron] Ready after ${i}s." >&2; break; }
    sleep 1
  done
fi

if ! ready; then
  echo "[trajectory-cron] ERROR: server did not come up. Last 50 log lines:" >&2
  tail -50 "$LOG" >&2 || true
  exit 1
fi

# Collect fresh signals, then snapshot the forecast so history keeps advancing.
curl -sSf -X POST "${BASE}/api/collectors/run" \
  -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1 \
  || echo "[trajectory-cron] WARN: collector run failed." >&2
curl -sSf -X POST "${BASE}/api/watchlist/evaluate" \
  -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1 \
  || echo "[trajectory-cron] WARN: watchlist evaluation failed." >&2

echo "${BASE}"
