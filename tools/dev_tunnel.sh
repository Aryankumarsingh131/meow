#!/usr/bin/env bash
# Local API against the hosted Supabase (staging + synthetic), exposed through
# ngrok so phones and residents can reach it. Run from the repo root:
#   bash tools/dev_tunnel.sh
# Ctrl+C stops both. Supabase credentials stay in .env (read by the API);
# nothing here prints or copies them. The public URL is written to
# apps/mobile/.env (gitignored) so `npx expo start` bundles it.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8000}"
# The app's HOSTED_API_BASE (apps/mobile/src/api.ts). Change both together.
NGROK_URL="${NGROK_URL:-https://angelfish-juice-refresh.ngrok-free.dev}"

JALSAKSHI_ENVIRONMENT=staging python -m uvicorn services.api.app.main:app --host 0.0.0.0 --port "$PORT" &   # LAN phones reach the internal DB offline
API=$!
ngrok http "$PORT" --url "$NGROK_URL" --log=stdout > .ngrok.log &
TUNNEL=$!
trap 'kill $API $TUNNEL 2>/dev/null' EXIT

URL=""
for _ in $(seq 30); do
  URL=$(curl -s http://127.0.0.1:4040/api/tunnels | python -c "import json,sys; t=json.load(sys.stdin)['tunnels']; print(t[0]['public_url'] if t else '')" 2>/dev/null || true)
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "ngrok did not start; see .ngrok.log"; exit 1; }

ENV_FILE=apps/mobile/.env
touch "$ENV_FILE"
{ grep -v '^EXPO_PUBLIC_API_BASE=' "$ENV_FILE" || true; echo "EXPO_PUBLIC_API_BASE=$URL"; } > "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"

echo
echo "API:    $URL  (-> localhost:$PORT)"
echo "Portal: $URL/portal   <- the resident link to share or print as a QR code"
echo "Check:  curl $URL/auth/config"
echo "Mobile: cd apps/mobile && npx expo start   ($ENV_FILE now points at $URL)"
echo
wait $API
