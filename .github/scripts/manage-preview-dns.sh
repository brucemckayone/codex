#!/bin/bash
set -e

# Cloudflare DNS Management Script for Preview Deployments
# This script creates or deletes DNS CNAME records for preview environments

ACTION=$1
PR_NUMBER=$2
CLOUDFLARE_API_TOKEN=$3
CLOUDFLARE_ZONE_ID=$4

if [ -z "$ACTION" ] || [ -z "$PR_NUMBER" ] || [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ZONE_ID" ]; then
  echo "Usage: $0 <create|delete> <PR_NUMBER> <CLOUDFLARE_API_TOKEN> <CLOUDFLARE_ZONE_ID>"
  exit 1
fi

BASE_DOMAIN="revelations.studio"

# Define the preview subdomains
PREVIEW_SUBDOMAINS=(
  "codex-preview-${PR_NUMBER}"
  "api-preview-${PR_NUMBER}"
  "auth-preview-${PR_NUMBER}"
)

# Cloudflare API endpoint
API_BASE="https://api.cloudflare.com/client/v4"

# Debug: Validate inputs (mask sensitive data in output)
echo "🔍 Validating Cloudflare credentials..."
echo "   Zone ID: ${CLOUDFLARE_ZONE_ID:0:8}... (length: ${#CLOUDFLARE_ZONE_ID})"
echo "   API Token: ${CLOUDFLARE_API_TOKEN:0:8}... (length: ${#CLOUDFLARE_API_TOKEN})"

# Validate Zone ID and API Token by verifying zone access
echo "🔍 Testing Cloudflare API access..."
VERIFY_RESPONSE=$(curl -s -X GET "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json")

if echo "$VERIFY_RESPONSE" | grep -q '"success":true'; then
  ZONE_NAME=$(echo "$VERIFY_RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "✅ Successfully authenticated with Cloudflare"
  echo "✅ Zone verified: ${ZONE_NAME}"

  # Verify this is the correct zone
  if [ "$ZONE_NAME" != "$BASE_DOMAIN" ]; then
    echo "❌ ERROR: Zone ID is for '${ZONE_NAME}' but expected '${BASE_DOMAIN}'"
    echo "Please verify CLOUDFLARE_ZONE_ID secret matches the revelations.studio zone"
    exit 1
  fi
else
  echo "❌ ERROR: Failed to verify Cloudflare credentials"
  echo "Response: $VERIFY_RESPONSE"

  # Parse error details
  if echo "$VERIFY_RESPONSE" | grep -q "Authentication error"; then
    echo ""
    echo "🔧 TROUBLESHOOTING:"
    echo "   1. Verify CLOUDFLARE_API_TOKEN has not expired"
    echo "   2. Ensure token has 'Zone:DNS:Edit' permission"
    echo "   3. Check token is scoped to the correct zone (revelations.studio)"
    echo "   4. Verify CLOUDFLARE_ZONE_ID matches revelations.studio zone"
  fi

  exit 1
fi

echo ""

# Function to create a CNAME record pointing to workers.dev
create_dns_record() {
  local subdomain=$1
  local full_domain="${subdomain}.${BASE_DOMAIN}"

  echo "Creating DNS record for ${full_domain}..."

  # For Cloudflare Workers, we create a CNAME pointing to a placeholder
  # The worker route will intercept requests to this domain
  # Using @ as target makes it resolve to the zone apex, then worker route handles it
  local response=$(curl -s -X POST "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{
      \"type\": \"CNAME\",
      \"name\": \"${subdomain}\",
      \"content\": \"${BASE_DOMAIN}\",
      \"ttl\": 1,
      \"proxied\": true
    }")

  # Check if successful
  if echo "$response" | grep -q '"success":true'; then
    echo "✓ Created DNS record for ${full_domain}"
    record_id=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "${subdomain}|${record_id}" >> dns_records.txt
  else
    echo "✗ Failed to create DNS record for ${full_domain}"
    echo "Response: $response"

    # Parse error code and message
    ERROR_CODE=$(echo "$response" | grep -o '"code":[0-9]*' | head -1 | cut -d':' -f2)
    ERROR_MESSAGE=$(echo "$response" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)

    echo ""
    echo "Error Code: ${ERROR_CODE}"
    echo "Error Message: ${ERROR_MESSAGE}"

    # Check if record already exists
    if echo "$response" | grep -q "already exists"; then
      echo "Record already exists, continuing..."
      # Try to get existing record ID
      existing_record=$(curl -s -X GET "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${full_domain}" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")
      record_id=$(echo "$existing_record" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
      if [ -n "$record_id" ]; then
        echo "${subdomain}|${record_id}" >> dns_records.txt
      fi
    else
      # Provide specific troubleshooting for common errors
      case "$ERROR_CODE" in
        10000)
          echo ""
          echo "🔧 Authentication Error (10000) - This means:"
          echo "   • API token is invalid or expired"
          echo "   • Token doesn't have 'Zone:DNS:Edit' permission"
          echo "   • Token is not scoped to this zone"
          ;;
        81057)
          echo ""
          echo "🔧 Record already exists (81057)"
          echo "   • A DNS record with this name already exists"
          echo "   • This should have been caught above - please report this"
          ;;
        *)
          echo ""
          echo "🔧 Unknown error code: ${ERROR_CODE}"
          echo "   • Check Cloudflare API documentation"
          ;;
      esac
      exit 1
    fi
  fi
}

# Function to delete a DNS record
delete_dns_record() {
  local subdomain=$1
  local full_domain="${subdomain}.${BASE_DOMAIN}"

  echo "Deleting DNS record for ${full_domain}..."

  # First, get the record ID
  local records=$(curl -s -X GET "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${full_domain}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")

  local record_id=$(echo "$records" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -z "$record_id" ]; then
    echo "⚠ DNS record for ${full_domain} not found, skipping..."
    return 0
  fi

  # Delete the record
  local response=$(curl -s -X DELETE "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${record_id}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")

  if echo "$response" | grep -q '"success":true'; then
    echo "✓ Deleted DNS record for ${full_domain}"
  else
    echo "⚠ Failed to delete DNS record for ${full_domain} (might not exist)"
    echo "Response: $response"
  fi
}

# Main logic
if [ "$ACTION" = "create" ]; then
  echo "Creating DNS records for PR #${PR_NUMBER}..."

  # Initialize dns_records.txt
  > dns_records.txt

  for subdomain in "${PREVIEW_SUBDOMAINS[@]}"; do
    create_dns_record "$subdomain"
  done

  echo ""
  echo "DNS records created successfully!"
  echo "Records saved to dns_records.txt"

elif [ "$ACTION" = "delete" ]; then
  echo "Deleting DNS records for PR #${PR_NUMBER}..."

  for subdomain in "${PREVIEW_SUBDOMAINS[@]}"; do
    delete_dns_record "$subdomain"
  done

  echo ""
  echo "DNS records deleted successfully!"

else
  echo "Invalid action: $ACTION"
  echo "Use 'create' or 'delete'"
  exit 1
fi
