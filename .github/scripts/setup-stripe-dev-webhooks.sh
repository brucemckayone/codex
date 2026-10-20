#!/usr/bin/env bash
set -euo pipefail

# One-time setup: create Stripe TEST-MODE webhook endpoints pointing at the
# dev environment's ecom-api worker, and print the resulting signing secrets.
# The user pastes each one into the GitHub `dev` environment.
#
# Prerequisites:
#   1. Stripe CLI installed (`stripe --version`)
#   2. Logged into Stripe CLI in test mode (`stripe login --interactive`)
#      — confirm with `stripe config --list` showing `test_mode_*` keys
#   3. Dev workers must already be live at *.dev.revelations.studio
#      (i.e. run this script AFTER the first deploy-dev.yml succeeds)
#
# Usage:
#   ./setup-stripe-dev-webhooks.sh
#
# If `gh` CLI is authenticated and you want secrets uploaded automatically:
#   ./setup-stripe-dev-webhooks.sh --upload
#
# Note: the --upload mode requires a GitHub token with permission to write
# environment secrets (default GITHUB_TOKEN does NOT have this; needs a PAT
# with repo scope). Without --upload, secrets are printed to stdout and you
# paste them into GitHub Settings → Environments → dev → Add secret.

UPLOAD=0
if [ "${1:-}" = "--upload" ]; then
  UPLOAD=1
fi

DEV_BASE="https://ecom-api.dev.revelations.studio/webhooks/stripe"

# Map endpoint URLs to the GitHub secret name that holds their signing secret.
# MIRRORS PRODUCTION: keep these in step with the endpoint table in
# docs/payments/operations.md ("Webhook endpoints (production)"). Fields:
# secret | url | events | scope ("connect" = a connected-accounts endpoint,
# which is the only kind that receives creators' account.updated).
declare -a ENDPOINTS=(
  "STRIPE_WEBHOOK_SECRET_BOOKING|${DEV_BASE}/booking|checkout.session.completed|platform"
  "STRIPE_WEBHOOK_SECRET_PAYMENT|${DEV_BASE}/payment|charge.refunded refund.updated refund.failed|platform"
  "STRIPE_WEBHOOK_SECRET_DISPUTE|${DEV_BASE}/dispute|charge.dispute.created charge.dispute.updated charge.dispute.closed charge.dispute.funds_withdrawn charge.dispute.funds_reinstated radar.early_fraud_warning.created|platform"
  "STRIPE_WEBHOOK_SECRET_SUBSCRIPTION|${DEV_BASE}/subscription|checkout.session.completed customer.subscription.updated customer.subscription.deleted customer.subscription.paused customer.subscription.resumed customer.subscription.trial_will_end invoice.payment_succeeded invoice.payment_failed product.updated price.created price.updated|platform"
  "STRIPE_WEBHOOK_SECRET_CONNECT|${DEV_BASE}/connect|account.updated account.application.deauthorized|connect"
)

# Verify we're in test mode
if ! stripe config --list | grep -q test_mode; then
  echo "❌ Stripe CLI is not in test mode. Run: stripe login --interactive"
  echo "   Confirm by running: stripe config --list"
  exit 1
fi

echo "🚀 Creating Stripe TEST-mode webhook endpoints for dev environment..."
echo ""

for entry in "${ENDPOINTS[@]}"; do
  IFS='|' read -r SECRET_NAME URL EVENTS SCOPE <<< "$entry"

  # Build --enabled-events args
  EVENT_ARGS=""
  for evt in $EVENTS; do
    EVENT_ARGS="$EVENT_ARGS --enabled-events $evt"
  done
  if [ "$SCOPE" = "connect" ]; then
    EVENT_ARGS="$EVENT_ARGS -d connect=true"
  fi

  echo "📍 Creating endpoint: $URL"
  # Stripe CLI returns JSON; jq extracts the signing secret
  RESPONSE=$(stripe webhook_endpoints create \
    --url "$URL" \
    $EVENT_ARGS \
    --description "Dev environment ($SECRET_NAME)")

  SIGNING_SECRET=$(echo "$RESPONSE" | jq -r '.secret')

  if [ -z "$SIGNING_SECRET" ] || [ "$SIGNING_SECRET" = "null" ]; then
    echo "❌ Failed to extract signing secret. Raw response:"
    echo "$RESPONSE"
    exit 1
  fi

  if [ "$UPLOAD" -eq 1 ]; then
    echo "$SIGNING_SECRET" | gh secret set "$SECRET_NAME" --env dev
    echo "   ✅ Uploaded as secrets.${SECRET_NAME} (dev env)"
  else
    echo "   ${SECRET_NAME} = ${SIGNING_SECRET}"
  fi
  echo ""
done

if [ "$UPLOAD" -eq 0 ]; then
  echo "📋 Copy each secret above into GitHub:"
  echo "   Settings → Environments → dev → Add environment secret"
  echo ""
  echo "Or re-run this script with --upload to upload via gh CLI."
fi

echo "✅ Done. Webhook endpoints created."
