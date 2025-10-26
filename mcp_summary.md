# MCP Summary

This file contains a summary of all the `.md` files that mention "mcp".

## AGENTS.md

# Agent Instructions for Codex Project

## Svelte MCP Server

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

### Available MCP Tools:

#### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

#### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

#### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

#### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

## Project Structure

This is a monorepo with feature-based organization:

### Apps

- `apps/web` - SvelteKit application

### Packages

**Active Packages:**

- `packages/database` - Drizzle ORM schemas and migrations
- `packages/validation` - Zod schemas for validation
- `packages/cloudflare-clients` - R2 and KV clients
- `packages/test-utils` - Shared testing utilities (includes Miniflare helpers)

**Deleted Packages:**

- `packages/auth` - Deleted (will use Better Auth directly in web app)
- `packages/notifications` - Deleted (will implement email/notifications when needed)
- `packages/core-services` - Deleted (business logic will live in web app features)

### Workers

- `workers/queue-consumer` - Currently disabled (Cloudflare not set up yet, will enable in Phase 2)

### Testing Strategy

Follow the testing pyramid approach:

1. **Unit Tests** (\*.test.ts) - Test individual functions, components, utilities
   - Co-located with source files
   - Fast, isolated tests
   - Mock external dependencies

2. **Integration Tests** (\*.test.ts) - Test service interactions, API routes
   - Test database interactions with test DB
   - Test API endpoints
   - Located near the code they test

3. **E2E Tests** (\*.spec.ts) - Test critical user flows
   - Located in `apps/web/e2e/`
   - Use Playwright
   - Test complete user journeys

### Code Organization

Follow feature-based organization in `apps/web/src/lib/features/`:

- Each feature has: components, services, types, utils
- Shared code goes in `lib/features/shared/`
- Tests are co-located with source code

### Best Practices

1. **Svelte 5**: Use runes ($state, $derived, $effect, $props)
2. **Type Safety**: Use TypeScript strictly
3. **Testing**: Write tests for new features
4. **Code Quality**: Run linting and formatting before committing
5. **Documentation**: Update docs when adding features

## Commands

```bash
# Development
pnpm dev              # Start dev server
pnpm dev:web          # Start web app only

# Testing
pnpm test             # Run all unit/integration tests
pnpm test:watch       # Run tests in watch mode
pnpm test:e2e         # Run E2E tests
pnpm test:coverage    # Run tests with coverage

# Code Quality
pnpm lint             # Run ESLint
pnpm format           # Format code with Prettier
pnpm typecheck        # Check TypeScript types

# Database
pnpm --filter @codex/database db:generate  # Generate migrations
pnpm --filter @codex/database db:migrate   # Run migrations
pnpm --filter @codex/database db:studio    # Open Drizzle Studio
```

## design/documentation-index.md

# Project Documentation Index

This document serves as a central routing system to all Markdown documentation files within the project. It is organized by logical categories to help you quickly find the information you need.

---

## I. Core Vision & Overview

- **[Platform Overview](design/overview.md)**
  - High-level requirements, platform vision, core business requirements, stakeholder needs, system capabilities, and phased development strategy.
- **[MVP Definition](design/MVP-Definition.md)**
  - Defines the Minimum Viable Product (MVP) goals, success criteria, architecture philosophy, primary stakeholders, and detailed MVP scope.
- **[Phase 1 Design Review](design/phase-1-design-review.md)**
  - Comprehensive review of all Phase 1 PDRs and TDDs, identifying strengths, weaknesses, and recommendations for implementation.

## II. Feature Designs (Phase 1 MVP)

### Authentication & Authorization

- **[Auth PDR - Phase 1](design/features/auth/pdr-phase-1.md)**
  - Product Requirements Document for Phase 1 Authentication, covering user registration, login, password reset, and role-based access control.
- **[Auth TDD - Phase 1](design/features/auth/ttd-dphase-1.md)**
  - Technical Design Document for Phase 1 Authentication, detailing BetterAuth configuration, session management, and route guards.

### Content Management

- **[Content Management PDR - Phase 1](design/features/content-management/pdr-phase-1.md)**
  - Product Requirements Document for Phase 1 Content Management, covering video/audio upload, media library, and content metadata.
- **[Content Management TDD - Phase 1](design/features/content-management/ttd-dphase-1.md)**
  - Technical Design Document for Phase 1 Content Management, detailing media services, R2 integration, and upload flows.

### Media Transcoding

- **[Media Transcoding PDR - Phase 1](design/features/media-transcoding/pdr-phase-1.md)**
  - Product Requirements Document for Phase 1 Media Transcoding, covering HLS video/audio, waveform generation, and async processing.
- **[Media Transcoding TDD - Phase 1](design/features/media-transcoding/ttd-dphase-1.md)**
  - Technical Design Document for Phase 1 Media Transcoding, detailing Runpod integration, queue processing, and webhook handling.

### E-Commerce

- **[E-Commerce PDR - Phase 1](design/features/e-commerce/pdr-phase-1.md)**
  - Product Requirements Document for Phase 1 E-Commerce, covering one-time purchases, Stripe integration, and refund management.
- **[E-Commerce TDD - Phase 1](design/features/e-commerce/ttd-dphase-1.md)**
  - Technical Design Document for Phase 1 E-Commerce, detailing Stripe API calls, webhook processing, and polymorphic purchase records.

### Content Access

- **[Content Access PDR - Phase 1](design/features/content-access/pdr-phase-1.md)**
  - Product Requirements Document for Phase 1 Content Access, covering customer library, secure media playback, and resume functionality.
- **[Content Access TDD - Phase 1](design/features/content-access/ttd-dphase-1.md)**
  - Technical Design Document for Phase 1 Content Access, detailing access control flow, signed R2 URLs, and playback progress tracking.

### Notifications

- **[Notifications PDR - Phase 1](design/features/notifications/pdr-phase-1.md)**
  - Product Requirements Document for Phase 1 Notifications, covering email abstraction, templates, and transactional emails.
- **[Notifications TDD - Phase 1](design/features/notifications/ttd-dphase-1.md)**
  - Technical Design Document for Phase 1 Notifications, detailing service interfaces, adapters, and template management.

### Admin Dashboard

- **[Admin Dashboard PDR - Phase 1](design/features/admin-dashboard/pdr-phase-1.md)**
  - Product Requirements Document for Phase 1 Admin Dashboard, covering content/customer management, simple analytics, and basic settings.
- **[Admin Dashboard TDD - Phase 1](design/features/admin-dashboard/ttd-dphase-1.md)**
  - Technical Design Document for Phase 1 Admin Dashboard, detailing service aggregation, UI components, and access control.

### Platform Settings

- **[Platform Settings PDR - Phase 1](design/features/platform-settings/pdr-phase-1.md)**
  - Product Requirements Document for Phase 1 Platform Settings, covering basic branding (name, logo, color) and business information.
- **[Platform Settings TDD - Phase 1](design/features/platform-settings/ttd-dphase-1.md)**
  - Technical Design Document for Phase 1 Platform Settings, detailing single-row table persistence, R2 for logos, and global availability.

## III. Feature Designs (Future Phases - Full Overviews)

- **[Admin Dashboard - Full Feature Overview](design/features/admin-dashboard/full-feature-overview.md)**
  - Comprehensive overview of the Admin Dashboard's capabilities across all phases.
- **[Analytics - Full Feature Overview](design/features/analytics/full-feature-overview.md)**
  - Comprehensive overview of the Analytics feature's capabilities across all phases.
- **[Auth - Full Feature Overview](design/features/auth/full-feature-overview.md)**
  - Comprehensive overview of the Authentication feature's capabilities across all phases.
- **[Content Access - Full Feature Overview](design/features/content-access/full-feature-overview.md)**
  - Comprehensive overview of the Content Access feature's capabilities across all phases.
- **[Content Management - Full Feature Overview](design/features/content-management/full-feature-overview.md)**
  - Comprehensive overview of the Content Management feature's capabilities across all phases.
- **[Credits - Full Feature Overview](design/features/credits/full-feature-overview.md)**
  - Comprehensive overview of the Credits feature's capabilities across all phases.
- **[E-Commerce - Full Feature Overview](design/features/e-commerce/full-feature-overview.md)**
  - Comprehensive overview of the E-Commerce feature's capabilities across all phases.
- **[Multi-Creator - Full Feature Overview](design/features/multi-creator/full-feature-overview.md)**
  - Comprehensive overview of the Multi-Creator feature's capabilities across all phases.
- **[Notifications - Full Feature Overview](design/features/notifications/full-feature-overview.md)**
  - Comprehensive overview of the Notifications feature's capabilities across all phases.
- **[Offering Portals - Full Feature Overview](design/features/offering-portals/full-feature-overview.md)**
  - Comprehensive overview of the Offering Portals feature's capabilities across all phases.
- **[Offerings - Full Feature Overview](design/features/offerings/full-feature-overview.md)**
  - Comprehensive overview of the Offerings feature's capabilities across all phases.
- **[Platform Settings - Full Feature Overview](design/features/platform-settings/full-feature-overview.md)**
  - Comprehensive overview of the Platform Settings feature's capabilities across all phases.
- **[Subscriptions - Full Feature Overview](design/features/subscriptions/full-feature-overview.md)**
  - Comprehensive overview of the Subscriptions feature's capabilities across all phases.

## IV. Feature Designs (Future Phases - PDR/TDD Placeholders)

- **[Analytics PDR - Phase 1](design/features/analytics/pdr-phase-1.md)**
  - Placeholder Product Requirements Document for Phase 1 Analytics.
- **[Analytics TDD - Phase 1](design/features/analytics/ttd-dphase-1.md)**
  - Placeholder Technical Design Document for Phase 1 Analytics.
- **[Auth MVP](design/features/auth/mvp.md)**
  - Defines the Minimum Viable Product scope for Authentication.
- **[Credits PDR - Phase 1](design/features/credits/pdr-phase-1.md)**
  - Placeholder Product Requirements Document for Phase 1 Credits.
- **[Credits TDD - Phase 1](design/features/credits/ttd-dphase-1.md)**
  - Placeholder Technical Design Document for Phase 1 Credits.
- **[Multi-Creator PDR - Phase 1](design/features/multi-creator/pdr-phase-1.md)**
  - Placeholder Product Requirements Document for Phase 1 Multi-Creator.
- **[Multi-Creator TDD - Phase 1](design/features/multi-creator/ttd-dphase-1.md)**
  - Placeholder Technical Design Document for Phase 1 Multi-Creator.
- **[Offering Portals PDR - Phase 1](design/features/offering-portals/pdr-phase-1.md)**
  - Placeholder Product Requirements Document for Phase 1 Offering Portals.
- **[Offering Portals TDD - Phase 1](design/features/offering-portals/ttd-dphase-1.md)**
  - Placeholder Technical Design Document for Phase 1 Offering Portals.
- **[Offerings PDR - Phase 1](design/features/offerings/pdr-phase-1.md)**
  - Placeholder Product Requirements Document for Phase 1 Offerings.
- **[Offerings TDD - Phase 1](design/features/offerings/ttd-dphase-1.md)**
  - Placeholder Technical Design Document for Phase 1 Offerings.
- **[Shared Database Schema](design/features/shared/database-schema.md)**
  - Detailed database schema for all phases of the platform.
- **[Shared PDR - Phase 1](design/features/shared/pdr-phase-1.md)**
  - Placeholder Product Requirements Document for Shared components.
- **[Shared TDD - Phase 1](design/features/shared/ttd-dphase-1.md)**
  - Placeholder Technical Design Document for Shared components.
- **[Subscriptions PDR - Phase 1](design/features/subscriptions/pdr-phase-1.md)**
  - Placeholder Product Requirements Document for Phase 1 Subscriptions.
- **[Subscriptions TDD - Phase 1](design/features/subscriptions/ttd-dphase-1.md)**
  - Placeholder Technical Design Document for Phase 1 Subscriptions.

## V. Infrastructure & Architecture

- **[CI/CD Pipeline](design/infrastructure/CI-CD-Pipeline.md)**
  - Details the Continuous Integration/Continuous Deployment strategy using GitHub Actions and Cloudflare.
- **[Code Structure](design/infrastructure/CodeStructure.md)**
  - Describes the monorepo structure, feature-based organization, shared package conventions, and testing organization.
- **[D2 Diagrams README](design/infrastructure/d2/README.md)**
  - Instructions and overview for generating infrastructure diagrams using D2.
- **[Environment Management](design/infrastructure/EnvironmentManagement.md)**
  - Guide for local development setup, staging, and production environment configurations.
- **[Infrastructure Plan](design/infrastructure/infraplan.md)**
  - Overall infrastructure architecture, core services stack (Cloudflare, Neon, RunPod), data flow examples, and cost estimation.
- **[MCP Setup](design/infrastructure/MCP-Setup.md)**
  - Guide for setting up Model Context Protocol servers with Claude Desktop to enhance development workflow with AI assistance.
- **[R2 Bucket Structure](design/infrastructure/R2BucketStructure.md)**
  - Details the Cloudflare R2 bucket organization, bucket-per-creator design, and access patterns.
- **[Testing](design/infrastructure/Testing.md)**
  - Complete testing framework guide - philosophy, implementation, and examples for unit, integration, and E2E tests across the monorepo.

## VI. Security

- **[Rate Limiting Strategy](design/security/RateLimiting.md)**
  - Details the rate limiting strategy using Cloudflare KV to protect against abuse and excessive API usage.

## VII. Other Project Files

- **[AGENTS.md](AGENTS.md)**
  - Instructions for using Claude with the Svelte MCP server for Svelte 5 and SvelteKit documentation.

---

**Note on Placeholder Documents**: Many files under `design/features/` for future phases (e.g., Analytics, Credits, Multi-Creator, Offerings, Subscriptions) currently exist as empty or minimal placeholder `.md` files. These will need to be fully fleshed out in their respective development phases.

## design/infrastructure/MCP-Cloudflare-Integration.md

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

## design/infrastructure/MCP-Setup.md

# Model Context Protocol (MCP) Setup

Learn how to extend Claude Desktop with local MCP servers to enable enhanced development workflows and integrations for the Codex project.

## Overview

Model Context Protocol (MCP) servers extend AI applications' capabilities by providing secure, controlled access to local resources and tools. This guide demonstrates how to configure Claude Desktop to work with MCP servers for improved development productivity.

## Benefits for Codex Development

Using MCP servers with Claude Desktop provides:

- **File System Access**: Read and modify project files with AI assistance
- **Codebase Navigation**: Search and explore the Codex monorepo structure
- **Development Tools**: Access to build tools, test runners, and linters
- **Database Integration**: Query and manage development databases
- **API Testing**: Interact with local API endpoints during development

All operations require explicit approval, ensuring you maintain full control.

## Prerequisites

Before setting up MCP servers, ensure you have:

### Claude Desktop

Download and install [Claude Desktop](https://claude.ai/download) for your operating system (macOS or Windows).

If already installed, verify you're running the latest version:

- Click the Claude menu → "Check for Updates..."

### Node.js

MCP servers require Node.js. Verify installation:

```bash
node --version
```

If not installed, download from [nodejs.org](https://nodejs.org/) (LTS version recommended).

## Recommended MCP Servers for Codex

### 1. Filesystem Server (Essential)

Provides file and directory operations for the Codex codebase.

**Capabilities:**

- Read file contents and directory structures
- Create new files and directories
- Move and rename files
- Search for files by name or content

**Use Cases:**

- Reading design documents while implementing features
- Creating new components and tests
- Organizing project files
- Searching for specific code patterns

### 2. GitHub Server (Recommended)

Integrates with GitHub for repository operations.

**Capabilities:**

- Create and manage pull requests
- View issues and discussions
- Review code changes
- Manage branches

**Use Cases:**

- Creating PRs for feature branches
- Reviewing GitHub Actions workflow results
- Managing project issues

### 3. PostgreSQL Server (Optional)

Direct database access for development.

**Capabilities:**

- Query database schemas
- Read table data
- Execute SQL queries
- Inspect database structure

**Use Cases:**

- Debugging database issues
- Exploring schema structure
- Testing queries before implementation

## Installation Guide

### Step 1: Open Claude Desktop Settings

1. Click the Claude menu in your system's menu bar
2. Select "Settings..."
3. Navigate to the "Developer" tab
4. Click "Edit Config"

This opens the configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Step 2: Configure MCP Servers

#### Minimal Configuration (Filesystem Only)

Replace the file contents with this configuration, adjusting paths to your Codex project:

<CodeGroup>

```json macOS
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/username/development/Codex"
      ]
    }
  }
}
```

```json Windows
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "C:\Users\username\development\Codex"
      ]
    }
  }
}
```

</CodeGroup>

**Important:** Replace `username` with your actual username and adjust the path to match your Codex installation location.

#### Full Configuration (Filesystem + GitHub)

For enhanced functionality, add the GitHub server:

<CodeGroup>

```json macOS
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/username/development/Codex"
      ]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_github_token_here"
      }
    }
  }
}
```

```json Windows
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "C:\Users\username\development\Codex"
      ]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_github_token_here"
      }
    }
  }
}
```

</CodeGroup>

**GitHub Token:** Create a personal access token at [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens) with `repo` and `workflow` scopes.

### Step 3: Restart Claude Desktop

1. Completely quit Claude Desktop
2. Restart the application
3. Look for the MCP server indicator (hammer icon) in the bottom-right corner

Click the indicator to view available tools from connected servers.

## Security Considerations

### Directory Access Control

Only grant access to directories you're comfortable with Claude reading and modifying:

✅ **Safe to include:**

- Your Codex project directory
- Development workspace folders
- Documentation directories

❌ **Avoid including:**

- System directories
- Sensitive configuration folders
- Directories containing secrets or credentials

### Token Management

- **Never commit** `claude_desktop_config.json` to version control
- Store GitHub tokens securely
- Use environment variables for sensitive values when possible
- Rotate tokens periodically

### Approval Workflow

Every MCP server operation requires explicit approval before execution. Review each request carefully:

- **File modifications**: Check paths and content before approving
- **API calls**: Verify the operation and parameters
- **Database queries**: Review SQL before execution

## Common Use Cases for Codex Development

### Example 1: Feature Implementation

```
Prompt: "Read the PDR document for the auth feature in design/features/auth/pdr-phase-1.md
and help me implement the user registration endpoint following the architecture"
```

Claude will:

1. Request approval to read the PDR document
2. Analyze the requirements
3. Request approval to read existing code structure
4. Suggest implementation with file creation/modification

### Example 2: Test Creation

```
Prompt: "Create unit tests for the validation schemas in packages/validation/src/user-schema.ts"
```

Claude will:

1. Read the existing schema file
2. Generate appropriate test cases
3. Request approval to create test file
4. Create tests following project conventions

### Example 3: Documentation Updates

```
Prompt: "Update the README in packages/database to reflect the current schema structure"
```

Claude will:

1. Read current schema files
2. Read existing README
3. Generate updated documentation
4. Request approval to modify README

### Example 4: GitHub Workflow

```
Prompt: "Create a pull request for the feature/ci-cd branch to main with a summary
of the CI/CD pipeline implementation"
```

Claude will:

1. Analyze git diff
2. Generate PR description
3. Request approval to create PR via GitHub API

## Troubleshooting

### Server Not Showing Up

**Symptoms:** No MCP indicator in Claude Desktop

**Solutions:**

1. Verify configuration file syntax (valid JSON)
2. Check that file paths are absolute, not relative
3. Restart Claude Desktop completely
4. View logs for errors (see below)

**Test manually:**

<CodeGroup>

```bash macOS/Linux
npx -y @modelcontextprotocol/server-filesystem /Users/username/development/Codex
```

```powershell Windows
npx -y @modelcontextprotocol/server-filesystem C:\Users\username\development\Codex
```

</CodeGroup>

### Viewing Logs

**macOS:**

```bash
tail -n 20 -f ~/Library/Logs/Claude/mcp*.log
```

**Windows:**

```powershell
type "%APPDATA%\Claude\logs\mcp*.log"
```

Log files:

- `mcp.log` - General MCP connection logging
- `mcp-server-SERVERNAME.log` - Server-specific error logs

### Tool Calls Failing

If operations fail silently:

1. Check Claude's logs for error messages
2. Verify file permissions for target directories
3. Test server manually (see above)
4. Restart Claude Desktop
5. Check that Node.js and npx are in PATH

### Windows ENOENT Error

If you see `${APPDATA}` in error messages, add the expanded path to your config:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\Users\username\development\Codex"],
      "env": {
        "APPDATA": "C:\Users\username\AppData\Roaming\"
      }
    }
  }
}
```

Ensure npm is installed globally:

```bash
npm install -g npm
```

## Advanced Configuration

### Multiple Project Directories

Grant access to multiple directories:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/username/development/Codex",
        "/Users/username/development/other-project",
        "/Users/username/Documents/design-docs"
      ]
    }
  }
}
```

### Custom Server Scripts

For project-specific tools, create a custom MCP server:

```json
{
  "mcpServers": {
    "codex-tools": {
      "command": "node",
      "args": ["/Users/username/development/Codex/scripts/mcp-server.js"]
    }
  }
}
```

See [Building Custom MCP Servers](#building-custom-servers) below.

## Building Custom Servers

For Codex-specific workflows, you can create custom MCP servers:

### Use Cases

- Database migration management
- Test runner integration
- Build tool automation
- Custom code generation

### Resources

- [MCP Server SDK Documentation](https://modelcontextprotocol.io/docs/develop/build-server)
- [Official MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

### Example Structure

```
scripts/
├── mcp-server/
│   ├── index.ts
│   ├── tools/
│   │   ├── test-runner.ts
│   │   ├── db-migrate.ts
│   │   └── code-gen.ts
│   └── package.json
```

## Best Practices

### Development Workflow

1. **Start each session** by having Claude read relevant design docs
2. **Review approvals carefully** before confirming file modifications
3. **Use specific prompts** that reference file paths and requirements
4. **Test incrementally** after each AI-assisted change
5. **Commit frequently** to track AI-assisted changes separately

### Prompt Engineering for Codex

**Good prompts:**

- "Read the PDR in design/features/auth/pdr-phase-1.md and implement the login endpoint"
- "Create tests for packages/validation/src/user-schema.ts following the Testing.md guide"
- "Update AGENTS.md to reflect the changes in packages structure"

**Avoid:**

- "Fix everything" (too broad)
- "Make it better" (no specific guidance)
- Prompts without file paths or context

### Security Checklist

- [ ] Only include necessary project directories in filesystem access
- [ ] Never include directories with secrets or credentials
- [ ] Use read-only GitHub tokens when possible
- [ ] Review all file modifications before approval
- [ ] Regularly audit MCP server configuration
- [ ] Keep Claude Desktop updated

## Integration with Codex Workflow

### CI/CD Development

Use MCP to assist with CI/CD pipeline work:

1. Read workflow files: `.github/workflows/*.yml`
2. Test changes locally with act
3. Update documentation automatically
4. Create PRs with detailed descriptions

### Feature Implementation

Follow the Codex development process:

1. Read PDR and TTD documents
2. Review existing code structure
3. Implement features with AI assistance
4. Create tests following conventions
5. Update documentation

### Code Review

Enhance code review process:

1. Analyze PR diffs
2. Suggest improvements based on style guides
3. Check test coverage
4. Update related documentation

## Next Steps

- [Explore MCP Server Repository](https://github.com/modelcontextprotocol/servers)
- [Build Custom MCP Servers](https://modelcontextprotocol.io/docs/develop/build-server)
- [MCP Architecture Documentation](https://modelcontextprotocol.io/docs/learn/architecture)
- [Claude Desktop Documentation](https://claude.ai/desktop)

## Related Documentation

- [CI/CD Pipeline](./CI-CD-Pipeline.md) - Automated testing and deployment
- [Testing Guide](./Testing.md) - Testing strategy and frameworks
- [Code Structure](./CodeStructure.md) - Project organization
- [AGENTS.md](../../AGENTS.md) - AI agent development guidelines
