# PR #44 - Complete Updated Schema Files

**Date**: 2025-11-22
**Migration**: 0006_cloudy_blizzard.sql

---

## Updated Files Summary

### 1. packages/database/src/schema/ecommerce.ts

**Complete Updated File**:

```typescript
import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { content, organizations } from './content';
import { users } from './users';

/**
 * NOTE: This is a placeholder schema based on the needs of P1-ACCESS-001.
 * The full schema should be defined in P1-ECOM-001.
 *
 * Tracks user access to content, granted via purchase, subscription, etc.
 *
 * Aligned with database-schema.md v2.0 (lines 418-448)
 */
export const contentAccess = pgTable(
  'content_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    // Access type with CHECK constraint enforcement
    accessType: varchar('access_type', { length: 50 }).notNull(),
    // Phase 1: 'purchased', 'complimentary'
    // Phase 2: 'subscription', 'preview'

    // Access window
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // Phase 1: null (permanent access)
    // Phase 2: Can expire with subscriptions

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Indexes
    index('idx_content_access_user_id').on(table.userId),
    index('idx_content_access_content_id').on(table.contentId),
    index('idx_content_access_organization_id').on(table.organizationId),

    // CHECK constraint for access_type enum values
    check(
      'check_access_type',
      sql`${table.accessType} IN ('purchased', 'subscription', 'complimentary', 'preview')`
    ),

    // Unique constraint: one access record per user per content
    unique('content_access_user_content_unique').on(table.userId, table.contentId),
  ]
);

/**
 * NOTE: This is a placeholder schema based on the needs of P1-ACCESS-001.
 * The full schema should be defined in P1-ECOM-001.
 *
 * Records completed purchases of content.
 *
 * Aligned with database-schema.md v2.0 (lines 321-389)
 * Phase 1: Simple purchases with 100% to creator
 * Phase 2+: Revenue splitting with organization fees
 */
export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: text('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),

    // Payment (stored as integer cents to avoid rounding errors)
    amountPaidCents: integer('amount_paid_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('usd'),

    // Stripe reference for payment reconciliation
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 })
      .notNull()
      .unique(),

    // Status with CHECK constraint enforcement
    status: varchar('status', { length: 50 }).notNull(),
    // 'pending', 'completed', 'refunded', 'failed'

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Indexes
    index('idx_purchases_customer_id').on(table.customerId),
    index('idx_purchases_content_id').on(table.contentId),
    index('idx_purchases_organization_id').on(table.organizationId),
    index('idx_purchases_stripe_payment_intent').on(table.stripePaymentIntentId),
    index('idx_purchases_created_at').on(table.createdAt),

    // CHECK constraint for status enum values
    check(
      'check_purchase_status',
      sql`${table.status} IN ('pending', 'completed', 'refunded', 'failed')`
    ),

    // CHECK constraint for positive amounts
    check('check_amount_positive', sql`${table.amountPaidCents} >= 0`),
  ]
);

// Relations
export const contentAccessRelations = relations(contentAccess, ({ one }) => ({
  user: one(users, {
    fields: [contentAccess.userId],
    references: [users.id],
  }),
  content: one(content, {
    fields: [contentAccess.contentId],
    references: [content.id],
  }),
  organization: one(organizations, {
    fields: [contentAccess.organizationId],
    references: [organizations.id],
  }),
}));

export const purchasesRelations = relations(purchases, ({ one }) => ({
  customer: one(users, {
    fields: [purchases.customerId],
    references: [users.id],
  }),
  content: one(content, {
    fields: [purchases.contentId],
    references: [content.id],
  }),
  organization: one(organizations, {
    fields: [purchases.organizationId],
    references: [organizations.id],
  }),
}));

// Type exports for type safety
export type ContentAccess = typeof contentAccess.$inferSelect;
export type NewContentAccess = typeof contentAccess.$inferInsert;

export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;
```

**Key Changes**:
- ✅ Added `organizationId` to both tables
- ✅ Added CHECK constraints for enum fields
- ✅ Added `stripePaymentIntentId` with unique constraint
- ✅ Added `currency` field with default 'usd'
- ✅ Added `updatedAt` to both tables
- ✅ Added `expiresAt` to content_access
- ✅ Added proper indexes
- ✅ Added type exports
- ✅ Updated relations to include organization

---

### 2. packages/database/src/schema/playback.ts

**Complete Updated File**:

```typescript
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { content } from './content';
import { users } from './users';

/**
 * Tracks video playback progress for resume functionality
 *
 * Design decisions:
 * - Composite unique key (user_id + content_id) for upsert pattern
 * - Progress in seconds (not percentage) for accuracy
 * - completed flag set when user watches >= 95% of video
 * - Aligned with database-schema.md v2.0 (lines 465-497)
 *
 * Business rules:
 * - Update every 30 seconds during playback (frontend responsibility)
 * - Auto-complete when position >= 95% of duration
 * - No cleanup (historical record useful for analytics)
 */
export const videoPlayback = pgTable(
  'video_playback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentId: uuid('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),

    // Playback state
    positionSeconds: integer('position_seconds').notNull().default(0),
    durationSeconds: integer('duration_seconds').notNull(),
    completed: boolean('completed').notNull().default(false), // Watched >= 95%

    // Timestamps
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // One playback record per user per video
    userContentUnique: unique().on(table.userId, table.contentId),

    // Indexes for common queries
    userIdIdx: index('idx_video_playback_user_id').on(table.userId),
    contentIdIdx: index('idx_video_playback_content_id').on(table.contentId),
  })
);

export const videoPlaybackRelations = relations(videoPlayback, ({ one }) => ({
  user: one(users, {
    fields: [videoPlayback.userId],
    references: [users.id],
  }),
  content: one(content, {
    fields: [videoPlayback.contentId],
    references: [content.id],
  }),
}));

export type VideoPlayback = typeof videoPlayback.$inferSelect;
export type NewVideoPlayback = typeof videoPlayback.$inferInsert;
```

**Key Changes**:
- ✅ Fixed timestamp consistency: both timestamps now use `withTimezone: true`

---

### 3. packages/database/src/migrations/0006_cloudy_blizzard.sql

**Complete Migration File**:

```sql
ALTER TABLE "video_playback" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;
ALTER TABLE "video_playback" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "video_playback" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;
ALTER TABLE "video_playback" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "content_access" ADD COLUMN "organization_id" uuid NOT NULL;
ALTER TABLE "content_access" ADD COLUMN "expires_at" timestamp with time zone;
ALTER TABLE "content_access" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "purchases" ADD COLUMN "organization_id" uuid NOT NULL;
ALTER TABLE "purchases" ADD COLUMN "currency" varchar(3) DEFAULT 'usd' NOT NULL;
ALTER TABLE "purchases" ADD COLUMN "stripe_payment_intent_id" varchar(255) NOT NULL;
ALTER TABLE "purchases" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "content_access" ADD CONSTRAINT "content_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
CREATE INDEX "idx_content_access_organization_id" ON "content_access" USING btree ("organization_id");
CREATE INDEX "idx_purchases_organization_id" ON "purchases" USING btree ("organization_id");
CREATE INDEX "idx_purchases_stripe_payment_intent" ON "purchases" USING btree ("stripe_payment_intent_id");
CREATE INDEX "idx_purchases_created_at" ON "purchases" USING btree ("created_at");
ALTER TABLE "content_access" ADD CONSTRAINT "content_access_user_content_unique" UNIQUE("user_id","content_id");
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id");
ALTER TABLE "content_access" ADD CONSTRAINT "check_access_type" CHECK ("content_access"."access_type" IN ('purchased', 'subscription', 'complimentary', 'preview'));
ALTER TABLE "purchases" ADD CONSTRAINT "check_purchase_status" CHECK ("purchases"."status" IN ('pending', 'completed', 'refunded', 'failed'));
ALTER TABLE "purchases" ADD CONSTRAINT "check_amount_positive" CHECK ("purchases"."amount_paid_cents" >= 0);
```

---

## Schema Comparison

### content_access Table

#### Before (0005_bent_inhumans.sql)
```sql
CREATE TABLE "content_access" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "content_id" uuid NOT NULL,
  "access_type" varchar(50) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

#### After (0006_cloudy_blizzard.sql applied)
```sql
CREATE TABLE "content_access" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "content_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,                              -- NEW
  "access_type" varchar(50) NOT NULL,
  "expires_at" timestamp with time zone,                        -- NEW
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL, -- NEW
  CONSTRAINT "content_access_user_content_unique" UNIQUE("user_id","content_id"), -- NEW
  CONSTRAINT "check_access_type" CHECK ("content_access"."access_type" IN ('purchased', 'subscription', 'complimentary', 'preview')) -- NEW
);
```

---

### purchases Table

#### Before (0005_bent_inhumans.sql)
```sql
CREATE TABLE "purchases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" text NOT NULL,
  "content_id" uuid NOT NULL,
  "status" varchar(50) NOT NULL,
  "amount_paid_cents" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

#### After (0006_cloudy_blizzard.sql applied)
```sql
CREATE TABLE "purchases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" text NOT NULL,
  "content_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,                                          -- NEW
  "status" varchar(50) NOT NULL,
  "amount_paid_cents" integer NOT NULL,
  "currency" varchar(3) DEFAULT 'usd' NOT NULL,                             -- NEW
  "stripe_payment_intent_id" varchar(255) NOT NULL UNIQUE,                  -- NEW
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,             -- NEW
  CONSTRAINT "check_purchase_status" CHECK ("purchases"."status" IN ('pending', 'completed', 'refunded', 'failed')), -- NEW
  CONSTRAINT "check_amount_positive" CHECK ("purchases"."amount_paid_cents" >= 0) -- NEW
);
```

---

### video_playback Table

#### Before (0005_bent_inhumans.sql)
```sql
CREATE TABLE "video_playback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "content_id" uuid NOT NULL,
  "position_seconds" integer DEFAULT 0 NOT NULL,
  "duration_seconds" integer NOT NULL,
  "completed" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,           -- NO TIMEZONE
  "created_at" timestamp DEFAULT now() NOT NULL,           -- NO TIMEZONE
  CONSTRAINT "video_playback_user_id_content_id_unique" UNIQUE("user_id","content_id")
);
```

#### After (0006_cloudy_blizzard.sql applied)
```sql
CREATE TABLE "video_playback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "content_id" uuid NOT NULL,
  "position_seconds" integer DEFAULT 0 NOT NULL,
  "duration_seconds" integer NOT NULL,
  "completed" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,  -- FIXED
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,  -- FIXED
  CONSTRAINT "video_playback_user_id_content_id_unique" UNIQUE("user_id","content_id")
);
```

---

## Type Exports Available

### From ecommerce.ts

```typescript
// Select types (database read)
type ContentAccess = {
  id: string;
  userId: string;
  contentId: string;
  organizationId: string;
  accessType: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type Purchase = {
  id: string;
  customerId: string;
  contentId: string;
  organizationId: string;
  amountPaidCents: number;
  currency: string;
  stripePaymentIntentId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

// Insert types (database write)
type NewContentAccess = {
  id?: string;
  userId: string;
  contentId: string;
  organizationId: string;
  accessType: string;
  expiresAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

type NewPurchase = {
  id?: string;
  customerId: string;
  contentId: string;
  organizationId: string;
  amountPaidCents: number;
  currency?: string; // defaults to 'usd'
  stripePaymentIntentId: string;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
};
```

### From playback.ts

```typescript
type VideoPlayback = {
  id: string;
  userId: string;
  contentId: string;
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  updatedAt: Date;
  createdAt: Date;
};

type NewVideoPlayback = {
  id?: string;
  userId: string;
  contentId: string;
  positionSeconds?: number; // defaults to 0
  durationSeconds: number;
  completed?: boolean; // defaults to false
  updatedAt?: Date;
  createdAt?: Date;
};
```

---

## Usage Examples

### Creating a Purchase

```typescript
import { db } from '@codex/database';
import { purchases, type NewPurchase } from '@codex/database/schema';

const newPurchase: NewPurchase = {
  customerId: user.id,
  contentId: content.id,
  organizationId: content.organizationId, // REQUIRED
  amountPaidCents: 1000,
  status: 'completed',
  stripePaymentIntentId: 'pi_123456789', // REQUIRED
  currency: 'usd', // Optional, defaults to 'usd'
};

const [purchase] = await db.insert(purchases).values(newPurchase).returning();
```

### Granting Content Access

```typescript
import { db } from '@codex/database';
import { contentAccess, type NewContentAccess } from '@codex/database/schema';

const newAccess: NewContentAccess = {
  userId: user.id,
  contentId: content.id,
  organizationId: content.organizationId, // REQUIRED
  accessType: 'purchased',
  expiresAt: null, // Permanent access for Phase 1
};

const [access] = await db.insert(contentAccess).values(newAccess).returning();
```

### Querying Organization Purchases

```typescript
import { db } from '@codex/database';
import { purchases } from '@codex/database/schema';
import { eq } from 'drizzle-orm';

// Direct organization filter (fast!)
const orgPurchases = await db
  .select()
  .from(purchases)
  .where(eq(purchases.organizationId, organization.id));
```

### Checking Valid Enum Values

```typescript
// TypeScript level (application validation)
const validAccessTypes = ['purchased', 'subscription', 'complimentary', 'preview'] as const;
type AccessType = typeof validAccessTypes[number];

// Database level (CHECK constraint)
// Attempting to insert invalid value will fail:
await db.insert(contentAccess).values({
  accessType: 'invalid_type', // ❌ Database will reject
});
// Error: new row for relation "content_access" violates check constraint "check_access_type"
```

---

## Summary

All HIGH and MEDIUM severity issues from PR #44 database review have been successfully resolved:

✅ **Multi-tenancy**: organization_id on all tenant data tables
✅ **CHECK constraints**: Database-level enum enforcement
✅ **Type exports**: Type-safe queries and inserts
✅ **Stripe integration**: payment_intent_id for reconciliation
✅ **Currency support**: Future-proofed for international payments
✅ **Timestamp consistency**: All tables use timezone-aware timestamps
✅ **Access expiration**: expires_at field for future subscriptions
✅ **Proper indexes**: All foreign keys and common query patterns indexed
✅ **Unique constraints**: Prevents duplicate records

**Migration**: 0006_cloudy_blizzard.sql
**Status**: ✅ Ready for review and testing
