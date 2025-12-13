#!/bin/bash
# Cleanup deprecated repository-level secrets
# Run this AFTER updating workflows to use environment-specific secrets
#
# Prerequisites:
# - gh CLI installed and authenticated
# - Workflows already updated to use environment secrets
#
# Usage: ./cleanup-repo-secrets.sh [--dry-run]

set -e

DRY_RUN=false
if [ "$1" == "--dry-run" ]; then
    DRY_RUN=true
    echo "=== DRY RUN MODE - No changes will be made ==="
    echo ""
fi

REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

echo "Cleaning up deprecated repository-level secrets for: $REPO"
echo ""

# Secrets to delete (environment-specific, should not be at repo level)
DEPRECATED_SECRETS=(
    # Stripe test secrets (moved to test/preview environments)
    "STRIPE_TEST_KEY"
    "STRIPE_TEST_BOOKING_WEBHOOK_SECRET"
    "STRIPE_TEST_CONNECT_WEBHOOK_SECRET"
    "STRIPE_TEST_CUSTOMER_WEBHOOK_SECRET"
    "STRIPE_TEST_DISPUTE_WEBHOOK_SECRET"
    "STRIPE_TEST_PAYMENT_WEBHOOK_SECRET"
    "STRIPE_TEST_SUBSCRIPTION_WEBHOOK_SECRET"

    # Stripe production secrets (moved to production environment)
    "STRIPE_PRODUCTION_KEY"
    "STRIPE_PRODUCTION_BOOKING_WEBHOOK_SECRET"
    "STRIPE_PRODUCTION_CONNECT_WEBHOOK_SECRET"
    "STRIPE_PRODUCTION_CUSTOMER_WEBHOOK_SECRET"
    "STRIPE_PRODUCTION_DISPUTE_WEBHOOK_SECRET"
    "STRIPE_PRODUCTION_PAYMENT_WEBHOOK_SECRET"
    "STRIPE_PRODUCTION_SUBSCRIPTION_WEBHOOK_SECRET"

    # Auth secrets with environment suffix (moved to environments)
    "BETTER_AUTH_SECRET_PRODUCTION"
    "SESSION_SECRET_PRODUCTION"
    "SESSION_SECRET"  # Ambiguous, now in each environment

    # Database URL (use DATABASE_URL in production environment)
    "NEON_PRODUCTION_URL"
)

echo "=== Repository secrets to remove ==="
echo ""

# Get current secrets
CURRENT_SECRETS=$(gh secret list --json name -q '.[].name')

deleted_count=0
skipped_count=0

for secret in "${DEPRECATED_SECRETS[@]}"; do
    if echo "$CURRENT_SECRETS" | grep -q "^${secret}$"; then
        if [ "$DRY_RUN" == true ]; then
            echo "  [DRY RUN] Would delete: $secret"
        else
            echo "  Deleting: $secret"
            gh secret delete "$secret" --repo "$REPO" 2>/dev/null || echo "    Failed to delete $secret"
        fi
        ((deleted_count++))
    else
        echo "  Skipped (not found): $secret"
        ((skipped_count++))
    fi
done

echo ""
echo "=== Summary ==="
if [ "$DRY_RUN" == true ]; then
    echo "Would delete: $deleted_count secrets"
else
    echo "Deleted: $deleted_count secrets"
fi
echo "Skipped (not found): $skipped_count secrets"

echo ""
echo "=== Secrets to KEEP at repository level ==="
echo "These are shared infrastructure secrets and should remain:"
echo ""
echo "  - CLOUDFLARE_ACCOUNT_ID"
echo "  - CLOUDFLARE_API_TOKEN"
echo "  - CLOUDFLARE_DNS_API_TOKEN"
echo "  - CLOUDFLARE_ZONE_ID"
echo "  - NEON_API_KEY"
echo "  - R2_ACCESS_KEY_ID"
echo "  - R2_ACCOUNT_ID"
echo "  - R2_SECRET_ACCESS_KEY"
echo "  - TURBO_TOKEN"
echo "  - WORKER_SHARED_SECRET"
echo "  - CLAUDE_CODE_OAUTH_TOKEN"
echo ""

if [ "$DRY_RUN" == true ]; then
    echo "Run without --dry-run to actually delete secrets."
else
    echo "Done! Repository secrets cleaned up."
fi
