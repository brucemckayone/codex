#!/usr/bin/env bash
# Stripe webhook listener for local development
# Forwards checkout events from Stripe to the local ecom-api worker
#
# The signing secret is deterministic per API key + device,
# so STRIPE_WEBHOOK_SECRET_BOOKING in workers/ecom-api/.dev.vars stays stable.

set -euo pipefail

ECOM_API_PORT="${ECOM_API_PORT:-42072}"
FORWARD_URL="http://localhost:${ECOM_API_PORT}/webhooks/stripe/booking"
DEV_VARS="$(dirname "$0")/../../workers/ecom-api/.dev.vars"

# Read STRIPE_SECRET_KEY from ecom-api .dev.vars
if [[ ! -f "$DEV_VARS" ]]; then
  echo "Error: $DEV_VARS not found. Copy from .dev.vars.example first."
  exit 1
fi

STRIPE_KEY=$(grep '^STRIPE_SECRET_KEY=' "$DEV_VARS" | cut -d'=' -f2-)
if [[ -z "$STRIPE_KEY" ]]; then
  echo "Error: STRIPE_SECRET_KEY not found in $DEV_VARS"
  exit 1
fi

echo "[stripe-webhooks] Forwarding checkout events to $FORWARD_URL"

exec stripe listen \
  --forward-to "$FORWARD_URL" \
  --events checkout.session.completed,checkout.session.expired \
  --api-key "$STRIPE_KEY"
