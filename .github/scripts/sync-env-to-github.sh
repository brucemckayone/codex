#!/bin/bash
# Sync local .env files to GitHub Environments
#
# Usage:
#   ./sync-env-to-github.sh <environment>
#   ./sync-env-to-github.sh test
#   ./sync-env-to-github.sh production
#
# The script reads from .github/env/.env.github.<environment>
# - Lines without SECRET_ prefix → set as variables
# - Lines with SECRET_ prefix → set as secrets (prefix stripped)

set -e

ENV_NAME="${1:-}"

if [ -z "$ENV_NAME" ]; then
  echo "Usage: $0 <environment>"
  echo "  e.g., $0 test"
  echo "  e.g., $0 production"
  exit 1
fi

ENV_FILE=".github/env/.env.github.${ENV_NAME}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: Environment file not found: $ENV_FILE"
  exit 1
fi

# Check gh is authenticated
if ! gh auth status > /dev/null 2>&1; then
  echo "Error: gh CLI not authenticated. Run 'gh auth login' first."
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
echo "=========================================="
echo "  Syncing to GitHub Environment: $ENV_NAME"
echo "  Repository: $REPO"
echo "=========================================="
echo ""

# Create environment if it doesn't exist
echo "Ensuring environment '$ENV_NAME' exists..."
gh api -X PUT "repos/${REPO}/environments/${ENV_NAME}" --silent 2>/dev/null || true
echo "  ✓ Environment ready"
echo ""

# Process the env file
VARS_COUNT=0
SECRETS_COUNT=0

while IFS= read -r line || [ -n "$line" ]; do
  # Skip empty lines and comments
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

  # Parse KEY=VALUE
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    KEY="${BASH_REMATCH[1]}"
    VALUE="${BASH_REMATCH[2]}"

    # Remove surrounding quotes if present
    VALUE="${VALUE%\"}"
    VALUE="${VALUE#\"}"
    VALUE="${VALUE%\'}"
    VALUE="${VALUE#\'}"

    if [[ "$KEY" == SECRET_* ]]; then
      # It's a secret - strip the SECRET_ prefix
      SECRET_NAME="${KEY#SECRET_}"

      # Skip placeholder values
      if [[ "$VALUE" == *"REPLACE_ME"* ]]; then
        echo "  ⏭ Skipping $SECRET_NAME (placeholder value)"
        continue
      fi

      echo "$VALUE" | gh secret set "$SECRET_NAME" --env "$ENV_NAME"
      echo "  ✓ Secret: $SECRET_NAME"
      ((SECRETS_COUNT++))
    else
      # It's a variable
      gh variable set "$KEY" --env "$ENV_NAME" --body "$VALUE"
      echo "  ✓ Variable: $KEY=$VALUE"
      ((VARS_COUNT++))
    fi
  fi
done < "$ENV_FILE"

echo ""
echo "=========================================="
echo "  Sync Complete!"
echo "  Variables: $VARS_COUNT"
echo "  Secrets: $SECRETS_COUNT"
echo "=========================================="
echo ""
echo "Verify with:"
echo "  gh variable list --env $ENV_NAME"
echo "  gh secret list --env $ENV_NAME"
