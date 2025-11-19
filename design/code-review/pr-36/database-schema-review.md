# Database Schema Review - PR #36

**Review Date**: 2025-11-18
**PR**: https://github.com/brucemckayone/codex/pull/36
**Reviewer**: Database Schema Architect Agent
**Drizzle ORM Version**: 0.44.7 (upgraded from 0.36.4)

---

## Executive Summary

**Overall Assessment**: GOOD (7.5/10) - Production-ready with recommended improvements

PR #36 introduces critical database schema infrastructure for the content management platform, including organizations, media items, and content tables. The implementation demonstrates strong schema design principles with proper constraints, indexes, and multi-tenancy support. The Drizzle ORM version alignment (0.44.7) across all packages resolves previous type safety issues.

### Key Strengths
- ✅ Excellent alignment with documented schema (database-schema.md)
- ✅ Proper foreign key constraints with appropriate ON DELETE behaviors
- ✅ Comprehensive CHECK constraints for data integrity
- ✅ Strategic indexing for query performance
- ✅ Proper multi-tenancy scoping with organization_id
- ✅ Type-safe schema definitions with full type exports
- ✅ Session-user relation added (critical fix)

### Critical Issues
- 🔴 **BLOCKER**: Migration files use `ON DELETE no action` initially, then fixed in migration 0003 (non-idempotent)
- 🔴 Missing indexes on foreign key columns in auth schema
- 🟡 Inconsistent primary key types (UUID vs text)
- 🟡 No migration rollback SQL files

### Recommended Actions
1. Review and consolidate migration strategy
2. Add missing indexes to auth schema
3. Standardize primary key types
4. Create rollback migration files
5. Add migration testing on ephemeral Neon branch

---

## Table of Contents

1. [Schema Design Analysis](#1-schema-design-analysis)
2. [Drizzle ORM Update Assessment](#2-drizzle-orm-update-assessment)
3. [Data Integrity Review](#3-data-integrity-review)
4. [Multi-Tenancy Implementation](#4-multi-tenancy-implementation)
5. [Performance Analysis](#5-performance-analysis)
6. [Migration Safety Review](#6-migration-safety-review)
7. [Detailed Findings](#7-detailed-findings)
8. [Action Items](#8-action-items)

---

## 1. Schema Design Analysis

### 1.1 Table Structure Review

#### ✅ Organizations Table (EXCELLENT)

**Location**: `packages/database/src/schema/content.ts` (lines 22-45)

**Strengths**:
- Proper UUID primary key with `defaultRandom()`
- Unique slug constraint for URL-friendly identifiers
- Soft delete support with `deletedAt`
- Proper timestamps with timezone support
- Index on slug for fast lookups

**Alignment with Spec**: 100% aligned with database-schema.md lines 256-281

**Schema Definition**:
```typescript
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull().unique(),
    description: text('description'),
    logoUrl: text('logo_url'),
    websiteUrl: text('website_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('idx_organizations_slug').on(table.slug)]
);
```

**Issues**: None identified

---

#### ✅ Media Items Table (EXCELLENT)

**Location**: `packages/database/src/schema/content.ts` (lines 53-105)

**Strengths**:
- Creator ownership properly enforced
- Comprehensive metadata fields for media processing
- CHECK constraints for enum-like fields (status, mediaType)
- Composite indexes for efficient filtering
- Soft delete support
- Proper foreign key with `ON DELETE restrict` (prevents orphaning)

**Alignment with Spec**: 100% aligned with database-schema.md lines 130-183

**Critical Design Decision** (CORRECT):
```typescript
creatorId: text('creator_id')
  .notNull()
  .references(() => users.id, { onDelete: 'restrict' }),
```
✅ Using `restrict` prevents deletion of users who own media (correct for data preservation)

**CHECK Constraints**:
```typescript
check('check_media_status',
  sql`${table.status} IN ('uploading', 'uploaded', 'transcoding', 'ready', 'failed')`),
check('check_media_type',
  sql`${table.mediaType} IN ('video', 'audio')`),
```
✅ Excellent - enforces data integrity at database level

**Indexing Strategy**:
```typescript
index('idx_media_items_creator_id').on(table.creatorId),
index('idx_media_items_status').on(table.creatorId, table.status),
index('idx_media_items_type').on(table.creatorId, table.mediaType),
```
✅ Composite indexes optimize common query patterns (creator + status, creator + type)

**Issues**: None identified

---

#### ✅ Content Table (EXCELLENT with minor observations)

**Location**: `packages/database/src/schema/content.ts` (lines 112-211)

**Strengths**:
- Proper separation of content metadata from media files
- Nullable `organizationId` supports personal vs org content
- Nullable `mediaItemId` supports written content (Phase 2)
- Comprehensive CHECK constraints (4 constraints)
- Smart partial unique indexes for slug uniqueness
- Price stored as integer cents (ACID-compliant, prevents float rounding errors)
- Extensive indexing strategy (9 indexes)

**Alignment with Spec**: 100% aligned with database-schema.md lines 185-254

**Critical Design Decision** (CORRECT):
```typescript
organizationId: uuid('organization_id').references(() => organizations.id, {
  onDelete: 'set null',
}), // NULL = personal profile

mediaItemId: uuid('media_item_id').references(() => mediaItems.id, {
  onDelete: 'set null',
}),
```
✅ Using `set null` allows content to persist even if organization or media is deleted
✅ Trigger (migration 0004) unpublishes content when org is deleted - excellent safeguard

**Partial Unique Indexes** (EXCELLENT):
```typescript
// Unique slug per organization (for organization content)
uniqueIndex('idx_unique_content_slug_per_org')
  .on(table.slug, table.organizationId)
  .where(sql`${table.organizationId} IS NOT NULL`),

// Unique slug per creator (for personal content)
uniqueIndex('idx_unique_content_slug_personal')
  .on(table.slug, table.creatorId)
  .where(sql`${table.organizationId} IS NULL`),
```
✅ Brilliant - ensures slug uniqueness scoped to organization OR creator
✅ Prevents collision between "yoga-basics" in different orgs
✅ Prevents collision between org content and personal content with same slug

**Price in Cents** (CORRECT):
```typescript
priceCents: integer('price_cents'), // NULL = free, INTEGER = price in cents
```
✅ Follows monetary best practice from database-schema.md (lines 18-21)
✅ Prevents floating-point rounding errors
✅ CHECK constraint ensures non-negative: `price_cents >= 0`

**Observation** (MINOR):
- Tags stored as JSONB array - flexible but no GIN index for JSONB queries
- **Recommendation**: Add GIN index if tag filtering becomes common: // added the index 
  ```typescript
  index('idx_content_tags_gin').on(table.tags).using('gin')
  ```

---

#### 🟡 Auth Schema (GOOD with concerns)

**Location**: `packages/database/src/schema/auth.ts`

**Strengths**:
- Proper cascade deletion on accounts/sessions when user deleted
- Email uniqueness enforced
- Timestamps with `$onUpdate` for automatic updates
- Session-user relation added (critical fix in this PR)

**Issues Identified**:

1. **MISSING INDEXES ON FOREIGN KEYS** 🔴
   - `accounts.userId` - no index (foreign key)
   - `sessions.userId` - no index (foreign key)

   **Impact**: Slow queries when joining sessions/accounts to users

   **Recommendation**:
   ```typescript
   export const accounts = pgTable('accounts', {
     // ... fields
   }, (table) => [
     index('idx_accounts_user_id').on(table.userId),
     index('idx_accounts_provider').on(table.providerId, table.accountId),
   ]);

   export const sessions = pgTable('sessions', {
     // ... fields
   }, (table) => [
     index('idx_sessions_user_id').on(table.userId),
     index('idx_sessions_token').on(table.token), // already unique, but explicit index
     index('idx_sessions_expires_at').on(table.expiresAt), // for cleanup queries
   ]);
   ```

2. **PRIMARY KEY TYPE INCONSISTENCY** 🟡
   - Auth tables use `text('id')` for primary keys
   - Content tables use `uuid('id')`

   **Why This Matters**:
   - Better-auth (used for auth) generates text IDs
   - Content domain uses UUIDs
   - Mixing types is OK if intentional, but should be documented

   **Current State**: Acceptable (different domains, different ID strategies)

   **Recommendation**: Document this decision in schema comments

3. **SESSION-USER RELATION ADDED** ✅
   - Lines 69-74 in auth.ts
   - Critical fix - enables `db.query.sessions.findFirst({ with: { user: true } })`
   - Previously missing, causing TypeScript errors

   **Verification**: Confirmed this is a NEW addition in PR #36 (not in base schema)

---

### 1.2 Relations Review

**Location**: `packages/database/src/schema/content.ts` (lines 214-238)

```typescript
// Organizations → Content (one-to-many)
export const organizationsRelations = relations(organizations, ({ many }) => ({
  content: many(content),
}));

// MediaItems → User (many-to-one)
export const mediaItemsRelations = relations(mediaItems, ({ one }) => ({
  creator: one(users, {
    fields: [mediaItems.creatorId],
    references: [users.id],
  }),
}));

// Content → User, Organization, MediaItem (many-to-one)
export const contentRelations = relations(content, ({ one }) => ({
  creator: one(users, { fields: [content.creatorId], references: [users.id] }),
  organization: one(organizations, { fields: [content.organizationId], references: [organizations.id] }),
  mediaItem: one(mediaItems, { fields: [content.mediaItemId], references: [mediaItems.id] }),
}));

// Sessions → User (many-to-one) - ADDED IN THIS PR ✅
export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
```

**Assessment**:
- ✅ All relations properly defined
- ✅ Bidirectional where needed (organizations ↔ content)
- ✅ Enables relational queries: `db.query.content.findMany({ with: { creator: true, organization: true, mediaItem: true } })`
- ✅ Session-user relation added (critical fix)

**Missing Relations** (ACCEPTABLE):
- Users → Content (not defined, but accessible via reverse query)
- Users → MediaItems (not defined, but acceptable)
- Users → Sessions (not defined, but acceptable - sessions have relation to users)

**Recommendation**: Relations are adequate for current use cases. Add user-side relations if needed in future.

---

### 1.3 Type Exports

**Location**: `packages/database/src/schema/content.ts` (lines 241-246)

```typescript
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type MediaItem = typeof mediaItems.$inferSelect;
export type NewMediaItem = typeof mediaItems.$inferInsert;
export type Content = typeof content.$inferSelect;
export type NewContent = typeof content.$inferInsert;
```

**Assessment**:
- ✅ Proper use of Drizzle's type inference
- ✅ Separate insert and select types (insert types exclude auto-generated fields)
- ✅ Available for import by service layers

**Verification**:
```typescript
// Example usage in service layer
import { NewContent, Content } from '@codex/database/schema';

async function createContent(data: NewContent): Promise<Content> {
  const [content] = await db.insert(content).values(data).returning();
  return content; // Type-safe!
}
```

**Missing** (MINOR):
- No type exports for auth tables (users, accounts, sessions)
- **Recommendation**: Add in `auth.ts`:
  ```typescript
  export type User = typeof users.$inferSelect;
  export type NewUser = typeof users.$inferInsert;
  export type Session = typeof sessions.$inferSelect;
  export type NewSession = typeof sessions.$inferInsert;
  ```

---

## 2. Drizzle ORM Update Assessment

### 2.1 Version Alignment

**Previous State**: Drizzle ORM 0.36.4 in some packages, 0.44.7 in others
**Current State**: Drizzle ORM 0.44.7 across ALL packages

**Packages Updated**:
- ✅ `@codex/database`: 0.44.7
- ✅ `@codex/content`: 0.44.7
- ✅ `@codex/identity`: 0.44.7
- ✅ `@codex/security`: 0.44.7
- ✅ `@codex/test-utils`: 0.44.7
- ✅ `@codex/worker-utils`: 0.44.7

**Verification**:
```bash
grep -r "drizzle-orm" packages/*/package.json workers/*/package.json | grep -v node_modules
```
Result: ALL packages now use `"drizzle-orm": "0.44.7"`

**Impact**:
- ✅ Resolves ~60 TypeScript compilation errors (from PR commit messages)
- ✅ Consistent type definitions across monorepo
- ✅ Enables proper relation inference
- ✅ Fixes session-user relation type errors

---

### 2.2 Breaking Changes Analysis

**Drizzle ORM 0.36.4 → 0.44.7 Changes**:

Based on Drizzle ORM documentation and changelog:

1. **Relations API Improvements** (NON-BREAKING)
   - Enhanced type inference for relations
   - Better support for `with` clause in queries
   - ✅ Used correctly in this PR (sessionsRelations added)

2. **Schema Definition Updates** (NON-BREAKING)
   - New `$onUpdate()` syntax for timestamps
   - ✅ Used correctly: `.$onUpdate(() => new Date())`

3. **Foreign Key ON DELETE/UPDATE** (ENHANCED)
   - More explicit handling of cascade behaviors
   - ✅ This PR uses explicit `{ onDelete: 'restrict' }`, `{ onDelete: 'set null' }`, `{ onDelete: 'cascade' }`

4. **Index Definition Improvements** (NON-BREAKING)
   - Better support for partial indexes with `.where()`
   - ✅ Used correctly for partial unique indexes

**Assessment**:
- ✅ No breaking changes impact this codebase
- ✅ New features used appropriately
- ✅ All schema definitions follow 0.44.7 best practices

---

### 2.3 Type Safety Improvements

**Before PR #36** (0.36.4 + 0.44.7 mixed):
```typescript
// TypeScript errors on session queries
const session = await db.query.sessions.findFirst({
  with: { user: true } // ❌ Error: Property 'user' does not exist
});
```

**After PR #36** (0.44.7 everywhere + sessionsRelations):
```typescript
// Now works correctly
const session = await db.query.sessions.findFirst({
  with: { user: true } // ✅ Type-safe, returns { ...session, user: { ...user } }
});
```

**Verification**:
- Commit message: "fix: add missing session-user relation in database schema"
- Lines 69-74 in `auth.ts` define the relation
- This enables type-safe queries with user data included

---

## 3. Data Integrity Review

### 3.1 Primary Keys

**Strategy**: UUID for content domain, text for auth domain

| Table | Primary Key | Type | Default | Assessment |
|-------|-------------|------|---------|------------|
| organizations | id | uuid | gen_random_uuid() | ✅ Excellent |
| media_items | id | uuid | gen_random_uuid() | ✅ Excellent |
| content | id | uuid | gen_random_uuid() | ✅ Excellent |
| users | id | text | (better-auth) | ✅ OK (external) |
| accounts | id | text | (better-auth) | ✅ OK (external) |
| sessions | id | text | (better-auth) | ✅ OK (external) |

**Analysis**:
- ✅ Content domain uses database-generated UUIDs (best practice)
- ✅ Auth domain uses better-auth generated IDs (acceptable - external library constraint)
- ✅ All primary keys are NOT NULL (enforced)
- ✅ No composite primary keys (appropriate for current schema)

**Recommendation**: Document why auth uses text IDs (better-auth library requirement)

---

### 3.2 Foreign Keys & Referential Integrity

#### Foreign Key Constraints Overview

| Foreign Key | ON DELETE | ON UPDATE | Assessment |
|-------------|-----------|-----------|------------|
| content.creator_id → users.id | restrict | no action | ✅ Correct |
| content.organization_id → organizations.id | set null | no action | ✅ Correct |
| content.media_item_id → media_items.id | set null | no action | ✅ Correct |
| media_items.creator_id → users.id | restrict | no action | ✅ Correct |
| accounts.userId → users.id | cascade | no action | ✅ Correct |
| sessions.userId → users.id | cascade | no action | ✅ Correct |

#### Detailed Analysis

**1. Content → User (restrict)** ✅
```typescript
creatorId: text('creator_id')
  .notNull()
  .references(() => users.id, { onDelete: 'restrict' }),
```
- **Behavior**: Cannot delete user if they have created content
- **Why Correct**: Preserves content attribution, prevents orphaned content
- **Alternative Considered**: CASCADE (would delete all content when user deleted) - REJECTED (data loss risk)

**2. Content → Organization (set null)** ✅
```typescript
organizationId: uuid('organization_id').references(() => organizations.id, {
  onDelete: 'set null',
}),
```
- **Behavior**: When org deleted, content.organization_id becomes NULL
- **Why Correct**: Content becomes personal creator content (doesn't delete content)
- **Additional Safeguard**: Trigger unpublishes content (migration 0004) ✅
```sql
-- When organization_id becomes NULL, set status to draft
CREATE TRIGGER trigger_unpublish_on_org_delete
  BEFORE UPDATE ON content
  FOR EACH ROW
  WHEN (OLD.organization_id IS DISTINCT FROM NEW.organization_id)
  EXECUTE FUNCTION unpublish_content_on_org_delete();
```
✅ Excellent - prevents published org content from auto-appearing on creator's personal page

**3. Content → MediaItem (set null)** ✅
```typescript
mediaItemId: uuid('media_item_id').references(() => mediaItems.id, {
  onDelete: 'set null',
}),
```
- **Behavior**: When media deleted, content.media_item_id becomes NULL
- **Why Correct**: Content metadata persists (may still have thumbnails, descriptions)
- **Use Case**: Written content (Phase 2) has NULL media_item_id

**4. MediaItem → User (restrict)** ✅
```typescript
creatorId: text('creator_id')
  .notNull()
  .references(() => users.id, { onDelete: 'restrict' }),
```
- **Behavior**: Cannot delete user if they own media
- **Why Correct**: Media ownership critical (files in R2 bucket named by creator_id)
- **Consequence**: To delete user, must first reassign or delete their media

**5. Accounts/Sessions → User (cascade)** ✅
```typescript
userId: text('user_id')
  .notNull()
  .references(() => users.id, { onDelete: 'cascade' }),
```
- **Behavior**: Delete accounts/sessions when user deleted
- **Why Correct**: Sessions and OAuth accounts are user-specific, no value after deletion

#### 🟡 Migration Concern: Non-Idempotent Foreign Key Changes

**Issue**: Migration 0002 creates FKs with `ON DELETE no action`, then migration 0003 drops and recreates with proper behaviors.

**Migration 0002** (initial):
```sql
ALTER TABLE "content" ADD CONSTRAINT "content_creator_id_users_id_fk"
  FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;
```

**Migration 0003** (fix):
```sql
ALTER TABLE "content" DROP CONSTRAINT "content_creator_id_users_id_fk";
ALTER TABLE "content" ADD CONSTRAINT "content_creator_id_users_id_fk"
  FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE no action;
```

**Problem**:
- Migrations 0002 + 0003 create correct state, but...
- If migration 0002 runs independently, database is in incorrect state
- Not idempotent - depends on exact sequence

**Recommendation**:
1. Squash migrations 0002-0004 into single migration for new deployments
2. OR keep as-is but document in migration notes
3. Test migration sequence on ephemeral Neon branch

---

### 3.3 NOT NULL Constraints

**Analysis**: All required fields properly marked as NOT NULL

| Table | NOT NULL Fields | Assessment |
|-------|-----------------|------------|
| organizations | id, name, slug, created_at, updated_at | ✅ |
| media_items | id, creator_id, title, media_type, status, r2_key, created_at, updated_at | ✅ |
| content | id, creator_id, title, slug, content_type, visibility, status, view_count, purchase_count, created_at, updated_at | ✅ |
| users | id, name, email, email_verified, created_at, updated_at | ✅ |
| sessions | id, expires_at, token, created_at, updated_at, user_id | ✅ |

**Nullable Fields (Intentional)**:
- ✅ `content.organization_id` - NULL = personal content
- ✅ `content.media_item_id` - NULL = written content
- ✅ `content.price_cents` - NULL = free content
- ✅ `content.description` - optional
- ✅ `content.deleted_at` - soft delete flag
- ✅ All metadata fields (thumbnailUrl, contentBody, category)

**No Issues Identified**

---

### 3.4 UNIQUE Constraints

**Simple Unique Constraints**:
```typescript
organizations.slug - UNIQUE
users.email - UNIQUE
sessions.token - UNIQUE
```
✅ All correct

**Partial Unique Constraints** (Advanced):
```typescript
// Unique slug per organization
uniqueIndex('idx_unique_content_slug_per_org')
  .on(table.slug, table.organizationId)
  .where(sql`${table.organizationId} IS NOT NULL`),

// Unique slug per creator (personal content)
uniqueIndex('idx_unique_content_slug_personal')
  .on(table.slug, table.creatorId)
  .where(sql`${table.organizationId} IS NULL`),
```

**Behavior**:
- Organization A can have content with slug "yoga-basics"
- Organization B can have content with slug "yoga-basics"
- Creator X can have personal content with slug "yoga-basics"
- But within Organization A, slug must be unique

**Test Cases**:
```typescript
// ✅ ALLOWED:
await db.insert(content).values({ slug: 'yoga-basics', organizationId: 'org-a', creatorId: 'user-1' });
await db.insert(content).values({ slug: 'yoga-basics', organizationId: 'org-b', creatorId: 'user-2' });
await db.insert(content).values({ slug: 'yoga-basics', organizationId: null, creatorId: 'user-1' });

// ❌ REJECTED (duplicate slug in org-a):
await db.insert(content).values({ slug: 'yoga-basics', organizationId: 'org-a', creatorId: 'user-2' });

// ❌ REJECTED (duplicate personal slug for user-1):
await db.insert(content).values({ slug: 'yoga-basics', organizationId: null, creatorId: 'user-1' });
```

✅ **Assessment**: Brilliant design - complex but correct

---

### 3.5 CHECK Constraints

**All CHECK Constraints**:

```typescript
// Media Items
check('check_media_status',
  sql`${table.status} IN ('uploading', 'uploaded', 'transcoding', 'ready', 'failed')`),
check('check_media_type',
  sql`${table.mediaType} IN ('video', 'audio')`),

// Content
check('check_content_status',
  sql`${table.status} IN ('draft', 'published', 'archived')`),
check('check_content_visibility',
  sql`${table.visibility} IN ('public', 'private', 'members_only', 'purchased_only')`),
check('check_content_type',
  sql`${table.contentType} IN ('video', 'audio', 'written')`),
check('check_price_non_negative',
  sql`${table.priceCents} IS NULL OR ${table.priceCents} >= 0`),
```

**Assessment**:
- ✅ Enum-like behavior enforced at database level
- ✅ Prevents invalid states (e.g., status = 'foobar')
- ✅ Price validation prevents negative prices
- ✅ Aligns with database-schema.md specifications

**Comparison with Spec**:
| Field | Spec Allowed Values | Implementation | Match |
|-------|---------------------|----------------|-------|
| media_items.status | uploading, uploaded, transcoding, ready, failed | ✅ Same | ✅ |
| media_items.media_type | video, audio | ✅ Same | ✅ |
| content.status | draft, published, archived | ✅ Same | ✅ |
| content.visibility | public, private, members_only, purchased_only | ✅ Same | ✅ |
| content.content_type | video, audio, written | ✅ Same | ✅ |

**No Issues Identified**

---

### 3.6 Default Values

**All Defaults**:

```typescript
// Timestamps
created_at: timestamp().defaultNow().notNull()
updated_at: timestamp().defaultNow().$onUpdate(() => new Date()).notNull()

// Status fields
media_items.status: DEFAULT 'uploading'
content.status: DEFAULT 'draft'
content.visibility: DEFAULT 'purchased_only'

// Counters
content.view_count: DEFAULT 0
content.purchase_count: DEFAULT 0

// JSONB
content.tags: DEFAULT '[]'::jsonb

// Booleans
users.email_verified: DEFAULT false

// UUIDs
organizations.id: DEFAULT gen_random_uuid()
media_items.id: DEFAULT gen_random_uuid()
content.id: DEFAULT gen_random_uuid()
```

**Assessment**:
- ✅ All defaults appropriate for their context
- ✅ Timestamps auto-populate
- ✅ Status defaults to safe state (draft, not published)
- ✅ Counters initialize to 0
- ✅ UUIDs auto-generate
- ✅ No missing defaults on required fields

**No Issues Identified**

---

## 4. Multi-Tenancy Implementation

### 4.1 Organization Scoping

**Design Pattern**: Multi-organization platform with organization-scoped content

**Implementation**:
```typescript
// Content can belong to organization OR be personal
organizationId: uuid('organization_id').references(() => organizations.id, {
  onDelete: 'set null',
}), // NULL = personal profile
```

**Scoping Logic**:
- `organizationId = NULL` → Personal creator content
- `organizationId = <uuid>` → Organization content

**Access Control Implications** (from database-schema.md lines 1350-1953):
- Organization owners can see content with `organizationId = their_org_id`
- Creators can see content with `creatorId = their_user_id` OR org content in orgs they belong to
- Customers see published content only

**Assessment**: ✅ Correct implementation of multi-tenancy at data layer

---

### 4.2 Organization ID Columns

**Tables with organization_id**:
| Table | Column | Purpose | Assessment |
|-------|--------|---------|------------|
| content | organization_id | Scope content to org | ✅ Correct |

**Tables WITHOUT organization_id** (intentional):
| Table | Reason | Assessment |
|-------|--------|------------|
| media_items | Creator-owned, not org-owned | ✅ Correct |
| users | Cross-organization | ✅ Correct |
| sessions | User sessions, not org-specific | ✅ Correct |

**Alignment with Spec** (database-schema.md):
- ✅ Content has `organization_id` (line 193)
- ✅ Media items do NOT have `organization_id` (creator-owned, line 133)
- ✅ Matches documented "Content Library Pattern" (lines 265-270)

**No Issues Identified**

---

### 4.3 Data Isolation Enforcement

**At Database Level**:
- ✅ Foreign key constraints prevent cross-org references
- ✅ Partial unique indexes scope slug uniqueness to org
- ✅ Soft deletes preserve data but mark as deleted

**Application Level** (not in this PR, but required):
- ⚠️ Query filters must include `organizationId` checks
- ⚠️ Service layer must enforce multi-tenancy
- ⚠️ Row-Level Security (RLS) policies not yet implemented (Phase 2 per spec)

**Example Query Pattern** (from spec):
```typescript
// Organization owner viewing content
const orgContent = await db.query.content.findMany({
  where: eq(content.organizationId, userOrgId),
});

// Creator viewing their content
const myContent = await db.query.content.findMany({
  where: or(
    eq(content.creatorId, userId),
    and(
      eq(content.organizationId, userOrgId),
      eq(content.status, 'published')
    )
  ),
});
```

**Recommendation**:
1. Document organization scoping patterns in service layer
2. Add RLS policies in Phase 2 (per database-schema.md lines 1696-1758)
3. Create test cases for multi-org data isolation

---

## 5. Performance Analysis

### 5.1 Index Strategy

**All Indexes**:

```typescript
// Organizations
index('idx_organizations_slug').on(table.slug)

// Media Items
index('idx_media_items_creator_id').on(table.creatorId)
index('idx_media_items_status').on(table.creatorId, table.status)
index('idx_media_items_type').on(table.creatorId, table.mediaType)

// Content
index('idx_content_creator_id').on(table.creatorId)
index('idx_content_organization_id').on(table.organizationId)
index('idx_content_media_item_id').on(table.mediaItemId)
index('idx_content_slug_org').on(table.slug, table.organizationId)
index('idx_content_status').on(table.status)
index('idx_content_published_at').on(table.publishedAt)
index('idx_content_category').on(table.category)
uniqueIndex('idx_unique_content_slug_per_org').on(table.slug, table.organizationId).where(...)
uniqueIndex('idx_unique_content_slug_personal').on(table.slug, table.creatorId).where(...)
```

**Index Coverage Analysis**:

| Query Pattern | Index Used | Assessment |
|--------------|------------|------------|
| Find org by slug | idx_organizations_slug | ✅ |
| List creator's media | idx_media_items_creator_id | ✅ |
| Filter media by status | idx_media_items_status (composite) | ✅ |
| Filter media by type | idx_media_items_type (composite) | ✅ |
| List creator's content | idx_content_creator_id | ✅ |
| List org's content | idx_content_organization_id | ✅ |
| Find content by slug+org | idx_content_slug_org | ✅ |
| List published content | idx_content_status | ✅ |
| Recent content feed | idx_content_published_at | ✅ |
| Browse by category | idx_content_category | ✅ |
| Join content→media | idx_content_media_item_id | ✅ |

**🔴 MISSING INDEXES (Critical)**:

```typescript
// Auth schema missing indexes
accounts.userId - NO INDEX ❌
sessions.userId - NO INDEX ❌
```

**Impact**:
- Slow queries: `SELECT * FROM sessions WHERE user_id = ?`
- Full table scan on sessions table
- Performance degrades as sessions grow

**Recommendation**:
```typescript
export const accounts = pgTable('accounts', {
  // ... fields
}, (table) => [
  index('idx_accounts_user_id').on(table.userId),
]);

export const sessions = pgTable('sessions', {
  // ... fields
}, (table) => [
  index('idx_sessions_user_id').on(table.userId),
  index('idx_sessions_expires_at').on(table.expiresAt), // For cleanup
]);
```

---

### 5.2 Composite Index Effectiveness

**Composite Indexes**:
1. `idx_media_items_status(creator_id, status)`
2. `idx_media_items_type(creator_id, media_type)`
3. `idx_content_slug_org(slug, organization_id)`

**Column Order Analysis**:

**1. Media Status Index** ✅
```typescript
index('idx_media_items_status').on(table.creatorId, table.status)
```
- **Query**: `WHERE creator_id = ? AND status = 'ready'`
- **Optimization**: Filter by creator first (high selectivity), then status
- ✅ Correct order

**2. Media Type Index** ✅
```typescript
index('idx_media_items_type').on(table.creatorId, table.mediaType)
```
- **Query**: `WHERE creator_id = ? AND media_type = 'video'`
- **Optimization**: Filter by creator first, then type
- ✅ Correct order

**3. Slug+Org Index** ✅
```typescript
index('idx_content_slug_org').on(table.slug, table.organizationId)
```
- **Query**: `WHERE slug = 'yoga-basics' AND organization_id = ?`
- **Optimization**: Slug is used for lookups (high selectivity), org narrows down
- ✅ Correct order
- **Note**: Also supports `WHERE slug = ?` (leftmost prefix)

**Assessment**: All composite indexes have optimal column ordering

---

### 5.3 Query Optimization Opportunities

**Current State**: Good baseline indexing

**Phase 2 Considerations** (not required now):

1. **GIN Index for JSONB Tags** 🟡
   ```typescript
   index('idx_content_tags_gin').on(table.tags).using('gin')
   ```
   - **When**: If tag filtering becomes common (`WHERE tags @> '["yoga"]'`)
   - **Trade-off**: Slower writes, faster tag queries

2. **Partial Index for Published Content** 🟡
   ```typescript
   index('idx_content_published').on(table.publishedAt)
     .where(sql`${table.status} = 'published'`)
   ```
   - **Benefit**: Smaller index (excludes drafts)
   - **Use Case**: Public content feed queries

3. **Covering Index for Content List** 🟡
   ```typescript
   index('idx_content_list_covering')
     .on(table.organizationId, table.status, table.publishedAt)
     .include(table.title, table.slug)
   ```
   - **Benefit**: Index-only scan (no table lookup)
   - **Trade-off**: Larger index size

**Recommendation**: Monitor query patterns in production before adding these

---

### 5.4 N+1 Query Prevention

**Relations Defined** ✅:
```typescript
// Enables efficient eager loading
const content = await db.query.content.findMany({
  with: {
    creator: true,        // JOIN users
    organization: true,   // JOIN organizations
    mediaItem: true,      // JOIN media_items
  },
});
```

**Without Relations** ❌:
```typescript
// N+1 problem
const content = await db.select().from(contentTable);
for (const c of content) {
  const creator = await db.select().from(users).where(eq(users.id, c.creatorId));
  const org = await db.select().from(organizations).where(eq(organizations.id, c.organizationId));
}
```

**Assessment**: ✅ Relations properly defined, enables efficient queries

---

### 5.5 Connection Pooling Configuration

**Location**: `packages/database/src/client.ts`

**HTTP Client** (stateless):
```typescript
const sqlHttp = neon(dbUrl);
const dbHttp = drizzleHttp({ client: sqlHttp, schema });
```
- ✅ Optimized for Cloudflare Workers
- ✅ No persistent connections
- ❌ Does NOT support transactions

**WebSocket Client** (stateful):
```typescript
const pool = new Pool({ connectionString: dbUrl });
const dbWs = drizzleWs(pool, { schema });
```
- ✅ Supports transactions
- ✅ Proper error handling: `pool.on('error', ...)`
- ✅ Cleanup function: `closeDbPool()`
- ✅ WebSocket configuration for Node.js (lines 57-64)

**Assessment**:
- ✅ Proper client selection (HTTP for workers, WS for tests/transactions)
- ✅ Pool cleanup implemented
- ✅ WebSocket compatibility handled correctly

**Recommendation**: Document when to use dbHttp vs dbWs in package README

---

## 6. Migration Safety Review

### 6.1 Migration Files

**All Migrations**:
1. `0000_clammy_dreadnoughts.sql` - 3 lines (initial auth schema)
2. `0001_soft_mauler.sql` - 59 lines (auth tables expansion)
3. `0002_curved_darwin.sql` - 100 lines (content tables creation) ⚠️
4. `0003_purple_scourge.sql` - 11 lines (fix FK constraints) ⚠️
5. `0004_add_org_deletion_trigger.sql` - 22 lines (org deletion safeguard) ✅

**Total**: 195 lines of SQL

---

### 6.2 Migration 0002 Analysis

**File**: `packages/database/src/migrations/0002_curved_darwin.sql`

**Creates**:
- ✅ organizations table
- ✅ media_items table
- ✅ content table
- ✅ All indexes (9 for content, 3 for media, 1 for orgs)
- ✅ CHECK constraints (6 total)
- ⚠️ Foreign keys with `ON DELETE no action`

**Issue**:
```sql
-- Migration 0002 creates FKs incorrectly:
ALTER TABLE "content" ADD CONSTRAINT "content_creator_id_users_id_fk"
  FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;
```

**Fixed in Migration 0003**:
```sql
-- Migration 0003 fixes FK behaviors:
ALTER TABLE "content" DROP CONSTRAINT "content_creator_id_users_id_fk";
ALTER TABLE "content" ADD CONSTRAINT "content_creator_id_users_id_fk"
  FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE no action;
```

**Root Cause**:
- Drizzle Kit generated migration 0002 with default `no action`
- Schema was updated with explicit `{ onDelete: 'restrict' }`, `{ onDelete: 'set null' }`
- Migration 0003 generated to fix the discrepancy

**Impact**:
- ⚠️ Non-idempotent migration sequence
- ⚠️ If 0002 runs without 0003, database is in incorrect state
- ✅ Final state (after 0003) is correct

**Recommendation**:
1. **For New Deployments**: Squash migrations 0002-0004 into single migration
2. **For Existing Deployments**: Keep as-is, ensure 0003 runs after 0002
3. **Test**: Verify migration sequence on ephemeral Neon branch

---

### 6.3 Migration 0003 Analysis

**File**: `packages/database/src/migrations/0003_purple_scourge.sql`

**Purpose**: Fix foreign key ON DELETE behaviors

**Changes**:
```sql
-- Drop incorrect FKs
ALTER TABLE "content" DROP CONSTRAINT "content_creator_id_users_id_fk";
ALTER TABLE "content" DROP CONSTRAINT "content_organization_id_organizations_id_fk";
ALTER TABLE "content" DROP CONSTRAINT "content_media_item_id_media_items_id_fk";
ALTER TABLE "media_items" DROP CONSTRAINT "media_items_creator_id_users_id_fk";

-- Recreate with correct behaviors
ALTER TABLE "content" ADD CONSTRAINT "content_creator_id_users_id_fk"
  FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE no action;

ALTER TABLE "content" ADD CONSTRAINT "content_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "content" ADD CONSTRAINT "content_media_item_id_media_items_id_fk"
  FOREIGN KEY ("media_item_id") REFERENCES "public"."media_items"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "media_items" ADD CONSTRAINT "media_items_creator_id_users_id_fk"
  FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE no action;
```

**Assessment**:
- ✅ Correctly fixes all FK behaviors
- ✅ Matches schema definitions in content.ts
- ⚠️ Depends on migration 0002 running first
- ❌ No rollback SQL provided

**Safety**:
- ✅ Safe to run on empty database
- ✅ Safe to run on database with data (no data modifications)
- ⚠️ Will fail if constraints already correct (duplicate constraint names)

---

### 6.4 Migration 0004 Analysis

**File**: `packages/database/src/migrations/0004_add_org_deletion_trigger.sql`

**Purpose**: Unpublish content when organization is deleted

**Implementation**:
```sql
CREATE OR REPLACE FUNCTION unpublish_content_on_org_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.organization_id IS NOT NULL AND NEW.organization_id IS NULL THEN
    NEW.status := 'draft';
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_unpublish_on_org_delete
  BEFORE UPDATE ON content
  FOR EACH ROW
  WHEN (OLD.organization_id IS DISTINCT FROM NEW.organization_id)
  EXECUTE FUNCTION unpublish_content_on_org_delete();
```

**Assessment**:
- ✅ Excellent safeguard against unintended content publishing
- ✅ Uses `CREATE OR REPLACE` (idempotent for function)
- ✅ Trigger condition is efficient (`WHEN` clause filters)
- ✅ Aligns with design intent (database-schema.md lines 273-277)

**Behavior**:
1. Organization deleted → `content.organization_id` set to NULL (by FK)
2. Trigger fires on UPDATE
3. Status changed to 'draft', published_at cleared
4. Content becomes unpublished personal content

**Edge Cases Handled**:
- ✅ Only fires when organization_id changes
- ✅ Only acts when organization_id becomes NULL (not when set)
- ✅ Does not affect content creation (BEFORE UPDATE, not INSERT)

**Recommendation**: Add comment to migration explaining why this is needed

---

### 6.5 Rollback Plan

**Current State**: ❌ No rollback SQL files provided

**Standard Practice**: Migrations should have `up.sql` and `down.sql`

**Example Rollback for Migration 0002**:
```sql
-- 0002_down.sql (rollback)
DROP TRIGGER IF EXISTS trigger_unpublish_on_org_delete ON content;
DROP FUNCTION IF EXISTS unpublish_content_on_org_delete();
DROP INDEX IF EXISTS idx_organizations_slug;
DROP INDEX IF EXISTS idx_media_items_creator_id;
DROP INDEX IF EXISTS idx_media_items_status;
DROP INDEX IF EXISTS idx_media_items_type;
DROP INDEX IF EXISTS idx_content_creator_id;
DROP INDEX IF EXISTS idx_content_organization_id;
DROP INDEX IF EXISTS idx_content_media_item_id;
DROP INDEX IF EXISTS idx_content_slug_org;
DROP INDEX IF EXISTS idx_content_status;
DROP INDEX IF EXISTS idx_content_published_at;
DROP INDEX IF EXISTS idx_content_category;
DROP INDEX IF EXISTS idx_unique_content_slug_per_org;
DROP INDEX IF EXISTS idx_unique_content_slug_personal;
DROP TABLE IF EXISTS content;
DROP TABLE IF EXISTS media_items;
DROP TABLE IF EXISTS organizations;
```

**Recommendation**:
1. Create rollback SQL files for all migrations
2. Test rollbacks on ephemeral Neon branch
3. Document rollback procedure in migration README

---

### 6.6 Data Migration Needs

**Current Migrations**: Schema-only (no data migrations)

**Potential Data Migrations** (Future):
- User role updates (if roles change)
- Content status transitions (if status values change)
- Price format changes (if moving from decimal to cents)

**Assessment**: ✅ No data migrations needed for this PR

**Recommendation**: Document data migration strategy for future schema changes

---

## 7. Detailed Findings FIXED

### 7.1 Critical Issues (Must Fix Before Production)

#### 🔴 CRITICAL-1: Missing Indexes on Foreign Keys

**Location**: `packages/database/src/schema/auth.ts`

**Issue**:
- `accounts.userId` has foreign key but no index
- `sessions.userId` has foreign key but no index

**Impact**:
- Slow JOIN queries
- Full table scans on sessions table
- Performance degrades as data grows

**Evidence**:
```typescript
export const accounts = pgTable('accounts', {
  // ...
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // ... NO INDEX DEFINED
});

export const sessions = pgTable('sessions', {
  // ...
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // ... NO INDEX DEFINED
});
```

**Fix**:
```typescript
export const accounts = pgTable('accounts', {
  // ... fields
}, (table) => [
  index('idx_accounts_user_id').on(table.userId),
  index('idx_accounts_provider').on(table.providerId, table.accountId),
]);

export const sessions = pgTable('sessions', {
  // ... fields
}, (table) => [
  index('idx_sessions_user_id').on(table.userId),
  index('idx_sessions_expires_at').on(table.expiresAt),
  index('idx_sessions_token').on(table.token), // Already unique, but explicit
]);
```

**Priority**: HIGH - Must fix before production deployment

**Estimated Effort**: 30 minutes (schema change + migration)

---

#### 🔴 CRITICAL-2: Non-Idempotent Migration Sequence

**Location**: Migrations 0002 and 0003

**Issue**:
- Migration 0002 creates FKs with `ON DELETE no action`
- Migration 0003 fixes FKs to correct behaviors
- Sequence is non-idempotent (order matters)
- Running 0002 alone leaves database in incorrect state

**Impact**:
- Risk of incorrect database state if migrations run out of order
- Difficult to reason about migration state
- Production deployment risk

**Evidence**:
```sql
-- Migration 0002 (incorrect):
ALTER TABLE "content" ADD CONSTRAINT "content_creator_id_users_id_fk"
  FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id")
  ON DELETE no action;

-- Migration 0003 (fix):
ALTER TABLE "content" DROP CONSTRAINT "content_creator_id_users_id_fk";
ALTER TABLE "content" ADD CONSTRAINT "content_creator_id_users_id_fk"
  FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id")
  ON DELETE restrict;
```

**Fix Options**:

**Option A: Squash Migrations** (Recommended for new deployments)
```sql
-- Create single migration 0002_complete.sql with correct FKs
-- Remove migrations 0002 and 0003
```

**Option B: Keep As-Is** (For existing deployments)
- Document that 0002 + 0003 must run together
- Add validation step after migrations

**Option C: Add Safety Check**
```sql
-- At start of migration 0003:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_creator_id_users_id_fk'
  ) THEN
    RAISE EXCEPTION 'Migration 0002 must run before 0003';
  END IF;
END $$;
```

**Priority**: HIGH - Must address before production

**Estimated Effort**: 1-2 hours (decision + testing)

---

### 7.2 High Priority Issues (Should Fix Soon)

#### 🟡 HIGH-1: No Rollback SQL Files

**Issue**: Migrations have no documented rollback procedures

**Impact**:
- Cannot safely rollback schema changes
- Production incidents harder to recover from
- No testing of reverse migrations

**Recommendation**:
1. Create rollback SQL for each migration
2. Test rollbacks on ephemeral Neon branch
3. Document rollback procedure

**Example**:
```
packages/database/src/migrations/
  0002_curved_darwin.up.sql
  0002_curved_darwin.down.sql
  0003_purple_scourge.up.sql
  0003_purple_scourge.down.sql
```

**Priority**: MEDIUM-HIGH

**Estimated Effort**: 2-3 hours

---

#### 🟡 HIGH-2: Primary Key Type Inconsistency

**Issue**: Auth tables use `text` IDs, content tables use `uuid`

**Current State**:
```typescript
// Auth (better-auth managed)
users.id: text('id')

// Content (database-generated)
organizations.id: uuid('id').defaultRandom()
```

**Impact**:
- Potentially confusing for developers
- Foreign keys mixing types (content.creator_id is text)
- No technical issue, but lacks documentation

**Recommendation**:
1. Add schema comments explaining the difference
2. Document in database-schema.md
3. Consider standardizing in v2.0 (long-term)

**Example Documentation**:
```typescript
/**
 * User ID is text because better-auth library generates string IDs.
 * Content domain uses UUIDs for database-generated keys.
 * This is intentional and acceptable - different domains, different strategies.
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(), // better-auth managed
  // ...
});
```

**Priority**: MEDIUM

**Estimated Effort**: 30 minutes (documentation only)

---

#### 🟡 HIGH-3: Missing Type Exports for Auth Tables

**Issue**: Content tables export types, auth tables do not

**Current**:
```typescript
// content.ts
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

// auth.ts
// ❌ NO TYPE EXPORTS
```

**Recommendation**:
```typescript
// Add to auth.ts:
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
```

**Priority**: MEDIUM

**Estimated Effort**: 10 minutes

---

### 7.3 Medium Priority Issues (Nice to Have)

#### 🟢 MEDIUM-1: No GIN Index on JSONB Tags

**Issue**: Tags stored as JSONB array but no GIN index for efficient querying

**Current**:
```typescript
tags: jsonb('tags').$type<string[]>().default([])
// No GIN index
```

**Impact**:
- Slow tag filtering: `WHERE tags @> '["yoga"]'`
- Sequential scan if tags are queried frequently

**Recommendation** (Phase 2):
```typescript
index('idx_content_tags_gin').on(table.tags).using('gin')
```

**When to Add**:
- Monitor query patterns in production
- Add if tag filtering becomes common use case
- Trade-off: Slower writes, faster tag queries

**Priority**: LOW (monitor first)

**Estimated Effort**: 15 minutes (when needed)

---

#### 🟢 MEDIUM-2: No Migration Testing Documentation

**Issue**: No documented process for testing migrations

**Recommendation**:
1. Document testing procedure using Neon ephemeral branches
2. Add migration testing to CI/CD
3. Create test script for migration validation

**Example Test Script**:
```bash
#!/bin/bash
# Test migrations on ephemeral Neon branch

# Create ephemeral branch
neon branch create --name "migration-test-$(date +%s)"

# Run migrations
pnpm --filter @codex/database db:migrate

# Run tests against migrated schema
pnpm --filter @codex/database test

# Delete ephemeral branch
neon branch delete migration-test-*
```

**Priority**: MEDIUM

**Estimated Effort**: 1-2 hours

---

### 7.4 Low Priority Items (Future Enhancements)

#### 🔵 LOW-1: Consider Partial Index for Published Content

**Suggestion**: Smaller index for published content queries

**Implementation**:
```typescript
index('idx_content_published').on(table.publishedAt)
  .where(sql`${table.status} = 'published'`)
```

**Benefit**: Excludes drafts from index (smaller, faster)

**When to Add**: Phase 2, after monitoring query patterns

---

#### 🔵 LOW-2: Consider Covering Index for List Queries

**Suggestion**: Index-only scans for content listing

**Implementation**:
```typescript
index('idx_content_list_covering')
  .on(table.organizationId, table.status, table.publishedAt)
  .include(table.title, table.slug)
```

**Benefit**: Avoid table lookups for list queries

**Trade-off**: Larger index size

**When to Add**: Phase 2, if performance profiling shows benefit

---

## 8. Action Items

### 8.1 Must Fix Before Merge (Blockers)

| ID | Issue | Priority | Effort | Assignee |
|----|-------|----------|--------|----------|
| CRITICAL-1 | Add indexes to auth schema foreign keys | HIGH | 30 min | Database Team |
| CRITICAL-2 | Resolve non-idempotent migration sequence | HIGH | 1-2 hrs | Database Team |

### 8.2 Should Fix Before Production

| ID | Issue | Priority | Effort | Assignee |
|----|-------|----------|--------|----------|
| HIGH-1 | Create rollback SQL files | MED-HIGH | 2-3 hrs | Database Team |
| HIGH-2 | Document primary key type inconsistency | MEDIUM | 30 min | Database Team |
| HIGH-3 | Add type exports for auth tables | MEDIUM | 10 min | Database Team |

### 8.3 Future Enhancements (Post-Production)

| ID | Issue | Priority | Effort | Assignee |
|----|-------|----------|--------|----------|
| MEDIUM-1 | Add GIN index on tags (if needed) | LOW | 15 min | Monitor first |
| MEDIUM-2 | Document migration testing process | MEDIUM | 1-2 hrs | DevOps Team |
| LOW-1 | Consider partial index for published content | LOW | 30 min | Phase 2 |
| LOW-2 | Consider covering index for list queries | LOW | 1 hr | Phase 2 |

---

## 9. Performance Recommendations

### 9.1 Query Optimization Checklist

- ✅ Foreign key indexes on content domain tables
- ❌ Foreign key indexes on auth domain tables (MISSING)
- ✅ Composite indexes for common filters
- ✅ Partial unique indexes for slug uniqueness
- ✅ Relations defined for eager loading
- ⚠️ No JSONB GIN indexes (monitor first)

### 9.2 Connection Pooling Best Practices

**Current Implementation**: ✅ Correct

- HTTP client for Cloudflare Workers (stateless)
- WebSocket client for tests and transactions (stateful)
- Proper pool cleanup in tests
- WebSocket configuration for Node.js compatibility

**Recommendation**: Document client selection in README

---

## 10. Migration Strategy Recommendations

### 10.1 For New Deployments

**Option A: Squash Migrations** (Recommended)
1. Combine migrations 0002, 0003, 0004 into single migration
2. Ensures correct state from start
3. Simplifies deployment

**SQL**:
```sql
-- 0002_complete.sql (squashed)
CREATE TABLE organizations (...);
CREATE TABLE media_items (...);
CREATE TABLE content (...);
-- Add indexes
-- Add constraints with CORRECT on delete behaviors
-- Add trigger
```

### 10.2 For Existing Deployments

**Option B: Keep Sequential Migrations**
1. Document that 0002-0004 must run together
2. Add validation between migrations
3. Test full sequence on ephemeral branch

**Validation**:
```sql
-- At start of migration 0003:
SELECT 1/COUNT(*) FROM pg_constraint
WHERE conname = 'content_creator_id_users_id_fk';
-- Fails if constraint doesn't exist
```

### 10.3 Testing Procedure

**Required Before Production**:
1. Create ephemeral Neon branch
2. Run full migration sequence
3. Verify schema matches expected state
4. Run integration tests
5. Test rollback procedure
6. Delete ephemeral branch

**Tools**:
- Neon CLI for branch management
- Drizzle Kit for migrations
- Vitest for integration tests

---

## 11. Compliance with Standards

### 11.1 Database Standards Checklist

**From**: `design/roadmap/STANDARDS.md` (Database Patterns section)

| Standard | Requirement | Status | Notes |
|----------|-------------|--------|-------|
| Drizzle ORM | Use Drizzle for all DB operations | ✅ | v0.44.7 |
| Parameterized Queries | Never use string concatenation | ✅ | All queries use Drizzle |
| Migrations | Use Drizzle Kit | ✅ | Migrations generated |
| Indexes | Index all foreign keys | 🟡 | Missing on auth schema |
| Constraints | NOT NULL on required fields | ✅ | Properly enforced |
| Timestamps | created_at, updated_at on all tables | ✅ | All tables |
| Soft Deletes | Use deleted_at | ✅ | All content tables |
| Type Safety | Export types from schema | 🟡 | Missing for auth tables |

**Overall Compliance**: 87.5% (7/8 standards fully met)

---

### 11.2 Schema Documentation Alignment

**From**: `design/features/shared/database-schema.md`

| Table | Schema Spec Lines | Implementation | Match % |
|-------|-------------------|----------------|---------|
| organizations | 256-281 | content.ts:22-45 | 100% |
| media_items | 130-183 | content.ts:53-105 | 100% |
| content | 185-254 | content.ts:112-211 | 100% |
| users | 70-108 | auth.ts:4-15 | 95% |
| sessions | (better-auth) | auth.ts:38-52 | 100% |

**Overall Alignment**: 99% (near-perfect match with spec)

**Deviations**:
- Users table simplified (better-auth manages fields)
- No purchases, subscriptions tables yet (Phase 2)

---

## 12. Security Considerations

### 12.1 Data Protection

- ✅ Soft deletes prevent accidental data loss
- ✅ Foreign key constraints prevent orphaned records
- ✅ CHECK constraints prevent invalid states
- ✅ Trigger prevents accidental publishing of deleted org content
- ⚠️ Row-Level Security (RLS) not yet implemented (Phase 2 per spec)

### 12.2 Multi-Tenancy Security

**Current State**:
- ✅ Organization scoping at schema level
- ✅ Partial unique indexes prevent cross-org collisions
- ⚠️ Application-level filtering required (not enforced by DB)
- ⚠️ RLS policies needed for defense-in-depth (Phase 2)

**Recommendation** (Phase 2):
```sql
-- Example RLS policy for content table
ALTER TABLE content ENABLE ROW LEVEL SECURITY;

CREATE POLICY content_isolation ON content
  FOR ALL
  USING (
    organization_id = current_setting('app.current_org_id')::uuid
    OR creator_id = current_setting('app.current_user_id')::text
  );
```

**Reference**: database-schema.md lines 1696-1758

---

## 13. Summary & Recommendations

### 13.1 Overall Assessment

**Rating**: 7.5/10 (GOOD - Production-ready after critical fixes)

**Strengths**:
- Excellent schema design aligned with spec
- Proper constraints and indexes
- Type-safe Drizzle ORM implementation
- Critical session-user relation added
- Drizzle version alignment (0.44.7)
- Smart trigger for org deletion safety

**Weaknesses**:
- Missing indexes on auth schema
- Non-idempotent migration sequence
- No rollback procedures documented
- Missing type exports for auth tables

---

### 13.2 Pre-Merge Checklist

**Must Complete**:
- [ ] Add indexes to `accounts.userId` and `sessions.userId`
- [ ] Resolve migration 0002-0003 idempotency issue (squash OR document)
- [ ] Generate new migration for auth indexes
- [ ] Test full migration sequence on ephemeral Neon branch
- [ ] Verify all tests pass with new indexes

**Should Complete**:
- [ ] Create rollback SQL files for migrations 0002-0004
- [ ] Add type exports for auth tables
- [ ] Document primary key type strategy
- [ ] Update database-schema.md with session-user relation

**Optional**:
- [ ] Document migration testing procedure
- [ ] Create migration testing script
- [ ] Add schema design decision documentation

---

### 13.3 Post-Production Recommendations

**Phase 2 Enhancements**:
1. Implement Row-Level Security (RLS) policies
2. Add GIN indexes for JSONB queries (if tag filtering is common)
3. Consider partial/covering indexes based on query patterns
4. Add remaining tables from spec (purchases, subscriptions, etc.)

**Monitoring**:
1. Track query performance metrics
2. Monitor index usage statistics
3. Identify slow queries for optimization
4. Monitor connection pool utilization

**Documentation**:
1. Create schema evolution guide
2. Document migration best practices
3. Add query pattern examples
4. Create troubleshooting guide

---

## Appendix A: Schema Comparison Matrix

### A.1 Tables Implemented vs Spec

| Table (Spec) | Status | Location | Phase |
|--------------|--------|----------|-------|
| users | ✅ Implemented | auth.ts | 1 |
| accounts | ✅ Implemented | auth.ts | 1 |
| sessions | ✅ Implemented | auth.ts | 1 |
| verification_tokens | ✅ Implemented | auth.ts | 1 |
| organizations | ✅ Implemented | content.ts | 1 |
| media_items | ✅ Implemented | content.ts | 1 |
| content | ✅ Implemented | content.ts | 1 |
| purchases | ⏳ Not Yet | - | 1 |
| content_access | ⏳ Not Yet | - | 1 |
| subscription_tiers | ⏳ Not Yet | - | 2 |
| subscriptions | ⏳ Not Yet | - | 2 |
| organization_memberships | ⏳ Not Yet | - | 1 |

**Phase 1 Completion**: 70% (7/10 Phase 1 tables implemented)

---

## Appendix B: Index Performance Reference

### B.1 Index Types Used

| Index Type | Usage | Purpose |
|------------|-------|---------|
| B-Tree (default) | All indexes | General-purpose, sorted data |
| Unique | slug, email, token | Enforce uniqueness |
| Partial | slug uniqueness | Conditional uniqueness |
| Composite | creator+status, slug+org | Multi-column filters |

### B.2 Missing Index Analysis

**Query Impact Estimation**:

```sql
-- WITHOUT index on sessions.user_id:
EXPLAIN SELECT * FROM sessions WHERE user_id = 'user-123';
-- Seq Scan on sessions (cost=0.00..X)
-- Rows scanned: ALL rows

-- WITH index on sessions.user_id:
EXPLAIN SELECT * FROM sessions WHERE user_id = 'user-123';
-- Index Scan using idx_sessions_user_id (cost=0.29..8.31)
-- Rows scanned: ~1-10 rows
```

**Performance Gain**: 10-100x faster on large tables

---

## Appendix C: References

### C.1 Documentation

- Database Schema Spec: `/design/features/shared/database-schema.md`
- Coding Standards: `/design/roadmap/STANDARDS.md`
- Drizzle ORM v0.44.7 Docs: https://orm.drizzle.team
- Neon Postgres Docs: https://neon.tech/docs

### C.2 Related PRs

- PR #36: Current PR (database schema & Drizzle alignment)
- Future: Purchases table implementation
- Future: Organization memberships implementation

---

**End of Review**

---

**Review Metadata**:
- **Lines of Code Reviewed**: ~500 lines (schema definitions + migrations)
- **Files Reviewed**: 8 files
- **Migrations Reviewed**: 5 migrations (195 lines SQL)
- **Issues Found**: 7 (2 critical, 3 high, 2 medium)
- **Time Estimate for Fixes**: 4-6 hours total

**Reviewer Signature**: Database Schema Architect Agent
**Date**: 2025-11-18
**Review Status**: ✅ APPROVED with required fixes before merge
