#!/bin/bash

# Test script to verify Wrangler loads .dev.vars.test with --env test

echo "🧪 Testing Wrangler environment variable loading..."
echo ""

cd /Users/brucemckay/development/Codex/workers/ecom-api

echo "📁 Current directory: $(pwd)"
echo ""

echo "📄 Contents of .dev.vars.test:"
cat .dev.vars.test | grep DATABASE
echo ""

echo "🚀 Starting wrangler dev with --env test..."
echo "   Command: npx wrangler dev --env test --port 42072"
echo ""

# Start wrangler in background and capture output
npx wrangler dev --env test --port 42072 > /tmp/wrangler-test.log 2>&1 &
WRANGLER_PID=$!

echo "⏳ Waiting for wrangler to start (10 seconds)..."
sleep 10

echo ""
echo "📋 Wrangler output (first 50 lines):"
head -50 /tmp/wrangler-test.log
echo ""

echo "🔍 Checking for DATABASE_URL_LOCAL_PROXY in output..."
if grep -q "DATABASE_URL_LOCAL_PROXY" /tmp/wrangler-test.log; then
    echo "✅ Found DATABASE_URL_LOCAL_PROXY in wrangler output"
else
    echo "❌ DATABASE_URL_LOCAL_PROXY NOT found in wrangler output"
fi
echo ""

echo "🛑 Killing wrangler process..."
kill $WRANGLER_PID 2>/dev/null

echo "✅ Test complete"
