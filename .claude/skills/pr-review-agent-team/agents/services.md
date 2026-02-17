# Service Agent Specification

## Domain
BaseService pattern, error handling, business logic placement, validation, state transitions.

## File Patterns to Review
- `packages/*/src/services/**/*.ts`
- `packages/service-errors/src/**/*.ts`
- All files with `*Service.ts` naming

## Checklist

### BaseService Pattern

**CRITICAL** = Blocking issue, **WARN** = Should fix, **INFO** = Suggestion

- [CRITICAL] All services extend `BaseService`
- [WARN] Constructor accepts `{ db, environment }`
- [WARN] Use `this.obs` for observability/logging
- [WARN] Use `this.handleError()` for error wrapping
- [INFO] Services are stateless (no class properties besides dependencies)

### Error Handling

- [CRITICAL] Throw specific error classes (NotFoundError, BusinessLogicError, ConflictError)
- [CRITICAL] Domain errors in `packages/[domain]/src/errors.ts`
- [WARN] Error context includes only IDs (no PII)
- [CRITICAL] No generic `new Error()` usage
- [WARN] Errors have helpful messages for debugging
- [INFO] Use ServiceError base class for custom errors

### Business Logic Placement

- [CRITICAL] No business logic in workers (belongs in services)
- [WARN] Service methods are pure (no HTTP concerns)
- [WARN] External API calls wrapped with error handling
- [INFO] Services are testable without HTTP context

### Validation

- [WARN] Defensive validation with Zod schemas (belt + suspenders)
- [CRITICAL] Validate business rules (e.g., content type matches media type)
- [WARN] Use `.parse()` not `.safeParse()` for internal validation
- [INFO] Reuse validation schemas from `@codex/validation`

### State Transitions

- [WARN] Verify state before transitions (e.g., draft → published)
- [CRITICAL] Prevent invalid transitions
- [WARN] Update `updatedAt` on state changes
- [INFO] Consider state machine pattern for complex transitions

### Database Operations

- [CRITICAL] All queries scoped by creatorId/orgId
- [CRITICAL] Multi-step operations use transactions
- [WARN] Single operations don't need transactions
- [CRITICAL] Verify ownership before state changes

## Code Examples

### Correct: Service Extending BaseService
```typescript
// packages/content/src/services/content-service.ts
import { BaseService } from '@codex/service-errors';
import { NotFoundError, ConflictError } from '@codex/service-errors';
import { scopedNotDeleted, eq, and } from '@codex/database';

export class ContentService extends BaseService {
  async create(creatorId: string, data: ContentData) {
    try {
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

### Incorrect: Not Extending BaseService
```typescript
// ❌ CRITICAL: Service doesn't extend BaseService
export class ContentService {
  constructor(private db: Database) {}

  async create(creatorId: string, data: ContentData) {
    // Missing error handling, observability
    const result = await this.db.insert(contentTable).values(data);
    return result;
  }
}
```

### Incorrect: Generic Error Usage
```typescript
// ❌ CRITICAL: Using generic Error instead of typed errors
async getById(id: string, creatorId: string) {
  const item = await this.db.query.content.findFirst({
    where: and(eq(content.id, id), scopedNotDeleted(content, creatorId))
  });

  if (!item) {
    throw new Error('Content not found'); // Wrong!
  }

  return item;
}

// ✅ CORRECT
if (!item) {
  throw new NotFoundError('Content not found', { contentId: id });
}
```

### Correct: State Transition with Validation
```typescript
async publish(id: string, creatorId: string) {
  // Verify ownership
  const content = await this.getByIdScoped(id, creatorId);

  // Validate state transition
  if (content.status === 'published') {
    throw new BusinessLogicError('Content is already published', {
      contentId: id,
      currentState: content.status
    });
  }

  if (content.status !== 'draft') {
    throw new BusinessLogicError('Only draft content can be published', {
      contentId: id,
      currentState: content.status
    });
  }

  // Perform transition
  const result = await this.db.update(contentTable)
    .set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(contentTable.id, id))
    .returning();

  this.obs.info('Content published', { contentId: id });
  return result[0];
}
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

### Incorrect: Business Logic in Worker
```typescript
// ❌ CRITICAL: Business logic belongs in service
// workers/content-api/src/routes/content.ts
export const createContentRoute = procedure({
  policy: { auth: 'required' },
  input: { body: createContentSchema }
}).handler(async ({ ctx, input }) => {
  // This logic should be in ContentService
  const slug = slugify(input.body.title);

  // Check for duplicates
  const existing = await ctx.db.query.content.findFirst({
    where: eq(content.slug, slug)
  });

  if (existing) {
    throw new ConflictError('Slug exists');
  }

  // Create content
  const result = await ctx.db.insert(contentTable).values({
    ...input.body,
    slug,
    creatorId: ctx.session.userId
  });

  return { data: result };
});
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| Missing query scoping | `database-reviewer` |
| Error handling issues | `architecture-reviewer` |
| External API integration issues | `security-reviewer` |
| Business rules that need tests | `testing-reviewer` |

## Critical File References

- `packages/service-errors/src/base-errors.ts` - BaseService and error classes
- `packages/service-errors/src/index.ts` - Error exports
- `packages/content/src/services/content-service.ts` - Service patterns
- `packages/purchase/src/services/purchase-service.ts` - External API patterns
- `packages/organization/src/services/organization-service.ts` - Organization logic
- `packages/access/src/services/content-access-service.ts` - Access control logic
