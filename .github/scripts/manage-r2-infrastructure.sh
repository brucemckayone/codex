#!/bin/bash
set -e

# R2 Infrastructure Management Script
# Manages R2 bucket public access, custom domains, DNS records, and cache rules
# Configuration is defined in .github/config/r2-infrastructure.json

ACTION=$1
CLOUDFLARE_DNS_TOKEN=$2
CLOUDFLARE_ZONE_ID=$3
CLOUDFLARE_ACCOUNT_ID=$4

if [ -z "$ACTION" ] || [ -z "$CLOUDFLARE_DNS_TOKEN" ] || [ -z "$CLOUDFLARE_ZONE_ID" ]; then
  echo "Usage: $0 <verify|apply> <CLOUDFLARE_DNS_TOKEN> <CLOUDFLARE_ZONE_ID> [CLOUDFLARE_ACCOUNT_ID]"
  exit 1
fi

CONFIG_FILE=".github/config/r2-infrastructure.json"
BASE_DOMAIN="revelations.studio"
API_BASE="https://api.cloudflare.com/client/v4"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if jq is installed
if ! command -v jq &> /dev/null; then
  echo "❌ ERROR: jq is required but not installed"
  echo "   Install with: brew install jq (macOS) or apt-get install jq (Linux)"
  exit 1
fi

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ ERROR: Config file not found: $CONFIG_FILE"
  exit 1
fi

# Validate Cloudflare credentials
echo "🔍 Validating Cloudflare credentials..."
echo "   Zone ID: ${CLOUDFLARE_ZONE_ID:0:8}... (length: ${#CLOUDFLARE_ZONE_ID})"
echo "   DNS Token: ${CLOUDFLARE_DNS_TOKEN:0:8}... (length: ${#CLOUDFLARE_DNS_TOKEN})"
echo "   R2 Token (env): ${CLOUDFLARE_API_TOKEN:0:8}... (length: ${#CLOUDFLARE_API_TOKEN})"

VERIFY_RESPONSE=$(curl -s -X GET "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_DNS_TOKEN}" \
  -H "Content-Type: application/json")

if echo "$VERIFY_RESPONSE" | grep -q '"success":true'; then
  ZONE_NAME=$(echo "$VERIFY_RESPONSE" | jq -r '.result.name')
  echo -e "${GREEN}✅ Successfully authenticated with Cloudflare${NC}"
  echo -e "${GREEN}✅ Zone verified: ${ZONE_NAME}${NC}"

  if [ "$ZONE_NAME" != "$BASE_DOMAIN" ]; then
    echo -e "${RED}❌ ERROR: Zone ID is for '${ZONE_NAME}' but expected '${BASE_DOMAIN}'${NC}"
    exit 1
  fi
else
  echo -e "${RED}❌ ERROR: Failed to verify Cloudflare credentials${NC}"
  echo "Response: $VERIFY_RESPONSE"
  exit 1
fi

echo ""

# Function to check R2 bucket custom domain status
check_r2_custom_domain() {
  local bucket=$1
  local expected_domain=$2

  echo "🔍 Checking custom domain for bucket: ${bucket}..."

  local domains=$(npx wrangler r2 bucket domain list "$bucket" 2>&1 || echo "ERROR")

  if echo "$domains" | grep -q "$expected_domain"; then
    echo -e "${GREEN}✅ Custom domain ${expected_domain} is attached${NC}"
    return 0
  elif echo "$domains" | grep -q "no custom domains"; then
    echo -e "${YELLOW}⚠️  No custom domain attached${NC}"
    return 1
  else
    echo -e "${YELLOW}⚠️  Custom domain ${expected_domain} not found${NC}"
    return 1
  fi
}

# Function to check R2 bucket dev URL status
check_r2_dev_url() {
  local bucket=$1

  local status=$(npx wrangler r2 bucket dev-url get "$bucket" 2>&1)

  if echo "$status" | grep -q "enabled"; then
    echo -e "${GREEN}✅ R2.dev URL is enabled${NC}"
    return 0
  else
    echo -e "${YELLOW}⚠️  R2.dev URL is disabled${NC}"
    return 1
  fi
}

# Function to check DNS record exists
check_dns_record() {
  local subdomain=$1
  local full_domain="${subdomain}.${BASE_DOMAIN}"

  echo "🔍 Checking DNS record for ${full_domain}..."

  local records=$(curl -s -X GET "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${full_domain}" \
    -H "Authorization: Bearer ${CLOUDFLARE_DNS_TOKEN}")

  local record_count=$(echo "$records" | jq -r '.result | length')

  if [ "$record_count" -gt 0 ]; then
    local record_type=$(echo "$records" | jq -r '.result[0].type')
    local record_content=$(echo "$records" | jq -r '.result[0].content')
    local is_proxied=$(echo "$records" | jq -r '.result[0].proxied')

    echo -e "${GREEN}✅ DNS record exists${NC}"
    echo "   Type: ${record_type}"
    echo "   Content: ${record_content}"
    echo "   Proxied: ${is_proxied}"
    return 0
  else
    echo -e "${YELLOW}⚠️  DNS record NOT found${NC}"
    return 1
  fi
}

# Function to check cache rule exists
check_cache_rule() {
  local rule_name=$1
  local domain_pattern=$2

  echo "🔍 Checking cache rule: ${rule_name}..."

  # Get cache rules for the zone
  local rules=$(curl -s -X GET "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/rulesets" \
    -H "Authorization: Bearer ${CLOUDFLARE_DNS_TOKEN}")

  if echo "$rules" | jq -e ".result[] | select(.phase == \"http_request_cache_settings\")" > /dev/null 2>&1; then
    # Check if our specific rule exists
    if echo "$rules" | jq -e ".result[] | .rules[]? | select(.description == \"$rule_name\")" > /dev/null 2>&1; then
      echo -e "${GREEN}✅ Cache rule exists${NC}"
      return 0
    fi
  fi

  echo -e "${YELLOW}⚠️  Cache rule NOT found${NC}"
  return 1
}

# Function to add custom domain to R2 bucket
add_r2_custom_domain() {
  local bucket=$1
  local domain=$2
  local min_tls=$3

  echo "📝 Adding custom domain ${domain} to bucket ${bucket}..."

  # Note: wrangler r2 bucket domain add requires zone-id
  # We'll get the zone-id from the environment or API
  local result=$(npx wrangler r2 bucket domain add "$bucket" \
    --domain "$domain" \
    --zone-id "$CLOUDFLARE_ZONE_ID" \
    --min-tls "$min_tls" \
    --force 2>&1)

  if echo "$result" | grep -q "success\|added\|attached"; then
    echo -e "${GREEN}✅ Custom domain added successfully${NC}"
    return 0
  else
    echo -e "${RED}❌ Failed to add custom domain${NC}"
    echo "Error: $result"
    return 1
  fi
}

# Function to enable/disable R2 dev URL
configure_r2_dev_url() {
  local bucket=$1
  local should_enable=$2

  if [ "$should_enable" = "true" ]; then
    echo "📝 Enabling r2.dev URL for bucket ${bucket}..."
    npx wrangler r2 bucket dev-url enable "$bucket" > /dev/null 2>&1
    echo -e "${GREEN}✅ R2.dev URL enabled${NC}"
  else
    echo "📝 Disabling r2.dev URL for bucket ${bucket}..."
    npx wrangler r2 bucket dev-url disable "$bucket" > /dev/null 2>&1
    echo -e "${GREEN}✅ R2.dev URL disabled${NC}"
  fi
}

# Function to create DNS record
create_dns_record() {
  local subdomain=$1
  local record_type=$2
  local proxied=$3
  local comment=$4
  local full_domain="${subdomain}.${BASE_DOMAIN}"

  echo "📝 Creating DNS record for ${full_domain}..."

  # For R2 custom domains, we typically use CNAME to the base domain
  local content="${BASE_DOMAIN}"

  local response=$(curl -s -X POST "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CLOUDFLARE_DNS_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{
      \"type\": \"${record_type}\",
      \"name\": \"${subdomain}\",
      \"content\": \"${content}\",
      \"ttl\": 1,
      \"proxied\": ${proxied},
      \"comment\": \"${comment}\"
    }")

  if echo "$response" | jq -e '.success == true' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Created DNS record${NC}"
    return 0
  else
    if echo "$response" | jq -e '.errors[] | select(.code == 81057)' > /dev/null 2>&1; then
      echo -e "${BLUE}ℹ️  DNS record already exists${NC}"
      return 0
    else
      echo -e "${RED}❌ Failed to create DNS record${NC}"
      echo "Response: $response"
      return 1
    fi
  fi
}

# Function to create cache rule
create_cache_rule() {
  local rule_name=$1
  local description=$2
  local domain_pattern=$3
  local enable_tiered_cache=$4

  echo "📝 Creating cache rule: ${rule_name}..."

  # Get or create the cache settings ruleset
  local rulesets=$(curl -s -X GET "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/rulesets" \
    -H "Authorization: Bearer ${CLOUDFLARE_DNS_TOKEN}")

  local ruleset_id=$(echo "$rulesets" | jq -r '.result[] | select(.phase == "http_request_cache_settings") | .id')

  if [ -z "$ruleset_id" ] || [ "$ruleset_id" = "null" ]; then
    echo -e "${YELLOW}⚠️  No cache ruleset found, creating one...${NC}"

    # Create new ruleset
    local create_response=$(curl -s -X POST "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/rulesets" \
      -H "Authorization: Bearer ${CLOUDFLARE_DNS_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{
        \"name\": \"Cache Settings\",
        \"kind\": \"zone\",
        \"phase\": \"http_request_cache_settings\",
        \"rules\": []
      }")

    ruleset_id=$(echo "$create_response" | jq -r '.result.id')
  fi

  # Build cache settings
  # Note: tiered_cache is configured at zone level, not per-rule
  local cache_settings="{\"cache\": true}"

  # Add rule to ruleset
  local rule_data=$(jq -n \
    --arg desc "$description" \
    --arg pattern "$domain_pattern" \
    --argjson settings "$cache_settings" \
    '{
      "description": $desc,
      "expression": ("http.host eq \"" + $pattern + "\""),
      "action": "set_cache_settings",
      "action_parameters": $settings
    }')

  local response=$(curl -s -X PUT "${API_BASE}/zones/${CLOUDFLARE_ZONE_ID}/rulesets/${ruleset_id}" \
    -H "Authorization: Bearer ${CLOUDFLARE_DNS_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{
      \"rules\": [${rule_data}]
    }")

  if echo "$response" | jq -e '.success == true' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Created cache rule${NC}"
    return 0
  else
    echo -e "${RED}❌ Failed to create cache rule${NC}"
    echo "Response: $response"
    return 1
  fi
}

# Main verification logic
verify_infrastructure() {
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}R2 Infrastructure Verification${NC}"
  echo -e "${BLUE}========================================${NC}"
  echo ""

  local all_verified=true
  local buckets=$(jq -r '.buckets | keys[]' "$CONFIG_FILE")

  for bucket in $buckets; do
    echo -e "${BLUE}--- Bucket: ${bucket} ---${NC}"

    # Get bucket config
    local custom_domain=$(jq -r ".buckets[\"$bucket\"].publicAccess.customDomain" "$CONFIG_FILE")
    local disable_dev_url=$(jq -r ".buckets[\"$bucket\"].publicAccess.disableR2DevUrl" "$CONFIG_FILE")
    local cache_enabled=$(jq -r ".buckets[\"$bucket\"].cache.enabled" "$CONFIG_FILE")
    local subdomain=$(jq -r ".buckets[\"$bucket\"].dns.subdomain" "$CONFIG_FILE")

    # Check custom domain (skip if not configured)
    if [ "$custom_domain" != "null" ] && [ -n "$custom_domain" ]; then
      if ! check_r2_custom_domain "$bucket" "$custom_domain"; then
        all_verified=false
      fi
    else
      echo -e "${BLUE}ℹ️  No custom domain configured (private bucket)${NC}"
    fi

    # Check dev URL status
    local dev_url_enabled=$(check_r2_dev_url "$bucket" && echo "true" || echo "false")
    if [ "$disable_dev_url" = "true" ] && [ "$dev_url_enabled" = "true" ]; then
      echo -e "${YELLOW}⚠️  R2.dev URL should be disabled but is enabled${NC}"
      all_verified=false
    fi

    # Check DNS record (skip if not configured)
    if [ "$subdomain" != "null" ] && [ -n "$subdomain" ]; then
      if ! check_dns_record "$subdomain"; then
        all_verified=false
      fi
    else
      echo -e "${BLUE}ℹ️  No DNS record configured (private bucket)${NC}"
    fi

    # Check cache rule
    if [ "$cache_enabled" = "true" ]; then
      local rule_name=$(jq -r ".buckets[\"$bucket\"].cache.ruleName" "$CONFIG_FILE")
      if ! check_cache_rule "$rule_name" "$custom_domain"; then
        all_verified=false
      fi
    fi

    echo ""
  done

  if [ "$all_verified" = true ]; then
    echo -e "${GREEN}✅ All R2 infrastructure is configured correctly${NC}"
    return 0
  else
    echo -e "${YELLOW}⚠️  Some R2 infrastructure needs configuration${NC}"
    echo -e "   Run: $0 apply <API_TOKEN> <ZONE_ID>"
    return 1
  fi
}

# Main apply logic
apply_infrastructure() {
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}R2 Infrastructure Apply${NC}"
  echo -e "${BLUE}========================================${NC}"
  echo ""

  local buckets=$(jq -r '.buckets | keys[]' "$CONFIG_FILE")

  for bucket in $buckets; do
    echo -e "${BLUE}--- Configuring Bucket: ${bucket} ---${NC}"

    # Get bucket config
    local custom_domain=$(jq -r ".buckets[\"$bucket\"].publicAccess.customDomain" "$CONFIG_FILE")
    local min_tls=$(jq -r ".buckets[\"$bucket\"].publicAccess.minTls // \"1.2\"" "$CONFIG_FILE")
    local disable_dev_url=$(jq -r ".buckets[\"$bucket\"].publicAccess.disableR2DevUrl" "$CONFIG_FILE")
    local cache_enabled=$(jq -r ".buckets[\"$bucket\"].cache.enabled" "$CONFIG_FILE")
    local subdomain=$(jq -r ".buckets[\"$bucket\"].dns.subdomain" "$CONFIG_FILE")
    local dns_type=$(jq -r ".buckets[\"$bucket\"].dns.type" "$CONFIG_FILE")
    local dns_proxied=$(jq -r ".buckets[\"$bucket\"].dns.proxied" "$CONFIG_FILE")
    local dns_comment=$(jq -r ".buckets[\"$bucket\"].dns.comment" "$CONFIG_FILE")

    # 1. Add custom domain if configured and not present
    if [ "$custom_domain" != "null" ] && [ -n "$custom_domain" ]; then
      if ! check_r2_custom_domain "$bucket" "$custom_domain" > /dev/null 2>&1; then
        add_r2_custom_domain "$bucket" "$custom_domain" "$min_tls"
      else
        echo -e "${BLUE}ℹ️  Custom domain already configured${NC}"
      fi
    else
      echo -e "${BLUE}ℹ️  Skipping custom domain (private bucket)${NC}"
    fi

    # 2. Configure R2 dev URL
    local should_enable_dev="true"
    if [ "$disable_dev_url" = "true" ]; then
      should_enable_dev="false"
    fi
    configure_r2_dev_url "$bucket" "$should_enable_dev"

    # 3. Create DNS record if configured and not present
    if [ "$subdomain" != "null" ] && [ -n "$subdomain" ]; then
      if ! check_dns_record "$subdomain" > /dev/null 2>&1; then
        create_dns_record "$subdomain" "$dns_type" "$dns_proxied" "$dns_comment"
      else
        echo -e "${BLUE}ℹ️  DNS record already exists${NC}"
      fi
    else
      echo -e "${BLUE}ℹ️  Skipping DNS record (private bucket)${NC}"
    fi

    # 4. Create cache rule if enabled and not present
    if [ "$cache_enabled" = "true" ]; then
      local rule_name=$(jq -r ".buckets[\"$bucket\"].cache.ruleName" "$CONFIG_FILE")
      local rule_desc=$(jq -r ".buckets[\"$bucket\"].cache.description" "$CONFIG_FILE")
      local tiered_cache=$(jq -r ".buckets[\"$bucket\"].cache.smartTieredCache // false" "$CONFIG_FILE")

      if ! check_cache_rule "$rule_name" "$custom_domain" > /dev/null 2>&1; then
        create_cache_rule "$rule_name" "$rule_desc" "$custom_domain" "$tiered_cache"
      else
        echo -e "${BLUE}ℹ️  Cache rule already exists${NC}"
      fi
    fi

    echo ""
  done

  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}✅ R2 Infrastructure Applied${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  echo -e "${BLUE}Next Steps:${NC}"
  echo "1. Update wrangler.jsonc files with R2_PUBLIC_URL_BASE bindings"
  echo "2. Deploy workers: wrangler deploy --env production"
  echo "3. Verify public URLs are accessible"
  echo ""
  echo -e "${YELLOW}Recommended wrangler.jsonc updates:${NC}"
  jq -r '.wranglerBindings.values | to_entries[] | "  " + .key + ": " + .value' "$CONFIG_FILE"
}

# Main execution
case "$ACTION" in
  verify)
    verify_infrastructure
    ;;
  apply)
    apply_infrastructure
    ;;
  *)
    echo "Invalid action: $ACTION"
    echo "Use 'verify' or 'apply'"
    exit 1
    ;;
esac
