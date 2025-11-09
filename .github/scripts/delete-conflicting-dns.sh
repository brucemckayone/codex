#!/bin/bash
set -e

# Delete DNS records that conflict with Cloudflare Workers custom domains
# This script removes CNAME records for api and auth subdomains that were
# created manually and now prevent Workers from attaching custom domains

CLOUDFLARE_API_TOKEN=$1
CLOUDFLARE_ZONE_ID=$2

if [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ZONE_ID" ]; then
  echo "Usage: $0 <CLOUDFLARE_API_TOKEN> <CLOUDFLARE_ZONE_ID>"
  exit 1
fi

BASE_DOMAIN="revelations.studio"
API_BASE="https://api.cloudflare.com/client/v4"

# Subdomains to clean up
SUBDOMAINS=("api" "auth")

echo "🗑️  Deleting conflicting DNS records..."
echo ""

# Validate credentials
echo "🔍 Validating Cloudflare credentials..."
VERIFY_RESPONSE=$(curl -s -X GET "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json")

if ! echo "$VERIFY_RESPONSE" | grep -q '"success":true'; then
  echo "❌ ERROR: Failed to verify Cloudflare credentials"
  echo "Response: $VERIFY_RESPONSE"
  exit 1
fi

ZONE_NAME=$(echo "$VERIFY_RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "✅ Authenticated with Cloudflare (Zone: ${ZONE_NAME})"
echo ""

# Function to delete DNS record
delete_dns_record() {
  local subdomain=$1
  local full_domain="${subdomain}.${BASE_DOMAIN}"

  echo "🔍 Checking for ${full_domain}..."

  # Get existing records
  local records=$(curl -s -X GET "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${full_domain}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")

  # Extract record IDs
  local record_ids=$(echo "$records" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  if [ -z "$record_ids" ]; then
    echo "ℹ️  No DNS record found for ${full_domain}"
    return 0
  fi

  # Delete each record
  echo "$record_ids" | while read -r record_id; do
    if [ -n "$record_id" ]; then
      echo "🗑️  Deleting record ${record_id}..."

      local delete_response=$(curl -s -X DELETE "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${record_id}" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json")

      if echo "$delete_response" | grep -q '"success":true'; then
        echo "✅ Deleted DNS record for ${full_domain}"
      else
        echo "❌ Failed to delete DNS record for ${full_domain}"
        echo "Response: $delete_response"
        return 1
      fi
    fi
  done
}

# Delete each subdomain
for subdomain in "${SUBDOMAINS[@]}"; do
  delete_dns_record "$subdomain"
  echo ""
done

echo "✅ DNS cleanup complete!"
echo ""
echo "ℹ️  Next steps:"
echo "   1. Run production deployment: gh workflow run deploy-production.yml"
echo "   2. Cloudflare Workers will automatically create custom domain DNS records"
echo "   3. SSL certificates will be provisioned automatically"
