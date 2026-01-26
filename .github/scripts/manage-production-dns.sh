#!/bin/bash
set -e

# Cloudflare DNS Management Script for Production Deployment
# This script verifies and creates DNS records for production custom domains
# Used ONLY for initial setup or verification - production domains are persistent

ACTION=$1
CLOUDFLARE_API_TOKEN=$2
CLOUDFLARE_ZONE_ID=$3

if [ -z "$ACTION" ] || [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ZONE_ID" ]; then
  echo "Usage: $0 <verify|create> <CLOUDFLARE_API_TOKEN> <CLOUDFLARE_ZONE_ID>"
  exit 1
fi

BASE_DOMAIN="revelations.studio"

# Define production subdomains that need CNAME DNS records created manually
#
# IMPORTANT: Workers with custom_domain: true in wrangler.jsonc should NOT be listed here!
# Wrangler automatically creates "Worker" type DNS records for custom domains.
# Adding them here creates CNAME records that conflict with Wrangler's deployment.
#
# Workers managed by Wrangler (DO NOT ADD HERE):
# - auth.revelations.studio -> auth-worker-production (custom_domain: true)
# - ecom-api.revelations.studio -> ecom-api-production (custom_domain: true)
# - content-api.revelations.studio -> content-api-production (custom_domain: true)
# - identity-api.revelations.studio -> identity-api-production (custom_domain: true)
#
# Add entries here for:
# - Cloudflare Pages deployments (web app)
# - Organization tenant subdomains (e.g., yogastudio.revelations.studio)
# - External service subdomains
declare -A PRODUCTION_DOMAINS=(
  ["codex"]="codex-web-production"
  ["www"]="codex-web-production"
  ["creators"]="codex-web-production"
  ["auth"]="auth-worker-production"
  ["content-api"]="content-api-production"
  ["ecom-api"]="ecom-api-production"
  ["identity-api"]="identity-api-production"
  ["media-api"]="media-api-production"
  ["notifications-api"]="notifications-api-production"
  ["organization-api"]="organization-api-production"
  ["admin-api"]="admin-api-production"
  ["*"]="codex-web-production"
)

# Cloudflare API endpoint
API_BASE="https://api.cloudflare.com/client/v4"

# Validate Cloudflare credentials
echo "🔍 Validating Cloudflare credentials..."
echo "   Zone ID: ${CLOUDFLARE_ZONE_ID:0:8}... (length: ${#CLOUDFLARE_ZONE_ID})"
echo "   API Token: ${CLOUDFLARE_API_TOKEN:0:8}... (length: ${#CLOUDFLARE_API_TOKEN})"

VERIFY_RESPONSE=$(curl -s -X GET "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json")

if echo "$VERIFY_RESPONSE" | grep -q '"success":true'; then
  ZONE_NAME=$(echo "$VERIFY_RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "✅ Successfully authenticated with Cloudflare"
  echo "✅ Zone verified: ${ZONE_NAME}"

  if [ "$ZONE_NAME" != "$BASE_DOMAIN" ]; then
    echo "❌ ERROR: Zone ID is for '${ZONE_NAME}' but expected '${BASE_DOMAIN}'"
    exit 1
  fi
else
  echo "❌ ERROR: Failed to verify Cloudflare credentials"
  echo "Response: $VERIFY_RESPONSE"
  exit 1
fi

echo ""

# Function to check if a DNS record exists
check_dns_record() {
  local subdomain=$1
  local full_domain="${subdomain}.${BASE_DOMAIN}"

  echo "🔍 Checking DNS record for ${full_domain}..."

  local records=$(curl -s -X GET "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${full_domain}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")

  local record_count=$(echo "$records" | grep -o '"id":"[^"]*"' | wc -l | tr -d ' ')

  if [ "$record_count" -gt 0 ]; then
    echo "✅ DNS record exists for ${full_domain}"

    # Get record details
    local record_type=$(echo "$records" | grep -o '"type":"[^"]*"' | head -1 | cut -d'"' -f4)
    local record_content=$(echo "$records" | grep -o '"content":"[^"]*"' | head -1 | cut -d'"' -f4)
    local is_proxied=$(echo "$records" | grep -o '"proxied":[^,}]*' | head -1 | cut -d':' -f2)

    echo "   Type: ${record_type}"
    echo "   Content: ${record_content}"
    echo "   Proxied: ${is_proxied}"

    return 0
  else
    echo "❌ DNS record NOT found for ${full_domain}"
    return 1
  fi
}

# Function to create/update a DNS record for Cloudflare Workers custom domain
create_dns_record() {
  local subdomain=$1
  local worker_name=$2
  local full_domain="${subdomain}.${BASE_DOMAIN}"

  echo "📝 Creating DNS record for ${full_domain} -> ${worker_name}..."

  # For Cloudflare Workers with custom domains:
  # Create a CNAME pointing to the zone apex (revelations.studio)
  # The worker route will intercept traffic to this subdomain
  # Cloudflare Workers' custom domains feature handles the rest

  local response=$(curl -s -X POST "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{
      \"type\": \"CNAME\",
      \"name\": \"${subdomain}\",
      \"content\": \"${BASE_DOMAIN}\",
      \"ttl\": 1,
      \"proxied\": true,
      \"comment\": \"Production custom domain for ${worker_name}\"
    }")

  if echo "$response" | grep -q '"success":true'; then
    echo "✅ Created DNS record for ${full_domain}"
    return 0
  else
    # Check if it already exists
    if echo "$response" | grep -q "already exists"; then
      echo "ℹ️  DNS record already exists for ${full_domain}"
      return 0
    else
      echo "❌ Failed to create DNS record for ${full_domain}"
      echo "Response: $response"
      return 1
    fi
  fi
}

# Function to verify custom domain attachment to worker
verify_custom_domain() {
  local subdomain=$1
  local worker_name=$2
  local full_domain="${subdomain}.${BASE_DOMAIN}"

  echo "🔍 Verifying custom domain attachment for ${full_domain}..."

  # Note: This requires the custom domain to already be attached via wrangler
  # We're just verifying it exists in the API
  local response=$(curl -s -X GET "${API_BASE}/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/domains" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" 2>/dev/null || echo '{"success":false}')

  if echo "$response" | grep -q "\"hostname\":\"${full_domain}\""; then
    echo "✅ Custom domain ${full_domain} is attached to worker"
    return 0
  else
    echo "⚠️  Custom domain ${full_domain} attachment not verified"
    echo "   This is expected if the worker hasn't been deployed yet"
    echo "   The wrangler deploy with custom_domain=true will handle this"
    return 0
  fi
}

# Main logic
if [ "$ACTION" = "verify" ]; then
  echo "🔍 Verifying production DNS records..."
  echo ""

  all_verified=true

  for subdomain in "${!PRODUCTION_DOMAINS[@]}"; do
    worker_name="${PRODUCTION_DOMAINS[$subdomain]}"
    if ! check_dns_record "$subdomain"; then
      all_verified=false
      echo "⚠️  DNS record missing for ${subdomain}.${BASE_DOMAIN}"
      echo "   Run with 'create' action to create missing records"
    fi
    echo ""
  done

  if [ "$all_verified" = true ]; then
    echo "✅ All production DNS records are configured"
    exit 0
  else
    echo "⚠️  Some production DNS records are missing"
    echo "   Run: $0 create <API_TOKEN> <ZONE_ID>"
    exit 1
  fi

elif [ "$ACTION" = "create" ]; then
  echo "📝 Creating production DNS records..."
  echo ""

  for subdomain in "${!PRODUCTION_DOMAINS[@]}"; do
    worker_name="${PRODUCTION_DOMAINS[$subdomain]}"

    # Check if already exists
    if check_dns_record "$subdomain"; then
      echo "✓ Skipping ${subdomain}.${BASE_DOMAIN} (already exists)"
    else
      # Create the DNS record
      if create_dns_record "$subdomain" "$worker_name"; then
        echo "✅ Created DNS record for ${subdomain}.${BASE_DOMAIN}"
      else
        echo "❌ Failed to create DNS record for ${subdomain}.${BASE_DOMAIN}"
        exit 1
      fi
    fi
    echo ""
  done

  echo "✅ Production DNS records created/verified successfully!"
  echo ""
  echo "ℹ️  Next steps:"
  echo "   1. Deploy workers with 'wrangler deploy --env production'"
  echo "   2. Custom domains will be automatically attached by Cloudflare"
  echo "   3. SSL certificates will be provisioned automatically (may take 1-2 minutes)"
  echo "   4. Verify with: curl https://codex.revelations.studio"

else
  echo "Invalid action: $ACTION"
  echo "Use 'verify' or 'create'"
  exit 1
fi
