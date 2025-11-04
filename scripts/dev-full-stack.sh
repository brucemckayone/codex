#!/bin/bash
set -e

# Full-stack local development script
# Mirrors CI/CD build and deployment workflow

echo "🚀 Starting Codex Full-Stack Local Development"
echo "================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load environment variables
if [ -f .env.dev ]; then
  echo -e "${BLUE}📋 Loading .env.dev${NC}"
  export $(grep -v '^#' .env.dev | xargs)
else
  echo -e "${RED}❌ .env.dev not found!${NC}"
  echo "Please create .env.dev from .env.dev.example"
  exit 1
fi

# Validate required environment variables
required_vars=(
  "DATABASE_URL"
  "SESSION_SECRET"
  "BETTER_AUTH_SECRET"
)

for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo -e "${RED}❌ Missing required environment variable: $var${NC}"
    exit 1
  fi
done

echo -e "${GREEN}✅ Environment variables loaded${NC}"

# Step 1: Start Database
echo ""
echo -e "${BLUE}📦 Step 1/6: Starting local database${NC}"
pnpm docker:up
echo -e "${GREEN}✅ Database started${NC}"

# Wait for database to be ready
echo -e "${YELLOW}⏳ Waiting for database to be ready...${NC}"
max_attempts=30
attempt=0
while ! pg_isready -h localhost -p 4444 -U codex_user > /dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ $attempt -ge $max_attempts ]; then
    echo -e "${RED}❌ Database failed to start after $max_attempts attempts${NC}"
    exit 1
  fi
  echo "Attempt $attempt/$max_attempts..."
  sleep 1
done
echo -e "${GREEN}✅ Database is ready${NC}"

# Step 2: Install dependencies
echo ""
echo -e "${BLUE}📦 Step 2/6: Installing dependencies${NC}"
pnpm install --frozen-lockfile
echo -e "${GREEN}✅ Dependencies installed${NC}"

# Step 3: Run migrations
echo ""
echo -e "${BLUE}🗄️  Step 3/6: Running database migrations${NC}"
pnpm --filter @codex/database db:push
echo -e "${GREEN}✅ Migrations complete${NC}"

# Step 4: Build all packages (like CI does)
echo ""
echo -e "${BLUE}🔨 Step 4/6: Building all packages${NC}"
echo "This mirrors the CI/CD build process..."
pnpm build:packages
echo -e "${GREEN}✅ Packages built${NC}"

# Step 5: Build all workers (like CI does)
echo ""
echo -e "${BLUE}🔨 Step 5/6: Building all workers${NC}"
echo "Building: stripe-webhook-handler, auth, web"
pnpm --filter stripe-webhook-handler build
pnpm --filter auth build
pnpm --filter web build
echo -e "${GREEN}✅ Workers built${NC}"

# Step 6: Start all services
echo ""
echo -e "${BLUE}🚀 Step 6/6: Starting all services${NC}"
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}🎉 Full-Stack Development Environment Ready!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${YELLOW}Services will start on:${NC}"
echo -e "  ${BLUE}🌐 Web App:${NC}           http://localhost:5173"
echo -e "  ${BLUE}🔐 Auth Worker:${NC}        http://localhost:8788"
echo -e "  ${BLUE}💳 Stripe Webhook:${NC}     http://localhost:8789"
echo -e "  ${BLUE}🗄️  Database:${NC}           localhost:4444"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Start all services with concurrently
# This allows all services to run and restart on changes
pnpm concurrently \
  --names "WEB,AUTH,STRIPE" \
  --prefix-colors "blue,green,yellow" \
  "pnpm dev:web" \
  "pnpm dev:auth" \
  "pnpm dev:stripe-webhook-handler"
