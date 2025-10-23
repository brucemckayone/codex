# Code Structure

## Overview

This project uses a **feature-based organization** approach within a pnpm workspace monorepo. Code is organized by domain/feature rather than technical type, making it easier to understand, maintain, and scale the application.

## Monorepo Structure

```
Codex/
├── apps/
│   └── web/                    # SvelteKit application
├── workers/
│   ├── queue-consumer/         # Queue processing worker
│   └── webhook-handler/        # Webhook handling worker
├── packages/
│   ├── database/               # Shared database schema & client
│   ├── validation/             # Shared Zod schemas
│   ├── core-services/          # Shared business logic services
│   └── cloudflare-clients/     # Shared Cloudflare service clients (R2, KV)
├── scripts/                    # Build & deployment scripts
└── infrastructure/             # Docker Compose, etc.
```

### Why These Packages?

**packages/database** - Database schema and client (existing)
**packages/validation** - Validation schemas (existing)
**packages/core-services** - Shared business logic used by app + workers
**packages/cloudflare-clients** - Cloudflare service clients (R2, KV) used everywhere

## Shared Packages

### packages/database

**Purpose**: Single source of truth for database schema, migrations, and database client. Shared across SvelteKit app and all workers.

```
packages/database/
├── package.json
├── tsconfig.json
├── drizzle.config.ts          # Drizzle configuration
├── src/
│   ├── index.ts               # Exports client & schema
│   ├── client.ts              # Database client factory
│   ├── schema/
│   │   ├── index.ts           # Export all schemas
│   │   ├── users.ts           # User tables
│   │   ├── subscriptions.ts   # Subscription tables
│   │   ├── videos.ts          # Video tables
│   │   └── ...                # Other domain schemas
│   └── migrations/
│       ├── 0001_create_users.sql
│       ├── 0002_create_subscriptions.sql
│       └── ...
└── README.md
```

**Usage Example**:
```typescript
// In any app or worker
import { db, schema } from '@codex/database';

// Query users
const users = await db.select().from(schema.users);
```

**Key Points**:
- ONE shared Drizzle client usable in server, app, and workers
- Migrations managed centrally via Drizzle Kit
- Schema definitions organized by domain
- No database code in the web app itself

### packages/validation

**Purpose**: Shared Zod schemas for request/response validation. Used across frontend, backend, and workers.

```
packages/validation/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts               # Export all schemas
│   ├── auth.ts                # Auth-related schemas
│   ├── subscription.ts        # Subscription schemas
│   ├── video.ts               # Video schemas
│   └── ...                    # Other domain schemas
└── README.md
```

**Usage Example**:
```typescript
// In API route
import { createVideoSchema } from '@codex/validation';

export async function POST({ request }) {
  const data = await request.json();
  const validated = createVideoSchema.parse(data);
  // ...
}
```

**Key Points**:
- Type-safe validation shared everywhere
- Single source of truth for data shapes
- Used for API validation, form validation, worker payloads
- Automatic TypeScript types from Zod schemas

### packages/cloudflare-clients

**Purpose**: Shared client implementations for Cloudflare services (R2, KV). Used across SvelteKit app and all workers.

```
packages/cloudflare-clients/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts               # Export all clients
│   ├── r2/
│   │   ├── index.ts           # Export R2 client
│   │   ├── client.ts          # R2 client implementation
│   │   ├── types.ts           # R2-specific types
│   │   └── utils.ts           # R2 helper functions
│   ├── kv/
│   │   ├── index.ts           # Export KV client
│   │   ├── client.ts          # KV client implementation
│   │   └── types.ts           # KV-specific types
│   └── types/
│       └── common.types.ts    # Common Cloudflare types
└── README.md
```

**Why Separate from core-services?**
- Cloudflare clients are **infrastructure/platform-specific**
- Core services contain **business logic** (domain-specific)
- Clear separation allows easier migration if needed
- Different dependency requirements (Cloudflare bindings vs business logic)

**Usage Example**:
```typescript
// In any app or worker
import { R2Client, KVClient } from '@codex/cloudflare-clients';

// Initialize R2 client with environment bindings
const r2 = new R2Client({
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY
});

// Upload file
await r2.uploadFile('bucket-name', 'path/to/file.mp4', buffer);

// Generate signed URL
const signedUrl = await r2.getSignedUrl('bucket-name', 'path/to/file.mp4', 3600);
```

**Key Services**:
- **R2Client**: Upload, download, delete, generate signed URLs
- **KVClient**: Get, put, delete with TTL support

**Used By**:
- Content Management (logo, media uploads)
- Media Transcoding (video/audio processing)
- Content Access (signed URL generation)
- Platform Settings (logo storage, theme caching)
- Queue Consumer Worker (processing jobs)
- Webhook Handler Worker (status updates)

### packages/core-services

**Purpose**: Shared business logic services that operate on data and implement domain rules. Used by SvelteKit app and workers.

```
packages/core-services/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts               # Export all services
│   ├── purchases/
│   │   ├── index.ts           # Export service
│   │   ├── service.ts         # PurchasesService implementation
│   │   ├── types.ts           # Purchase-specific types
│   │   └── utils.ts           # Purchase helper functions
│   ├── content-access/
│   │   ├── index.ts           # Export service
│   │   ├── service.ts         # ContentAccessService implementation
│   │   ├── types.ts           # Access-specific types
│   │   └── utils.ts           # Access helper functions
│   ├── platform-settings/
│   │   ├── index.ts           # Export service
│   │   ├── service.ts         # PlatformSettingsService implementation
│   │   ├── theme-generator.ts # Theme generation logic
│   │   ├── color-utils.ts     # Color conversion utilities
│   │   ├── contrast-utils.ts  # WCAG contrast checking
│   │   └── types.ts           # Settings-specific types
│   └── shared/
│       ├── errors/
│       │   ├── base-error.ts
│       │   ├── payment-error.ts
│       │   └── access-error.ts
│       └── utils/
│           ├── date.ts
│           └── currency.ts
└── README.md
```

**Why These Services Are Shared**:

1. **PurchasesService** - Used by:
   - SvelteKit app (purchase flow, admin dashboard)
   - Webhook Handler Worker (Stripe webhook processing)

2. **ContentAccessService** - Used by:
   - SvelteKit app (access control, content delivery)
   - E-Commerce feature (granting access after purchase)
   - Admin Dashboard (manual access grants)

3. **PlatformSettingsService** - Used by:
   - SvelteKit app (settings management, theme loading)
   - Future: Workers may need platform settings for email templates

**Usage Example**:
```typescript
// In SvelteKit app or worker
import { PurchasesService, ContentAccessService } from '@codex/core-services';
import { db } from '@codex/database';

// Initialize services with dependencies
const purchasesService = new PurchasesService(db);
const accessService = new ContentAccessService(db);

// Use in webhook handler (worker)
async function handleStripeWebhook(event) {
  // Create purchase record
  const purchase = await purchasesService.createPurchase({
    customerId: event.metadata.user_id,
    itemId: event.metadata.content_id,
    itemType: 'content',
    amount: event.amount_total
  });

  // Grant access to content
  await accessService.grantAccess(
    purchase.customerId,
    purchase.itemId,
    purchase.itemType
  );
}
```

**Key Interfaces** (detailed in each service):

```typescript
// packages/core-services/src/purchases/service.ts
export interface IPurchasesService {
  createPurchase(data: CreatePurchaseData): Promise<Purchase>;
  getPurchase(id: string): Promise<Purchase | null>;
  getCustomerPurchases(customerId: string): Promise<Purchase[]>;
  refundPurchase(id: string): Promise<Purchase>;
  grantFreeItemAccess(customerId: string, itemId: string, itemType: string): Promise<Purchase>;
}

// packages/core-services/src/content-access/service.ts
export interface IContentAccessService {
  checkAccess(userId: string, itemId: string, itemType: string): Promise<boolean>;
  grantAccess(userId: string, itemId: string, itemType: string): Promise<void>;
  revokeAccess(userId: string, itemId: string, itemType: string): Promise<void>;
  getSignedMediaStreamUrl(userId: string, mediaItemId: string): Promise<string>;
  savePlaybackProgress(userId: string, mediaItemId: string, position: number, duration: number): Promise<void>;
  getPlaybackProgress(userId: string, mediaItemId: string): Promise<number>;
}

// packages/core-services/src/platform-settings/service.ts
export interface IPlatformSettingsService {
  getSettings(ownerId: string): Promise<PlatformSettings | null>;
  updateSettings(ownerId: string, updates: PlatformSettingsUpdate): Promise<PlatformSettings>;
  generateTheme(primaryColorHex: string): ThemeColors;
  uploadLogo(ownerId: string, file: ArrayBuffer, filename: string): Promise<string>;
  deleteLogo(logoUrl: string): Promise<void>;
  cacheTheme(ownerId: string, theme: ThemeColors): Promise<void>;
  getCachedTheme(ownerId: string): Promise<ThemeColors | null>;
}
```

**Dependencies**:
- `@codex/database` - For database operations
- `@codex/validation` - For input validation
- `@codex/cloudflare-clients` - For R2/KV operations

**Key Points**:
- Pure business logic, no framework-specific code
- Dependency injection for testability
- Consistent error handling (custom error classes)
- Interfaces for all services
- Stateless (no instance state beyond injected dependencies)

## SvelteKit App Structure (apps/web)

### Feature-Based Organization

```
apps/web/
├── src/
│   ├── lib/
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   │   ├── components/
│   │   │   │   │   ├── LoginForm.svelte
│   │   │   │   │   ├── SignupForm.svelte
│   │   │   │   │   └── PasswordReset.svelte
│   │   │   │   ├── services/
│   │   │   │   │   └── auth.service.ts
│   │   │   │   ├── stores/
│   │   │   │   │   └── user.store.ts
│   │   │   │   ├── types/
│   │   │   │   │   └── auth.types.ts
│   │   │   │   └── utils/
│   │   │   │       └── token.utils.ts
│   │   │   │
│   │   │   ├── subscription/
│   │   │   │   ├── components/
│   │   │   │   │   ├── PricingCard.svelte
│   │   │   │   │   ├── SubscriptionStatus.svelte
│   │   │   │   │   └── UpgradeModal.svelte
│   │   │   │   ├── services/
│   │   │   │   │   └── subscription.service.ts
│   │   │   │   ├── stores/
│   │   │   │   │   └── subscription.store.ts
│   │   │   │   └── types/
│   │   │   │       └── subscription.types.ts
│   │   │   │
│   │   │   ├── video/
│   │   │   │   ├── components/
│   │   │   │   │   ├── VideoPlayer.svelte
│   │   │   │   │   ├── VideoUpload.svelte
│   │   │   │   │   ├── VideoList.svelte
│   │   │   │   │   └── VideoCard.svelte
│   │   │   │   ├── services/
│   │   │   │   │   ├── video.service.ts
│   │   │   │   │   └── upload.service.ts
│   │   │   │   ├── stores/
│   │   │   │   │   └── video.store.ts
│   │   │   │   ├── types/
│   │   │   │   │   └── video.types.ts
│   │   │   │   └── utils/
│   │   │   │       └── video.utils.ts
│   │   │   │
│   │   │   └── shared/
│   │   │       ├── components/
│   │   │       │   ├── Button.svelte
│   │   │       │   ├── Modal.svelte
│   │   │       │   ├── Toast.svelte
│   │   │       │   └── Spinner.svelte
│   │   │       ├── utils/
│   │   │       │   ├── format.ts
│   │   │       │   ├── date.ts
│   │   │       │   └── api.ts
│   │   │       └── types/
│   │   │           └── common.types.ts
│   │   │
│   │   └── tests/                  # Test utilities only
│   │       ├── fixtures/
│   │       ├── mocks/
│   │       └── utils/
│   │
│   └── routes/
│       ├── (auth)/
│       │   ├── login/
│       │   │   └── +page.svelte    # Uses auth feature
│       │   └── signup/
│       │       └── +page.svelte    # Uses auth feature
│       │
│       ├── (app)/
│       │   ├── dashboard/
│       │   │   └── +page.svelte    # Uses multiple features
│       │   ├── videos/
│       │   │   ├── +page.svelte    # Uses video feature
│       │   │   └── [id]/
│       │   │       └── +page.svelte # Uses video feature
│       │   └── subscription/
│       │       └── +page.svelte    # Uses subscription feature
│       │
│       └── api/
│           ├── auth/
│           │   └── +server.ts      # Uses auth services
│           ├── videos/
│           │   └── +server.ts      # Uses video services
│           └── subscription/
│               └── +server.ts      # Uses subscription services
│
├── static/                         # Public assets (favicon, robots.txt)
└── tests/
    ├── e2e/                        # Playwright E2E tests
    │   ├── auth.spec.ts
    │   ├── subscription.spec.ts
    │   └── video.spec.ts
    └── integration/                # Integration tests
        ├── api/
        │   ├── auth.test.ts
        │   └── videos.test.ts
        └── features/
            └── video/
                └── upload.test.ts
```

### Feature Structure Explained

Each feature follows this pattern:

```
feature-name/
├── components/        # Svelte components for this feature
├── services/         # Business logic & API calls
├── stores/           # Svelte stores for state management
├── types/            # TypeScript types specific to feature
└── utils/            # Helper functions for this feature
```

**Key Points**:
- Everything related to a feature lives together
- Easy to find and modify feature code
- Components are feature-specific, not generic
- Services handle all business logic and API interactions
- Stores manage feature state (using Svelte stores)
- Routes import from features as needed

### State Management in Features

State is managed using **Svelte stores** within each feature:

```typescript
// lib/features/video/stores/video.store.ts
import { writable, derived } from 'svelte/store';
import type { Video } from '@codex/validation';

function createVideoStore() {
  const { subscribe, set, update } = writable<Video[]>([]);

  return {
    subscribe,
    setVideos: (videos: Video[]) => set(videos),
    addVideo: (video: Video) => update(videos => [...videos, video]),
    removeVideo: (id: string) => update(videos =>
      videos.filter(v => v.id !== id)
    ),
  };
}

export const videos = createVideoStore();
export const videoCount = derived(videos, $videos => $videos.length);
```

**Usage in components**:
```svelte
<!-- lib/features/video/components/VideoList.svelte -->
<script lang="ts">
  import { videos } from '../stores/video.store';
</script>

{#each $videos as video}
  <VideoCard {video} />
{/each}
```

**Key Points**:
- State encapsulated in feature stores
- Stores can be composed and derived
- Shared across all components in the feature
- No global state pollution

### Test Organization

Tests are **feature-scoped** but live separately to avoid cluttering feature folders:

```
apps/web/
├── src/lib/features/
│   └── video/
│       ├── components/
│       ├── services/
│       └── stores/
│
└── tests/
    ├── unit/
    │   └── features/
    │       └── video/
    │           ├── services.test.ts
    │           ├── stores.test.ts
    │           └── utils.test.ts
    │
    ├── integration/
    │   └── features/
    │       └── video/
    │           └── upload-flow.test.ts
    │
    └── e2e/
        └── video.spec.ts
```

**Key Points**:
- Tests mirror feature structure but live in `tests/`
- Unit tests for services, stores, utils
- Integration tests for feature flows
- E2E tests for user journeys
- NO full structure reflection - only test what matters

## Worker Structure

Workers are also feature-based but simpler:

```
workers/queue-consumer/
├── src/
│   ├── index.ts                # Main entry point
│   ├── features/
│   │   ├── video-processing/
│   │   │   ├── handlers/
│   │   │   │   ├── transcode.handler.ts
│   │   │   │   └── thumbnail.handler.ts
│   │   │   ├── services/
│   │   │   │   └── runpod.service.ts
│   │   │   └── types/
│   │   │       └── processing.types.ts
│   │   │
│   │   ├── notifications/
│   │   │   ├── handlers/
│   │   │   │   └── email.handler.ts
│   │   │   └── services/
│   │   │       └── resend.service.ts
│   │   │
│   │   └── shared/
│   │       └── utils/
│   │           └── queue.utils.ts
│   │
│   └── tests/
│       └── features/
│           └── video-processing/
│               └── transcode.test.ts
│
├── wrangler.toml
└── package.json
```

**Key Points**:
- Handlers process queue messages
- Services interact with external APIs
- Uses `@codex/database` for database access
- Uses `@codex/validation` for payload validation
- No state management needed (stateless workers)

## Adding a New Feature

### 1. Create Feature Structure

```bash
# In apps/web/src/lib/features/
mkdir -p new-feature/{components,services,stores,types,utils}
```

### 2. Create Core Files

```typescript
// features/new-feature/types/new-feature.types.ts
export interface NewFeature {
  id: string;
  name: string;
}

// features/new-feature/services/new-feature.service.ts
import type { NewFeature } from '../types/new-feature.types';

export async function fetchNewFeatures(): Promise<NewFeature[]> {
  const res = await fetch('/api/new-feature');
  return res.json();
}

// features/new-feature/stores/new-feature.store.ts
import { writable } from 'svelte/store';
import type { NewFeature } from '../types/new-feature.types';

export const newFeatures = writable<NewFeature[]>([]);

// features/new-feature/components/NewFeatureCard.svelte
<script lang="ts">
  import type { NewFeature } from '../types/new-feature.types';
  export let feature: NewFeature;
</script>

<div>{feature.name}</div>
```

### 3. Create Route

```svelte
<!-- routes/new-feature/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { newFeatures } from '$lib/features/new-feature/stores/new-feature.store';
  import { fetchNewFeatures } from '$lib/features/new-feature/services/new-feature.service';
  import NewFeatureCard from '$lib/features/new-feature/components/NewFeatureCard.svelte';

  onMount(async () => {
    const features = await fetchNewFeatures();
    $newFeatures = features;
  });
</script>

{#each $newFeatures as feature}
  <NewFeatureCard {feature} />
{/each}
```

### 4. Create API Route (if needed)

```typescript
// routes/api/new-feature/+server.ts
import { json } from '@sveltejs/kit';
import { db, schema } from '@codex/database';
import { newFeatureSchema } from '@codex/validation';

export async function GET() {
  const features = await db.select().from(schema.newFeatures);
  return json(features);
}

export async function POST({ request }) {
  const data = await request.json();
  const validated = newFeatureSchema.parse(data);

  const [feature] = await db.insert(schema.newFeatures)
    .values(validated)
    .returning();

  return json(feature);
}
```

### 5. Add Database Schema (if needed)

```typescript
// packages/database/src/schema/new-features.ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const newFeatures = pgTable('new_features', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### 6. Add Validation Schema (if needed)

```typescript
// packages/validation/src/new-feature.ts
import { z } from 'zod';

export const newFeatureSchema = z.object({
  name: z.string().min(1).max(255),
});

export type NewFeature = z.infer<typeof newFeatureSchema>;
```

### 7. Add Tests

```typescript
// tests/unit/features/new-feature/services.test.ts
import { describe, it, expect } from 'vitest';
import { fetchNewFeatures } from '$lib/features/new-feature/services/new-feature.service';

describe('fetchNewFeatures', () => {
  it('fetches features from API', async () => {
    // Test implementation
  });
});
```

## Import Patterns

### Absolute Imports in SvelteKit App

```typescript
// Use $lib alias for app-specific imports
import { Button } from '$lib/features/shared/components/Button.svelte';
import { videos } from '$lib/features/video/stores/video.store';
import { fetchVideos } from '$lib/features/video/services/video.service';

// Use package imports for shared packages
import { db, schema } from '@codex/database';
import { videoSchema } from '@codex/validation';
import { R2Client, KVClient } from '@codex/cloudflare-clients';
import { PurchasesService, ContentAccessService } from '@codex/core-services';
```

### Imports in Workers

```typescript
// Package imports
import { db, schema } from '@codex/database';
import { videoProcessingSchema } from '@codex/validation';
import { R2Client } from '@codex/cloudflare-clients';
import { PurchasesService } from '@codex/core-services';

// Relative imports within worker
import { transcodeVideo } from './features/video-processing/handlers/transcode.handler';
```

### Import Rules

1. **Shared packages** (`@codex/*`): Use for code shared across apps and workers
2. **App-specific** (`$lib/*`): Use only within SvelteKit app
3. **Worker-specific** (relative): Use only within specific worker
4. **Never** import from `apps/web` in workers or vice versa

## Key Principles

1. **Feature-Based**: Group by domain, not technical type
2. **Shared Packages**: Database, validation, services, and clients are shared
3. **Single Database Client**: One Drizzle client for all services
4. **Type Safety**: Zod schemas provide runtime validation and TypeScript types
5. **Test Separation**: Tests live separately but mirror feature structure
6. **State Encapsulation**: Each feature manages its own state via stores
7. **No Database in Web App**: All schema/migrations in `packages/database`
8. **Component Specificity**: Components belong to features, not generic "components" folder
9. **Clear Boundaries**: Infrastructure (Cloudflare) separate from business logic (core services)
10. **Dependency Injection**: Services accept dependencies for testability

---

## Migration Strategy: Moving to Shared Packages

Based on [phase-1-design-review.md](../phase-1-design-review.md), here's the migration plan for existing services:

### Step 1: Create New Packages

```bash
# Create package directories
mkdir -p packages/cloudflare-clients/src/{r2,kv,types}
mkdir -p packages/core-services/src/{purchases,content-access,platform-settings,shared}
```

### Step 2: Move R2Service to cloudflare-clients

**From**: `apps/web/src/lib/server/r2/service.ts`
**To**: `packages/cloudflare-clients/src/r2/client.ts`

**Update imports in**:
- Content Management TDD
- Media Transcoding TDD
- Content Access TDD
- Platform Settings TDD

**New import**:
```typescript
import { R2Client } from '@codex/cloudflare-clients';
```

### Step 3: Move PurchasesService to core-services

**From**: `apps/web/src/lib/server/purchases/service.ts`
**To**: `packages/core-services/src/purchases/service.ts`

**Update imports in**:
- E-Commerce feature (SvelteKit app)
- Webhook Handler Worker
- Admin Dashboard feature

**New import**:
```typescript
import { PurchasesService } from '@codex/core-services';
```

### Step 4: Move ContentAccessService to core-services

**From**: `apps/web/src/lib/server/content-access/service.ts`
**To**: `packages/core-services/src/content-access/service.ts`

**Add missing `grantAccess` method** (currently only `checkAccess` exists)

**Update imports in**:
- Content Access feature
- E-Commerce feature (for granting access)
- Admin Dashboard feature (manual grants)

**New import**:
```typescript
import { ContentAccessService } from '@codex/core-services';
```

### Step 5: Move PlatformSettingsService to core-services

**From**: `apps/web/src/lib/server/platform-settings/service.ts`
**To**: `packages/core-services/src/platform-settings/service.ts`

**Also move**:
- `theme-generator.ts`
- `color-utils.ts`
- `contrast-utils.ts`

**Update imports in**:
- Platform Settings feature
- Root layout (theme loading)
- Admin Dashboard (settings display)

**New import**:
```typescript
import { PlatformSettingsService } from '@codex/core-services';
```

### Step 6: Update Package.json Files

**Root `package.json`** (workspace configuration):
```json
{
  "workspaces": [
    "apps/*",
    "workers/*",
    "packages/*"
  ]
}
```

**`packages/cloudflare-clients/package.json`**:
```json
{
  "name": "@codex/cloudflare-clients",
  "version": "0.1.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "@aws-sdk/client-s3": "^3.x",
    "@aws-sdk/s3-request-presigner": "^3.x"
  }
}
```

**`packages/core-services/package.json`**:
```json
{
  "name": "@codex/core-services",
  "version": "0.1.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "@codex/database": "workspace:*",
    "@codex/validation": "workspace:*",
    "@codex/cloudflare-clients": "workspace:*"
  }
}
```

### Step 7: Update TDD Documents

Update the following TDDs with new import paths:

- [x] Content Management TDD - Update R2Service imports
- [x] Media Transcoding TDD - Update R2Service imports
- [x] E-Commerce TDD - Update PurchasesService location
- [x] Content Access TDD - Update R2Service and add grantAccess method
- [x] Admin Dashboard TDD - Update service imports
- [x] Platform Settings TDD - Update service location

### Migration Checklist

- [ ] Create `packages/cloudflare-clients` package
- [ ] Create `packages/core-services` package
- [ ] Move R2Service → `cloudflare-clients/r2`
- [ ] Move KV utilities → `cloudflare-clients/kv`
- [ ] Move PurchasesService → `core-services/purchases`
- [ ] Move ContentAccessService → `core-services/content-access`
- [ ] Add `grantAccess` method to ContentAccessService
- [ ] Move PlatformSettingsService → `core-services/platform-settings`
- [ ] Update all import statements across codebase
- [ ] Run tests to verify no broken imports
- [ ] Update all relevant TDD documents

### Benefits After Migration

✅ **No Code Duplication**: Services shared across app and workers
✅ **Clear Dependencies**: Business logic separate from infrastructure
✅ **Better Testing**: Services can be tested in isolation
✅ **Easier Maintenance**: Change service once, updates everywhere
✅ **Worker Access**: Webhook handler can use same PurchasesService
✅ **Type Safety**: Full TypeScript support across packages
✅ **Future-Proof**: Ready for Phase 3 multi-tenant expansion