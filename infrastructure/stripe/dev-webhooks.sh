#!/usr/bin/env bash
# Stripe webhook listener for local development
#
# Forwards ALL Stripe events to the dev catch-all endpoint which routes
# them to the correct handler by event type.
#
# The signing secret is deterministic per API key + device,
# so STRIPE_WEBHOOK_SECRET_BOOKING in workers/ecom-api/.dev.vars stays stable.
# Set ALL STRIPE_WEBHOOK_SECRET_* vars to the same value in .dev.vars.
#
# Production uses separate endpoints with per-endpoint secrets configured
# in the Stripe Dashboard. This script is for local development only.

set -euo pipefail

ECOM_API_PORT="${ECOM_API_PORT:-42072}"
FORWARD_URL="http://localhost:${ECOM_API_PORT}/webhooks/stripe/dev"
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

echo "[stripe-webhooks] Forwarding all events to $FORWARD_URL"
echo "[stripe-webhooks] Events will be routed to handlers by type (checkout, subscription, connect)"
echo ""
echo "  Ensure ALL STRIPE_WEBHOOK_SECRET_* vars in .dev.vars match the CLI signing secret."
echo ""

exec stripe listen \
  --forward-to "$FORWARD_URL" \
  --events checkout.session.completed,checkout.session.expired,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_succeeded,invoice.payment_failed,account.updated \
  --api-key "$STRIPE_KEY"
