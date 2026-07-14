#!/bin/bash
set -e

# Upload Worker Secrets Script
# One script to upload secrets and vars to all workers across all environments
#
#   ./upload-worker-secrets.sh <environment> <worker-name> [target-worker-name]
#
# Environments: production, preview, test
# Workers: ecom-api, content-api, identity-api, organization-api, notifications-api, admin-api, media-api, auth
# Target Worker Name (optional): Override the destination worker name (e.g. for PR builds)
#
# Environment variables required (set via GitHub Actions):
#   - CLOUDFLARE_API_TOKEN
#   - CLOUDFLARE_ACCOUNT_ID
#   - DATABASE_URL (secret)
#   - R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (secrets)
#   - R2_BUCKET_MEDIA, R2_BUCKET_ASSETS, R2_BUCKET_PLATFORM, R2_BUCKET_RESOURCES (vars)
#   - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET_* (secrets, ecom-api only)
#   - BETTER_AUTH_SECRET, SESSION_SECRET (secrets, auth only)
#   - RUNPOD_* (secrets, media-api only)
#   - WORKER_SHARED_SECRET (secret, every worker that makes or receives a
#     worker-to-worker HMAC call: auth, content-api, ecom-api, organization-api,
#     identity-api, notifications-api, media-api — NOT admin-api)
#   - RESEND_API_KEY (secret, notifications-api only)

ENVIRONMENT=$1
WORKER=$2
TARGET_WORKER_NAME=$3

if [ -z "$ENVIRONMENT" ] || [ -z "$WORKER" ]; then
  echo "Usage: $0 <environment> <worker-name> [target-worker-name]"
  echo "  Environments: production, preview, test"
  echo "  Workers: ecom-api, content-api, identity-api, organization-api, notifications-api, admin-api, media-api, auth"
  exit 1
fi

# Determine worker name
if [ -n "$TARGET_WORKER_NAME" ]; then
  # Use explicit target name if provided (e.g. media-api-preview-123)
  WORKER_NAME="$TARGET_WORKER_NAME"
else
  # Auto-generate name based on environment suffix
  case "$ENVIRONMENT" in
    production)
      WORKER_SUFFIX="-production"
      ;;
    dev)
      WORKER_SUFFIX="-dev"
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

  # Map worker argument to actual worker name prefix (auth -> auth-worker)
  case "$WORKER" in
    auth)
      WORKER_BASE="auth-worker"
      ;;
    *)
      WORKER_BASE="$WORKER"
      ;;
  esac

  WORKER_NAME="${WORKER_BASE}${WORKER_SUFFIX}"
fi

echo "📤 Uploading secrets to ${WORKER_NAME}..."

# Build secrets JSON based on worker type
# Note: R2_BUCKET_* are passed as --var during deploy, not as secrets
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
  "WORKER_SHARED_SECRET":"${WORKER_SHARED_SECRET:-}"
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
  "WORKER_SHARED_SECRET":"${WORKER_SHARED_SECRET:-}"
}
EOF
)
    ;;

  identity-api)
    # WORKER_SHARED_SECRET required: identity-api exposes a worker-HMAC
    # membership lookup endpoint that auth uses to resolve org context.
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  "WORKER_SHARED_SECRET":"${WORKER_SHARED_SECRET:-}"
}
EOF
)
    ;;

  admin-api)
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}"
}
EOF
)
    ;;

  organization-api)
    # CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID are used by
    # DevDomainService to provision Cloudflare Workers Custom Domains
    # for new orgs in the dev environment. They're harmless to inject
    # in non-dev environments (the service no-ops outside ENVIRONMENT=dev).
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  "CLOUDFLARE_API_TOKEN":"${CLOUDFLARE_API_TOKEN:-}",
  "CLOUDFLARE_ACCOUNT_ID":"${CLOUDFLARE_ACCOUNT_ID:-}",
  "WORKER_SHARED_SECRET":"${WORKER_SHARED_SECRET:-}"
}
EOF
)
    ;;

  notifications-api)
    # WORKER_SHARED_SECRET required: notifications-api accepts worker-HMAC
    # signed /internal/send calls from other workers (auth → welcome email,
    # org-api → invite email, etc).
    # RESEND_API_KEY required in production: the email service (service-registry.ts)
    # throws on the FIRST send when USE_MOCK_EMAIL is unset and RESEND_API_KEY is
    # absent. It is OPTIONAL at boot, so a missing key silently passes /health and
    # only fails when an email is actually sent — hence it must be pushed here.
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  "WORKER_SHARED_SECRET":"${WORKER_SHARED_SECRET:-}",
  "RESEND_API_KEY":"${RESEND_API_KEY:-}"
}
EOF
)
    ;;

  media-api)
    # Fail-fast on unset/empty RunPod secrets. `set -e` does NOT catch unset vars
    # (no `set -u`), so a missing GitHub secret would otherwise expand to "" and
    # silently upload an EMPTY secret — the transcoding getter then throws inside
    # waitUntil, invisibly (passes /health, fails only when a transcode dispatches).
    # ${VAR:?msg} aborts the deploy with a clear message. media-api secrets are
    # uploaded ONLY for production (deploy-production.yml), where all are required,
    # so this guard never runs in preview/test. (Codex-fc5oh.6)
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL:?DATABASE_URL is required for media-api}",
  "RUNPOD_API_KEY":"${RUNPOD_API_KEY:?RUNPOD_API_KEY is required for media-api transcoding}",
  "RUNPOD_ENDPOINT_ID":"${RUNPOD_ENDPOINT_ID:?RUNPOD_ENDPOINT_ID is required for media-api transcoding}",
  "RUNPOD_WEBHOOK_SECRET":"${RUNPOD_WEBHOOK_SECRET:?RUNPOD_WEBHOOK_SECRET is required for media-api transcoding}",
  "WORKER_SHARED_SECRET":"${WORKER_SHARED_SECRET:?WORKER_SHARED_SECRET is required for media-api}"
}
EOF
)
    ;;

  auth)
    # WORKER_SHARED_SECRET: auth signs worker-HMAC calls to notifications-api for
    # transactional email (welcome / verification) via sendEmailToWorker (email.ts).
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  "SESSION_SECRET":"${SESSION_SECRET}",
  "BETTER_AUTH_SECRET":"${BETTER_AUTH_SECRET}",
  "WORKER_SHARED_SECRET":"${WORKER_SHARED_SECRET:-}"
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
