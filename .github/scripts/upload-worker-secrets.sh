#!/bin/bash
set -e

# Upload Worker Secrets Script
# One script to upload secrets and vars to all workers across all environments
#
# Usage:
#   ./upload-worker-secrets.sh <environment> <worker-name>
#
# Environments: production, preview, test
# Workers: ecom-api, content-api, identity-api, organization-api, notifications-api, admin-api, auth
#
# Environment variables required (set via GitHub Actions):
#   - CLOUDFLARE_API_TOKEN
#   - CLOUDFLARE_ACCOUNT_ID
#   - DATABASE_URL (secret)
#   - R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (secrets)
#   - R2_BUCKET_MEDIA, R2_BUCKET_ASSETS, R2_BUCKET_PLATFORM, R2_BUCKET_RESOURCES (vars)
#   - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET_* (secrets, ecom-api only)
#   - BETTER_AUTH_SECRET, SESSION_SECRET (secrets, auth only)

ENVIRONMENT=$1
WORKER=$2

if [ -z "$ENVIRONMENT" ] || [ -z "$WORKER" ]; then
  echo "Usage: $0 <environment> <worker-name>"
  echo "  Environments: production, preview, test"
  echo "  Workers: ecom-api, content-api, identity-api, organization-api, notifications-api, admin-api, auth"
  exit 1
fi

# Determine worker name suffix based on environment
case "$ENVIRONMENT" in
  production)
    WORKER_SUFFIX="-production"
    ;;
  preview)
    WORKER_SUFFIX="-preview"
    ;;
  test)
    WORKER_SUFFIX="-test"
    ;;
  *)
    echo "❌ Unknown environment: $ENVIRONMENT"
    exit 1
    ;;
esac

# Map worker argument to actual worker name (auth -> auth-worker)
case "$WORKER" in
  auth)
    WORKER_BASE="auth-worker"
    ;;
  *)
    WORKER_BASE="$WORKER"
    ;;
esac

WORKER_NAME="${WORKER_BASE}${WORKER_SUFFIX}"
echo "📤 Uploading secrets to ${WORKER_NAME}..."

# Common R2 bucket vars (available to all workers)
R2_BUCKETS=$(cat <<EOF
"R2_BUCKET_MEDIA":"${R2_BUCKET_MEDIA}",
"R2_BUCKET_ASSETS":"${R2_BUCKET_ASSETS}",
"R2_BUCKET_PLATFORM":"${R2_BUCKET_PLATFORM}",
"R2_BUCKET_RESOURCES":"${R2_BUCKET_RESOURCES}"
EOF
)

# Build secrets JSON based on worker type
case "$WORKER" in
  ecom-api)
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  "STRIPE_SECRET_KEY":"${STRIPE_SECRET_KEY}",
  "STRIPE_WEBHOOK_SECRET_PAYMENT":"${STRIPE_WEBHOOK_SECRET_PAYMENT}",
  "STRIPE_WEBHOOK_SECRET_SUBSCRIPTION":"${STRIPE_WEBHOOK_SECRET_SUBSCRIPTION}",
  "STRIPE_WEBHOOK_SECRET_CONNECT":"${STRIPE_WEBHOOK_SECRET_CONNECT}",
  "STRIPE_WEBHOOK_SECRET_CUSTOMER":"${STRIPE_WEBHOOK_SECRET_CUSTOMER}",
  "STRIPE_WEBHOOK_SECRET_BOOKING":"${STRIPE_WEBHOOK_SECRET_BOOKING}",
  "STRIPE_WEBHOOK_SECRET_DISPUTE":"${STRIPE_WEBHOOK_SECRET_DISPUTE}",
  ${R2_BUCKETS}
}
EOF
)
    ;;

  content-api)
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  "R2_ACCOUNT_ID":"${R2_ACCOUNT_ID}",
  "R2_ACCESS_KEY_ID":"${R2_ACCESS_KEY_ID}",
  "R2_SECRET_ACCESS_KEY":"${R2_SECRET_ACCESS_KEY}",
  ${R2_BUCKETS}
}
EOF
)
    ;;

  identity-api)
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  ${R2_BUCKETS}
}
EOF
)
    ;;

  admin-api)
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  ${R2_BUCKETS}
}
EOF
)
    ;;

  organization-api)
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  ${R2_BUCKETS}
}
EOF
)
    ;;

  notifications-api)
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  ${R2_BUCKETS}
}
EOF
)
    ;;

  media-api)
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  "RUNPOD_API_KEY":"${RUNPOD_API_KEY}",
  "RUNPOD_ENDPOINT_ID":"${RUNPOD_ENDPOINT_ID}",
  "RUNPOD_WEBHOOK_SECRET":"${RUNPOD_WEBHOOK_SECRET}",
  "WORKER_SHARED_SECRET":"${WORKER_SHARED_SECRET}",
  "B2_ENDPOINT":"${B2_ENDPOINT}",
  "B2_KEY_ID":"${B2_KEY_ID}",
  "B2_APP_KEY":"${B2_APP_KEY}",
  "B2_BUCKET":"${B2_BUCKET}",
  ${R2_BUCKETS}
}
EOF
)
    ;;

  auth)
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  "SESSION_SECRET":"${SESSION_SECRET}",
  "BETTER_AUTH_SECRET":"${BETTER_AUTH_SECRET}",
  ${R2_BUCKETS}
}
EOF
)
    ;;

  *)
    echo "❌ Unknown worker: $WORKER"
    exit 1
    ;;
esac

# Remove newlines and extra spaces from JSON
SECRETS_JSON=$(echo "$SECRETS_JSON" | tr -d '\n' | sed 's/  */ /g')

# Upload secrets via wrangler
echo "$SECRETS_JSON" | npx wrangler secret bulk --name "$WORKER_NAME"

echo "✅ Secrets uploaded to ${WORKER_NAME}"
