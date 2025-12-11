#!/bin/bash
#
# Test Stripe Webhook Handler Locally
#
# Usage: ./scripts/test-local.sh

set -euo pipefail

echo "🧪 Testing Stripe Webhook Handler"
echo ""

BASE_URL="http://localhost:8787"

echo "1. Testing health endpoint..."
curl -s "$BASE_URL/health" | jq '.'
echo ""

echo "2. Testing missing signature (expect 400)..."
curl -s -X POST "$BASE_URL/webhooks/stripe/payment" \
  -H "Content-Type: application/json" \
  -d '{"type":"payment_intent.succeeded"}' \
  -w "\nStatus: %{http_code}\n" | tail -1
echo ""

echo "3. Testing invalid signature (expect 401)..."
curl -s -X POST "$BASE_URL/webhooks/stripe/payment" \
  -H "Content-Type: application/json" \
  -H "stripe-signature: t=12345,v1=invalid" \
  -d '{"type":"payment_intent.succeeded"}' \
  -w "\nStatus: %{http_code}\n" | tail -1
echo ""

echo "✅ All tests completed!"
echo ""
echo "To test with real Stripe events:"
echo "  1. Terminal 1: pnpm dev"
echo "  2. Terminal 2: stripe listen --forward-to http://localhost:8787/webhooks/stripe/payment"
echo "  3. Terminal 3: stripe trigger payment_intent.succeeded"
