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
│   └── validation/             # Shared Zod schemas
├── scripts/                    # Build & deployment scripts
└── infrastructure/             # Docker Compose, etc.
```

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
// Use $lib alias for internal imports
import { Button } from '$lib/features/shared/components/Button.svelte';
import { videos } from '$lib/features/video/stores/video.store';
import { fetchVideos } from '$lib/features/video/services/video.service';

// Use package imports for shared packages
import { db, schema } from '@codex/database';
import { videoSchema } from '@codex/validation';
```

### Imports in Workers

```typescript
// Package imports
import { db, schema } from '@codex/database';
import { videoProcessingSchema } from '@codex/validation';

// Relative imports within worker
import { transcodeVideo } from './features/video-processing/services/runpod.service';
```

## Key Principles

1. **Feature-Based**: Group by domain, not technical type
2. **Shared Packages**: Database and validation are shared, not duplicated
3. **Single Database Client**: One Drizzle client for all services
4. **Type Safety**: Zod schemas provide runtime validation and TypeScript types
5. **Test Separation**: Tests live separately but mirror feature structure
6. **State Encapsulation**: Each feature manages its own state via stores
7. **No Database in Web App**: All schema/migrations in `packages/database`
8. **Component Specificity**: Components belong to features, not generic "components" folder