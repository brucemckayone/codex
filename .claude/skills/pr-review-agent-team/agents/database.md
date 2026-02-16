# Database Agent Specification

## Domain
Drizzle ORM patterns, query scoping, soft deletes, transaction safety, schema design.

## File Patterns to Review
- `packages/database/src/schema/**/*.ts`
- `packages/database/src/**/*.ts` (scoping helpers, queries)
- `packages/*/src/services/**/*.ts` (all database queries)

## Checklist

### Query Scoping (CRITICAL - Security Vulnerability)

**CRITICAL** = Blocking issue, **WARN** = Should fix, **INFO** = Suggestion

- [CRITICAL] ALL queries use `scopedNotDeleted(table, creatorId)` or `orgScopedNotDeleted(table, orgId)`
- [CRITICAL] NEVER query by ID alone (data leak vulnerability)
- [CRITICAL] Soft delete filtering via `whereNotDeleted()` or `scopedNotDeleted()`
- [WARN] Use `withCreatorScope()` for UPDATE/DELETE operations
- [CRITICAL] No queries without user/org context in multi-tenant code
- [CRITICAL] List queries always scoped and paginated

### Transaction Safety

- [CRITICAL] Multi-step operations use `db.transaction()`
- [CRITICAL] Use `dbWs` for transactions, NOT `dbHttp`
- [WARN] Single queries don't need transactions
- [CRITICAL] State-changing operations verify ownership before mutate
- [WARN] Transactions handle rollback properly
- [INFO] Consider deadlock risks in concurrent operations

### Schema Patterns

- [WARN] Tables include `id`, `createdAt`, `updatedAt` columns
- [WARN] Soft delete tables have `deletedAt` column with default `null`
- [WARN] Creator-owned tables have `creatorId` column
- [WARN] Org tables have `organizationId` with proper FK
- [CRITICAL] No physical DELETE operations (use soft delete)
- [INFO] Indexes exist for frequently queried columns
- [INFO] Foreign keys have proper cascading rules

### Migration Safety

- [WARN] Migrations use sequential naming `XXXX_name.sql`
- [WARN] Use `statement-breakpoint` for multi-statement migrations
- [CRITICAL] No destructive migrations without data backup plan
- [INFO] Migrations are reversible

### Query Performance

- [INFO] N+1 queries identified (multiple queries in loops)
- [WARN] Use `db.query` with relations instead of separate queries
- [INFO] Appropriate use of indexes

## Code Examples

### Correct: Scoped Query with Soft Delete
```typescript
// packages/content/src/services/content-service.ts
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

### Incorrect: Missing Soft Delete Filter
```typescript
// ❌ CRITICAL: Returns deleted items
async getByCreator(creatorId: string) {
  return await this.db.query.content.findMany({
    where: eq(content.creatorId, creatorId)
  });
}
```

### Correct: Transaction for Multi-Step
```typescript
// packages/content/src/services/content-service.ts
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

### Incorrect: Physical Delete
```typescript
// ❌ CRITICAL: Physical delete violates soft-delete pattern
async delete(id: string, creatorId: string) {
  await this.db.delete(contentTable)
    .where(eq(contentTable.id, id));
}
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| Scoping violations that are auth issues | `security-reviewer` |
| Unscoped queries in services | `service-reviewer` |
| Query patterns in routes | `worker-reviewer` |
| Missing test coverage for queries | `testing-reviewer` |

## Critical File References

- `packages/database/src/schema/content.ts` - Table patterns
- `packages/database/src/schema/users.ts` - User schema patterns
- `packages/database/src/scoping.ts` - Scoping helpers
- `packages/database/src/index.ts` - DB exports (dbHttp, dbWs)
- `packages/content/src/services/content-service.ts` - Query patterns
- `packages/organization/src/services/organization-service.ts` - Org scoping
