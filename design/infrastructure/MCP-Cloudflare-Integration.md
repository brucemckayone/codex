# MCP and Cloudflare Integration Guide

Cross-reference between configured MCP servers and Codex's Cloudflare infrastructure.

## Overview

This document maps the configured MCP (Model Context Protocol) servers in `.mcp.json` to the actual Cloudflare services used in the Codex platform architecture.

---

## Configured MCP Servers

### 1. cloudflare-docs

**Endpoint:** `https://docs.mcp.cloudflare.com/mcp`

**Purpose:** Search and reference Cloudflare documentation

**Use Cases for Codex:**
- Research Cloudflare Pages deployment configurations
- Learn about Workers API and bindings
- Understand R2 bucket operations and signed URLs
- Reference KV namespace operations
- Study Queues configuration and consumer patterns
- Check compatibility dates and feature availability

**Relevant to:**
- All Cloudflare services documentation
- API references for services we use
- Best practices and migration guides

---

### 2. cloudflare-workers-bindings

**Endpoint:** `https://bindings.mcp.cloudflare.com/mcp`

**Purpose:** Build applications with storage, AI, and compute bindings

**Maps to Codex Services:**

#### R2 (Object Storage)
**Current Usage in Codex:**
- **Location:** `packages/cloudflare-clients/src/r2/`
- **Purpose:** Store media files (videos, audio, thumbnails, images)
- **Implementation Status:** Placeholder client defined
- **Planned Features:**
  - Upload original videos
  - Store transcoded outputs (720p, 1080p)
  - Generate and store thumbnails
  - Manage user-uploaded content

**What MCP Can Help With:**
- Generate presigned URLs for direct uploads
- Configure bucket policies
- Implement CORS settings
- Optimize storage patterns
- Test R2 client code

#### KV (Key-Value Store)
**Current Usage in Codex:**
- **Location:** `packages/cloudflare-clients/src/kv/`
- **Purpose:** Fast edge caching and session storage
- **Planned Storage:**
  - Auth sessions (BetterAuth)
  - Rate limiting counters
  - Feature flags
  - Cache data
  - Temporary tokens

**What MCP Can Help With:**
- Set and get values with TTL
- Implement cache invalidation strategies
- Test KV namespace operations
- Optimize key naming patterns

#### Queues
**Current Usage in Codex:**
- **Location:** `workers/queue-consumer/`
- **Configuration:** `wrangler.toml`
- **Queue Name:** `media-processing-queue`
- **Implementation Status:** Placeholder consumer defined
- **Planned Use Cases:**
  - Video upload → transcode job
  - New user → welcome email
  - Purchase → receipt generation
  - Content publish → notifications

**Worker Configuration:**
```toml
[[queues.consumers]]
queue = "media-processing-queue"
max_batch_size = 10
max_batch_timeout = 30
```

**What MCP Can Help With:**
- Send test messages to queue
- Monitor queue depth and processing
- Debug consumer failures
- Optimize batch sizes
- Test retry logic

#### D1 (Not Currently Used)
**Status:** Not planned for Phase 1
**Reason:** Using Neon Postgres instead for ACID transactions and production-grade features

**What MCP Could Help With (Future):**
- If migrating from Neon to D1
- Testing edge database patterns
- Implementing read replicas

---

### 3. cloudflare-observability

**Endpoint:** `https://observability.mcp.cloudflare.com/mcp`

**Purpose:** Debug and get insights into application logs

**Maps to Codex Components:**

#### Workers Logs
**Relevant Workers:**
- `queue-consumer` - Media processing queue consumer
- Future webhook handlers

**Current Status:** Workers not yet deployed (Cloudflare not configured)

**What MCP Can Help With (Post-Deployment):**
- Query worker execution logs
- Debug queue processing failures
- Monitor worker performance
- Track error rates
- Analyze cold start times
- View console.log outputs from workers

#### Pages Logs
**Relevant Application:**
- `apps/web` - SvelteKit application deployed to Cloudflare Pages

**Current Status:** Pages not yet configured

**What MCP Can Help With (Post-Deployment):**
- View build logs
- Debug deployment failures
- Monitor SSR function logs
- Track preview deployment status

#### Planned Monitoring Use Cases:
1. **Queue Consumer Debugging:**
   - Why are messages failing to process?
   - Are we hitting timeout limits?
   - What errors are occurring in the RunPod integration?

2. **Performance Monitoring:**
   - Worker execution times
   - Queue processing throughput
   - R2 upload/download speeds

3. **Error Tracking:**
   - Failed transcoding jobs
   - Webhook delivery failures
   - Database connection issues from Workers

---

## Cloudflare Services NOT Yet Configured

These are in the infrastructure plan but not yet set up:

### Cloudflare Pages
**Status:** Not configured (no account yet)
**Deployment Target:** `apps/web` - SvelteKit application
**Configuration Needed:**
- Connect GitHub repository
- Set build command: `pnpm --filter web build`
- Configure environment variables
- Set up preview deployments

**Related MCP Server:** `cloudflare-docs` (for setup guidance)

### Cloudflare Workers Deployment
**Status:** Workers code exists but not deployed
**Workers:**
- `queue-consumer` - Currently disabled in vitest.config.ts
**Configuration File:** `workers/queue-consumer/wrangler.toml` (ready)
**Deployment Workflow:** `.github/workflows/deploy-workers.yml.disabled` (ready, just disabled)

**Related MCP Servers:**
- `cloudflare-workers-bindings` (for testing bindings)
- `cloudflare-observability` (for post-deployment debugging)

---

## Current Development Status

### Implemented
- ✅ Infrastructure design documents
- ✅ Worker code structure (placeholder)
- ✅ Cloudflare client packages (R2, KV)
- ✅ Wrangler configuration
- ✅ GitHub Actions workflow (disabled)
- ✅ MCP server configuration

### Not Yet Configured
- ❌ Cloudflare account setup
- ❌ Pages project creation
- ❌ R2 bucket creation
- ❌ KV namespace creation
- ❌ Queue creation (`media-processing-queue`)
- ❌ Worker deployment
- ❌ Environment variables in Cloudflare

### Free Services Only (Current Approach)
As noted in [CI-CD-Pipeline.md](./CI-CD-Pipeline.md), we're currently using only free services for CI testing. Cloudflare deployment will be enabled when accounts are set up.

---

## How to Use MCP Servers for Codex Development

### Phase 1: Pre-Deployment (Current)

**Using cloudflare-docs:**
1. Research R2 API for implementing upload logic
2. Study Queue consumer patterns for `queue-consumer` worker
3. Reference KV namespace operations for session storage
4. Learn about Pages deployment configuration

**Example Queries:**
- "How do I generate presigned URLs for R2 uploads in Workers?"
- "What's the best pattern for Cloudflare Queue consumers with retry logic?"
- "How do I configure KV namespaces in wrangler.toml?"
- "What environment variables are needed for Pages deployment?"

### Phase 2: Post-Deployment (Future)

**Using cloudflare-workers-bindings:**
1. Test R2 uploads from your actual bucket
2. Send test messages to `media-processing-queue`
3. Verify KV namespace operations
4. Debug binding configurations

**Using cloudflare-observability:**
1. Monitor queue-consumer execution
2. Debug video processing failures
3. Track worker performance metrics
4. Analyze error patterns

---

## Integration with Other Services

### Neon Postgres
**MCP Status:** No direct MCP server
**Integration Point:** Workers and Pages connect to Neon via DATABASE_URL
**Alternative:** Could use `postgres` MCP server for local queries (not yet configured)

### RunPod GPU
**MCP Status:** No direct MCP server
**Integration Point:** Queue consumer calls RunPod API
**Current Status:** Placeholder implementation in `workers/queue-consumer/src/index.ts`

### GitHub
**MCP Server:** Configured at `https://api.githubcopilot.com/mcp/`
**Use Cases:**
- Create PRs for feature work
- Manage issues
- Review CI/CD workflow runs
- Track deployment status

---

## Next Steps for Full Integration

1. **Set up Cloudflare Account**
   - Sign up for Cloudflare
   - Connect payment method (for production usage)
   - Note: Many services have generous free tiers

2. **Create Cloudflare Resources**
   - Create R2 bucket: `codex-media-dev` (or similar)
   - Create KV namespace: `codex-sessions`
   - Create Queue: `media-processing-queue`
   - Create Pages project linked to GitHub repo

3. **Configure Environment Variables**
   - Add secrets to Cloudflare Pages environment
   - Add secrets for Workers (DATABASE_URL, API keys)
   - Update wrangler.toml with actual IDs

4. **Deploy Workers**
   - Test `queue-consumer` deployment: `pnpm --filter queue-consumer deploy`
   - Re-enable `.github/workflows/deploy-workers.yml`
   - Verify MCP observability access

5. **Test with MCP**
   - Use `cloudflare-workers-bindings` to test R2/KV/Queue operations
   - Use `cloudflare-observability` to debug any issues
   - Use `cloudflare-docs` to reference as needed

---

## Troubleshooting MCP Access

### Authentication
Most Cloudflare MCP servers require OAuth authentication:

1. Add the server to `.mcp.json` (already done)
2. In Claude Desktop/Code, use `/mcp` command
3. Follow OAuth flow to authenticate with Cloudflare account
4. Tokens are stored securely and refreshed automatically

### Server Not Showing Up
- Restart Claude Desktop/Code after adding to `.mcp.json`
- Check `npx mcp-remote <url>` works standalone
- Verify internet connectivity to Cloudflare MCP endpoints

### No Data Available
- Some MCP servers (like observability) require active Cloudflare resources
- If nothing deployed yet, some queries will return empty results
- This is expected in pre-deployment phase

---

## Reference Links

- [Cloudflare Docs MCP Server](https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/)
- [Cloudflare MCP GitHub Repository](https://github.com/cloudflare/mcp-server-cloudflare)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [Codex Infrastructure Plan](./infraplan.md)
- [Codex CI/CD Pipeline Status](./CI-CD-Pipeline.md)