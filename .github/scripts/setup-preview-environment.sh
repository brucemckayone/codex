#!/bin/bash
# Setup preview environment in GitHub
# Run this script to create the preview environment with all required secrets and variables
#
# Prerequisites:
# - gh CLI installed and authenticated
# - Access to the repository
#
# Usage: ./setup-preview-environment.sh

set -e

REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
ENV_NAME="preview"

echo "Setting up '$ENV_NAME' environment for repository: $REPO"
echo ""

# Check if environment exists, create if not
if ! gh api "repos/$REPO/environments/$ENV_NAME" > /dev/null 2>&1; then
    echo "Creating environment '$ENV_NAME'..."
    gh api --method PUT "repos/$REPO/environments/$ENV_NAME"
else
    echo "Environment '$ENV_NAME' already exists"
fi

echo ""
echo "=== Setting Variables ==="

# Variables (non-sensitive, can be set directly)
gh variable set DB_METHOD --env "$ENV_NAME" --body "NEON_BRANCH"
echo "  DB_METHOD=NEON_BRANCH"

gh variable set NODE_ENV --env "$ENV_NAME" --body "preview"
echo "  NODE_ENV=preview"

gh variable set R2_BUCKET_ASSETS --env "$ENV_NAME" --body "codex-assets-preview"
echo "  R2_BUCKET_ASSETS=codex-assets-preview"

gh variable set R2_BUCKET_MEDIA --env "$ENV_NAME" --body "codex-media-preview"
echo "  R2_BUCKET_MEDIA=codex-media-preview"

gh variable set R2_BUCKET_PLATFORM --env "$ENV_NAME" --body "codex-platform-preview"
echo "  R2_BUCKET_PLATFORM=codex-platform-preview"

gh variable set R2_BUCKET_RESOURCES --env "$ENV_NAME" --body "codex-resources-preview"
echo "  R2_BUCKET_RESOURCES=codex-resources-preview"

# Copy STRIPE_PUBLISHABLE_KEY from test environment if it exists
TEST_PK=$(gh variable list --env test --json name,value -q '.[] | select(.name=="STRIPE_PUBLISHABLE_KEY") | .value' 2>/dev/null || echo "")
if [ -n "$TEST_PK" ]; then
    gh variable set STRIPE_PUBLISHABLE_KEY --env "$ENV_NAME" --body "$TEST_PK"
    echo "  STRIPE_PUBLISHABLE_KEY=(copied from test)"
else
    echo "  WARNING: STRIPE_PUBLISHABLE_KEY not found in test environment"
    echo "  You need to set this manually:"
    echo "    gh variable set STRIPE_PUBLISHABLE_KEY --env $ENV_NAME --body 'pk_test_...'"
fi

echo ""
echo "=== Setting Secrets ==="
echo "Secrets must be set interactively or from a secure source."
echo ""

# Generate new secrets for auth isolation
BETTER_AUTH_SECRET_PREVIEW=$(openssl rand -base64 32)
SESSION_SECRET_PREVIEW=$(openssl rand -base64 32)

echo "Generated new BETTER_AUTH_SECRET for preview environment"
echo "$BETTER_AUTH_SECRET_PREVIEW" | gh secret set BETTER_AUTH_SECRET --env "$ENV_NAME"
echo "  BETTER_AUTH_SECRET=<generated>"

echo "Generated new SESSION_SECRET for preview environment"
echo "$SESSION_SECRET_PREVIEW" | gh secret set SESSION_SECRET --env "$ENV_NAME"
echo "  SESSION_SECRET=<generated>"

echo ""
echo "Now copying Stripe secrets from test environment..."
echo "These use test-mode keys (same webhooks work for preview and test)"
echo ""

# List of Stripe secrets to copy from test
STRIPE_SECRETS=(
    "STRIPE_SECRET_KEY"
    "STRIPE_WEBHOOK_SECRET_BOOKING"
    "STRIPE_WEBHOOK_SECRET_CONNECT"
    "STRIPE_WEBHOOK_SECRET_CUSTOMER"
    "STRIPE_WEBHOOK_SECRET_DISPUTE"
    "STRIPE_WEBHOOK_SECRET_PAYMENT"
    "STRIPE_WEBHOOK_SECRET_SUBSCRIPTION"
)

echo "NOTE: GitHub CLI cannot copy secrets (values are hidden)."
echo "You need to manually copy these from the test environment:"
echo ""
echo "Go to: https://github.com/$REPO/settings/environments"
echo ""
echo "For each secret below, copy the value from 'test' to 'preview':"
for secret in "${STRIPE_SECRETS[@]}"; do
    echo "  - $secret"
done

echo ""
echo "=== Summary ==="
echo ""
echo "Variables set automatically:"
echo "  - DB_METHOD"
echo "  - NODE_ENV"
echo "  - R2_BUCKET_ASSETS"
echo "  - R2_BUCKET_MEDIA"
echo "  - R2_BUCKET_PLATFORM"
echo "  - R2_BUCKET_RESOURCES"
echo "  - STRIPE_PUBLISHABLE_KEY (if found)"
echo ""
echo "Secrets set automatically:"
echo "  - BETTER_AUTH_SECRET (new, unique to preview)"
echo "  - SESSION_SECRET (new, unique to preview)"
echo ""
echo "Secrets requiring manual setup:"
echo "  - STRIPE_SECRET_KEY"
echo "  - STRIPE_WEBHOOK_SECRET_* (6 secrets)"
echo ""
echo "=== R2 Buckets ==="
echo ""
echo "Ensure these R2 buckets exist in your Cloudflare account:"
echo "  - codex-assets-preview"
echo "  - codex-media-preview"
echo "  - codex-platform-preview"
echo "  - codex-resources-preview"
echo ""
echo "Done! Preview environment created."
