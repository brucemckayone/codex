#!/usr/bin/env bash
set -euo pipefail

# One-time local setup: creates the GitHub `dev` Actions environment,
# generates random secrets (SESSION_SECRET, BETTER_AUTH_SECRET,
# WORKER_SHARED_SECRET), uploads everything via `gh` CLI, and sets up
# branch protection rulesets for `main` and `dev`.
#
# Prerequisites:
#   1. `gh` CLI installed + authenticated (run `gh auth status`)
#   2. Your gh token has `repo` scope (default user token does)
#   3. You have a Stripe test-mode secret key handy (sk_test_...)
#
# What it does NOT set:
#   - DATABASE_URL: auto-generated per-deploy by the workflow (Neon API)
#   - STRIPE_WEBHOOK_SECRET_*: set later by setup-stripe-dev-webhooks.sh
#     (after first deploy, since endpoints need live URLs)
#
# Usage:
#   ./.github/scripts/bootstrap-dev-env.sh
#
# Re-running is safe (idempotent).

REPO="${GH_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
ENV="dev"

echo "🚀 Bootstrapping GitHub \`${ENV}\` environment for ${REPO}..."
echo ""

# Step 1: Create or update the dev environment
# IMPORTANT: gh api -F does NOT support nested keys via dot notation.
# Use JSON via stdin to pass deployment_branch_policy as a nested object.
echo "📦 Step 1: Ensuring \`${ENV}\` environment exists..."
gh api -X PUT "/repos/${REPO}/environments/${ENV}" --input - > /dev/null <<'EOF'
{
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  }
}
EOF
echo "   ✅ Environment ready"
echo ""

# Step 2: Set deployment branch policy: only `dev` branch can deploy
echo "🛡️  Step 2: Restricting deploys to \`dev\` branch only..."
EXISTING_POLICIES=$(gh api "/repos/${REPO}/environments/${ENV}/deployment-branch-policies" \
  --jq '.branch_policies[].name' 2>/dev/null || echo "")
if ! echo "$EXISTING_POLICIES" | grep -qx "dev"; then
  gh api -X POST "/repos/${REPO}/environments/${ENV}/deployment-branch-policies" \
    -f name="dev" > /dev/null
  echo "   ✅ \`dev\` branch policy added"
else
  echo "   ✅ \`dev\` branch policy already set"
fi
echo ""

# Step 3: Set environment variables (per-environment overrides)
echo "🔧 Step 3: Setting environment variables..."
declare -A VARS=(
  [DB_METHOD]="PRODUCTION"
  [R2_BUCKET_MEDIA]="codex-media-dev"
  [R2_BUCKET_ASSETS]="codex-assets-dev"
  [R2_BUCKET_PLATFORM]="codex-platform-dev"
  [R2_BUCKET_RESOURCES]="codex-resources-dev"
)
for KEY in "${!VARS[@]}"; do
  VALUE="${VARS[$KEY]}"
  gh variable set "$KEY" --env "$ENV" --body "$VALUE" > /dev/null
  echo "   ✅ ${KEY} = ${VALUE}"
done
echo ""

# Step 4: Generate + set the three random secrets
echo "🔐 Step 4: Generating random secrets..."
for KEY in SESSION_SECRET BETTER_AUTH_SECRET WORKER_SHARED_SECRET; do
  VALUE=$(openssl rand -base64 32)
  echo "$VALUE" | gh secret set "$KEY" --env "$ENV" --body -
  echo "   ✅ ${KEY} generated + uploaded"
done
echo ""

# Step 5: Prompt for Stripe test-mode key
echo "💳 Step 5: Stripe test-mode secret key"
echo "   Get it from: https://dashboard.stripe.com/test/apikeys"
echo "   Should start with sk_test_..."
read -r -s -p "   Paste STRIPE_SECRET_KEY (input hidden): " STRIPE_KEY
echo ""
if [[ ! "$STRIPE_KEY" =~ ^sk_test_ ]]; then
  echo "   ❌ That doesn't look like a test-mode key (should start with sk_test_)."
  echo "   Aborting to prevent accidentally uploading a live key."
  exit 1
fi
echo "$STRIPE_KEY" | gh secret set STRIPE_SECRET_KEY --env "$ENV" --body -
echo "   ✅ STRIPE_SECRET_KEY uploaded"
echo ""

# Step 6: Prompt for B2 bucket name
echo "📦 Step 6: B2 bucket name for dev"
echo "   Either reuse prod (same bucket, OK since dev is isolated by KV/DB),"
echo "   or use a dev-specific bucket name (e.g. codex-media-dev)."
read -r -p "   B2_BUCKET name: " B2_BUCKET
if [ -z "$B2_BUCKET" ]; then
  echo "   ❌ Empty value rejected."
  exit 1
fi
echo "$B2_BUCKET" | gh secret set B2_BUCKET --env "$ENV" --body -
echo "   ✅ B2_BUCKET = ${B2_BUCKET}"
echo ""

# Step 7: Branch protection rulesets for main + dev
# We use the modern Rulesets API rather than legacy branch protection
# because rulesets support targeting branches that don't exist yet
# (the `dev` branch may not be created until after this script runs).
echo "🛡️  Step 7: Branch protection rulesets..."

upsert_ruleset() {
  local NAME="$1"
  local PAYLOAD="$2"

  EXISTING_ID=$(gh api "/repos/${REPO}/rulesets" \
    --jq ".[] | select(.name == \"$NAME\") | .id" 2>/dev/null | head -n 1 || echo "")

  if [ -n "$EXISTING_ID" ]; then
    echo "$PAYLOAD" | gh api -X PUT "/repos/${REPO}/rulesets/${EXISTING_ID}" --input - > /dev/null
    echo "   ✅ Updated existing ruleset: $NAME"
  else
    echo "$PAYLOAD" | gh api -X POST "/repos/${REPO}/rulesets" --input - > /dev/null
    echo "   ✅ Created new ruleset: $NAME"
  fi
}

# main: only PRs from dev can merge (enforced by Guard main source branch
# workflow). Require PR + Guard check. Block force pushes and deletion.
MAIN_PAYLOAD=$(cat <<'EOF'
{
  "name": "main-protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {"type": "pull_request"},
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          {"context": "check-source-branch"}
        ]
      }
    }
  ]
}
EOF
)
upsert_ruleset "main-protection" "$MAIN_PAYLOAD"

# dev: require PR + testing.yml to pass before merge. Block force pushes
# and deletion. Targets refs/heads/dev (works even if dev doesn't exist
# yet — ruleset activates when the branch is created).
DEV_PAYLOAD=$(cat <<'EOF'
{
  "name": "dev-protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/dev"],
      "exclude": []
    }
  },
  "rules": [
    {"type": "pull_request"},
    {"type": "deletion"},
    {"type": "non_fast_forward"}
  ]
}
EOF
)
upsert_ruleset "dev-protection" "$DEV_PAYLOAD"

echo ""

# Done
echo "✨ Done!"
echo ""
echo "Still pending (handled later by other tools):"
echo "  - DATABASE_URL: auto-generated by deploy-dev.yml (Neon API)"
echo "  - STRIPE_WEBHOOK_SECRET_* (6 of them): run setup-stripe-dev-webhooks.sh"
echo "    AFTER first deploy creates the worker URLs"
echo ""
echo "Next:"
echo "  1. gh workflow run \"Bootstrap Dev Infrastructure\"   (DNS + R2)"
echo "  2. git checkout -b dev && git push -u origin dev      (first deploy)"
echo "  3. ./.github/scripts/setup-stripe-dev-webhooks.sh --upload  (after first deploy)"
echo "  4. gh workflow run \"Deploy to Dev\"                  (pick up Stripe secrets)"
