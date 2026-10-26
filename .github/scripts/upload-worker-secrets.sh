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
#   - STRIPE_SECRET_KEY (secret, the platform's full key: ecom-api —
#     purchase/subscription/connect/course-subscription — and organization-api,
#     which owns subscription-tier creation. No other worker gets it; do not
#     add it elsewhere without a Stripe-backed service there.)
#   - ADMIN_API_STRIPE_RESTRICTED_KEY (secret, admin-api only, OPTIONAL):
#     admin-api's OWN restricted key for support refunds (Codex-2hxff.28,
#     owner decision Q4; Codex-5vvwj.2), uploaded as admin-api's
#     STRIPE_SECRET_KEY. Sent only when set and of this environment's mode
#     (rk_live_ in production, rk_test_ elsewhere); unset is a ::warning::,
#     any other value an ::error:: and not sent. Either way the deploy still
#     succeeds and only the support refund routes fail.
#   - STRIPE_WEBHOOK_SECRET_* (secrets, ecom-api only — it owns all Stripe webhooks)
#   - STRIPE_PORTAL_CONFIGURATION_ID (secret, ecom-api only — the locked Billing
#     Portal configuration, bpc_...; without it the portal refuses to open).
#     Sent only when set and a bpc_ id (Codex-2hxff.41); unset is a
#     ::warning::, any other value an ::error:: and not sent. Either way the
#     deploy carries on and ecom-api keeps the value it already holds.
#   - BETTER_AUTH_SECRET, SESSION_SECRET (secrets, auth only)
#   - RUNPOD_* (secrets, media-api only)
#   - WORKER_SHARED_SECRET (secret, every worker that makes or receives a
#     worker-to-worker HMAC call: auth, content-api, ecom-api, organization-api,
#     identity-api, notifications-api, media-api — NOT admin-api)
#   - RESEND_API_KEY (secret, notifications-api only)
#   - CF_ZONE_ID, CF_API_TOKEN (secrets, identity-api only — the CDN cache purge
#     that takes a deleted account's avatars off the edge, Codex-kk9nv.15. The
#     token needs only the zone's Cache Purge permission. Empty = purge skipped,
#     logged at error in production. Set them here, never by `wrangler secret
#     put`: every deploy re-uploads this JSON and would blank a manual value.)

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
    # STRIPE_PORTAL_CONFIGURATION_ID is sent ONLY when set and a bpc_ id
    # (Codex-2hxff.41), the admin-api key pattern below. An empty value would
    # overwrite the working configuration with "", and the portal then refuses
    # every subscriber's "Manage billing". Leaving the key out keeps what
    # ecom-api already holds. Never ${VAR:?}: ecom-api is DEPLOYED before this
    # step runs, so an abort would leave its new code on stale secrets and skip
    # every worker deployed after it. Unset is a warning; any other value an
    # error and not sent. A bpc_ id carries no live/test mode, so there is no
    # mode check like admin-api's.
    PORTAL_JSON=""
    if [ -z "${STRIPE_PORTAL_CONFIGURATION_ID:-}" ]; then
      echo "::warning title=ecom-api portal config::STRIPE_PORTAL_CONFIGURATION_ID is not set: ecom-api's value is left as it is, and the billing portal refuses to open without one"
    elif [[ "$STRIPE_PORTAL_CONFIGURATION_ID" != bpc_* ]]; then
      echo "::error title=ecom-api portal config::STRIPE_PORTAL_CONFIGURATION_ID does not start with bpc_: not uploaded, ecom-api's value is left as it is"
    else
      PORTAL_JSON=",
  \"STRIPE_PORTAL_CONFIGURATION_ID\":\"${STRIPE_PORTAL_CONFIGURATION_ID}\""
    fi
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
  "WORKER_SHARED_SECRET":"${WORKER_SHARED_SECRET:-}"${PORTAL_JSON}
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
    # CF_ZONE_ID + CF_API_TOKEN: the account-deletion CDN purge (see header).
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  "WORKER_SHARED_SECRET":"${WORKER_SHARED_SECRET:-}",
  "CF_ZONE_ID":"${CF_ZONE_ID:-}",
  "CF_API_TOKEN":"${CF_API_TOKEN:-}"
}
EOF
)
    ;;

  admin-api)
    # STRIPE_SECRET_KEY comes from ADMIN_API_STRIPE_RESTRICTED_KEY, never from
    # STRIPE_SECRET_KEY (ecom-api's full key): support refunds use admin-api's
    # own restricted key (Codex-2hxff.28, owner decision Q4). It is sent ONLY
    # when set and non-empty. `secret bulk` writes just the keys it is given,
    # so leaving it out keeps whatever admin-api already holds, where an empty
    # value would overwrite a working key with "". Without it the deploy still
    # succeeds; only the support refund routes need it.
    #
    # It must be a RESTRICTED key of this environment's mode (silent F8):
    # rk_live_ in production, rk_test_ elsewhere. A full sk_ key would defeat
    # the restriction, and a test key in production makes every live charge
    # "unknown". Anything else is reported as a GitHub error annotation and
    # NOT uploaded; the deploy carries on. An unset key is a warning.
    if [ "$ENVIRONMENT" = "production" ]; then
      ADMIN_API_KEY_PREFIX="rk_live_"
    else
      ADMIN_API_KEY_PREFIX="rk_test_"
    fi
    ADMIN_API_STRIPE_JSON=""
    if [ -z "${ADMIN_API_STRIPE_RESTRICTED_KEY:-}" ]; then
      echo "::warning title=admin-api Stripe key::ADMIN_API_STRIPE_RESTRICTED_KEY is not set: admin-api's STRIPE_SECRET_KEY is left as it is, and support refunds fail without one"
    elif [[ "$ADMIN_API_STRIPE_RESTRICTED_KEY" != "$ADMIN_API_KEY_PREFIX"* ]]; then
      echo "::error title=admin-api Stripe key::ADMIN_API_STRIPE_RESTRICTED_KEY does not start with ${ADMIN_API_KEY_PREFIX}: not uploaded, admin-api's STRIPE_SECRET_KEY is left as it is"
    else
      ADMIN_API_STRIPE_JSON=",
  \"STRIPE_SECRET_KEY\":\"${ADMIN_API_STRIPE_RESTRICTED_KEY}\""
    fi
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}"${ADMIN_API_STRIPE_JSON}
}
EOF
)
    ;;

  organization-api)
    # CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID are used by
    # DevDomainService to provision Cloudflare Workers Custom Domains
    # for new orgs in the dev environment. They're harmless to inject
    # in non-dev environments (the service no-ops outside ENVIRONMENT=dev).
    #
    # STRIPE_SECRET_KEY required (Codex-1g5lh.1): organization-api owns the
    # subscription-tier write path — POST /api/organizations/:id/tiers ->
    # TierService.createTier -> stripe.products.create — because tiers are
    # org-scoped. It is OPTIONAL at boot, so a missing key passes /health and
    # every tier READ, then fails only when a creator actually creates a tier;
    # that is what shipped, and it returned a bare 500. Same failure shape as
    # media-api's RunPod secrets below, so the same ${VAR:?} fail-fast applies:
    # abort the deploy rather than upload an empty secret. Safe because this
    # script is only ever invoked for `production` (deploy-production.yml).
    SECRETS_JSON=$(cat <<EOF
{
  "DATABASE_URL":"${DATABASE_URL}",
  "CLOUDFLARE_API_TOKEN":"${CLOUDFLARE_API_TOKEN:-}",
  "CLOUDFLARE_ACCOUNT_ID":"${CLOUDFLARE_ACCOUNT_ID:-}",
  "STRIPE_SECRET_KEY":"${STRIPE_SECRET_KEY:?STRIPE_SECRET_KEY is required for organization-api subscription-tier creation}",
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
