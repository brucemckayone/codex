# Database Planning Agent Specification

## Domain
Drizzle ORM patterns, query scoping, soft deletes, transaction safety, schema design, migrations.

## Purpose
Generate implementation plans for database work including schema changes, migrations, and query patterns. Ensures compliance with the Database PR review agent.

## File Patterns to Review
- `packages/database/src/schema/**/*.ts` - Table definitions
- `packages/database/src/migrations/**/*.sql` - Migration files
- `packages/database/src/**/*.ts` - Scoping helpers, queries

## Compliance Standards (PR Review Agents)

Your plans must comply with:
- **Database Agent**: `.claude/skills/pr-review-agent-team/agents/database.md`

**CRITICAL Rules**:
- [CRITICAL] ALL queries use `scopedNotDeleted(table, creatorId)` or `orgScopedNotDeleted(table, orgId)`
- [CRITICAL] NEVER query by ID alone (data leak vulnerability)
- [CRITICAL] Soft delete filtering via `whereNotDeleted()` or `scopedNotDeleted()`
- [CRITICAL] Multi-step operations use `db.transaction()` with `dbWs`
- [CRITICAL] No physical DELETE operations (use soft delete)

## Checklist

### Query Scoping (CRITICAL - Security Vulnerability)

- [CRITICAL] ALL queries use `scopedNotDeleted(table, creatorId)` or `orgScopedNotDeleted(table, orgId)`
- [CRITICAL] NEVER query by ID alone
- [CRITICAL] Soft delete filtering via `whereNotDeleted()` or `scopedNotDeleted()`
- [WARN] Use `withCreatorScope()` for UPDATE/DELETE operations
- [CRITICAL] No queries without user/org context in multi-tenant code
- [CRITICAL] List queries always scoped and paginated

### Transaction Safety (CRITICAL)

- [CRITICAL] Multi-step operations use `db.transaction()`
- [CRITICAL] Use `dbWs` for transactions, NOT `dbHttp`
- [WARN] Single queries don't need transactions
- [CRITICAL] State-changing operations verify ownership before mutate
- [WARN] Transactions handle rollback properly
- [INFO] Consider deadlock risks in concurrent operations

### Schema Patterns (CRITICAL)

- [WARN] Tables include `id`, `createdAt`, `updatedAt` columns
- [WARN] Soft delete tables have `deletedAt` column with default `null`
- [WARN] Creator-owned tables have `creatorId` column
- [WARN] Org tables have `organizationId` with proper FK
- [CRITICAL] No physical DELETE operations (use soft delete)
- [INFO] Indexes exist for frequently queried columns
- [INFO] Foreign keys have proper cascading rules

### Migration Safety (CRITICAL)

- [WARN] Migrations use sequential naming `XXXX_name.sql`
- [WARN] Use `statement-breakpoint` for multi-statement migrations
- [CRITICAL] No destructive migrations without data backup plan
- [INFO] Migrations are reversible

## Code Examples

### Correct: Scoped Query with Soft Delete

```typescript
import { scopedNotDeleted, eq, and } from '@codex/database';
import { content } from '@codex/database/schema';

async getById(id: string, creatorId: string) {
  const item = await this.db.query.content.findFirst({
    where: and(
      eq(content.id, id),
      scopedNotDeleted(content, creatorId)
    ),
    with: {
      mediaItems: true // Relations loaded efficiently
    }
  });

  if (!item) {
    throw new NotFoundError('Content not found');
  }
  return item;
}
```

### Incorrect: Unscoped Query (CRITICAL)

```typescript
// ❌ CRITICAL: No scoping - data leak vulnerability
async getById(id: string) {
  const item = await this.db.query.content.findFirst({
    where: eq(content.id, id)
  });
  return item;
}
```

### Correct: Transaction for Multi-Step

```typescript
async createWithMedia(data: ContentData, media: MediaData[]) {
  return await this.dbWs.transaction(async (tx) => {
    const content = await tx.insert(contentTable).values(data).returning();
    const mediaItems = await tx.insert(mediaTable).values(
      media.map(m => ({ ...m, contentId: content[0].id }))
    ).returning();
    return { content: content[0], mediaItems };
  });
}
```

### Incorrect: Wrong DB for Transactions

```typescript
// ❌ CRITICAL: dbHttp doesn't support transactions
async createWithMedia(data: ContentData, media: MediaData[]) {
  return await this.dbHttp.transaction(async (tx) => {
    // This will fail!
  });
}
```

### Correct: Soft Delete Operation

```typescript
async delete(id: string, creatorId: string) {
  const result = await this.db.update(contentTable)
    .set({ deletedAt: new Date() })
    .where(and(
      eq(contentTable.id, id),
      eq(contentTable.creatorId, creatorId)
    ));
  return result;
}
```

## Plan Output Format

```markdown
## Database Implementation Plan

### Applicable PR Review Agents (Compliance Standards)
- Database Agent: `.claude/skills/pr-review-agent-team/agents/database.md`

---

## Phase 1: Schema Changes (Database Agent Compliance)

### File to Create/Modify
- `packages/database/src/schema/[table].ts`

### Implementation Instructions
**Read this pattern first**:
- `packages/database/src/schema/content.ts`

**Database Agent Requirements** (CRITICAL):
- Tables include `id`, `createdAt`, `updatedAt`
- Soft delete tables have `deletedAt` column
- Creator-owned tables have `creatorId` column
- Proper foreign key relationships

**Schema Template**:
```typescript
import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { users } from './users';

export const tableName = pgTable('table_name', {
  id: uuid('id').defaultRandom().primaryKey(),
  creatorId: uuid('creator_id').notNull().references(() => users.id),
  // ... other columns
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'), // Soft delete
});

export const tableNameRelations = relations(tableName, ({ many }) => ({
  // Define relations
}));
```

**Acceptance Criteria**:
- [ ] Has all required columns
- [ ] Has soft delete column
- [ ] Has proper foreign keys
- [ ] Has relations defined

---

## Phase 2: Migration (Database Agent Compliance)

### File to Create
- `packages/database/src/migrations/0001_[description].sql`

### Implementation Instructions
**Migration Requirements**:
- Use sequential naming `XXXX_name.sql`
- Use `statement-breakpoint` for multi-statement
- Non-destructive if possible
- Include rollback in comments

**Migration Template**:
```sql
-- Migration: [Description]
-- Created: [Date]

CREATE TABLE [table_name] (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id),
  -- ... other columns
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_[table]_creator_id ON [table_name](creator_id);
CREATE INDEX idx_[table]_deleted_at ON [table_name](deleted_at);

-- Rollback:
-- DROP TABLE [table_name];
```

**Acceptance Criteria**:
- [ ] Has sequential naming
- [ ] Has statement breakpoints
- [ ] Has rollback comments
- [ ] Creates indexes

---

## Phase 3: Query Patterns (Database Agent Compliance)

### Scoping Requirements (CRITICAL):
- All queries use `scopedNotDeleted(table, creatorId)`
- Never query by ID alone
- Use `dbWs` for transactions

**Query Template**:
```typescript
import { scopedNotDeleted, eq, and } from '@codex/database';

async getById(id: string, creatorId: string) {
  const item = await this.db.query.tableName.findFirst({
    where: and(
      eq(tableName.id, id),
      scopedNotDeleted(tableName, creatorId)
    )
  });

  if (!item) {
    throw new NotFoundError('[Entity] not found');
  }
  return item;
}
```

**Acceptance Criteria**:
- [ ] Uses scoped queries
- [ ] Handles not found
- [ ] Uses proper error types

---

## Deep Dive References
- Table patterns: `packages/database/src/schema/content.ts`
- User schema: `packages/database/src/schema/users.ts`
- Scoping helpers: `packages/database/src/scoping.ts`
- DB exports: `packages/database/src/index.ts`
- Query examples: `packages/content/src/services/content-service.ts`
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| Scoping violations that are auth issues | `security-planner` |
| Unscoped queries in services | `backend-planner` |
| Migration affects existing data | Note backup requirements |
| Schema changes require service updates | `backend-planner` |

## Critical File References

- `packages/database/src/schema/content.ts` - Table patterns
- `packages/database/src/schema/users.ts` - User schema patterns
- `packages/database/src/scoping.ts` - Scoping helpers
- `packages/database/src/index.ts` - DB exports (dbHttp, dbWs)
- `packages/content/src/services/content-service.ts` - Query patterns
- `packages/organization/src/services/organization-service.ts` - Org scoping
