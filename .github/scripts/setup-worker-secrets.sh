#!/bin/bash
set -e

# Script: setup-worker-secrets.sh
# Purpose: Configure secrets for Cloudflare Workers
# Usage: ./setup-worker-secrets.sh <worker_name>
#
# This script sets secrets for a single worker. It expects all secrets to be
# available as environment variables (passed from GitHub Actions or similar).
# The same script works for production, staging, and preview deployments -
# only the worker name and environment variable values differ.

WORKER_NAME=$1

if [ -z "$WORKER_NAME" ]; then
  echo "❌ Error: Worker name is required"
  echo "Usage: $0 <worker_name>"
  echo ""
  echo "Examples:"
  echo "  $0 ecom-api-production"
  echo "  $0 ecom-api-preview-123"
  echo "  $0 auth-worker-staging"
  exit 1
fi

# Validate Cloudflare credentials are available
if [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
  echo "❌ Error: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set"
  exit 1
fi

echo "🔐 Configuring secrets for worker: $WORKER_NAME"
echo ""

# Function to set a secret (silent on success, logs only errors)
set_secret() {
  local secret_name=$1
  local secret_value=$2

  if [ -z "$secret_value" ]; then
    echo "  ⚠️  Skipping $secret_name (not set in environment)"
    return 0
  fi

  echo "  Setting $secret_name..."
  if echo "$secret_value" | wrangler secret put "$secret_name" --name "$WORKER_NAME" 2>&1 | grep -v "Creating the secret" | grep -v "^$"; then
    return 0
  fi
}

# Determine worker type from name and set appropriate secrets
case "$WORKER_NAME" in
  auth-worker-* | *-auth | *-auth-*)
    echo "📝 Detected: Auth Worker"
    set_secret "DATABASE_URL" "$DATABASE_URL"
    set_secret "BETTER_AUTH_SECRET" "$BETTER_AUTH_SECRET"
    set_secret "SESSION_SECRET" "$SESSION_SECRET"
    ;;

  content-api-* | *-content-api | *-content-api-*)
    echo "📝 Detected: Content API Worker"
    set_secret "DATABASE_URL" "$DATABASE_URL"
    set_secret "R2_ACCOUNT_ID" "$R2_ACCOUNT_ID"
    set_secret "R2_ACCESS_KEY_ID" "$R2_ACCESS_KEY_ID"
    set_secret "R2_SECRET_ACCESS_KEY" "$R2_SECRET_ACCESS_KEY"
    set_secret "R2_BUCKET_MEDIA" "$R2_BUCKET_MEDIA"
    ;;

  identity-api-* | *-identity-api | *-identity-api-*)
    echo "📝 Detected: Identity API Worker"
    set_secret "DATABASE_URL" "$DATABASE_URL"
    ;;

  ecom-api-* | *-ecom-api | *-ecom-api-* | *-api | api-*)
    echo "📝 Detected: Ecom API Worker"
    set_secret "DATABASE_URL" "$DATABASE_URL"
    set_secret "STRIPE_SECRET_KEY" "$STRIPE_SECRET_KEY"
    set_secret "STRIPE_WEBHOOK_SECRET_BOOKING" "$STRIPE_WEBHOOK_SECRET_BOOKING"
    set_secret "STRIPE_WEBHOOK_SECRET_PAYMENT" "$STRIPE_WEBHOOK_SECRET_PAYMENT"
    set_secret "STRIPE_WEBHOOK_SECRET_SUBSCRIPTION" "$STRIPE_WEBHOOK_SECRET_SUBSCRIPTION"
    set_secret "STRIPE_WEBHOOK_SECRET_CONNECT" "$STRIPE_WEBHOOK_SECRET_CONNECT"
    set_secret "STRIPE_WEBHOOK_SECRET_CUSTOMER" "$STRIPE_WEBHOOK_SECRET_CUSTOMER"
    set_secret "STRIPE_WEBHOOK_SECRET_DISPUTE" "$STRIPE_WEBHOOK_SECRET_DISPUTE"
    ;;

  *-web | codex-web-* | web-*)
    echo "📝 Detected: Web App Worker"
    set_secret "DATABASE_URL" "$DATABASE_URL"
    ;;

  *)
    echo "❌ Error: Unknown worker type: $WORKER_NAME"
    echo "Cannot determine which secrets to set."
    echo ""
    echo "Supported patterns:"
    echo "  - auth-worker-*"
    echo "  - content-api-*"
    echo "  - identity-api-*"
    echo "  - ecom-api-*"
    echo "  - codex-web-*"
    exit 1
    ;;
esac

echo ""
echo "✅ Secrets configured for $WORKER_NAME"
