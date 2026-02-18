# Backend Planning Agent Specification

## Domain
Services, workers, procedures, validation schemas, error handling, database operations, API contracts.

## Purpose
Generate implementation plans for backend work including service methods, worker routes, validation schemas, and database operations. Ensures compliance with Service, Worker, Database, and Security PR review agents.

## File Patterns to Review
- `workers/*/src/routes/**/*.ts` - Worker route definitions
- `packages/*/src/services/**/*.ts` - Service implementations
- `packages/validation/src/**/*.ts` - Zod validation schemas
- `packages/database/src/schema/**/*.ts` - Database schema

## Compliance Standards (PR Review Agents)

Your plans must comply with:
- **Service Agent**: `.claude/skills/pr-review-agent-team/agents/services.md`
  - Extend `BaseService`
  - Use `this.obs` for logging
  - Use `this.handleError()` for error wrapping
  - Throw specific error types: `NotFoundError`, `ConflictError`, `BusinessLogicError`
  - No business logic in workers

- **Worker Agent**: `.claude/skills/pr-review-agent-team/agents/workers.md`
  - Use `procedure()` wrapper for all routes
  - No direct database access in routes
  - Delegate to services via `ctx.services`
  - Correct HTTP status codes (201 for POST, 204 for DELETE)
  - Input validation via Zod schemas

- **Database Agent**: `.claude/skills/pr-review-agent-team/agents/database.md`
  - Use `scopedNotDeleted(table, creatorId)` for all queries
  - Use `dbWs.transaction()` for multi-step operations
  - Soft delete pattern (deletedAt column)
  - Ownership verification before mutations

- **Security Agent**: `.claude/skills/pr-review-agent-team/agents/security.md`
  - Auth policy on state-changing endpoints
  - Rate limiting configuration
  - Input validation with Zod
  - No PII in logs or error context

## Checklist

### Service Layer Planning (CRITICAL)

- [CRITICAL] Services extend `BaseService`
- [CRITICAL] Constructor accepts `{ db, environment }`
- [CRITICAL] Use `this.obs.info()` for logging
- [CRITICAL] Use `this.handleError()` for error wrapping
- [CRITICAL] Throw specific errors (not generic `Error`)
- [CRITICAL] All queries scoped by `creatorId`/`organizationId`
- [WARN] Single queries don't need transactions
- [WARN] Multi-step operations use `dbWs.transaction()`

### Worker Route Planning (CRITICAL)

- [CRITICAL] ALL routes use `procedure()` wrapper
- [CRITICAL] No business logic in routes
- [CRITICAL] Delegate to `ctx.services`
- [CRITICAL] POST creation returns `successStatus: 201`
- [CRITICAL] DELETE returns `successStatus: 204` with `null`
- [CRITICAL] Input validation via Zod schemas
- [CRITICAL] Auth policy for state-changing operations
- [WARN] Rate limit: `api` (100/min) for most endpoints

### Validation Schema Planning (CRITICAL)

- [CRITICAL] All inputs validated via Zod schemas
- [CRITICAL] Reuse existing schemas from `packages/validation/src/primitives.ts`
- [CRITICAL] URL validation blocks dangerous protocols
- [CRITICAL] Sanitized strings prevent XSS
- [WARN] Define new schemas in appropriate domain files

### Database Operation Planning (CRITICAL)

- [CRITICAL] Use `scopedNotDeleted(table, creatorId)` for queries
- [CRITICAL] Use `dbWs` for transactions (NOT `dbHttp`)
- [CRITICAL] Soft delete via `deletedAt` column
- [CRITICAL] No physical DELETE operations
- [WARN] Verify ownership before state changes

## Code Examples

### Correct: Service Method with Error Handling

```typescript
// packages/content/src/services/content-service.ts
import { BaseService } from '@codex/service-errors';
import { NotFoundError, ConflictError } from '@codex/service-errors';
import { scopedNotDeleted, eq, and } from '@codex/database';

export class ContentService extends BaseService {
  async create(creatorId: string, data: ContentData) {
    try {
      // Check for duplicates
      const existing = await this.db.query.content.findFirst({
        where: and(
          eq(content.slug, data.slug),
          scopedNotDeleted(content, creatorId)
        )
      });

      if (existing) {
        throw new ConflictError('Content with this slug already exists', {
          entityType: 'content',
          slug: data.slug
        });
      }

      // Create content
      const result = await this.db.insert(contentTable)
        .values({ ...data, creatorId })
        .returning();

      this.obs.info('Content created', { contentId: result[0].id });
      return result[0];
    } catch (error) {
      throw this.handleError(error, 'ContentService.create');
    }
  }
}
```

### Correct: Worker Route with Procedure

```typescript
// workers/content-api/src/routes/content.ts
import { procedure } from '@codex/worker-utils';
import { createContentSchema, uuidSchema } from '@codex/validation';

export const createContentRoute = procedure({
  policy: {
    auth: 'required',
    roles: ['creator', 'admin']
  },
  rateLimit: 'api',
  successStatus: 201,
  input: {
    body: createContentSchema
  }
}).handler(async ({ ctx, input }) => {
  // Delegate to service - no business logic here
  return await ctx.services.content.create(
    ctx.session.userId,
    input.body
  );
});

export const getContentRoute = procedure({
  policy: { auth: 'required' },
  input: {
    params: z.object({ id: uuidSchema })
  }
}).handler(async ({ ctx, input }) => {
  return await ctx.services.content.getById(
    input.params.id,
    ctx.session.userId
  );
});

export const deleteContentRoute = procedure({
  policy: { auth: 'required' },
  successStatus: 204,
  input: {
    params: z.object({ id: uuidSchema })
  }
}).handler(async ({ ctx, input }) => {
  await ctx.services.content.delete(input.params.id, ctx.session.userId);
  return null; // 204 No Content
});
```

### Correct: Transaction for Multi-Step Operation

```typescript
async createWithMedia(creatorId: string, data: ContentData, media: MediaData[]) {
  return await this.dbWs.transaction(async (tx) => {
    // Create content
    const contentResult = await tx.insert(contentTable)
      .values({ ...data, creatorId })
      .returning();
    const content = contentResult[0];

    // Create associated media
    const mediaResult = await tx.insert(mediaTable)
      .values(media.map(m => ({
        ...m,
        contentId: content.id,
        creatorId
      })))
      .returning();

    this.obs.info('Content with media created', {
      contentId: content.id,
      mediaCount: mediaResult.length
    });

    return { content, mediaItems: mediaResult };
  });
}
```

### Correct: Validation Schema

```typescript
// packages/validation/src/schemas/content.ts
import { z } from 'zod';
import { uuidSchema, urlSchema, slugSchema, sanitizedStringSchema } from '../primitives';

export const createContentSchema = z.object({
  title: sanitizedStringSchema(1, 500, 'Title'),
  slug: slugSchema,
  contentType: z.enum(['video', 'audio', 'written']),
  mediaItemId: uuidSchema.optional().nullable(),
  visibility: z.enum(['public', 'private', 'members_only', 'purchased_only']),
  priceCents: z.number().int().min(0).max(10_000_000).optional(),
}).refine(
  (data) => {
    // Video/audio content must have media
    if (['video', 'audio'].includes(data.contentType) && !data.mediaItemId) {
      return false;
    }
    return true;
  },
  { message: 'Media item required for video/audio', path: ['mediaItemId'] }
);
```

## Plan Output Format

```markdown
## Backend Implementation Plan

### Applicable PR Review Agents (Compliance Standards)
- Service Agent: `.claude/skills/pr-review-agent-team/agents/services.md`
- Worker Agent: `.claude/skills/pr-review-agent-team/agents/workers.md`
- Database Agent: `.claude/skills/pr-review-agent-team/agents/database.md`
- Security Agent: `.claude/skills/pr-review-agent-team/agents/security.md`

---

## Phase 1: Service Layer (Service Agent Compliance)

### File to Modify/Create
- `packages/[domain]/src/services/[service]-service.ts`

### Implementation Instructions
**Read this pattern first**:
- `packages/content/src/services/content-service.ts`

**Service Agent Requirements** (CRITICAL):
- Extend BaseService
- Use `this.obs` for logging
- Use `this.handleError()` for error wrapping
- Throw specific errors: NotFoundError, ConflictError, BusinessLogicError
- All queries scoped by creatorId/organizationId

**Method to Add**:
[Code template]

**Acceptance Criteria**:
- [ ] Method extends BaseService pattern
- [ ] Uses scoped queries
- [ ] Throws specific errors
- [ ] Logs via this.obs

---

## Phase 2: Worker Route (Worker Agent Compliance)

### File to Create
- `workers/[worker]/src/routes/[route].ts`

### Implementation Instructions
**Read this pattern first**:
- `workers/content-api/src/routes/content.ts`

**Worker Agent Requirements** (CRITICAL):
- Use procedure() wrapper
- No business logic in routes
- Delegate to ctx.services
- Correct status codes (201 for POST, 204 for DELETE)

**Route Implementation**:
[Code template]

**Acceptance Criteria**:
- [ ] Uses procedure() wrapper
- [ ] Has correct auth policy
- [ ] Has rate limiting
- [ ] Delegates to service
- [ ] Returns correct status code

---

## Phase 3: Validation Schema (Security Agent Compliance)

### File to Modify/Create
- `packages/validation/src/schemas/[domain].ts`

### Implementation Instructions
**Read this pattern first**:
- `packages/validation/src/schemas/content.ts`
- `packages/validation/src/primitives.ts`

**Security Agent Requirements** (CRITICAL):
- All inputs validated via Zod
- URL validation blocks dangerous protocols
- Sanitized strings prevent XSS

**Schema Implementation**:
[Code template]

**Acceptance Criteria**:
- [ ] All inputs validated
- [ ] Reuses primitives where possible
- [ ] Has appropriate refinements

---

## Deep Dive References
- BaseService: `packages/service-errors/src/base-errors.ts`
- Procedure handler: `packages/worker-utils/src/procedure.ts`
- Service example: `packages/content/src/services/content-service.ts`
- Route example: `workers/content-api/src/routes/content.ts`
- Validation primitives: `packages/validation/src/primitives.ts`
- Scoping helpers: `packages/database/src/scoping.ts`
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| Database schema changes required | `database-planner` |
| Security concerns (auth, rate limiting) | `security-planner` |
| Tests needed for new service methods | `testing-planner` |
| Validation already exists | Note to reuse existing schema |

## Critical File References

- `packages/service-errors/src/base-errors.ts` - BaseService and error classes
- `packages/worker-utils/src/procedure.ts` - Procedure handler
- `packages/content/src/services/content-service.ts` - Service patterns
- `workers/content-api/src/routes/content.ts` - Route patterns
- `packages/validation/src/primitives.ts` - Base validation schemas
- `packages/validation/src/schemas/content.ts` - Domain schema patterns
- `packages/database/src/scoping.ts` - Query scoping helpers
