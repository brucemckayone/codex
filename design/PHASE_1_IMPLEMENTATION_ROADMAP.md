# Codex Platform - Phase 1 Implementation Roadmap

**Version**: 1.0
**Date**: 2025-11-05
**Status**: Execution-Ready
**Target**: Backend Implementation Only (No Frontend)

---

## Executive Summary

This document provides a complete, execution-ready implementation roadmap for Phase 1 (backend only) of the Codex platform. It is designed for parallel team execution without requiring additional high-level explanation.

**Scope**: Backend services, APIs, database, workers, integrations
**Excluded**: Frontend UI components, styling, client-side JavaScript

**Delivery Model**: Test-Driven Development (TDD)
- Every work packet includes implementation + full test suite + Definition of Done
- Tests must pass in CI before merge
- All interfaces explicitly defined with versioning

**Parallelization**: Work packets are designed for concurrent development with minimal coordination through stable interface contracts.

---

## Table of Contents

1. [Roadmap Structure](#1-roadmap-structure)
2. [Setup & Foundation](#2-setup--foundation)
3. [Core Services](#3-core-services)
4. [Feature Packets](#4-feature-packets)
5. [Integration Phase](#5-integration-phase)
6. [Release Preparation](#6-release-preparation)
7. [Cross-Cutting Concerns](#7-cross-cutting-concerns)
8. [CI/CD Mapping](#8-cicd-mapping)
9. [Risk & Mitigation](#9-risk--mitigation)
10. [Worked Example](#10-worked-example)

---

## 1. Roadmap Structure

### 1.1 Phases Overview

```
Phase 0: Setup & Foundation (1-2 weeks)
  ↓
Phase 1: Core Services (2-3 weeks, parallel)
  ↓
Phase 2: Feature Packets (4-6 weeks, parallel)
  ↓
Phase 3: Integration (1-2 weeks)
  ↓
Phase 4: Release Prep (1 week)
```

### 1.2 Work Packet Format

Each work packet contains:

1. **Packet ID**: Unique identifier (e.g., `P1-AUTH-001`)
2. **Branch Name**: Suggested git branch name
3. **Implementation Steps**: Ordered, actionable substeps
4. **Dependencies**: Required packets, services, interfaces
5. **Interface Contracts**: Exact API specifications with examples
6. **Role Assignments**: Backend Engineer, Schema Owner, API Owner, QA, DevOps
7. **Test Specifications**: Unit, integration, contract, E2E tests with assertions
8. **Implementation Guide**: Code snippets, file paths, pseudocode
9. **Definition of Done**: Verifiable acceptance criteria
10. **Review Checklist**: What reviewers must verify

### 1.3 Naming Conventions

**Branch Names**: `feature/{packet-id}-{short-description}`
Example: `feature/P1-AUTH-001-betterauth-setup`

**Packet IDs**: `P1-{FEATURE}-{NUMBER}`
- `P1-SETUP-*`: Foundation & infrastructure
- `P1-AUTH-*`: Authentication & authorization
- `P1-CONTENT-*`: Content management
- `P1-ACCESS-*`: Content access & playback
- `P1-ECOM-*`: E-commerce & payments
- `P1-ADMIN-*`: Admin dashboard
- `P1-SETTINGS-*`: Platform settings
- `P1-NOTIFY-*`: Notifications
- `P1-INTEG-*`: Integration packets

---

## 2. Setup & Foundation

### Work Packet P1-SETUP-001: Database Schema Migration

**Branch**: `feature/P1-SETUP-001-database-schema`

**Owner**: Schema Owner + Backend Engineer

**Description**: Implement complete Phase 1 database schema using Drizzle ORM with PostgreSQL (Neon).

#### Implementation Steps

1. **Install Drizzle ORM and dependencies**
   ```bash
   pnpm add drizzle-orm postgres
   pnpm add -D drizzle-kit
   ```

2. **Create Drizzle configuration** (`drizzle.config.ts`)
   ```typescript
   import type { Config } from 'drizzle-kit';

   export default {
     schema: './packages/database/src/schema/index.ts',
     out: './packages/database/drizzle',
     driver: 'pg',
     dbCredentials: {
       connectionString: process.env.DATABASE_URL!,
     },
   } satisfies Config;
   ```

3. **Implement schema files** (one per entity group):
   - `packages/database/src/schema/users.ts` - users, sessions, verification_tokens
   - `packages/database/src/schema/organizations.ts` - organizations, organization_members, organization_invitations
   - `packages/database/src/schema/content.ts` - categories, tags, media_items, content, content_tags, content_resources
   - `packages/database/src/schema/resources.ts` - resources
   - `packages/database/src/schema/purchases.ts` - content_purchases
   - `packages/database/src/schema/playback.ts` - video_playback
   - `packages/database/src/schema/settings.ts` - platform_settings
   - `packages/database/src/schema/notifications.ts` - email_templates
   - `packages/database/src/schema/index.ts` - exports all schemas

4. **Enable PostgreSQL extensions**
   ```sql
   -- Add to migration 0000_init.sql
   CREATE EXTENSION IF NOT EXISTS citext;
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   ```

5. **Generate initial migration**
   ```bash
   pnpm --filter @codex/database db:gen:drizzle
   ```

6. **Review generated SQL** in `packages/database/drizzle/0000_*.sql`
   - Verify all tables created
   - Verify all indexes created
   - Verify all constraints created
   - Verify CASCADE/RESTRICT rules

7. **Apply migration to development database**
   ```bash
   pnpm --filter @codex/database db:migrate
   ```

#### Dependencies

- Neon Postgres database provisioned
- Environment variable `DATABASE_URL` configured

#### Interface Contract: Database Client

**Export**: `packages/database/src/client.ts`

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);

export const db = drizzle(client, { schema });
export type Database = typeof db;

// Type exports
export * from './schema';
```

**Version**: v1.0.0
**Breaking Changes**: N/A (initial version)

#### Test Specifications

**1. Schema Validation Tests** (`packages/database/src/schema/schema.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import * as schema from './index';

describe('Database Schema', () => {
  it('should export all required tables', () => {
    expect(schema.users).toBeDefined();
    expect(schema.sessions).toBeDefined();
    expect(schema.organizations).toBeDefined();
    expect(schema.content).toBeDefined();
    expect(schema.contentPurchases).toBeDefined();
    // ... all tables
  });

  it('should have correct foreign key relationships', () => {
    // Verify FK constraints in schema definitions
    expect(schema.organizationMembers.organizationId).toBeDefined();
    expect(schema.content.organizationId).toBeDefined();
  });
});
```

**2. Migration Tests** (`packages/database/src/migrations.test.ts`)

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from './client';
import { sql } from 'drizzle-orm';

describe('Database Migrations', () => {
  it('should apply migrations successfully', async () => {
    // Migration already applied in test setup
    // Verify tables exist
    const result = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);

    expect(result.rows.length).toBeGreaterThan(10);
  });

  it('should have created citext extension', async () => {
    const result = await db.execute(sql`
      SELECT * FROM pg_extension WHERE extname = 'citext'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('should enforce unique email constraint (case-insensitive)', async () => {
    await db.insert(schema.users).values({
      email: 'test@example.com',
      name: 'Test User',
      role: 'customer',
    });

    await expect(async () => {
      await db.insert(schema.users).values({
        email: 'TEST@EXAMPLE.COM', // Different case
        name: 'Test User 2',
        role: 'customer',
      });
    }).rejects.toThrow(); // Should violate unique constraint
  });
});
```

**3. Contract Tests** (`packages/database/src/client.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { db } from './client';
import { users } from './schema';

describe('Database Client Contract', () => {
  it('should export db instance', () => {
    expect(db).toBeDefined();
    expect(db.query).toBeDefined();
  });

  it('should support basic CRUD operations', async () => {
    // Create
    const [user] = await db.insert(users).values({
      email: 'crud@test.com',
      name: 'CRUD Test',
      role: 'customer',
    }).returning();

    expect(user.id).toBeDefined();

    // Read
    const found = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.id, user.id),
    });
    expect(found?.email).toBe('crud@test.com');

    // Update
    await db.update(users)
      .set({ name: 'Updated Name' })
      .where(eq(users.id, user.id));

    // Delete
    await db.delete(users).where(eq(users.id, user.id));
  });
});
```

**CI Requirements**:
- All tests must pass on ephemeral Neon branch
- Migration must complete in <10 seconds
- Schema validation: 100% coverage
- Zero SQL syntax errors

#### Implementation Guide

**File Structure**:
```
packages/database/
├── src/
│   ├── schema/
│   │   ├── users.ts
│   │   ├── organizations.ts
│   │   ├── content.ts
│   │   ├── purchases.ts
│   │   ├── playback.ts
│   │   ├── settings.ts
│   │   ├── notifications.ts
│   │   ├── index.ts
│   │   └── schema.test.ts
│   ├── client.ts
│   ├── client.test.ts
│   └── migrations.test.ts
├── drizzle/
│   └── 0000_initial_schema.sql (generated)
├── drizzle.config.ts
└── package.json
```

**Example Schema File** (`packages/database/src/schema/users.ts`):

```typescript
import { pgTable, uuid, text, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['customer', 'platform_owner']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(), // citext in migration
  emailVerified: boolean('email_verified').default(false).notNull(),
  name: text('name').notNull(),
  role: userRoleEnum('role').default('customer').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const verificationTokens = pgTable('verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type VerificationToken = typeof verificationTokens.$inferSelect;
```

**Manual Migration Customization** (add to generated SQL):

```sql
-- After table creation, modify email column to use citext
ALTER TABLE users ALTER COLUMN email TYPE citext;

-- Add email format validation
ALTER TABLE users ADD CONSTRAINT users_email_format CHECK (
  email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
);

-- Add indexes not auto-generated by Drizzle
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_sessions_expired ON sessions(expires_at) WHERE expires_at < NOW();
```

#### Definition of Done

- [ ] All 17 tables created with correct schema
- [ ] All foreign key constraints configured with CASCADE/RESTRICT
- [ ] All unique constraints in place (email, slugs, tokens)
- [ ] All indexes created (see DATABASE_SCHEMA_DESIGN.md section 5)
- [ ] citext extension enabled for case-insensitive emails
- [ ] Email format validation CHECK constraint added
- [ ] All schema tests passing (100% table coverage)
- [ ] Migration tests passing on ephemeral Neon branch
- [ ] Contract tests passing (db client CRUD operations)
- [ ] Migration SQL reviewed and approved by Schema Owner
- [ ] Database client exports all schemas and types
- [ ] CI passes: static analysis, tests, migration
- [ ] Documentation: schema file headers with JSDoc comments

#### Review Checklist

- [ ] All table names match DATABASE_SCHEMA_DESIGN.md exactly
- [ ] All column names use snake_case (PostgreSQL convention)
- [ ] All foreign key relationships have correct ON DELETE behavior
- [ ] Indexes exist for all foreign keys
- [ ] Composite indexes exist for organization-scoped queries
- [ ] Soft delete tables have `deleted_at TIMESTAMPTZ`
- [ ] Timestamps use `TIMESTAMPTZ` (not `TIMESTAMP`)
- [ ] UUIDs use `gen_random_uuid()` (not uuid-ossp)
- [ ] Enums are defined as PostgreSQL enums (not text with CHECK)
- [ ] No polymorphic foreign keys (all FKs point to specific tables)
- [ ] Migration SQL is idempotent (can run multiple times safely)
- [ ] Migration rollback procedure documented

---

### Work Packet P1-SETUP-002: Cloudflare Workers Foundation

**Branch**: `feature/P1-SETUP-002-workers-foundation`

**Owner**: DevOps + Backend Engineer

**Description**: Set up Cloudflare Workers infrastructure for all backend services (API, Auth, Web).

#### Implementation Steps

1. **Install Wrangler CLI and dependencies**
   ```bash
   pnpm add -D wrangler @cloudflare/workers-types
   ```

2. **Create worker projects** (monorepo structure):
   ```
   workers/
   ├── stripe-webhook-handler/   # API worker
   │   ├── src/index.ts
   │   ├── wrangler.toml
   │   └── package.json
   ├── auth/                      # Auth worker (future)
   │   ├── src/index.ts
   │   ├── wrangler.toml
   │   └── package.json
   └── README.md
   ```

3. **Configure wrangler.toml for each worker**:

**stripe-webhook-handler** (`workers/stripe-webhook-handler/wrangler.toml`):
```toml
name = "stripe-webhook-handler"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[env.production]
name = "stripe-webhook-handler-production"
routes = [
  { pattern = "api.revelations.studio/*", zone_name = "revelations.studio" }
]

[env.preview]
name = "stripe-webhook-handler-preview-PR_NUMBER"
routes = [
  { pattern = "api-preview-PR_NUMBER.revelations.studio/*", zone_name = "revelations.studio" }
]

[[env.production.kv_namespaces]]
binding = "AUTH_SESSION_KV"
id = "YOUR_PRODUCTION_KV_ID"

[[env.preview.kv_namespaces]]
binding = "AUTH_SESSION_KV"
id = "YOUR_PREVIEW_KV_ID"
```

4. **Create base worker handler** (`workers/stripe-webhook-handler/src/index.ts`):

```typescript
/**
 * Stripe Webhook Handler Worker
 * Processes Stripe webhook events for payment processing
 */

export interface Env {
  DATABASE_URL: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET_PAYMENT: string;
  AUTH_SESSION_KV: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'stripe-webhook-handler' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, stripe-signature',
        },
      });
    }

    // Route to webhook handler
    if (url.pathname === '/webhooks/stripe/payment' && request.method === 'POST') {
      // Webhook handler implementation in later packet
      return new Response('Webhook handler not implemented', { status: 501 });
    }

    return new Response('Not Found', { status: 404 });
  },
};
```

5. **Create Cloudflare KV namespaces**:
   ```bash
   # Production
   wrangler kv:namespace create "AUTH_SESSION_KV" --env production

   # Preview
   wrangler kv:namespace create "AUTH_SESSION_KV" --env preview
   ```

6. **Update wrangler.toml with KV IDs** from previous step

7. **Deploy to preview environment** (test deployment):
   ```bash
   cd workers/stripe-webhook-handler
   wrangler deploy --env preview
   ```

8. **Verify deployment**:
   ```bash
   curl https://api-preview-test.revelations.studio/health
   # Expected: {"status":"ok","service":"stripe-webhook-handler"}
   ```

#### Dependencies

- Cloudflare account with Workers enabled
- DNS zone `revelations.studio` configured
- GitHub secrets configured (see CI/CD section)

#### Interface Contract: Worker Environment

**Binding**: All workers receive standardized `Env` interface

```typescript
export interface Env {
  // Database
  DATABASE_URL: string;

  // Authentication
  SESSION_SECRET: string;
  BETTER_AUTH_SECRET: string;

  // Stripe
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET_PAYMENT: string;
  STRIPE_WEBHOOK_SECRET_SUBSCRIPTION: string;
  STRIPE_WEBHOOK_SECRET_CONNECT: string;

  // Email
  RESEND_API_KEY: string;

  // KV Namespaces
  AUTH_SESSION_KV: KVNamespace;

  // R2 Buckets (future)
  // CODEX_MEDIA: R2Bucket;

  // Queues (future)
  // TRANSCODING_QUEUE: Queue;
}
```

**Version**: v1.0.0

#### Test Specifications

**1. Worker Deployment Tests** (`workers/stripe-webhook-handler/src/index.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import worker from './index';

const mockEnv: Env = {
  DATABASE_URL: 'postgresql://mock',
  STRIPE_SECRET_KEY: 'sk_test_mock',
  STRIPE_WEBHOOK_SECRET_PAYMENT: 'whsec_mock',
  AUTH_SESSION_KV: {} as KVNamespace,
};

describe('Stripe Webhook Handler Worker', () => {
  it('should respond to health check', async () => {
    const request = new Request('https://api.example.com/health');
    const response = await worker.fetch(request, mockEnv, {} as ExecutionContext);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ok');
  });

  it('should handle CORS preflight', async () => {
    const request = new Request('https://api.example.com/webhooks/stripe/payment', {
      method: 'OPTIONS',
    });
    const response = await worker.fetch(request, mockEnv, {} as ExecutionContext);

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('should return 404 for unknown routes', async () => {
    const request = new Request('https://api.example.com/unknown');
    const response = await worker.fetch(request, mockEnv, {} as ExecutionContext);

    expect(response.status).toBe(404);
  });
});
```

**2. CI/CD Integration Tests** (`.github/workflows/testing.yml` updated)

```yaml
- name: Test Worker Build
  run: |
    pnpm --filter stripe-webhook-handler build
    test -f workers/stripe-webhook-handler/dist/index.js
```

**CI Requirements**:
- Worker builds successfully
- Health check responds with 200
- CORS headers present
- All unit tests pass

#### Implementation Guide

**Project Structure**:
```
workers/
├── stripe-webhook-handler/
│   ├── src/
│   │   ├── index.ts
│   │   ├── index.test.ts
│   │   └── types.ts
│   ├── wrangler.toml
│   ├── package.json
│   └── tsconfig.json
└── README.md
```

**Worker Development**:
```bash
# Local development
cd workers/stripe-webhook-handler
wrangler dev

# Test locally
curl http://localhost:8787/health

# Deploy to preview
wrangler deploy --env preview

# Deploy to production
wrangler deploy --env production
```

#### Definition of Done

- [ ] All worker projects created with correct structure
- [ ] wrangler.toml configured for production + preview environments
- [ ] KV namespaces created and bound
- [ ] Health check endpoint implemented and tested
- [ ] CORS handling implemented
- [ ] Worker deploys successfully to preview environment
- [ ] Health check accessible via custom domain
- [ ] All worker unit tests passing
- [ ] CI build and deployment scripts working
- [ ] Secrets configured in Cloudflare (via wrangler secret)
- [ ] Documentation: README with deployment instructions

#### Review Checklist

- [ ] wrangler.toml has both production and preview environments
- [ ] Custom routes use correct domain (revelations.studio)
- [ ] KV namespaces are environment-specific (separate prod/preview)
- [ ] Worker exports correct type for Env interface
- [ ] Health check returns JSON with service name
- [ ] CORS headers allow stripe-signature header
- [ ] Worker handles OPTIONS method for all routes
- [ ] Error responses return appropriate status codes
- [ ] All secrets referenced in Env are documented
- [ ] Deployment script includes health check verification

---

### Work Packet P1-SETUP-003: R2 Bucket Infrastructure

**Branch**: `feature/P1-SETUP-003-r2-buckets`

**Owner**: DevOps + Backend Engineer

**Description**: Create Cloudflare R2 buckets for media, resources, and assets with presigned URL capabilities.

#### Implementation Steps

1. **Create R2 buckets via Wrangler**:
   ```bash
   # Production buckets
   wrangler r2 bucket create codex-media-production
   wrangler r2 bucket create codex-assets-production

   # Preview buckets
   wrangler r2 bucket create codex-media-preview
   wrangler r2 bucket create codex-assets-preview
   ```

2. **Create R2 service abstraction** (`packages/r2-service/src/index.ts`):

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export class R2Service {
  private client: S3Client;
  private bucket: string;

  constructor(config: R2Config) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.bucket = config.bucket;
  }

  /**
   * Generate presigned URL for upload (browser → R2 direct)
   */
  async getUploadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Generate presigned URL for download (streaming)
   */
  async getDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Delete object from R2
   */
  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  /**
   * Check if object exists
   */
  async objectExists(key: string): Promise<boolean> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }
}
```

3. **Define R2 key structure** (`packages/r2-service/src/keys.ts`):

```typescript
/**
 * R2 Key Structure (see R2_STORAGE_PATTERNS.md)
 */

export const R2Keys = {
  /**
   * Media originals: {organizationId}/originals/{mediaId}/original.{ext}
   */
  mediaOriginal: (orgId: string, mediaId: string, ext: string) =>
    `${orgId}/originals/${mediaId}/original.${ext}`,

  /**
   * HLS transcoded (future): {organizationId}/hls/{mediaId}/master.m3u8
   */
  mediaHLS: (orgId: string, mediaId: string) =>
    `${orgId}/hls/${mediaId}/master.m3u8`,

  /**
   * Thumbnails: {organizationId}/thumbnails/{mediaId}/thumb-{size}.jpg
   */
  thumbnail: (orgId: string, mediaId: string, size: 'small' | 'medium' | 'large') =>
    `${orgId}/thumbnails/${mediaId}/thumb-${size}.jpg`,

  /**
   * Resources: {organizationId}/resources/{resourceId}/{filename}
   */
  resource: (orgId: string, resourceId: string, filename: string) =>
    `${orgId}/resources/${resourceId}/${filename}`,

  /**
   * Assets (logos, etc): {organizationId}/assets/{assetType}/{filename}
   */
  asset: (orgId: string, assetType: string, filename: string) =>
    `${orgId}/assets/${assetType}/${filename}`,
};
```

4. **Bind R2 buckets to workers** (update `wrangler.toml`):

```toml
[[env.production.r2_buckets]]
binding = "CODEX_MEDIA"
bucket_name = "codex-media-production"

[[env.production.r2_buckets]]
binding = "CODEX_ASSETS"
bucket_name = "codex-assets-production"

[[env.preview.r2_buckets]]
binding = "CODEX_MEDIA"
bucket_name = "codex-media-preview"

[[env.preview.r2_buckets]]
binding = "CODEX_ASSETS"
bucket_name = "codex-assets-preview"
```

5. **Update worker Env interface**:

```typescript
export interface Env {
  // ... existing bindings
  CODEX_MEDIA: R2Bucket;
  CODEX_ASSETS: R2Bucket;

  // R2 credentials (for presigned URLs)
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}
```

6. **Create R2 service factory** for workers:

```typescript
import { R2Service } from '@codex/r2-service';

export function createR2Services(env: Env) {
  return {
    media: new R2Service({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: 'codex-media-production', // or from env
    }),
    assets: new R2Service({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: 'codex-assets-production',
    }),
  };
}
```

#### Dependencies

- Cloudflare R2 enabled on account
- AWS SDK v3 installed
- R2 access credentials generated

#### Interface Contract: R2 Service

**Export**: `packages/r2-service/src/index.ts`

```typescript
export interface IR2Service {
  getUploadUrl(key: string, expiresIn?: number): Promise<string>;
  getDownloadUrl(key: string, expiresIn?: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
}

export class R2Service implements IR2Service {
  // Implementation
}

export const R2Keys: {
  mediaOriginal(orgId: string, mediaId: string, ext: string): string;
  mediaHLS(orgId: string, mediaId: string): string;
  thumbnail(orgId: string, mediaId: string, size: 'small' | 'medium' | 'large'): string;
  resource(orgId: string, resourceId: string, filename: string): string;
  asset(orgId: string, assetType: string, filename: string): string;
};
```

**Version**: v1.0.0

#### Test Specifications

**1. R2 Service Unit Tests** (`packages/r2-service/src/index.test.ts`)

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { R2Service } from './index';

const testConfig = {
  accountId: process.env.R2_ACCOUNT_ID!,
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  bucket: 'codex-media-preview',
};

describe('R2Service', () => {
  let r2: R2Service;

  beforeAll(() => {
    r2 = new R2Service(testConfig);
  });

  it('should generate presigned upload URL', async () => {
    const url = await r2.getUploadUrl('test/upload.txt');
    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain('codex-media-preview');
  });

  it('should generate presigned download URL', async () => {
    const url = await r2.getDownloadUrl('test/download.txt');
    expect(url).toContain('X-Amz-Signature');
  });

  it('should set correct expiration time', async () => {
    const url = await r2.getUploadUrl('test/file.txt', 7200);
    const params = new URL(url);
    expect(params.searchParams.get('X-Amz-Expires')).toBe('7200');
  });
});
```

**2. R2 Keys Tests** (`packages/r2-service/src/keys.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { R2Keys } from './keys';

describe('R2Keys', () => {
  it('should generate correct media original key', () => {
    const key = R2Keys.mediaOriginal('org-123', 'media-456', 'mp4');
    expect(key).toBe('org-123/originals/media-456/original.mp4');
  });

  it('should generate correct thumbnail key', () => {
    const key = R2Keys.thumbnail('org-123', 'media-456', 'medium');
    expect(key).toBe('org-123/thumbnails/media-456/thumb-medium.jpg');
  });

  it('should generate correct resource key', () => {
    const key = R2Keys.resource('org-123', 'res-789', 'workbook.pdf');
    expect(key).toBe('org-123/resources/res-789/workbook.pdf');
  });
});
```

**3. Integration Tests** (requires R2 bucket access):

```typescript
describe('R2Service Integration', () => {
  it('should upload and retrieve file', async () => {
    const key = 'test/integration-test.txt';
    const content = 'Hello R2!';

    // Get upload URL
    const uploadUrl = await r2.getUploadUrl(key);

    // Upload file
    await fetch(uploadUrl, {
      method: 'PUT',
      body: content,
    });

    // Verify exists
    const exists = await r2.objectExists(key);
    expect(exists).toBe(true);

    // Cleanup
    await r2.deleteObject(key);
  });
});
```

**CI Requirements**:
- R2 service builds successfully
- Unit tests pass (with mock credentials)
- Integration tests pass (on preview bucket)
- Presigned URLs valid for 1 hour

#### Definition of Done

- [ ] R2 buckets created (production + preview)
- [ ] R2 service package implemented and tested
- [ ] R2Keys structure matches R2_STORAGE_PATTERNS.md
- [ ] Presigned URL generation working (upload + download)
- [ ] R2 buckets bound to workers
- [ ] R2 credentials configured as secrets
- [ ] All unit tests passing
- [ ] Integration tests passing (upload + download)
- [ ] CI passes with R2 service tests
- [ ] Documentation: JSDoc for all public methods

#### Review Checklist

- [ ] Bucket names follow convention: codex-{type}-{env}
- [ ] R2 keys follow organization-scoped structure
- [ ] Presigned URLs expire after 1 hour (default)
- [ ] S3 client configured with correct endpoint
- [ ] Error handling for missing objects
- [ ] No credentials hardcoded (use env vars)
- [ ] R2Service is stateless (safe for concurrent use)
- [ ] Test cleanup (delete test files after integration tests)

---

## 3. Core Services

### Work Packet P1-AUTH-001: BetterAuth Integration

**Branch**: `feature/P1-AUTH-001-betterauth-integration`

**Owner**: Backend Engineer + Auth Specialist

**Description**: Integrate BetterAuth with Drizzle adapter for email/password authentication and session management.

#### Implementation Steps

1. **Install BetterAuth dependencies**:
   ```bash
   pnpm add better-auth
   pnpm add better-auth/adapters/drizzle
   ```

2. **Create auth configuration** (`packages/auth/src/config.ts`):

```typescript
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@codex/database';
import * as schema from '@codex/database/schema';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      verification: schema.verificationTokens,
    },
  }),

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update every 24 hours
    cookieName: 'codex-session',
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 min fallback cache
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      // Email sending implemented in P1-NOTIFY-001
      console.log(`Verification email to ${user.email}: ${url}`);
    },
    sendResetPasswordEmail: async ({ user, url }) => {
      console.log(`Password reset to ${user.email}: ${url}`);
    },
  },

  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'customer',
      },
    },
  },

  secret: process.env.BETTER_AUTH_SECRET!, // 32+ chars
  baseURL: process.env.AUTH_URL || 'http://localhost:5173',
  trustedOrigins: [process.env.AUTH_URL || 'http://localhost:5173'],
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.User;
```

3. **Create auth API endpoints** (`apps/web/src/routes/api/auth/[...all]/+server.ts`):

```typescript
import { auth } from '@codex/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  return auth.handler(request);
};

export const POST: RequestHandler = async ({ request }) => {
  return auth.handler(request);
};
```

4. **Create session middleware** (`apps/web/src/hooks.server.ts`):

```typescript
import { auth } from '@codex/auth';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';

const sessionHandler: Handle = async ({ event, resolve }) => {
  const session = await auth.api.getSession({
    headers: event.request.headers,
  });

  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;

  return resolve(event);
};

export const handle = sequence(sessionHandler);
```

5. **Create auth service wrapper** (`packages/auth/src/service.ts`):

```typescript
import { auth } from './config';
import type { User, Session } from './config';

export interface IAuthService {
  signUp(email: string, password: string, name: string): Promise<User>;
  signIn(email: string, password: string): Promise<{ user: User; session: Session }>;
  signOut(sessionToken: string): Promise<void>;
  verifyEmail(token: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
  getSession(headers: Headers): Promise<{ user: User; session: Session } | null>;
}

export class AuthService implements IAuthService {
  async signUp(email: string, password: string, name: string): Promise<User> {
    const result = await auth.api.signUpEmail({
      body: { email, password, name },
    });
    return result.user;
  }

  async signIn(email: string, password: string) {
    const result = await auth.api.signInEmail({
      body: { email, password },
    });
    return { user: result.user, session: result.session };
  }

  async signOut(sessionToken: string): Promise<void> {
    await auth.api.signOut({
      headers: new Headers({ cookie: `codex-session=${sessionToken}` }),
    });
  }

  async verifyEmail(token: string): Promise<void> {
    await auth.api.verifyEmail({
      query: { token },
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    await auth.api.forgetPassword({
      body: { email },
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await auth.api.resetPassword({
      body: { token, password: newPassword },
    });
  }

  async getSession(headers: Headers) {
    return auth.api.getSession({ headers });
  }
}

export const authService = new AuthService();
```

6. **Create auth guards** (`packages/auth/src/guards.ts`):

```typescript
import { error, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Require authenticated user
 */
export function requireAuth(event: RequestEvent) {
  if (!event.locals.user) {
    throw redirect(303, `/login?redirect=${encodeURIComponent(event.url.pathname)}`);
  }
  return event.locals.user;
}

/**
 * Require platform owner role
 */
export function requirePlatformOwner(event: RequestEvent) {
  const user = requireAuth(event);
  if (user.role !== 'platform_owner') {
    throw error(403, 'Access denied: Platform owner required');
  }
  return user;
}

/**
 * Require verified email
 */
export function requireVerifiedEmail(event: RequestEvent) {
  const user = requireAuth(event);
  if (!user.emailVerified) {
    throw redirect(303, '/verify-email?prompt=true');
  }
  return user;
}

/**
 * Require guest (not authenticated)
 */
export function requireGuest(event: RequestEvent) {
  if (event.locals.user) {
    throw redirect(303, '/library');
  }
}
```

#### Dependencies

- P1-SETUP-001: Database schema with users, sessions, verification_tokens
- Environment variables: BETTER_AUTH_SECRET, AUTH_URL

#### Interface Contract: Auth Service

**Export**: `packages/auth/src/index.ts`

```typescript
export { authService, type IAuthService } from './service';
export { auth } from './config';
export * from './guards';
export type { User, Session } from './config';
```

**API Endpoints**: `/api/auth/*`

```typescript
// POST /api/auth/sign-up/email
{
  email: string;
  password: string;
  name: string;
}
// Returns: { user: User, session: Session }

// POST /api/auth/sign-in/email
{
  email: string;
  password: string;
}
// Returns: { user: User, session: Session }

// POST /api/auth/sign-out
// Returns: { success: boolean }

// GET /api/auth/verify-email?token=xyz
// Returns: { success: boolean }

// POST /api/auth/forget-password
{
  email: string;
}
// Returns: { success: boolean }

// POST /api/auth/reset-password
{
  token: string;
  password: string;
}
// Returns: { success: boolean }

// GET /api/auth/session
// Returns: { user: User, session: Session } | null
```

**Version**: v1.0.0

#### Test Specifications

**1. Auth Service Unit Tests** (`packages/auth/src/service.test.ts`)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authService } from './service';
import { db } from '@codex/database';
import { users } from '@codex/database/schema';

describe('AuthService', () => {
  beforeEach(async () => {
    // Clean up test users
    await db.delete(users).where(eq(users.email, 'test@example.com'));
  });

  it('should sign up a new user', async () => {
    const user = await authService.signUp(
      'test@example.com',
      'Password123!',
      'Test User'
    );

    expect(user.email).toBe('test@example.com');
    expect(user.name).toBe('Test User');
    expect(user.role).toBe('customer');
    expect(user.emailVerified).toBe(false);
  });

  it('should reject duplicate email', async () => {
    await authService.signUp('test@example.com', 'Password123!', 'Test User');

    await expect(
      authService.signUp('test@example.com', 'Password123!', 'Another User')
    ).rejects.toThrow();
  });

  it('should sign in with correct credentials', async () => {
    await authService.signUp('test@example.com', 'Password123!', 'Test User');

    const result = await authService.signIn('test@example.com', 'Password123!');

    expect(result.user.email).toBe('test@example.com');
    expect(result.session).toBeDefined();
    expect(result.session.expiresAt).toBeInstanceOf(Date);
  });

  it('should reject incorrect password', async () => {
    await authService.signUp('test@example.com', 'Password123!', 'Test User');

    await expect(
      authService.signIn('test@example.com', 'WrongPassword')
    ).rejects.toThrow();
  });

  it('should handle email verification', async () => {
    // Implementation depends on BetterAuth token generation
    // Mock or create verification token
  });
});
```

**2. Auth Guards Tests** (`packages/auth/src/guards.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { requireAuth, requirePlatformOwner } from './guards';

describe('Auth Guards', () => {
  it('requireAuth should allow authenticated user', () => {
    const event = {
      locals: { user: { id: '1', role: 'customer' } },
      url: new URL('http://localhost/protected'),
    } as any;

    const user = requireAuth(event);
    expect(user.id).toBe('1');
  });

  it('requireAuth should redirect unauthenticated user', () => {
    const event = {
      locals: { user: null },
      url: new URL('http://localhost/protected'),
    } as any;

    expect(() => requireAuth(event)).toThrow();
  });

  it('requirePlatformOwner should allow owner', () => {
    const event = {
      locals: { user: { id: '1', role: 'platform_owner' } },
      url: new URL('http://localhost/admin'),
    } as any;

    const user = requirePlatformOwner(event);
    expect(user.role).toBe('platform_owner');
  });

  it('requirePlatformOwner should deny customer', () => {
    const event = {
      locals: { user: { id: '1', role: 'customer' } },
      url: new URL('http://localhost/admin'),
    } as any;

    expect(() => requirePlatformOwner(event)).toThrow();
  });
});
```

**3. Integration Tests** (`packages/auth/src/integration.test.ts`)

```typescript
describe('Auth Integration', () => {
  it('should complete full authentication flow', async () => {
    // 1. Sign up
    const user = await authService.signUp(
      'flow@test.com',
      'Password123!',
      'Flow Test'
    );
    expect(user.emailVerified).toBe(false);

    // 2. Sign in
    const { session } = await authService.signIn('flow@test.com', 'Password123!');
    expect(session.token).toBeDefined();

    // 3. Verify session
    const headers = new Headers();
    headers.set('cookie', `codex-session=${session.token}`);
    const retrieved = await authService.getSession(headers);
    expect(retrieved?.user.id).toBe(user.id);

    // 4. Sign out
    await authService.signOut(session.token);

    // 5. Verify session invalidated
    const afterSignout = await authService.getSession(headers);
    expect(afterSignout).toBeNull();
  });
});
```

**CI Requirements**:
- All unit tests pass
- Integration tests pass on ephemeral database
- Auth endpoints return correct status codes
- Session cookies set with httpOnly, secure flags

#### Definition of Done

- [ ] BetterAuth configured with Drizzle adapter
- [ ] Auth service wrapper implemented
- [ ] Auth guards implemented (requireAuth, requirePlatformOwner, etc.)
- [ ] Auth API endpoints mounted at /api/auth/*
- [ ] Session middleware populates event.locals
- [ ] All unit tests passing (95%+ coverage)
- [ ] Integration tests passing (full auth flow)
- [ ] Password hashing working (bcrypt via BetterAuth)
- [ ] Email verification workflow functional (placeholder)
- [ ] Password reset workflow functional (placeholder)
- [ ] Session cookies secure (httpOnly, sameSite, secure in prod)
- [ ] CI passes all auth tests
- [ ] Documentation: Auth service API reference

#### Review Checklist

- [ ] BETTER_AUTH_SECRET is 32+ characters
- [ ] Passwords hashed with bcrypt (handled by BetterAuth)
- [ ] Session tokens cryptographically secure
- [ ] Email verification tokens expire after 24 hours
- [ ] Password reset tokens expire after 1 hour
- [ ] Session cookies have correct security flags
- [ ] No sensitive data in session cookie (only token)
- [ ] Guards throw redirects (not errors) for better UX
- [ ] All auth errors return generic messages (prevent enumeration)
- [ ] Rate limiting considered (implement in future packet)

---

*Continue with remaining work packets following the same detailed structure...*

Would you like me to continue with the complete roadmap? This will be a very large document (100+ pages) covering all Phase 1 features. I can:

1. Continue writing the full roadmap in this file
2. Create multiple files (one per phase/section)
3. Focus on specific features first

What would you prefer?
### Work Packet P1-CONTENT-001: Content Service & Media Library

**Branch**: `feature/P1-CONTENT-001-content-service`

**Owner**: Backend Engineer + Content Specialist

**Description**: Implement content management service with media library pattern, supporting video/audio uploads and metadata management.

#### Implementation Steps

1. **Create Content Service interface** (`packages/content/src/service.ts`):

```typescript
export interface IContentService {
  // Media Items (library)
  createMediaItem(data: CreateMediaItemInput, organizationId: string): Promise<MediaItem>;
  getMediaLibrary(organizationId: string, filters: MediaFilters): Promise<PaginatedMediaItems>;
  updateMediaItemStatus(id: string, status: MediaStatus): Promise<void>;
  deleteMediaItem(id: string, organizationId: string): Promise<void>;

  // Content (published items)
  createContent(data: CreateContentInput, organizationId: string): Promise<Content>;
  getContent(id: string, organizationId: string): Promise<Content | null>;
  listContent(organizationId: string, filters: ContentFilters): Promise<PaginatedContent>;
  updateContent(id: string, data: UpdateContentInput, organizationId: string): Promise<Content>;
  publishContent(id: string, organizationId: string): Promise<Content>;
  unpublishContent(id: string, organizationId: string): Promise<Content>;
  deleteContent(id: string, organizationId: string): Promise<void>;
}
```

2. **Implement organization-scoped queries** (see MULTI_TENANT_ARCHITECTURE.md):

```typescript
async listContent(organizationId: string, filters: ContentFilters) {
  return db.query.content.findMany({
    where: and(
      eq(content.organizationId, organizationId),
      isNull(content.deletedAt),
      filters.status ? eq(content.status, filters.status) : undefined
    ),
    with: {
      mediaItem: true,
      category: true,
      tags: { with: { tag: true } },
    },
    limit: filters.limit || 20,
    offset: filters.offset || 0,
    orderBy: (content, { desc }) => [desc(content.createdAt)],
  });
}
```

3. **Create presigned upload URL endpoint** (`apps/web/src/routes/api/media/upload-url/+server.ts`):

```typescript
export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireAuth({ locals });
  const { filename, contentType, organizationId } = await request.json();

  // Generate unique media item ID
  const mediaId = crypto.randomUUID();
  
  // Generate R2 key
  const r2Key = R2Keys.mediaOriginal(organizationId, mediaId, getFileExtension(filename));
  
  // Generate presigned URL (1 hour expiry)
  const uploadUrl = await r2Service.getUploadUrl(r2Key, 3600);
  
  return json({ 
    uploadUrl, 
    mediaId, 
    r2Key,
    expiresIn: 3600 
  });
};
```

4. **Create upload completion endpoint** (`apps/web/src/routes/api/media/complete-upload/+server.ts`):

```typescript
export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireAuth({ locals });
  const { mediaId, r2Key, filename, fileSize, mimeType, organizationId } = await request.json();

  // Verify file exists in R2
  const exists = await r2Service.objectExists(r2Key);
  if (!exists) {
    throw error(400, 'File upload not completed');
  }

  // Create media_items record
  const mediaItem = await contentService.createMediaItem({
    id: mediaId,
    organizationId,
    type: mimeType.startsWith('video/') ? 'video' : 'audio',
    r2Key,
    filename,
    fileSize,
    mimeType,
    status: 'uploaded',
  }, organizationId);

  // If video, enqueue transcoding job (P1-TRANSCODE-001)
  if (mediaItem.type === 'video') {
    await transcodingQueue.send({
      mediaItemId: mediaItem.id,
      r2Key: mediaItem.r2Key,
    });
  }

  return json({ mediaItem });
};
```

5. **Implement content CRUD operations** with full validation:
   - Title: 3-255 characters
   - Description: 10-5000 characters
   - Price: >= 0 (cents)
   - Category: must exist
   - Tags: max 10 tags
   - Slug: auto-generated from title, unique per organization

6. **Add soft delete support**:
   ```typescript
   async deleteContent(id: string, organizationId: string) {
     // Check for active purchases
     const purchases = await db.query.contentPurchases.findFirst({
       where: and(
         eq(contentPurchases.contentId, id),
         eq(contentPurchases.status, 'completed')
       ),
     });

     if (purchases) {
       throw new Error('Cannot delete content with completed purchases');
     }

     // Soft delete
     await db.update(content)
       .set({ deletedAt: new Date() })
       .where(and(
         eq(content.id, id),
         eq(content.organizationId, organizationId)
       ));
   }
   ```

#### Dependencies

- P1-SETUP-001: Database schema
- P1-SETUP-003: R2 bucket infrastructure
- P1-AUTH-001: Authentication guards

#### Interface Contract: Content Service API

**Endpoints**:

```typescript
// POST /api/media/upload-url
Request: { filename: string, contentType: string, organizationId: string }
Response: { uploadUrl: string, mediaId: string, r2Key: string, expiresIn: number }

// POST /api/media/complete-upload
Request: { mediaId: string, r2Key: string, filename: string, fileSize: number, mimeType: string, organizationId: string }
Response: { mediaItem: MediaItem }

// POST /api/content
Request: CreateContentInput
Response: { content: Content }

// GET /api/content/:id
Response: { content: Content }

// PUT /api/content/:id
Request: UpdateContentInput
Response: { content: Content }

// DELETE /api/content/:id
Response: { success: boolean }

// POST /api/content/:id/publish
Response: { content: Content }

// POST /api/content/:id/unpublish
Response: { content: Content }
```

**Version**: v1.0.0

#### Test Specifications

**1. Content Service Unit Tests**:

```typescript
describe('ContentService', () => {
  describe('createContent', () => {
    it('should create content with valid data', async () => {
      const content = await contentService.createContent({
        title: 'Test Video',
        description: 'A test video description',
        mediaItemId: 'media-123',
        categoryId: 'cat-456',
        price: 999,
        tags: ['beginner', 'tutorial'],
        organizationId: 'org-789',
      }, 'org-789');

      expect(content.title).toBe('Test Video');
      expect(content.status).toBe('draft');
      expect(content.slug).toBe('test-video');
    });

    it('should reject duplicate slug within organization', async () => {
      await contentService.createContent({...}, 'org-789');
      
      await expect(
        contentService.createContent({...}, 'org-789')
      ).rejects.toThrow('Slug already exists');
    });

    it('should allow same slug across organizations', async () => {
      await contentService.createContent({...}, 'org-789');
      const content2 = await contentService.createContent({...}, 'org-999');
      
      expect(content2).toBeDefined();
    });

    it('should validate media item exists and belongs to organization', async () => {
      await expect(
        contentService.createContent({
          mediaItemId: 'nonexistent',
          organizationId: 'org-789',
        }, 'org-789')
      ).rejects.toThrow('Media item not found');
    });
  });

  describe('publishContent', () => {
    it('should publish draft content', async () => {
      const content = await contentService.createContent({...}, 'org-789');
      const published = await contentService.publishContent(content.id, 'org-789');

      expect(published.status).toBe('published');
      expect(published.publishedAt).toBeInstanceOf(Date);
    });

    it('should reject publish if media not ready', async () => {
      // Create content with media in 'transcoding' status
      const content = await contentService.createContent({
        mediaItemId: 'transcoding-media',
        ...
      }, 'org-789');

      await expect(
        contentService.publishContent(content.id, 'org-789')
      ).rejects.toThrow('Media not ready');
    });
  });

  describe('deleteContent', () => {
    it('should soft delete content without purchases', async () => {
      const content = await contentService.createContent({...}, 'org-789');
      await contentService.deleteContent(content.id, 'org-789');

      const deleted = await db.query.content.findFirst({
        where: eq(content.id, content.id),
      });

      expect(deleted?.deletedAt).toBeInstanceOf(Date);
    });

    it('should prevent delete if content has purchases', async () => {
      const content = await contentService.createContent({...}, 'org-789');
      
      // Create purchase
      await db.insert(contentPurchases).values({
        contentId: content.id,
        customerId: 'user-123',
        status: 'completed',
        ...
      });

      await expect(
        contentService.deleteContent(content.id, 'org-789')
      ).rejects.toThrow('Cannot delete content with completed purchases');
    });
  });
});
```

**2. Upload Flow Integration Tests**:

```typescript
describe('Upload Flow Integration', () => {
  it('should complete full upload workflow', async () => {
    // 1. Request upload URL
    const { uploadUrl, mediaId, r2Key } = await fetch('/api/media/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        filename: 'test-video.mp4',
        contentType: 'video/mp4',
        organizationId: 'org-123',
      }),
    }).then(r => r.json());

    expect(uploadUrl).toContain('X-Amz-Signature');

    // 2. Upload file to R2 (simulated)
    const fileData = new Blob(['test video data'], { type: 'video/mp4' });
    await fetch(uploadUrl, {
      method: 'PUT',
      body: fileData,
    });

    // 3. Complete upload
    const { mediaItem } = await fetch('/api/media/complete-upload', {
      method: 'POST',
      body: JSON.stringify({
        mediaId,
        r2Key,
        filename: 'test-video.mp4',
        fileSize: fileData.size,
        mimeType: 'video/mp4',
        organizationId: 'org-123',
      }),
    }).then(r => r.json());

    expect(mediaItem.id).toBe(mediaId);
    expect(mediaItem.status).toBe('uploaded');

    // 4. Verify media item in database
    const dbMedia = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, mediaId),
    });

    expect(dbMedia).toBeDefined();
    expect(dbMedia?.r2Key).toBe(r2Key);
  });

  it('should reject upload completion if file missing in R2', async () => {
    const response = await fetch('/api/media/complete-upload', {
      method: 'POST',
      body: JSON.stringify({
        mediaId: 'fake-id',
        r2Key: 'nonexistent-key',
        ...
      }),
    });

    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(error).toContain('File upload not completed');
  });
});
```

**3. Organization Scoping Tests**:

```typescript
describe('Content Organization Scoping', () => {
  it('should only return content for specified organization', async () => {
    // Create content in org-1
    await contentService.createContent({...}, 'org-1');
    await contentService.createContent({...}, 'org-1');

    // Create content in org-2
    await contentService.createContent({...}, 'org-2');

    const org1Content = await contentService.listContent('org-1', {});
    expect(org1Content.total).toBe(2);

    const org2Content = await contentService.listContent('org-2', {});
    expect(org2Content.total).toBe(1);
  });

  it('should prevent cross-organization content access', async () => {
    const content = await contentService.createContent({...}, 'org-1');

    await expect(
      contentService.getContent(content.id, 'org-2')
    ).resolves.toBeNull();
  });
});
```

**CI Requirements**:
- All unit tests pass (95%+ coverage)
- Integration tests pass with ephemeral R2 bucket
- Organization scoping tests verify isolation
- Upload flow tests complete successfully
- Zero SQL injection vulnerabilities (parameterized queries)

#### Definition of Done

- [ ] Content service implemented with all CRUD operations
- [ ] Media library management (create, list, delete media items)
- [ ] Presigned URL generation for direct browser uploads
- [ ] Upload completion workflow with R2 verification
- [ ] Organization-scoped queries for all operations
- [ ] Soft delete implementation for content
- [ ] Purchase prevention on delete working
- [ ] All validation rules enforced (title, description, price, etc.)
- [ ] Slug auto-generation working (unique per org)
- [ ] Tag management (max 10 tags per content)
- [ ] Category validation
- [ ] All unit tests passing (95%+ coverage)
- [ ] Integration tests passing (upload workflow)
- [ ] API endpoints returning correct status codes
- [ ] Error messages user-friendly and informative
- [ ] CI passes all checks
- [ ] Documentation: API reference with examples

#### Review Checklist

- [ ] All database queries include organizationId filter
- [ ] Soft delete uses deletedAt timestamp (not hard delete)
- [ ] Purchase check before delete prevents data loss
- [ ] Presigned URLs expire after 1 hour
- [ ] Upload URL generation validates file type (video/audio only)
- [ ] Media item status transitions: uploaded → transcoding → ready
- [ ] Content status transitions: draft → published → archived
- [ ] Slug generation handles special characters correctly
- [ ] Duplicate slug error returns 409 Conflict
- [ ] All foreign key relationships validated before create
- [ ] No N+1 query problems (use with: { relations } in Drizzle)
- [ ] Pagination implemented correctly (limit, offset)
- [ ] File size limits enforced (5GB video, 500MB audio)

---

### Work Packet P1-ECOM-001: Stripe Checkout Integration

**Branch**: `feature/P1-ECOM-001-stripe-checkout`

**Owner**: Backend Engineer + Payment Specialist

**Description**: Implement Stripe Checkout for one-time content purchases with webhook-driven fulfillment.

#### Implementation Steps

1. **Install Stripe SDK**:
   ```bash
   pnpm add stripe @stripe/stripe-js
   ```

2. **Create Stripe client** (`packages/payments/src/stripe.ts`):

```typescript
import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
  typescript: true,
});

export type StripeCheckoutSession = Stripe.Checkout.Session;
export type StripeWebhookEvent = Stripe.Event;
```

3. **Create Purchase Service** (`packages/payments/src/service.ts`):

```typescript
export interface IPurchaseService {
  createCheckoutSession(
    customerId: string,
    contentId: string,
    organizationId: string
  ): Promise<{ checkoutUrl: string; sessionId: string }>;
  
  handleCheckoutComplete(session: StripeCheckoutSession): Promise<void>;
  handlePaymentFailed(session: StripeCheckoutSession): Promise<void>;
  
  getCustomerPurchases(customerId: string): Promise<ContentPurchase[]>;
  hasAccess(customerId: string, contentId: string): Promise<boolean>;
  
  initiateRefund(purchaseId: string, reason: string): Promise<void>;
}

export class PurchaseService implements IPurchaseService {
  async createCheckoutSession(
    customerId: string,
    contentId: string,
    organizationId: string
  ) {
    // 1. Get content details
    const content = await db.query.content.findFirst({
      where: and(
        eq(content.id, contentId),
        eq(content.organizationId, organizationId),
        eq(content.status, 'published')
      ),
    });

    if (!content) {
      throw new Error('Content not found or not available');
    }

    // 2. Check for existing purchase
    const existing = await db.query.contentPurchases.findFirst({
      where: and(
        eq(contentPurchases.customerId, customerId),
        eq(contentPurchases.contentId, contentId),
        inArray(contentPurchases.status, ['completed', 'pending'])
      ),
    });

    if (existing) {
      throw new Error('Content already purchased or pending');
    }

    // 3. Handle free content
    if (content.priceCents === 0) {
      await this.grantFreeAccess(customerId, contentId, organizationId);
      return { checkoutUrl: null, sessionId: null }; // No checkout needed
    }

    // 4. Create pending purchase record (idempotency)
    const [purchase] = await db.insert(contentPurchases).values({
      customerId,
      contentId,
      organizationId,
      pricePaidCents: content.priceCents,
      status: 'pending',
    }).returning();

    // 5. Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: (await db.query.users.findFirst({ where: eq(users.id, customerId) }))?.email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: content.title,
            description: content.description,
            images: content.thumbnailR2Key ? [await r2Service.getDownloadUrl(content.thumbnailR2Key)] : [],
          },
          unit_amount: content.priceCents,
        },
        quantity: 1,
      }],
      success_url: `${process.env.APP_URL}/content/${contentId}?purchase=success`,
      cancel_url: `${process.env.APP_URL}/content/${contentId}?purchase=cancel`,
      metadata: {
        purchaseId: purchase.id,
        customerId,
        contentId,
        organizationId,
      },
    });

    // 6. Update purchase with session ID
    await db.update(contentPurchases)
      .set({ stripeCheckoutSessionId: session.id })
      .where(eq(contentPurchases.id, purchase.id));

    return {
      checkoutUrl: session.url!,
      sessionId: session.id,
    };
  }

  async handleCheckoutComplete(session: StripeCheckoutSession) {
    const { purchaseId, customerId, contentId } = session.metadata!;

    // Idempotent: check if already processed
    const purchase = await db.query.contentPurchases.findFirst({
      where: eq(contentPurchases.id, purchaseId),
    });

    if (purchase?.status === 'completed') {
      console.log(`Purchase ${purchaseId} already completed`);
      return;
    }

    // Update purchase to completed
    await db.update(contentPurchases)
      .set({
        status: 'completed',
        stripePaymentIntentId: session.payment_intent as string,
        purchasedAt: new Date(),
      })
      .where(eq(contentPurchases.id, purchaseId));

    // Send purchase confirmation email
    await notificationService.sendEmail({
      template: 'purchase-receipt',
      recipient: (await db.query.users.findFirst({ where: eq(users.id, customerId) }))!.email,
      data: {
        customerName: (await db.query.users.findFirst({ where: eq(users.id, customerId) }))!.name,
        contentTitle: (await db.query.content.findFirst({ where: eq(content.id, contentId) }))!.title,
        amount: session.amount_total! / 100,
        purchaseDate: new Date().toLocaleDateString(),
      },
    });
  }

  async hasAccess(customerId: string, contentId: string): Promise<boolean> {
    const purchase = await db.query.contentPurchases.findFirst({
      where: and(
        eq(contentPurchases.customerId, customerId),
        eq(contentPurchases.contentId, contentId),
        eq(contentPurchases.status, 'completed'),
        isNull(contentPurchases.refundedAt)
      ),
    });

    return !!purchase;
  }

  private async grantFreeAccess(customerId: string, contentId: string, organizationId: string) {
    await db.insert(contentPurchases).values({
      customerId,
      contentId,
      organizationId,
      pricePaidCents: 0,
      status: 'completed',
      purchasedAt: new Date(),
    }).onConflictDoNothing(); // Handle duplicate requests
  }
}

export const purchaseService = new PurchaseService();
```

4. **Create checkout API endpoint** (`apps/web/src/routes/api/checkout/+server.ts`):

```typescript
export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireAuth({ locals });
  const { contentId, organizationId } = await request.json();

  const { checkoutUrl, sessionId } = await purchaseService.createCheckoutSession(
    user.id,
    contentId,
    organizationId
  );

  return json({ checkoutUrl, sessionId });
};
```

5. **Create Stripe webhook handler** (`workers/stripe-webhook-handler/src/index.ts`):

```typescript
import Stripe from 'stripe';
import { purchaseService } from '@codex/payments';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      return new Response('Missing signature', { status: 400 });
    }

    try {
      // Verify webhook signature
      const body = await request.text();
      const event = stripe.webhooks.constructEvent(
        body,
        signature,
        env.STRIPE_WEBHOOK_SECRET_PAYMENT
      );

      // Handle events
      switch (event.type) {
        case 'checkout.session.completed':
          await purchaseService.handleCheckoutComplete(event.data.object as Stripe.Checkout.Session);
          break;

        case 'checkout.session.expired':
          // Mark purchase as failed
          break;

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('Webhook error:', err);
      return new Response(`Webhook error: ${err.message}`, { status: 400 });
    }
  },
};
```

6. **Add duplicate purchase prevention index** (migration):

```sql
-- Prevent duplicate purchases (race condition protection)
CREATE UNIQUE INDEX idx_content_purchases_no_duplicates
  ON content_purchases(customer_id, content_id)
  WHERE status IN ('completed', 'pending');
```

#### Dependencies

- P1-SETUP-001: Database schema (content_purchases table)
- P1-AUTH-001: Authentication guards
- P1-CONTENT-001: Content service
- P1-NOTIFY-001: Notification service
- Stripe account with webhook endpoint configured

#### Interface Contract: Purchase API

**Endpoints**:

```typescript
// POST /api/checkout
Request: { contentId: string, organizationId: string }
Response: { checkoutUrl: string, sessionId: string } | { checkoutUrl: null } // null for free content

// POST /webhooks/stripe/payment (Stripe webhook)
Headers: { 'stripe-signature': string }
Body: Stripe webhook event JSON
Response: { received: true }

// GET /api/purchases
Response: { purchases: ContentPurchase[] }

// GET /api/purchases/access/:contentId
Response: { hasAccess: boolean }
```

**Version**: v1.0.0

**Breaking Changes**: N/A (initial version)

#### Test Specifications

**1. Purchase Service Unit Tests**:

```typescript
describe('PurchaseService', () => {
  describe('createCheckoutSession', () => {
    it('should create Stripe checkout session for paid content', async () => {
      const { checkoutUrl, sessionId } = await purchaseService.createCheckoutSession(
        'user-123',
        'content-456',
        'org-789'
      );

      expect(checkoutUrl).toContain('checkout.stripe.com');
      expect(sessionId).toMatch(/^cs_/);

      // Verify pending purchase created
      const purchase = await db.query.contentPurchases.findFirst({
        where: and(
          eq(contentPurchases.customerId, 'user-123'),
          eq(contentPurchases.contentId, 'content-456')
        ),
      });

      expect(purchase?.status).toBe('pending');
      expect(purchase?.stripeCheckoutSessionId).toBe(sessionId);
    });

    it('should grant free access without Stripe for free content', async () => {
      // Create free content (price = 0)
      const content = await contentService.createContent({
        priceCents: 0,
        ...
      }, 'org-789');

      const result = await purchaseService.createCheckoutSession(
        'user-123',
        content.id,
        'org-789'
      );

      expect(result.checkoutUrl).toBeNull();

      // Verify purchase created with status=completed
      const purchase = await db.query.contentPurchases.findFirst({
        where: and(
          eq(contentPurchases.customerId, 'user-123'),
          eq(contentPurchases.contentId, content.id)
        ),
      });

      expect(purchase?.status).toBe('completed');
      expect(purchase?.pricePaidCents).toBe(0);
    });

    it('should prevent duplicate purchase', async () => {
      await purchaseService.createCheckoutSession('user-123', 'content-456', 'org-789');

      await expect(
        purchaseService.createCheckoutSession('user-123', 'content-456', 'org-789')
      ).rejects.toThrow('Content already purchased or pending');
    });

    it('should reject unpublished content', async () => {
      const draftContent = await contentService.createContent({
        status: 'draft',
        ...
      }, 'org-789');

      await expect(
        purchaseService.createCheckoutSession('user-123', draftContent.id, 'org-789')
      ).rejects.toThrow('Content not found or not available');
    });
  });

  describe('handleCheckoutComplete', () => {
    it('should update purchase to completed', async () => {
      // Create pending purchase
      const { sessionId } = await purchaseService.createCheckoutSession(...);

      // Simulate Stripe webhook
      const mockSession = {
        id: sessionId,
        payment_intent: 'pi_123',
        metadata: {
          purchaseId: 'purchase-123',
          customerId: 'user-123',
          contentId: 'content-456',
        },
        amount_total: 999,
      } as Stripe.Checkout.Session;

      await purchaseService.handleCheckoutComplete(mockSession);

      // Verify purchase completed
      const purchase = await db.query.contentPurchases.findFirst({
        where: eq(contentPurchases.id, 'purchase-123'),
      });

      expect(purchase?.status).toBe('completed');
      expect(purchase?.stripePaymentIntentId).toBe('pi_123');
      expect(purchase?.purchasedAt).toBeInstanceOf(Date);
    });

    it('should be idempotent (handle duplicate webhooks)', async () => {
      const mockSession = {...} as Stripe.Checkout.Session;

      // Process first time
      await purchaseService.handleCheckoutComplete(mockSession);

      // Process second time (duplicate webhook)
      await expect(
        purchaseService.handleCheckoutComplete(mockSession)
      ).resolves.not.toThrow();

      // Verify only one purchase exists
      const purchases = await db.query.contentPurchases.findMany({
        where: eq(contentPurchases.id, mockSession.metadata.purchaseId),
      });

      expect(purchases.length).toBe(1);
    });

    it('should send purchase confirmation email', async () => {
      const sendEmailSpy = vi.spyOn(notificationService, 'sendEmail');
      const mockSession = {...} as Stripe.Checkout.Session;

      await purchaseService.handleCheckoutComplete(mockSession);

      expect(sendEmailSpy).toHaveBeenCalledWith({
        template: 'purchase-receipt',
        recipient: expect.any(String),
        data: expect.objectContaining({
          customerName: expect.any(String),
          contentTitle: expect.any(String),
          amount: expect.any(Number),
        }),
      });
    });
  });

  describe('hasAccess', () => {
    it('should return true for completed purchase', async () => {
      await db.insert(contentPurchases).values({
        customerId: 'user-123',
        contentId: 'content-456',
        status: 'completed',
        refundedAt: null,
        ...
      });

      const hasAccess = await purchaseService.hasAccess('user-123', 'content-456');
      expect(hasAccess).toBe(true);
    });

    it('should return false for pending purchase', async () => {
      await db.insert(contentPurchases).values({
        customerId: 'user-123',
        contentId: 'content-456',
        status: 'pending',
        ...
      });

      const hasAccess = await purchaseService.hasAccess('user-123', 'content-456');
      expect(hasAccess).toBe(false);
    });

    it('should return false for refunded purchase', async () => {
      await db.insert(contentPurchases).values({
        customerId: 'user-123',
        contentId: 'content-456',
        status: 'completed',
        refundedAt: new Date(),
        ...
      });

      const hasAccess = await purchaseService.hasAccess('user-123', 'content-456');
      expect(hasAccess).toBe(false);
    });
  });
});
```

**2. Webhook Integration Tests**:

```typescript
describe('Stripe Webhook Integration', () => {
  it('should process checkout.session.completed event', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          payment_intent: 'pi_123',
          metadata: {
            purchaseId: 'purchase-123',
            customerId: 'user-123',
            contentId: 'content-456',
          },
          amount_total: 999,
        },
      },
    };

    const signature = stripe.webhooks.generateTestHeaderString({
      payload: JSON.stringify(event),
      secret: process.env.STRIPE_WEBHOOK_SECRET_PAYMENT!,
    });

    const response = await fetch('http://localhost:8787/webhooks/stripe/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature,
      },
      body: JSON.stringify(event),
    });

    expect(response.status).toBe(200);
    const { received } = await response.json();
    expect(received).toBe(true);

    // Verify purchase updated
    const purchase = await db.query.contentPurchases.findFirst({
      where: eq(contentPurchases.id, 'purchase-123'),
    });

    expect(purchase?.status).toBe('completed');
  });

  it('should reject invalid signature', async () => {
    const response = await fetch('http://localhost:8787/webhooks/stripe/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'invalid-signature',
      },
      body: JSON.stringify({ type: 'checkout.session.completed' }),
    });

    expect(response.status).toBe(400);
  });
});
```

**3. Race Condition Tests**:

```typescript
describe('Purchase Race Conditions', () => {
  it('should prevent duplicate purchases from concurrent requests', async () => {
    // Simulate two simultaneous purchase requests
    const results = await Promise.allSettled([
      purchaseService.createCheckoutSession('user-123', 'content-456', 'org-789'),
      purchaseService.createCheckoutSession('user-123', 'content-456', 'org-789'),
    ]);

    // One should succeed, one should fail
    const succeeded = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0].reason.message).toContain('already purchased');

    // Verify only one purchase record created
    const purchases = await db.query.contentPurchases.findMany({
      where: and(
        eq(contentPurchases.customerId, 'user-123'),
        eq(contentPurchases.contentId, 'content-456')
      ),
    });

    expect(purchases.length).toBe(1);
  });
});
```

**CI Requirements**:
- All unit tests pass (95%+ coverage)
- Webhook tests pass with test mode Stripe keys
- Race condition tests prevent duplicates
- Signature verification tests ensure security
- Integration tests use Stripe test mode only

#### Definition of Done

- [ ] Stripe SDK integrated
- [ ] Purchase service implemented with all methods
- [ ] Checkout session creation working
- [ ] Webhook handler deployed and verified
- [ ] Webhook signature verification working
- [ ] Duplicate purchase prevention (unique index + idempotency)
- [ ] Free content handling (no Stripe, instant access)
- [ ] Purchase completion updates database correctly
- [ ] Access check (hasAccess) working
- [ ] Email notifications sent after purchase
- [ ] All unit tests passing (95%+ coverage)
- [ ] Webhook integration tests passing
- [ ] Race condition tests passing
- [ ] Stripe test mode configured in development
- [ ] Stripe webhook endpoint configured in Stripe dashboard
- [ ] CI passes all checks
- [ ] Documentation: API reference, webhook setup guide

#### Review Checklist

- [ ] Stripe API keys stored as secrets (not in code)
- [ ] Webhook signature verified before processing
- [ ] Purchase records created before Stripe checkout (audit trail)
- [ ] Idempotency handled for webhooks (check existing status)
- [ ] Error messages don't expose internal details
- [ ] Amount stored in cents (not dollars) - prevents floating point issues
- [ ] Customer email passed to Stripe (auto-fill checkout)
- [ ] Success/cancel URLs redirect to appropriate pages
- [ ] Metadata includes all IDs needed for fulfillment
- [ ] Free content grants immediate access (no Stripe call)
- [ ] Refunded purchases revoke access
- [ ] Unpublished content cannot be purchased
- [ ] Purchase history queryable by customer
- [ ] No PCI compliance issues (no card data touches our servers)

---


### Work Packet P1-NOTIFY-001: Email Notification Service

**Branch**: `feature/P1-NOTIFY-001-email-notifications`

**Owner**: Backend Engineer

**Description**: Implement provider-agnostic email notification service with Resend adapter and template system.

#### Implementation Steps

1. **Install dependencies**:
   ```bash
   pnpm add resend
   ```

2. **Create notification service interface** (`packages/notifications/src/service.ts`):

```typescript
export interface EmailPayload {
  template: string;
  recipient: string;
  data: Record<string, any>;
  replyTo?: string;
}

export interface EmailResult {
  success: boolean;
  emailId?: string;
  error?: string;
}

export interface INotificationService {
  sendEmail(payload: EmailPayload): Promise<EmailResult>;
}
```

3. **Create template engine** (`packages/notifications/src/templates.ts`):

```typescript
interface EmailTemplate {
  subject: string;
  htmlTemplate: string;
  textTemplate: string;
}

const templates: Record<string, EmailTemplate> = {
  'email-verification': {
    subject: 'Verify your email address',
    htmlTemplate: `
      <h1>Welcome {{userName}}!</h1>
      <p>Please verify your email address by clicking the link below:</p>
      <a href="{{verificationUrl}}">Verify Email</a>
    `,
    textTemplate: `
      Welcome {{userName}}!
      Please verify your email: {{verificationUrl}}
    `,
  },
  'password-reset': {
    subject: 'Reset your password',
    htmlTemplate: `
      <h1>Password Reset Request</h1>
      <p>Hi {{userName}}, click below to reset your password:</p>
      <a href="{{resetUrl}}">Reset Password</a>
      <p>This link expires in 1 hour.</p>
    `,
    textTemplate: `
      Password Reset Request
      Hi {{userName}}, reset your password: {{resetUrl}}
      Link expires in 1 hour.
    `,
  },
  'purchase-receipt': {
    subject: 'Your purchase receipt',
    htmlTemplate: `
      <h1>Thank you for your purchase!</h1>
      <p>Hi {{customerName}},</p>
      <p>You've successfully purchased: <strong>{{contentTitle}}</strong></p>
      <p>Amount: ${{amount}}</p>
      <p>Purchase Date: {{purchaseDate}}</p>
      <a href="{{accessUrl}}">Access Your Content</a>
    `,
    textTemplate: `
      Thank you for your purchase!
      Content: {{contentTitle}}
      Amount: ${{amount}}
      Access: {{accessUrl}}
    `,
  },
};

export function renderTemplate(templateKey: string, data: Record<string, any>): { subject: string; html: string; text: string } {
  const template = templates[templateKey];
  if (!template) {
    throw new Error(`Template not found: ${templateKey}`);
  }

  // Simple variable interpolation
  const interpolate = (str: string) => {
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] || ''));
  };

  return {
    subject: interpolate(template.subject),
    html: interpolate(template.htmlTemplate),
    text: interpolate(template.textTemplate),
  };
}
```

4. **Create Resend adapter** (`packages/notifications/src/adapters/resend.ts`):

```typescript
import { Resend } from 'resend';

export interface IEmailAdapter {
  send(payload: {
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
  }): Promise<{ emailId: string }>;
}

export class ResendAdapter implements IEmailAdapter {
  private client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(payload: { to: string; subject: string; html: string; text: string; replyTo?: string }) {
    const result = await this.client.emails.send({
      from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM_ADDRESS}>`,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      reply_to: payload.replyTo,
    });

    if (result.error) {
      throw new Error(`Email send failed: ${result.error.message}`);
    }

    return { emailId: result.data!.id };
  }
}
```

5. **Implement notification service** (`packages/notifications/src/service.ts` - full):

```typescript
import { renderTemplate } from './templates';
import { ResendAdapter } from './adapters/resend';

export class NotificationService implements INotificationService {
  private adapter: IEmailAdapter;

  constructor(adapter: IEmailAdapter) {
    this.adapter = adapter;
  }

  async sendEmail(payload: EmailPayload): Promise<EmailResult> {
    try {
      // Render template
      const { subject, html, text } = renderTemplate(payload.template, payload.data);

      // Send with retry (one attempt)
      let emailId: string;
      try {
        const result = await this.adapter.send({
          to: payload.recipient,
          subject,
          html,
          text,
          replyTo: payload.replyTo,
        });
        emailId = result.emailId;
      } catch (firstError) {
        console.warn('Email send failed, retrying...', firstError);
        // Retry once
        const result = await this.adapter.send({
          to: payload.recipient,
          subject,
          html,
          text,
          replyTo: payload.replyTo,
        });
        emailId = result.emailId;
      }

      return {
        success: true,
        emailId,
      };
    } catch (error) {
      console.error('Email send failed after retry:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

// Export singleton with Resend adapter
export const notificationService = new NotificationService(
  new ResendAdapter(process.env.RESEND_API_KEY!)
);
```

#### Dependencies

- Environment variables: RESEND_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME

#### Interface Contract

**Export**: `packages/notifications/src/index.ts`

```typescript
export { notificationService, type INotificationService } from './service';
export type { EmailPayload, EmailResult } from './service';
```

**Templates Available**:
- `email-verification` - requires: { userName, verificationUrl }
- `password-reset` - requires: { userName, resetUrl }
- `purchase-receipt` - requires: { customerName, contentTitle, amount, purchaseDate, accessUrl }

**Version**: v1.0.0

#### Test Specifications

**1. Template Rendering Tests**:

```typescript
describe('Email Templates', () => {
  it('should render email-verification template', () => {
    const { subject, html, text } = renderTemplate('email-verification', {
      userName: 'John Doe',
      verificationUrl: 'https://example.com/verify?token=abc123',
    });

    expect(subject).toBe('Verify your email address');
    expect(html).toContain('Welcome John Doe!');
    expect(html).toContain('https://example.com/verify?token=abc123');
    expect(text).toContain('John Doe');
  });

  it('should throw for unknown template', () => {
    expect(() => renderTemplate('nonexistent', {})).toThrow('Template not found');
  });

  it('should handle missing data gracefully', () => {
    const { html } = renderTemplate('email-verification', {});
    expect(html).not.toContain('undefined');
  });
});
```

**2. Notification Service Tests**:

```typescript
describe('NotificationService', () => {
  it('should send email successfully', async () => {
    const mockAdapter = {
      send: vi.fn().mockResolvedValue({ emailId: 'email-123' }),
    };
    const service = new NotificationService(mockAdapter);

    const result = await service.sendEmail({
      template: 'email-verification',
      recipient: 'test@example.com',
      data: { userName: 'Test', verificationUrl: 'https://test.com' },
    });

    expect(result.success).toBe(true);
    expect(result.emailId).toBe('email-123');
    expect(mockAdapter.send).toHaveBeenCalledWith({
      to: 'test@example.com',
      subject: expect.any(String),
      html: expect.stringContaining('Test'),
      text: expect.any(String),
    });
  });

  it('should retry on failure once', async () => {
    const mockAdapter = {
      send: vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ emailId: 'email-123' }),
    };
    const service = new NotificationService(mockAdapter);

    const result = await service.sendEmail({
      template: 'email-verification',
      recipient: 'test@example.com',
      data: { userName: 'Test', verificationUrl: 'https://test.com' },
    });

    expect(result.success).toBe(true);
    expect(mockAdapter.send).toHaveBeenCalledTimes(2);
  });

  it('should return error after retry fails', async () => {
    const mockAdapter = {
      send: vi.fn().mockRejectedValue(new Error('Network error')),
    };
    const service = new NotificationService(mockAdapter);

    const result = await service.sendEmail({
      template: 'email-verification',
      recipient: 'test@example.com',
      data: { userName: 'Test', verificationUrl: 'https://test.com' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
    expect(mockAdapter.send).toHaveBeenCalledTimes(2); // Initial + 1 retry
  });
});
```

**3. Resend Integration Tests** (with test API key):

```typescript
describe('Resend Adapter Integration', () => {
  it('should send real email via Resend', async () => {
    const adapter = new ResendAdapter(process.env.RESEND_TEST_API_KEY!);

    const { emailId } = await adapter.send({
      to: 'test@example.com',
      subject: 'Test Email',
      html: '<p>Test HTML</p>',
      text: 'Test text',
    });

    expect(emailId).toBeDefined();
    expect(emailId).toMatch(/^[a-f0-9-]+$/); // UUID format
  });
});
```

**CI Requirements**:
- Template rendering tests pass
- Notification service unit tests pass with mocks
- Retry logic verified
- Integration tests pass with Resend test API key
- No emails sent to real addresses in CI

#### Definition of Done

- [ ] Notification service interface defined
- [ ] Template engine implemented with interpolation
- [ ] Three email templates created (verification, password reset, purchase receipt)
- [ ] Resend adapter implemented
- [ ] Retry logic (one retry on failure) working
- [ ] All unit tests passing (100% coverage on core logic)
- [ ] Integration tests passing with Resend test key
- [ ] Error handling for missing templates
- [ ] Error handling for send failures
- [ ] Logging implemented (success and failure cases)
- [ ] CI passes all checks
- [ ] Documentation: Template variables reference

#### Review Checklist

- [ ] API keys stored as environment variables (not hardcoded)
- [ ] FROM address configured correctly
- [ ] Templates use proper HTML escaping (prevent XSS)
- [ ] Text fallback provided for all templates
- [ ] Retry logic doesn't infinite loop
- [ ] Error messages don't expose sensitive info
- [ ] Email logging masks recipient (GDPR)
- [ ] Templates handle missing variables gracefully
- [ ] Success/failure clearly indicated in return value
- [ ] Adapter is swappable (interface-based design)

---

## 4. Feature Packets

### Work Packet P1-ACCESS-001: Content Access & Playback

**Branch**: `feature/P1-ACCESS-001-content-access`

**Owner**: Backend Engineer + Media Specialist

**Description**: Implement secure content access with signed URLs, playback progress tracking, and streaming support.

#### Implementation Steps

1. **Create Content Access Service** (`packages/content-access/src/service.ts`):

```typescript
export interface IContentAccessService {
  checkAccess(userId: string, contentId: string): Promise<boolean>;
  getStreamingUrl(userId: string, mediaItemId: string): Promise<string>;
  savePlaybackProgress(userId: string, mediaItemId: string, position: number, duration: number): Promise<void>;
  getPlaybackProgress(userId: string, mediaItemId: string): Promise<number>;
  getUserLibrary(userId: string): Promise<LibraryContent[]>;
}

export class ContentAccessService implements IContentAccessService {
  async checkAccess(userId: string, contentId: string): Promise<boolean> {
    // Check purchase table
    const purchase = await db.query.contentPurchases.findFirst({
      where: and(
        eq(contentPurchases.customerId, userId),
        eq(contentPurchases.contentId, contentId),
        eq(contentPurchases.status, 'completed'),
        isNull(contentPurchases.refundedAt)
      ),
    });

    return !!purchase;
  }

  async getStreamingUrl(userId: string, mediaItemId: string): Promise<string> {
    // 1. Get media item
    const mediaItem = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, mediaItemId),
    });

    if (!mediaItem) {
      throw new Error('Media not found');
    }

    // 2. Get content that uses this media
    const content = await db.query.content.findFirst({
      where: eq(content.mediaItemId, mediaItemId),
    });

    if (!content) {
      throw new Error('Content not found');
    }

    // 3. Check access
    const hasAccess = await this.checkAccess(userId, content.id);
    if (!hasAccess) {
      throw new Error('Access denied');
    }

    // 4. Generate signed URL (1 hour expiry)
    const streamUrl = await r2Service.getDownloadUrl(mediaItem.r2Key, 3600);

    return streamUrl;
  }

  async savePlaybackProgress(userId: string, mediaItemId: string, position: number, duration: number) {
    const completed = position / duration > 0.95;

    await db.insert(videoPlayback)
      .values({
        userId,
        mediaItemId,
        positionSeconds: Math.floor(position),
        durationSeconds: Math.floor(duration),
        completed,
        lastWatchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [videoPlayback.userId, videoPlayback.mediaItemId],
        set: {
          positionSeconds: Math.floor(position),
          completed,
          lastWatchedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }

  async getPlaybackProgress(userId: string, mediaItemId: string): Promise<number> {
    const progress = await db.query.videoPlayback.findFirst({
      where: and(
        eq(videoPlayback.userId, userId),
        eq(videoPlayback.mediaItemId, mediaItemId)
      ),
    });

    return progress?.positionSeconds || 0;
  }

  async getUserLibrary(userId: string): Promise<LibraryContent[]> {
    const purchases = await db.query.contentPurchases.findMany({
      where: and(
        eq(contentPurchases.customerId, userId),
        eq(contentPurchases.status, 'completed'),
        isNull(contentPurchases.refundedAt)
      ),
      with: {
        content: {
          with: {
            mediaItem: true,
            category: true,
          },
        },
      },
      orderBy: (purchases, { desc }) => [desc(purchases.purchasedAt)],
    });

    return purchases.map(p => ({
      ...p.content,
      purchasedAt: p.purchasedAt,
    }));
  }
}

export const contentAccessService = new ContentAccessService();
```

2. **Create streaming URL endpoint** (`apps/web/src/routes/api/media/[id]/stream/+server.ts`):

```typescript
export const GET: RequestHandler = async ({ params, locals }) => {
  const user = requireAuth({ locals });
  const mediaItemId = params.id;

  const streamUrl = await contentAccessService.getStreamingUrl(user.id, mediaItemId);

  return json({ 
    url: streamUrl, 
    expiresIn: 3600 
  });
};
```

3. **Create playback progress endpoint** (`apps/web/src/routes/api/playback/progress/+server.ts`):

```typescript
// POST /api/playback/progress
export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireAuth({ locals });
  const { mediaItemId, position, duration } = await request.json();

  await contentAccessService.savePlaybackProgress(
    user.id,
    mediaItemId,
    position,
    duration
  );

  return json({ success: true });
};

// GET /api/playback/progress/:mediaItemId
export const GET: RequestHandler = async ({ params, locals }) => {
  const user = requireAuth({ locals });
  const mediaItemId = params.id;

  const position = await contentAccessService.getPlaybackProgress(user.id, mediaItemId);

  return json({ position });
};
```

4. **Create library page** (`apps/web/src/routes/library/+page.server.ts`):

```typescript
export const load: PageServerLoad = async ({ locals }) => {
  const user = requireAuth({ locals });

  const library = await contentAccessService.getUserLibrary(user.id);

  return { library };
};
```

5. **Create content player page** (`apps/web/src/routes/content/[id]/+page.server.ts`):

```typescript
export const load: PageServerLoad = async ({ params, locals }) => {
  const user = requireAuth({ locals });
  const contentId = params.id;

  // Check access
  const hasAccess = await contentAccessService.checkAccess(user.id, contentId);
  if (!hasAccess) {
    throw redirect(303, `/content/${contentId}/purchase`);
  }

  // Load content details
  const content = await db.query.content.findFirst({
    where: eq(content.id, contentId),
    with: {
      mediaItem: true,
    },
  });

  if (!content) {
    throw error(404, 'Content not found');
  }

  // Get playback progress
  const progress = await contentAccessService.getPlaybackProgress(
    user.id,
    content.mediaItem.id
  );

  return {
    content,
    initialPosition: progress,
  };
};
```

#### Dependencies

- P1-SETUP-001: Database schema (video_playback table)
- P1-SETUP-003: R2 service (signed URLs)
- P1-CONTENT-001: Content service
- P1-ECOM-001: Purchase service (access check)

#### Interface Contract: Content Access API

**Endpoints**:

```typescript
// GET /api/media/:id/stream
Response: { url: string, expiresIn: number }

// POST /api/playback/progress
Request: { mediaItemId: string, position: number, duration: number }
Response: { success: boolean }

// GET /api/playback/progress/:mediaItemId
Response: { position: number }

// GET /library (page)
Returns: LibraryContent[]
```

**Version**: v1.0.0

#### Test Specifications

**1. Access Control Tests**:

```typescript
describe('ContentAccessService', () => {
  describe('checkAccess', () => {
    it('should grant access for completed purchase', async () => {
      await db.insert(contentPurchases).values({
        customerId: 'user-123',
        contentId: 'content-456',
        status: 'completed',
        ...
      });

      const hasAccess = await contentAccessService.checkAccess('user-123', 'content-456');
      expect(hasAccess).toBe(true);
    });

    it('should deny access without purchase', async () => {
      const hasAccess = await contentAccessService.checkAccess('user-123', 'content-999');
      expect(hasAccess).toBe(false);
    });

    it('should deny access for refunded purchase', async () => {
      await db.insert(contentPurchases).values({
        customerId: 'user-123',
        contentId: 'content-456',
        status: 'completed',
        refundedAt: new Date(),
        ...
      });

      const hasAccess = await contentAccessService.checkAccess('user-123', 'content-456');
      expect(hasAccess).toBe(false);
    });
  });

  describe('getStreamingUrl', () => {
    it('should return signed URL for authorized user', async () => {
      // Setup: content + purchase
      const mediaItem = await createMediaItem();
      const content = await createContent({ mediaItemId: mediaItem.id });
      await createPurchase({ customerId: 'user-123', contentId: content.id });

      const url = await contentAccessService.getStreamingUrl('user-123', mediaItem.id);

      expect(url).toContain('X-Amz-Signature');
      expect(url).toContain(mediaItem.r2Key);
    });

    it('should throw for unauthorized user', async () => {
      const mediaItem = await createMediaItem();
      const content = await createContent({ mediaItemId: mediaItem.id });
      // No purchase created

      await expect(
        contentAccessService.getStreamingUrl('user-123', mediaItem.id)
      ).rejects.toThrow('Access denied');
    });
  });

  describe('playback progress', () => {
    it('should save and retrieve progress', async () => {
      await contentAccessService.savePlaybackProgress('user-123', 'media-456', 120, 300);

      const progress = await contentAccessService.getPlaybackProgress('user-123', 'media-456');

      expect(progress).toBe(120);
    });

    it('should update existing progress', async () => {
      await contentAccessService.savePlaybackProgress('user-123', 'media-456', 120, 300);
      await contentAccessService.savePlaybackProgress('user-123', 'media-456', 180, 300);

      const progress = await contentAccessService.getPlaybackProgress('user-123', 'media-456');

      expect(progress).toBe(180);
    });

    it('should mark as completed when >95% watched', async () => {
      await contentAccessService.savePlaybackProgress('user-123', 'media-456', 290, 300);

      const record = await db.query.videoPlayback.findFirst({
        where: and(
          eq(videoPlayback.userId, 'user-123'),
          eq(videoPlayback.mediaItemId, 'media-456')
        ),
      });

      expect(record?.completed).toBe(true);
    });
  });
});
```

**2. Library Tests**:

```typescript
describe('User Library', () => {
  it('should return all purchased content', async () => {
    const user = await createUser();
    const content1 = await createContent();
    const content2 = await createContent();

    await createPurchase({ customerId: user.id, contentId: content1.id });
    await createPurchase({ customerId: user.id, contentId: content2.id });

    const library = await contentAccessService.getUserLibrary(user.id);

    expect(library.length).toBe(2);
    expect(library.map(c => c.id)).toContain(content1.id);
    expect(library.map(c => c.id)).toContain(content2.id);
  });

  it('should exclude refunded purchases', async () => {
    const user = await createUser();
    const content = await createContent();

    await createPurchase({
      customerId: user.id,
      contentId: content.id,
      refundedAt: new Date(),
    });

    const library = await contentAccessService.getUserLibrary(user.id);

    expect(library.length).toBe(0);
  });

  it('should order by purchase date (newest first)', async () => {
    const user = await createUser();
    const content1 = await createContent({ title: 'Old' });
    const content2 = await createContent({ title: 'New' });

    await createPurchase({ 
      customerId: user.id, 
      contentId: content1.id,
      purchasedAt: new Date('2024-01-01'),
    });
    await createPurchase({ 
      customerId: user.id, 
      contentId: content2.id,
      purchasedAt: new Date('2024-01-02'),
    });

    const library = await contentAccessService.getUserLibrary(user.id);

    expect(library[0].title).toBe('New');
    expect(library[1].title).toBe('Old');
  });
});
```

**CI Requirements**:
- All access control tests pass
- Signed URLs generated correctly
- Playback progress CRUD operations work
- Library filtering works (no refunded, correct order)
- URL expiration verified (mock time)

#### Definition of Done

- [ ] Content access service implemented
- [ ] Access check verifies purchase status
- [ ] Streaming URL generation with signed URLs
- [ ] Playback progress tracking (save/retrieve)
- [ ] Completion detection (>95% watched)
- [ ] User library endpoint working
- [ ] Library excludes refunded purchases
- [ ] Library ordered by purchase date
- [ ] Content player page with access guard
- [ ] Redirect to purchase page if no access
- [ ] All unit tests passing (95%+ coverage)
- [ ] Integration tests passing
- [ ] CI passes all checks
- [ ] Documentation: Access control flow diagram

#### Review Checklist

- [ ] Access checks run before URL generation
- [ ] Signed URLs expire after 1 hour
- [ ] Progress updates use upsert (idempotent)
- [ ] Completion threshold is 95% (not 100%)
- [ ] Last watched timestamp updated on progress save
- [ ] Library query efficient (single query with joins)
- [ ] No N+1 query problems
- [ ] Refunded purchases excluded from all access checks
- [ ] Content player redirects properly (no error page)
- [ ] Progress tracking doesn't block playback

---

## 5. Integration Phase

### Work Packet P1-INTEG-001: End-to-End Purchase Flow

**Branch**: `feature/P1-INTEG-001-e2e-purchase-flow`

**Owner**: QA Engineer + Backend Engineer

**Description**: Integrate and test complete purchase flow from content discovery to playback.

#### Implementation Steps

1. **Create E2E test suite** (`apps/web/e2e/purchase-flow.spec.ts`):

```typescript
import { test, expect } from '@playwright/test';

test.describe('Complete Purchase Flow', () => {
  test('should complete full purchase and access workflow', async ({ page }) => {
    // 1. User registers
    await page.goto('/register');
    await page.fill('[name=email]', 'test@example.com');
    await page.fill('[name=password]', 'Password123!');
    await page.fill('[name=name]', 'Test User');
    await page.click('button[type=submit]');

    // 2. Browse content catalog
    await page.goto('/browse');
    await expect(page.locator('h1')).toContainText('Browse Content');
    
    // Click first content item
    await page.click('[data-testid=content-card]:first-child');

    // 3. View content details
    await expect(page).toHaveURL(/\/content\/[a-f0-9-]+/);
    const contentTitle = await page.locator('h1').textContent();
    const price = await page.locator('[data-testid=price]').textContent();

    // 4. Click purchase button
    await page.click('[data-testid=buy-now]');

    // 5. Stripe checkout (test mode)
    await expect(page).toHaveURL(/checkout\.stripe\.com/);
    
    // Fill Stripe test card
    const stripeFrame = page.frameLocator('iframe[name*="stripe"]');
    await stripeFrame.locator('[name=cardNumber]').fill('4242424242424242');
    await stripeFrame.locator('[name=cardExpiry]').fill('12/34');
    await stripeFrame.locator('[name=cardCvc]').fill('123');
    await stripeFrame.locator('[name=billingName]').fill('Test User');
    
    await page.click('button[type=submit]');

    // 6. Redirect back to content page
    await expect(page).toHaveURL(/\/content\/[a-f0-9-]+\?purchase=success/);
    await expect(page.locator('[data-testid=success-message]')).toBeVisible();

    // 7. Wait for webhook processing
    await page.waitForTimeout(2000);

    // 8. Access content player
    await page.click('[data-testid=watch-now]');
    
    // 9. Verify video player loaded
    await expect(page.locator('video')).toBeVisible();
    
    // 10. Verify library access
    await page.goto('/library');
    await expect(page.locator('[data-testid=content-card]').filter({ hasText: contentTitle })).toBeVisible();

    // 11. Verify email sent
    // (Check email via Resend API or test inbox)
  });

  test('should handle free content without Stripe', async ({ page }) => {
    // Setup: Create free content via API
    const freeContent = await createTestContent({ price: 0 });

    // Login
    await page.goto('/login');
    await page.fill('[name=email]', 'test@example.com');
    await page.fill('[name=password]', 'Password123!');
    await page.click('button[type=submit]');

    // Visit free content
    await page.goto(`/content/${freeContent.id}`);

    // Click "Get Access" button (not "Buy Now")
    await page.click('[data-testid=get-access]');

    // Should redirect directly to player (no Stripe)
    await expect(page).toHaveURL(/\/content\/[a-f0-9-]+\/player/);
    await expect(page.locator('video')).toBeVisible();
  });

  test('should prevent access without purchase', async ({ page }) => {
    const content = await createTestContent({ price: 999 });

    // Login
    await page.goto('/login');
    await page.fill('[name=email]', 'test@example.com');
    await page.fill('[name=password]', 'Password123!');
    await page.click('button[type=submit]');

    // Try to access player directly
    await page.goto(`/content/${content.id}/player`);

    // Should redirect to purchase page
    await expect(page).toHaveURL(/\/content\/[a-f0-9-]+\/purchase/);
    await expect(page.locator('[data-testid=purchase-required]')).toBeVisible();
  });
});
```

2. **Create integration test helpers** (`apps/web/e2e/helpers.ts`):

```typescript
export async function createTestContent(data: Partial<Content>) {
  const response = await fetch('/api/test/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return response.json();
}

export async function createTestUser(data: { email: string; password: string; role?: string }) {
  const response = await fetch('/api/test/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return response.json();
}

export async function simulateStripeWebhook(sessionId: string) {
  const response = await fetch('/webhooks/stripe/payment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': generateTestSignature(),
    },
    body: JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          payment_intent: 'pi_test_123',
          metadata: {
            purchaseId: 'purchase-123',
            customerId: 'user-123',
            contentId: 'content-456',
          },
        },
      },
    }),
  });
  return response;
}
```

3. **Create contract tests** (`apps/web/tests/contracts/purchase-flow.contract.ts`):

```typescript
describe('Purchase Flow Contracts', () => {
  it('should maintain stable checkout API', () => {
    const request = {
      contentId: expect.any(String),
      organizationId: expect.any(String),
    };

    const response = {
      checkoutUrl: expect.stringMatching(/^https:\/\/checkout\.stripe\.com/),
      sessionId: expect.stringMatching(/^cs_/),
    };

    // Contract verified
  });

  it('should maintain stable webhook payload', () => {
    const webhookPayload = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: expect.stringMatching(/^cs_/),
          payment_intent: expect.stringMatching(/^pi_/),
          metadata: {
            purchaseId: expect.any(String),
            customerId: expect.any(String),
            contentId: expect.any(String),
          },
        },
      },
    };

    // Contract verified
  });
});
```

#### Dependencies

- All feature packets (P1-AUTH-001, P1-CONTENT-001, P1-ECOM-001, P1-ACCESS-001)
- Stripe test mode configured
- Resend test API key configured

#### Test Specifications

**Required Test Coverage**:
- [ ] Complete purchase flow (registration → browse → purchase → access)
- [ ] Free content flow (no Stripe, instant access)
- [ ] Access denial (no purchase)
- [ ] Playback progress (save and resume)
- [ ] Library display (purchased content)
- [ ] Email delivery (purchase receipt)
- [ ] Webhook processing (idempotent)
- [ ] Error handling (payment failed, webhook failed)
- [ ] Cross-browser compatibility (Chrome, Firefox, Safari)
- [ ] Mobile responsiveness (simulated)

**Performance Benchmarks**:
- [ ] Page load time < 2 seconds
- [ ] Video playback starts < 3 seconds
- [ ] Checkout creation < 1 second
- [ ] Webhook processing < 500ms
- [ ] Library query < 500ms

#### Definition of Done

- [ ] E2E tests cover complete purchase flow
- [ ] Contract tests verify API stability
- [ ] Performance benchmarks met
- [ ] All integration points tested
- [ ] Stripe test mode verified
- [ ] Email delivery verified
- [ ] Error scenarios tested
- [ ] CI runs all E2E tests on every PR
- [ ] Test artifacts (screenshots, videos) captured on failure
- [ ] Documentation: Integration test guide

#### Review Checklist

- [ ] Tests use test mode Stripe keys (no real charges)
- [ ] Tests clean up data after run
- [ ] Tests are idempotent (can run multiple times)
- [ ] Webhook signature verification tested
- [ ] Access control tested at every integration point
- [ ] Performance metrics tracked over time
- [ ] Flaky tests identified and fixed
- [ ] Tests run on ephemeral database (isolated)

---


## 6. Release Preparation

### Work Packet P1-RELEASE-001: Production Deployment Checklist

**Branch**: `feature/P1-RELEASE-001-deployment-prep`

**Owner**: DevOps + Backend Engineer

**Description**: Prepare and verify all production deployment requirements.

#### Pre-Deployment Checklist

**Infrastructure**:
- [ ] Neon production database created and migrations applied
- [ ] Cloudflare Workers deployed (codex-web, stripe-webhook-handler, auth-worker)
- [ ] R2 buckets created (codex-media-production, codex-assets-production)
- [ ] KV namespaces created (AUTH_SESSION_KV)
- [ ] DNS records configured (codex.revelations.studio, api.revelations.studio, auth.revelations.studio)
- [ ] SSL certificates provisioned (automatic via Cloudflare)

**Secrets Configuration**:
- [ ] DATABASE_URL (production pooled connection)
- [ ] SESSION_SECRET (32+ characters, cryptographically random)
- [ ] BETTER_AUTH_SECRET (32+ characters)
- [ ] STRIPE_SECRET_KEY (production key)
- [ ] STRIPE_WEBHOOK_SECRET_PAYMENT (production webhook secret)
- [ ] RESEND_API_KEY (production key)
- [ ] R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY

**Stripe Configuration**:
- [ ] Production webhook endpoint configured: https://api.revelations.studio/webhooks/stripe/payment
- [ ] Webhook secret saved in Cloudflare secrets
- [ ] Test payment processed successfully
- [ ] Webhook events verified in Stripe dashboard

**Database**:
- [ ] All migrations applied successfully
- [ ] Indexes verified (EXPLAIN ANALYZE on key queries)
- [ ] Constraints verified (foreign keys, unique indexes)
- [ ] Platform owner user created manually
- [ ] Initial categories seeded
- [ ] Connection pooling configured (Neon pooler)

**Monitoring**:
- [ ] Cloudflare Analytics enabled
- [ ] Worker logs accessible via `wrangler tail`
- [ ] Error tracking configured (Sentry or similar)
- [ ] Health check endpoints responding
- [ ] Performance metrics baseline established

**Security**:
- [ ] CORS headers configured correctly
- [ ] CSP headers configured
- [ ] Rate limiting enabled (Cloudflare)
- [ ] SQL injection prevention verified (parameterized queries)
- [ ] XSS prevention verified (input sanitization)
- [ ] Authentication tokens secure (httpOnly, secure, sameSite)

**Testing**:
- [ ] All CI tests passing on main branch
- [ ] Manual smoke tests completed (see below)
- [ ] Load testing completed (expected traffic volume)
- [ ] Security scan passed (OWASP top 10)

---

## 7. Cross-Cutting Concerns

### 7.1 Authentication & Authorization

**Pattern**: All protected routes must use authentication guards

**Implementation**:
```typescript
// All route load functions
export const load: PageServerLoad = async ({ locals }) => {
  const user = requireAuth({ locals }); // Throws redirect if not authenticated
  // ... rest of load function
};

// All API endpoints
export const POST: RequestHandler = async ({ locals }) => {
  const user = requireAuth({ locals });
  // ... rest of handler
};
```

**Guards Available**:
- `requireAuth` - Any authenticated user
- `requirePlatformOwner` - Platform owner only
- `requireVerifiedEmail` - Authenticated + email verified
- `requireGuest` - Not authenticated (login/register pages)

**Requirement**: Every work packet that creates protected endpoints must use guards

---

### 7.2 Error Handling

**Pattern**: Consistent error responses across all APIs

**Standard Error Response**:
```typescript
{
  error: {
    code: string;        // Machine-readable error code
    message: string;     // User-friendly error message
    details?: any;       // Optional additional context (never sensitive data)
  }
}
```

**HTTP Status Codes**:
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (not authenticated)
- `403` - Forbidden (authenticated but not authorized)
- `404` - Not Found
- `409` - Conflict (duplicate resource)
- `422` - Unprocessable Entity (business logic error)
- `429` - Too Many Requests (rate limit)
- `500` - Internal Server Error (catch-all)

**Implementation**:
```typescript
// API endpoint error handling
try {
  // Business logic
} catch (err) {
  if (err instanceof ValidationError) {
    return json({ error: { code: 'VALIDATION_ERROR', message: err.message } }, { status: 400 });
  }
  if (err instanceof NotFoundError) {
    return json({ error: { code: 'NOT_FOUND', message: err.message } }, { status: 404 });
  }
  // Log unexpected errors
  console.error('Unexpected error:', err);
  return json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }, { status: 500 });
}
```

**Requirement**: All work packets must implement consistent error handling

---

### 7.3 Logging & Observability

**Pattern**: Structured logging with context

**Log Levels**:
- `debug` - Development debugging info
- `info` - Normal application events
- `warn` - Recoverable errors, degraded functionality
- `error` - Unrecoverable errors requiring attention

**Implementation**:
```typescript
import { logger } from '$lib/server/logger';

logger.info('Purchase created', {
  purchaseId: purchase.id,
  customerId: purchase.customerId,
  amount: purchase.pricePaidCents,
});

logger.error('Stripe webhook failed', {
  error: err.message,
  sessionId: session.id,
  stack: err.stack,
});
```

**PII Protection**:
- NEVER log full email addresses (mask: `u***@example.com`)
- NEVER log passwords, tokens, API keys
- NEVER log full credit card numbers

**Requirement**: All work packets must add appropriate logging

---

### 7.4 Database Migrations

**Pattern**: Drizzle migration workflow

**Migration Creation**:
```bash
# 1. Update schema file
vim packages/database/src/schema/users.ts

# 2. Generate migration
pnpm --filter @codex/database db:gen:drizzle

# 3. Review generated SQL
cat packages/database/drizzle/0001_*.sql

# 4. Customize if needed (add indexes, data migration, etc.)
vim packages/database/drizzle/0001_*.sql

# 5. Apply to development DB
pnpm --filter @codex/database db:migrate

# 6. Test migration (run app, verify functionality)

# 7. Commit migration file
git add packages/database/drizzle/0001_*.sql
git commit -m "feat: Add user email verification"
```

**Migration Safety**:
- All migrations must be backwards-compatible (no breaking changes without versioning)
- Use transactions (Drizzle automatic)
- Add indexes concurrently (PostgreSQL `CREATE INDEX CONCURRENTLY`)
- Never drop columns in production (use soft delete: rename to `_deprecated_columnName`)
- Test rollback procedure before production deployment

**Data Migrations**:
```sql
-- Good: Idempotent data migration
UPDATE users
SET role = 'customer'
WHERE role IS NULL;

-- Bad: Non-idempotent
UPDATE users SET role = 'customer'; -- Overwrites existing roles!
```

**Requirement**: All schema changes must go through migration workflow

---

### 7.5 Testing Standards

**Test Coverage Requirements**:
- Unit tests: 95%+ coverage on business logic
- Integration tests: All API endpoints
- E2E tests: Critical user flows
- Contract tests: All public APIs

**Test Organization**:
```
packages/feature/
├── src/
│   ├── service.ts
│   └── service.test.ts        # Unit tests (co-located)
└── tests/
    ├── integration.test.ts     # Integration tests
    └── contracts.test.ts       # Contract tests

apps/web/
├── e2e/
│   └── feature.spec.ts         # E2E tests (Playwright)
```

**Test Naming**:
```typescript
describe('ServiceName', () => {
  describe('methodName', () => {
    it('should handle normal case', () => { });
    it('should handle edge case', () => { });
    it('should reject invalid input', () => { });
    it('should throw for unauthorized access', () => { });
  });
});
```

**Test Data Management**:
- Use transactions for database tests (auto-rollback)
- Use factories for test data generation
- Never use production data in tests
- Clean up after tests (or use ephemeral database)

**Requirement**: All work packets must meet coverage requirements

---

### 7.6 Security Best Practices

**Input Validation**:
- Validate all user input (never trust client data)
- Use schema validation (Zod, Yup, etc.)
- Sanitize HTML input (prevent XSS)
- Validate file uploads (type, size, content)

**SQL Injection Prevention**:
```typescript
// Good: Parameterized query
await db.select().from(users).where(eq(users.email, userInput));

// Bad: String concatenation
await db.execute(`SELECT * FROM users WHERE email = '${userInput}'`); // NEVER DO THIS
```

**Authentication**:
- Use BetterAuth for all authentication
- Store passwords hashed (bcrypt via BetterAuth)
- Use httpOnly cookies for session tokens
- Implement CSRF protection (SvelteKit automatic)

**Authorization**:
- Check authorization in every route/endpoint
- Use guards consistently
- Never rely on client-side authorization checks alone

**Secrets Management**:
- Never commit secrets to git
- Use environment variables
- Use Cloudflare secrets for worker secrets
- Rotate secrets regularly (document procedure)

**Requirement**: All work packets must follow security best practices

---

## 8. CI/CD Mapping

### 8.1 CI Pipeline (`.github/workflows/testing.yml`)

**Triggered On**: Every push, every PR

**Jobs**:

**1. Static Analysis** (parallel):
```yaml
static-analysis:
  runs-on: ubuntu-latest
  steps:
    - Typecheck: pnpm typecheck
    - Lint: pnpm lint
    - Format check: pnpm format:check
```

**2. Unit & Integration Tests** (parallel with static analysis):
```yaml
test:
  runs-on: ubuntu-latest
  services:
    - neon-database: ephemeral branch created
  steps:
    - Create Neon branch
    - Generate migrations
    - Apply migrations
    - Run tests: pnpm test
    - Upload coverage report
    - Cleanup Neon branch
```

**3. E2E Tests** (after unit tests pass):
```yaml
e2e:
  runs-on: ubuntu-latest
  needs: [test]
  steps:
    - Create E2E Neon branch
    - Build workers
    - Start preview deployment
    - Run Playwright: pnpm test:e2e
    - Upload test artifacts
    - Cleanup
```

**CI Checks Required for Merge**:
- [ ] Static analysis passes
- [ ] All unit tests pass
- [ ] Integration tests pass
- [ ] E2E tests pass (if web changed)
- [ ] Test coverage >= 95%
- [ ] No security vulnerabilities (npm audit)

---

### 8.2 Work Packet CI Integration

**Each work packet must specify**:

1. **Path Filters**: Which file changes trigger tests
   ```yaml
   paths:
     - 'packages/content/**'
     - 'apps/web/src/routes/api/content/**'
   ```

2. **Test Commands**: How to run packet-specific tests
   ```bash
   pnpm --filter @codex/content test
   pnpm --filter web test -- e2e/content
   ```

3. **Dependencies**: What must be running
   - Database with specific tables
   - R2 buckets
   - Mock services

4. **Artifacts**: What to save on failure
   - Screenshots
   - Logs
   - Database dumps

**Example** (P1-CONTENT-001):
```yaml
- name: Test Content Management
  if: contains(github.event.head_commit.modified, 'packages/content')
  run: |
    pnpm --filter @codex/content test --coverage
    pnpm --filter web test -- e2e/content
```

---

### 8.3 Deployment Pipeline

**Preview Deployments** (`.github/workflows/preview-deploy.yml`):
- Triggered on: PR opened/updated
- Environment: `preview-{PR-NUMBER}`
- Database: Neon branch `pr-{PR-NUMBER}`
- DNS: `*-preview-{PR-NUMBER}.revelations.studio`
- Lifetime: Until PR closed

**Production Deployments** (`.github/workflows/deploy-production.yml`):
- Triggered on: Push to `main` (after tests pass)
- Environment: `production`
- Database: Neon `production` branch
- DNS: `*.revelations.studio`
- Steps:
  1. Verify DNS records
  2. Validate builds (fail fast)
  3. Run migrations (with backup)
  4. Deploy workers sequentially
  5. Health checks with retry
  6. Notify on success/failure

---

## 9. Risk & Mitigation

### 9.1 Database Migration Risks

**Risk**: Migration fails in production, leaving database in inconsistent state

**Mitigation**:
1. Always test migrations on preview environment first
2. Create Neon restore point before migration (PITR available)
3. Use Drizzle transactions (automatic rollback on failure)
4. Have rollback procedure documented
5. Schedule migrations during low-traffic windows

**Rollback Procedure**:
```bash
# Create restore branch from before migration
neonctl branches create \
  --name emergency-restore-$(date +%s) \
  --parent production \
  --timestamp "1 hour ago"

# Update DATABASE_URL to restore branch
# Redeploy workers with restore URL
```

---

### 9.2 Stripe Webhook Risks

**Risk**: Webhook fails, purchase not fulfilled, customer has access without payment

**Mitigation**:
1. Webhook signature verification (prevent fake webhooks)
2. Idempotency (handle duplicate webhooks)
3. Pending purchase created before Stripe checkout (audit trail)
4. Retry logic (Stripe retries failed webhooks)
5. Manual reconciliation tool (compare Stripe payments to database purchases)

**Manual Reconciliation**:
```typescript
// Script: scripts/reconcile-purchases.ts
async function reconcilePurchases() {
  const pendingPurchases = await db.query.contentPurchases.findMany({
    where: eq(contentPurchases.status, 'pending'),
  });

  for (const purchase of pendingPurchases) {
    if (!purchase.stripeCheckoutSessionId) continue;

    // Check Stripe session status
    const session = await stripe.checkout.sessions.retrieve(purchase.stripeCheckoutSessionId);

    if (session.payment_status === 'paid' && purchase.status === 'pending') {
      console.warn(`Found unfulfilled purchase: ${purchase.id}`);
      // Update to completed
      await handleCheckoutComplete(session);
    }
  }
}
```

---

### 9.3 Race Condition Risks

**Risk**: Concurrent requests create duplicate purchases or data corruption

**Mitigation**:
1. Database unique constraints (prevent duplicates at DB level)
2. Optimistic locking (version field in critical tables)
3. Idempotent operations (upsert instead of insert)
4. Transaction isolation (Drizzle `db.transaction()`)

**Example** (duplicate purchase prevention):
```sql
-- Unique index prevents duplicates
CREATE UNIQUE INDEX idx_content_purchases_no_duplicates
  ON content_purchases(customer_id, content_id)
  WHERE status IN ('completed', 'pending');
```

---

### 9.4 R2 Upload Risks

**Risk**: User abandons upload, orphaned files in R2, wasted storage costs

**Mitigation**:
1. Presigned URLs expire after 1 hour (unused URLs become invalid)
2. Upload completion verification (check object exists before creating media_items record)
3. Orphan cleanup job (cron: delete R2 objects without corresponding media_items record)
4. File size limits enforced (client-side and presigned URL)

**Orphan Cleanup** (Cloudflare Worker Cron):
```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    // Find media_items with 'uploaded' status older than 24 hours
    const staleUploads = await db.query.mediaItems.findMany({
      where: and(
        eq(mediaItems.status, 'uploaded'),
        lt(mediaItems.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
      ),
    });

    for (const item of staleUploads) {
      // Check if referenced by content
      const hasContent = await db.query.content.findFirst({
        where: eq(content.mediaItemId, item.id),
      });

      if (!hasContent) {
        // Safe to delete
        await r2Service.deleteObject(item.r2Key);
        await db.delete(mediaItems).where(eq(mediaItems.id, item.id));
        console.log(`Cleaned up orphaned media: ${item.id}`);
      }
    }
  },
};
```

---

### 9.5 Performance Risks

**Risk**: Slow queries degrade user experience, database overload

**Mitigation**:
1. Database indexes on all foreign keys and frequently queried columns
2. Connection pooling (Neon pooler)
3. KV caching for session data
4. Pagination on all list endpoints
5. Query optimization (EXPLAIN ANALYZE in development)
6. Cloudflare caching for static assets

**Key Indexes**:
```sql
-- Session lookups
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- Organization-scoped queries
CREATE INDEX idx_content_organization_id ON content(organization_id);
CREATE INDEX idx_content_purchases_customer_id ON content_purchases(customer_id);

-- Purchase access checks
CREATE INDEX idx_content_purchases_lookup 
  ON content_purchases(customer_id, content_id) 
  WHERE status = 'completed' AND refunded_at IS NULL;
```

---

## 10. Worked Example: Complete E-Commerce Work Packet

### Work Packet P1-ECOM-002: Refund Processing

**Branch**: `feature/P1-ECOM-002-refund-processing`

**Owner**: Backend Engineer (Primary), Payment Specialist (Reviewer)

**Priority**: P1 (Critical for Phase 1 MVP)

**Estimated Effort**: 3 days

---

#### 1. Unique Identifier

**Packet ID**: P1-ECOM-002
**Branch**: `feature/P1-ECOM-002-refund-processing`
**Parent Branch**: `main` (or `feature/P1-ECOM-001-stripe-checkout` if running in parallel)

---

#### 2. Implementation Steps (Ordered, Actionable)

**Step 1**: Update database schema for refund tracking

File: `packages/database/src/schema/purchases.ts`

```typescript
// Add refund fields to contentPurchases table
export const contentPurchases = pgTable('content_purchases', {
  // ... existing fields
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  refundReason: text('refund_reason'),
  stripeRefundId: text('stripe_refund_id'),
});
```

Generate migration:
```bash
pnpm --filter @codex/database db:gen:drizzle
# Review generated SQL in packages/database/drizzle/0002_add_refund_fields.sql
pnpm --filter @codex/database db:migrate
```

Expected output:
```sql
ALTER TABLE content_purchases ADD COLUMN refunded_at TIMESTAMPTZ;
ALTER TABLE content_purchases ADD COLUMN refund_reason TEXT;
ALTER TABLE content_purchases ADD COLUMN stripe_refund_id TEXT;
```

**Step 2**: Add refund method to Purchase Service

File: `packages/payments/src/service.ts`

```typescript
export interface IPurchaseService {
  // ... existing methods
  initiateRefund(purchaseId: string, reason: string, requestedBy: string): Promise<RefundResult>;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  error?: string;
}

export class PurchaseService {
  async initiateRefund(
    purchaseId: string,
    reason: string,
    requestedBy: string
  ): Promise<RefundResult> {
    // 1. Get purchase
    const purchase = await db.query.contentPurchases.findFirst({
      where: eq(contentPurchases.id, purchaseId),
    });

    if (!purchase) {
      return { success: false, error: 'Purchase not found' };
    }

    // 2. Validate refund eligibility
    if (purchase.status !== 'completed') {
      return { success: false, error: 'Purchase not completed' };
    }

    if (purchase.refundedAt) {
      return { success: false, error: 'Purchase already refunded' };
    }

    // 3. Check refund window (30 days)
    const daysSincePurchase = Math.floor(
      (Date.now() - purchase.purchasedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSincePurchase > 30) {
      return { success: false, error: 'Refund window expired (30 days)' };
    }

    // 4. Initiate Stripe refund
    let stripeRefund;
    try {
      stripeRefund = await stripe.refunds.create({
        payment_intent: purchase.stripePaymentIntentId!,
        reason: 'requested_by_customer',
        metadata: {
          purchaseId: purchase.id,
          requestedBy,
          internalReason: reason,
        },
      });
    } catch (err) {
      console.error('Stripe refund failed:', err);
      return { success: false, error: 'Payment refund failed' };
    }

    // 5. Update purchase record
    await db.update(contentPurchases)
      .set({
        refundedAt: new Date(),
        refundReason: reason,
        stripeRefundId: stripeRefund.id,
        updatedAt: new Date(),
      })
      .where(eq(contentPurchases.id, purchaseId));

    // 6. Send refund confirmation email
    const customer = await db.query.users.findFirst({
      where: eq(users.id, purchase.customerId),
    });

    const content = await db.query.content.findFirst({
      where: eq(content.id, purchase.contentId),
    });

    await notificationService.sendEmail({
      template: 'refund-confirmation',
      recipient: customer!.email,
      data: {
        customerName: customer!.name,
        contentTitle: content!.title,
        refundAmount: purchase.pricePaidCents / 100,
        refundDate: new Date().toLocaleDateString(),
      },
    });

    return { success: true, refundId: stripeRefund.id };
  }
}
```

**Step 3**: Create refund admin API endpoint

File: `apps/web/src/routes/api/admin/purchases/[id]/refund/+server.ts`

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePlatformOwner } from '@codex/auth/guards';
import { purchaseService } from '@codex/payments';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  // 1. Authorization check
  const admin = requirePlatformOwner({ locals });

  const purchaseId = params.id;
  const { reason } = await request.json();

  // 2. Validate input
  if (!reason || reason.length < 10) {
    throw error(400, 'Refund reason must be at least 10 characters');
  }

  // 3. Process refund
  const result = await purchaseService.initiateRefund(
    purchaseId,
    reason,
    admin.id
  );

  if (!result.success) {
    throw error(400, result.error || 'Refund failed');
  }

  return json({ 
    success: true, 
    refundId: result.refundId 
  });
};
```

**Step 4**: Create refund email template

File: `packages/notifications/src/templates.ts`

```typescript
// Add to templates object
'refund-confirmation': {
  subject: 'Refund processed for your purchase',
  htmlTemplate: `
    <h1>Refund Confirmation</h1>
    <p>Hi {{customerName}},</p>
    <p>Your refund has been processed for: <strong>{{contentTitle}}</strong></p>
    <p>Refund Amount: ${{refundAmount}}</p>
    <p>Refund Date: {{refundDate}}</p>
    <p>You will see the credit in 5-10 business days depending on your bank.</p>
    <p>You will no longer have access to this content.</p>
  `,
  textTemplate: `
    Refund Confirmation
    Hi {{customerName}},
    Refund Amount: ${{refundAmount}}
    Content: {{contentTitle}}
    Date: {{refundDate}}
  `,
},
```

**Step 5**: Update content access check to exclude refunded purchases

File: `packages/content-access/src/service.ts`

```typescript
async checkAccess(userId: string, contentId: string): Promise<boolean> {
  const purchase = await db.query.contentPurchases.findFirst({
    where: and(
      eq(contentPurchases.customerId, userId),
      eq(contentPurchases.contentId, contentId),
      eq(contentPurchases.status, 'completed'),
      isNull(contentPurchases.refundedAt) // ADDED: Exclude refunded
    ),
  });

  return !!purchase;
}
```

---

#### 3. Dependencies

**Work Packets**:
- P1-ECOM-001 (Stripe Checkout Integration) - REQUIRED
- P1-NOTIFY-001 (Email Notifications) - REQUIRED
- P1-ACCESS-001 (Content Access) - REQUIRED (must update access check)

**Infrastructure**:
- Stripe production account with refund permissions
- Resend email delivery configured

**Services**:
- Database with content_purchases table
- Stripe SDK initialized
- Notification service available

---

#### 4. Interface Contracts

**API Contract**:

```typescript
// POST /api/admin/purchases/:id/refund
Request: {
  reason: string; // Min 10 characters
}

Response (Success): {
  success: true;
  refundId: string; // Stripe refund ID (e.g., "re_1ABC123")
}

Response (Error): {
  error: {
    code: string;
    message: string;
  }
}

// Status Codes:
// 200 - Refund successful
// 400 - Validation error or refund ineligible
// 401 - Not authenticated
// 403 - Not platform owner
// 404 - Purchase not found
// 500 - Internal error (Stripe API failure)
```

**Example Requests/Responses**:

Success:
```json
// Request
POST /api/admin/purchases/purchase-123/refund
{
  "reason": "Customer requested refund due to content quality"
}

// Response (200)
{
  "success": true,
  "refundId": "re_1PQR789xyz"
}
```

Validation Error:
```json
// Request
POST /api/admin/purchases/purchase-123/refund
{
  "reason": "too short"
}

// Response (400)
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Refund reason must be at least 10 characters"
  }
}
```

Already Refunded:
```json
// Response (400)
{
  "error": {
    "code": "REFUND_ERROR",
    "message": "Purchase already refunded"
  }
}
```

---

#### 5. Role Assignments

| Task | Role | Responsibility |
|------|------|----------------|
| Schema update | Schema Owner | Design refund fields, review migration |
| Migration generation | Backend Engineer | Run Drizzle migration generator, test migration |
| Service implementation | Backend Engineer | Implement refund logic in PurchaseService |
| API endpoint | API Owner | Create admin refund endpoint, input validation |
| Email template | Backend Engineer | Create refund confirmation template |
| Access check update | Backend Engineer | Update ContentAccessService |
| Unit tests | Backend Engineer | Write comprehensive test suite |
| Integration tests | QA Engineer | Test end-to-end refund flow |
| Security review | Security Specialist | Review authorization, audit logging |
| Code review | Payment Specialist | Review Stripe integration, refund logic |
| Documentation | Technical Writer | API docs, admin guide |

---

#### 6. Test Suite Specification

**6.1 Unit Tests** (`packages/payments/src/service.test.ts`)

Test: `should refund completed purchase successfully`
```typescript
it('should refund completed purchase successfully', async () => {
  // Setup: Create completed purchase
  const purchase = await db.insert(contentPurchases).values({
    id: 'purchase-123',
    customerId: 'user-456',
    contentId: 'content-789',
    status: 'completed',
    purchasedAt: new Date(),
    pricePaidCents: 999,
    stripePaymentIntentId: 'pi_test_123',
  }).returning();

  // Mock Stripe refund
  const mockRefund = { id: 're_mock_123' };
  vi.spyOn(stripe.refunds, 'create').mockResolvedValue(mockRefund as any);

  // Execute
  const result = await purchaseService.initiateRefund(
    'purchase-123',
    'Customer requested refund',
    'admin-001'
  );

  // Assert
  expect(result.success).toBe(true);
  expect(result.refundId).toBe('re_mock_123');

  // Verify database updated
  const updated = await db.query.contentPurchases.findFirst({
    where: eq(contentPurchases.id, 'purchase-123'),
  });
  expect(updated?.refundedAt).toBeInstanceOf(Date);
  expect(updated?.refundReason).toBe('Customer requested refund');
  expect(updated?.stripeRefundId).toBe('re_mock_123');

  // Verify Stripe called correctly
  expect(stripe.refunds.create).toHaveBeenCalledWith({
    payment_intent: 'pi_test_123',
    reason: 'requested_by_customer',
    metadata: expect.objectContaining({
      purchaseId: 'purchase-123',
      requestedBy: 'admin-001',
    }),
  });
});
```

Test: `should reject refund for already refunded purchase`
```typescript
it('should reject refund for already refunded purchase', async () => {
  // Setup: Create refunded purchase
  await db.insert(contentPurchases).values({
    id: 'purchase-123',
    status: 'completed',
    refundedAt: new Date(),
    stripeRefundId: 're_existing_123',
    ...
  });

  // Execute
  const result = await purchaseService.initiateRefund(
    'purchase-123',
    'Duplicate refund attempt',
    'admin-001'
  );

  // Assert
  expect(result.success).toBe(false);
  expect(result.error).toBe('Purchase already refunded');

  // Verify Stripe NOT called
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
```

Test: `should enforce 30-day refund window`
```typescript
it('should enforce 30-day refund window', async () => {
  // Setup: Create old purchase (31 days ago)
  const oldDate = new Date();
  oldDate.setDate(oldDate.getDate() - 31);

  await db.insert(contentPurchases).values({
    id: 'purchase-123',
    status: 'completed',
    purchasedAt: oldDate,
    ...
  });

  // Execute
  const result = await purchaseService.initiateRefund(
    'purchase-123',
    'Too late refund',
    'admin-001'
  );

  // Assert
  expect(result.success).toBe(false);
  expect(result.error).toContain('Refund window expired');
});
```

Test: `should handle Stripe API failure gracefully`
```typescript
it('should handle Stripe API failure gracefully', async () => {
  await db.insert(contentPurchases).values({
    id: 'purchase-123',
    status: 'completed',
    purchasedAt: new Date(),
    ...
  });

  // Mock Stripe error
  vi.spyOn(stripe.refunds, 'create').mockRejectedValue(
    new Error('Stripe API error: insufficient funds')
  );

  // Execute
  const result = await purchaseService.initiateRefund(
    'purchase-123',
    'Test error handling',
    'admin-001'
  );

  // Assert
  expect(result.success).toBe(false);
  expect(result.error).toBe('Payment refund failed');

  // Verify database NOT updated
  const purchase = await db.query.contentPurchases.findFirst({
    where: eq(contentPurchases.id, 'purchase-123'),
  });
  expect(purchase?.refundedAt).toBeNull();
});
```

Test: `should send refund confirmation email`
```typescript
it('should send refund confirmation email', async () => {
  const mockSend = vi.spyOn(notificationService, 'sendEmail');

  await db.insert(contentPurchases).values({
    id: 'purchase-123',
    customerId: 'user-456',
    contentId: 'content-789',
    status: 'completed',
    purchasedAt: new Date(),
    pricePaidCents: 999,
    stripePaymentIntentId: 'pi_test_123',
  });

  // Mock user and content
  await db.insert(users).values({
    id: 'user-456',
    email: 'customer@test.com',
    name: 'Test Customer',
  });

  await db.insert(content).values({
    id: 'content-789',
    title: 'Test Video',
    ...
  });

  vi.spyOn(stripe.refunds, 'create').mockResolvedValue({ id: 're_123' } as any);

  await purchaseService.initiateRefund('purchase-123', 'Test', 'admin-001');

  expect(mockSend).toHaveBeenCalledWith({
    template: 'refund-confirmation',
    recipient: 'customer@test.com',
    data: {
      customerName: 'Test Customer',
      contentTitle: 'Test Video',
      refundAmount: 9.99,
      refundDate: expect.any(String),
    },
  });
});
```

**6.2 Integration Tests** (`apps/web/tests/integration/refund.test.ts`)

Test: `should complete full refund workflow via API`
```typescript
it('should complete full refund workflow via API', async () => {
  // Setup: Create admin user and purchase
  const admin = await createTestUser({ role: 'platform_owner' });
  const customer = await createTestUser({ email: 'customer@test.com' });
  const content = await createTestContent({ price: 999 });
  const purchase = await createTestPurchase({
    customerId: customer.id,
    contentId: content.id,
  });

  // Login as admin
  const { sessionToken } = await loginUser(admin.email, 'password');

  // Execute refund
  const response = await fetch(`/api/admin/purchases/${purchase.id}/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `codex-session=${sessionToken}`,
    },
    body: JSON.stringify({
      reason: 'Customer requested refund due to dissatisfaction',
    }),
  });

  // Assert response
  expect(response.status).toBe(200);
  const { success, refundId } = await response.json();
  expect(success).toBe(true);
  expect(refundId).toMatch(/^re_/);

  // Verify database updated
  const updatedPurchase = await db.query.contentPurchases.findFirst({
    where: eq(contentPurchases.id, purchase.id),
  });
  expect(updatedPurchase?.refundedAt).not.toBeNull();

  // Verify access revoked
  const hasAccess = await contentAccessService.checkAccess(customer.id, content.id);
  expect(hasAccess).toBe(false);

  // Verify email sent (check mock or test inbox)
  // await verifyEmailSent('customer@test.com', 'refund-confirmation');
});
```

Test: `should reject non-admin refund attempt`
```typescript
it('should reject non-admin refund attempt', async () => {
  const customer = await createTestUser({ role: 'customer' });
  const purchase = await createTestPurchase({ customerId: customer.id });

  const { sessionToken } = await loginUser(customer.email, 'password');

  const response = await fetch(`/api/admin/purchases/${purchase.id}/refund`, {
    method: 'POST',
    headers: {
      'Cookie': `codex-session=${sessionToken}`,
    },
    body: JSON.stringify({ reason: 'Unauthorized attempt' }),
  });

  expect(response.status).toBe(403);
});
```

**6.3 Contract Tests** (`apps/web/tests/contracts/refund.contract.ts`)

```typescript
describe('Refund API Contract', () => {
  it('should maintain stable request/response format', () => {
    const request = {
      reason: expect.any(String),
    };

    const successResponse = {
      success: true,
      refundId: expect.stringMatching(/^re_[A-Za-z0-9]+$/),
    };

    const errorResponse = {
      error: {
        code: expect.any(String),
        message: expect.any(String),
      },
    };

    // Contract verified
  });
});
```

**6.4 E2E Tests** (`apps/web/e2e/admin-refund.spec.ts`)

```typescript
test('admin should refund purchase from dashboard', async ({ page }) => {
  // Setup: Login as admin
  await page.goto('/admin/login');
  await page.fill('[name=email]', 'admin@test.com');
  await page.fill('[name=password]', 'AdminPass123!');
  await page.click('button[type=submit]');

  // Navigate to purchases
  await page.goto('/admin/purchases');
  await expect(page.locator('h1')).toContainText('Purchases');

  // Click first purchase
  await page.click('[data-testid=purchase-row]:first-child');

  // Click refund button
  await page.click('[data-testid=refund-button]');

  // Fill refund form
  await page.fill('[name=reason]', 'Customer requested refund - dissatisfied with quality');
  await page.click('[data-testid=confirm-refund]');

  // Wait for success message
  await expect(page.locator('[data-testid=refund-success]')).toBeVisible();
  await expect(page.locator('[data-testid=refund-success]')).toContainText('Refund processed');

  // Verify purchase status updated
  await page.reload();
  await expect(page.locator('[data-testid=purchase-status]')).toContainText('Refunded');
});
```

**CI Requirements**:
- All unit tests pass (100% coverage on refund logic)
- Integration tests pass on ephemeral database
- Contract tests verify API stability
- E2E test passes with Stripe test mode
- No regression in existing tests

---

#### 7. Implementation Guide

**File Paths to Modify**:
```
packages/database/src/schema/purchases.ts           (add refund fields)
packages/database/drizzle/0002_*.sql                (generated migration)
packages/payments/src/service.ts                    (add initiateRefund method)
packages/payments/src/service.test.ts               (add refund tests)
packages/notifications/src/templates.ts             (add refund template)
packages/content-access/src/service.ts              (update checkAccess)
apps/web/src/routes/api/admin/purchases/[id]/refund/+server.ts  (new endpoint)
apps/web/tests/integration/refund.test.ts           (new integration tests)
apps/web/e2e/admin-refund.spec.ts                   (new E2E test)
```

**Code Snippets**: See Step 2 for complete service implementation

**Key Considerations**:
- Refund window: 30 days from purchase date
- Stripe refund reason: Always use `'requested_by_customer'`
- Email notification: Send to customer, not admin
- Access revocation: Automatic (via checkAccess query)
- Audit trail: Store requestedBy admin ID in Stripe metadata

---

#### 8. Definition of Done

**Functional Requirements**:
- [ ] Refund fields added to schema (refundedAt, refundReason, stripeRefundId)
- [ ] Migration applied successfully to development database
- [ ] Refund method implemented in PurchaseService
- [ ] 30-day refund window enforced
- [ ] Stripe refund API integration working
- [ ] Refund confirmation email template created
- [ ] Email sent to customer on successful refund
- [ ] Content access revoked for refunded purchases
- [ ] Admin API endpoint created and protected
- [ ] Input validation (reason >= 10 characters)
- [ ] Already-refunded prevention (idempotency)

**Test Requirements**:
- [ ] All unit tests passing (8 tests, 100% coverage on refund logic)
- [ ] Integration tests passing (refund workflow, authorization)
- [ ] Contract tests passing (API stability)
- [ ] E2E test passing (admin refund from dashboard)
- [ ] No regression in existing tests (purchases, access)

**Quality Requirements**:
- [ ] Code review approved by Payment Specialist
- [ ] Security review approved (authorization, audit logging)
- [ ] Error messages user-friendly
- [ ] Logging implemented (refund initiated, Stripe API calls, errors)
- [ ] No sensitive data logged (full payment details)

**Documentation Requirements**:
- [ ] API endpoint documented in API reference
- [ ] Admin guide updated with refund procedure
- [ ] Refund email template documented
- [ ] Error codes documented
- [ ] Refund window policy documented

**CI/CD Requirements**:
- [ ] CI pipeline passes (all checks green)
- [ ] Deployed to preview environment and manually tested
- [ ] Performance verified (refund completes in <2 seconds)
- [ ] No breaking changes to existing APIs

---

#### 9. Review Checklist

**Functionality**:
- [ ] Refund only allowed for completed purchases
- [ ] Already-refunded purchases rejected
- [ ] 30-day window enforced correctly
- [ ] Stripe refund creates correct refund object
- [ ] Database transaction used (if multi-step operation)
- [ ] Email sent after successful refund
- [ ] Access check correctly excludes refunded purchases

**Security**:
- [ ] Only platform owners can initiate refunds
- [ ] Authorization guard on API endpoint
- [ ] Input validation on reason field
- [ ] No sensitive data in error messages
- [ ] Audit trail captured (who initiated refund)
- [ ] No SQL injection vulnerabilities

**Error Handling**:
- [ ] Stripe API errors handled gracefully
- [ ] Database errors handled (network issues)
- [ ] Email send failures don't block refund
- [ ] Clear error messages for user/admin
- [ ] Errors logged with context

**Testing**:
- [ ] Edge cases covered (expired window, missing purchase, etc.)
- [ ] Happy path tested
- [ ] Error paths tested
- [ ] Integration tests realistic (actual Stripe test mode calls)
- [ ] E2E test doesn't use production Stripe keys

**Code Quality**:
- [ ] No code duplication
- [ ] Functions < 50 lines
- [ ] Clear variable names
- [ ] Comments for complex logic
- [ ] TypeScript types correct
- [ ] No `any` types used

**Performance**:
- [ ] Refund completes in < 2 seconds
- [ ] Database query optimized (single update)
- [ ] No N+1 queries
- [ ] Email sending doesn't block response

**Documentation**:
- [ ] JSDoc comments on public methods
- [ ] API endpoint documented
- [ ] Error codes listed
- [ ] Example requests/responses provided

---

## CSV Export for Spreadsheet

(See separate file: `PHASE_1_WORK_PACKETS.csv`)

---

## Summary

This roadmap provides a complete, execution-ready implementation plan for Codex Phase 1 backend. Each work packet is:

- **Self-contained**: Can be developed independently
- **Test-driven**: Tests specified before implementation
- **Documented**: Clear interfaces and examples
- **Reviewable**: Explicit checklist for reviewers
- **Parallel-ready**: Dependencies clearly stated

Teams can begin implementation immediately with minimal coordination.

---

**Document Version**: 1.0
**Last Updated**: 2025-11-05
**Maintained By**: Technical Lead
**Review Cycle**: Weekly during Phase 1 execution

