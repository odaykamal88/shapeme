#!/usr/bin/env bash
# One-time deploy of the body tracker to your Vercel account.
# Run from this folder on your Mac:  bash setup.sh
set -euo pipefail

echo "1/5  Linking to Vercel (a browser window may open to log in)…"
npx --yes vercel@latest project add odey-body-tracker >/dev/null 2>&1 || true
npx --yes vercel@latest link --yes --project odey-body-tracker

echo
echo "2/5  Blob storage. In the Vercel dashboard: project 'odey-body-tracker' → Storage → Create → Blob"
echo "     → name it 'body-tracker' → Connect to the project (all environments)."
read -r -p "     Press Enter once it's connected… "

echo
echo "3/5  Secrets. Paste them here (nothing is shown as you type)."
read -r -s -p "     Telegram bot token from @BotFather: " TG; echo
read -r -s -p "     Anthropic API key (console.anthropic.com): " AK; echo

gen() { openssl rand -hex 16; }
WEBHOOK_SECRET=$(gen); DASHBOARD_KEY=$(gen); DATA_KEY=$(gen); CRON_SECRET=$(gen)

add() { printf '%s' "$2" | npx --yes vercel@latest env add "$1" production --force >/dev/null && echo "     set $1"; }
add TELEGRAM_BOT_TOKEN "$TG"
add ANTHROPIC_API_KEY "$AK"
add WEBHOOK_SECRET "$WEBHOOK_SECRET"
add DASHBOARD_KEY "$DASHBOARD_KEY"
add DATA_KEY "$DATA_KEY"
add CRON_SECRET "$CRON_SECRET"

echo
echo "4/5  Deploying…"
OUT=$(npx --yes vercel@latest deploy --prod --yes 2>&1) || { echo "$OUT"; exit 1; }
# Use the production alias: generated deployment URLs sit behind Vercel's login wall.
BASE=$(echo "$OUT" | grep -i 'aliased' | grep -Eo 'https://[^ ]+' | head -1 || true)
[ -z "$BASE" ] && BASE="https://odey-body-tracker.vercel.app"
echo "     $BASE"

echo
echo "5/5  Pointing Telegram at the app…"
curl -s "$BASE/api/setup?key=$DASHBOARD_KEY"; echo

cat > .keys.local <<EOF
DASHBOARD=$BASE/?key=$DASHBOARD_KEY
STEPS_WEBHOOK=$BASE/api/steps?key=$DASHBOARD_KEY
DATA_KEY=$DATA_KEY
EOF

echo
echo "Done. Saved to .keys.local (keep it private):"
cat .keys.local
echo
echo "Now open your bot in Telegram and send /start."
