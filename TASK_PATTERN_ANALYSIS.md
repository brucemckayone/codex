# Task Pattern Analysis: Missing Design Patterns & Bad Assumptions

**Date**: 2026-02-14
**Analysis**: Compared 50+ beads tasks against actual codebase architecture

---

## Executive Summary

**Overall Quality**: Tasks are well-structured with good descriptions, acceptance criteria, and dependencies.

**Critical Issues Found**:
1. **Backend tasks missing core implementation patterns** (procedure(), BaseService, scoping)
2. **Frontend tasks reference outdated API patterns** (some corrected in review notes)
3. **Port inconsistencies** (hardcoded values vs SERVICE_PORTS constant)
4. **Incorrect API endpoint assumptions** (access check endpoint that doesn't exist)

---

## 🔴 Critical: Backend Implementation Patterns Missing

### Issue: Backend Tasks Don't Specify `procedure()` Requirement

**Affected Tasks**: ALL backend tasks (BE-02 through BE-11)

**Current State**: Tasks describe endpoints like:
```
Required Endpoint: GET /api/user/notification-preferences
Required Endpoint: POST /api/organizations/:orgId/members/invite
```

**Missing Pattern**: ALL worker endpoints MUST use `procedure()` from `@codex/worker-utils`. This is the **mandatory** pattern for:
- Policy enforcement (auth, roles, RBAC)
- Input validation (Zod schemas)
- Error handling (mapErrorToResponse)
- Response envelope (auto-wraps in { data: T })

**Correct Pattern**:
```typescript
// In workers/[worker]/src/routes/*.ts
import { procedure } from '@codex/worker-utils';
import { z } from 'zod';

app.get('/api/user/notification-preferences',
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx) => {
      return await ctx.services.notifications.getPreferences(ctx.user.id);
    },
  })
);

app.post('/api/organizations/:orgId/members/invite',
  procedure({
    policy: { auth: 'required', roles: ['admin', 'owner'] },
    input: {
      params: z.object({ orgId: z.string().uuid() }),
      body: inviteMemberSchema
    },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.organization.inviteMember(
        ctx.input.params.orgId,
        ctx.input.body,
        ctx.user.id
      );
    },
  })
);
```

**Reference**: `/packages/worker-utils/CLAUDE.md`, `/packages/worker-utils/src/procedure/procedure.ts`

---

### Issue: Backend Tasks Don't Specify Service Layer Pattern

**Affected Tasks**: BE-02, BE-03, BE-05, BE-06, BE-08, BE-09, BE-10

**Missing Pattern**: Services MUST extend `BaseService` and throw typed errors:

```typescript
// In packages/[service]/src/services/*.service.ts
import { BaseService, NotFoundError, ForbiddenError } from '@codex/service-errors';
import type { ServiceConfig } from '@codex/service-errors';

export class NotificationService extends BaseService {
  constructor(config: ServiceConfig) {
    super(config); // Initializes this.db, this.environment, this.obs
  }

  async getPreferences(userId: string) {
    const prefs = await this.db.query.notificationPreferences.findFirst({
      where: eq(schema.notificationPreferences.userId, userId),
    });

    if (!prefs) {
      throw new NotFoundError('Preferences not found', { userId });
    }

    return prefs;
  }
}
```

**Reference**: `/packages/service-errors/CLAUDE.md`

---

### Issue: Backend Tasks Don't Specify File Structure

**Missing**: WHERE to put the code

**Should Specify**:
1. **Worker route file**: `workers/[worker-name]/src/routes/[domain].ts`
2. **Service file**: `packages/[service-name]/src/services/[domain].service.ts`
3. **Schema file**: `packages/validation/src/[domain].ts`

**Example for BE-09 (User Profile Update)**:
```
Files to Create/Modify:
1. packages/validation/src/user.ts — Add updateProfileSchema
2. packages/auth/src/services/user.service.ts — Add updateProfile() method (extend BaseService)
3. workers/auth/src/routes/user.ts — Add PATCH /api/user/profile using procedure()
```

---

### Issue: Backend Tasks Don't Mention Database Scoping

**Critical Pattern Missing**: ALWAYS scope queries by creatorId/orgId

**Correct Pattern**:
```typescript
// Service method MUST scope to current user
async getContent(id: string, userId: string) {
  const content = await this.db.query.content.findFirst({
    where: and(
      eq(schema.content.id, id),
      eq(schema.content.creatorId, userId),  // ← REQUIRED scoping
      isNull(schema.content.deletedAt)       // ← Soft delete filter
    ),
  });

  if (!content) {
    throw new NotFoundError('Content not found', { contentId: id });
  }

  return content;
}
```

Or use the helper:
```typescript
import { scopedNotDeleted } from '@codex/database';

where: scopedNotDeleted(schema.content, userId)
```

**Reference**: `/packages/CLAUDE.md` — "Scoping: Always filter by creatorId or organizationId"

---

### Issue: Backend Tasks Don't Specify Which Worker

**Affected Tasks**: BE-02, BE-03, BE-05, BE-06, BE-08, BE-09, BE-10

**Problem**: Tasks say "create endpoint" but don't specify which worker

**Should Specify**:
- BE-09 (User profile): **Auth Worker** (42069) — `/api/user/*` paths
- BE-10 (Notifications): **Notifications-API Worker** (42075) — `/api/notifications/*` paths
- BE-06 (Org members): **Organization-API Worker** (42071) — `/api/organizations/:id/*` paths
- BE-08 (Stripe portal): **Ecom-API Worker** (42072) — `/api/checkout/*` paths

**Worker Assignment Rule**: Path prefix determines worker:
- `/api/auth/*` → Auth Worker
- `/api/user/*` → Auth Worker
- `/api/content/*` → Content-API Worker
- `/api/access/*` → Content-API Worker (shares deployment)
- `/api/organizations/*` → Organization-API Worker
- `/api/checkout/*` → Ecom-API Worker
- `/api/admin/*` → Admin-API Worker

---

### Issue: Status Code Conventions Not Specified

**Missing Pattern**: Success status codes for different operations

**Should Specify**:
```typescript
POST (create)   → successStatus: 201
PATCH (update)  → successStatus: 200 (default)
DELETE (remove) → successStatus: 204
POST (action)   → successStatus: 200 (default)
```

**Example**:
```typescript
// Create: 201 Created
app.post('/api/content',
  procedure({
    successStatus: 201,  // ← Must specify for POST create
    handler: async (ctx) => { ... }
  })
);

// Delete: 204 No Content
app.delete('/api/content/:id',
  procedure({
    successStatus: 204,  // ← Must specify for DELETE
    handler: async (ctx) => {
      await ctx.services.content.delete(ctx.input.params.id, ctx.user.id);
      return null;  // ← Must return null for 204
    }
  })
);
```

---

## 🟡 Medium: Frontend Pattern Issues

### Issue: Tasks Reference Old API Client Pattern

**Affected Tasks**: Codex-b0rx, Codex-xf08, some others

**Problem**: Task descriptions say:
```typescript
api.fetch('content', '/api/organizations/${slug}/content/by-slug/${contentSlug}')
```

**Correct Pattern**: Use **Remote Functions** with `query()` or `command()`:

```typescript
// In lib/remote/content.remote.ts
export const getContentBySlug = query(
  z.object({ orgSlug: z.string(), contentSlug: z.string() }),
  async ({ orgSlug, contentSlug }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.content.getBySlug(orgSlug, contentSlug);
  }
);

// In +page.server.ts
export async function load({ params }) {
  return {
    content: await getContentBySlug({
      orgSlug: params.slug,
      contentSlug: params.contentSlug
    })
  };
}
```

**Status**: Some tasks have this corrected in "Review Notes" but not in main description

**Reference**: `/apps/web/src/lib/remote/content.remote.ts`

---

### Issue: Access Check Pattern Incorrect

**Affected Tasks**: Codex-120q (PreviewPlayer), Codex-b0rx (Content Detail), review notes

**Problem**: Tasks mention endpoint that **doesn't exist**:
```
GET /api/access/content/:id/check
```

**Correct Pattern**: Use `getStreamingUrl()` with try/catch:
```typescript
// In +page.server.ts
let hasAccess = false;
let streamUrl = null;

if (locals.userId) {
  try {
    const result = await getStreamingUrl(content.id);
    streamUrl = result.streamingUrl;
    hasAccess = true;
  } catch (err) {
    if (err.statusCode === 403) {
      hasAccess = false;  // User doesn't own/purchased
    } else {
      throw err;  // Other error, re-throw
    }
  }
}
```

**Rationale**: The streaming URL fetch itself **IS** the access check. 403 = no access.

**Reference**: Task review notes mention this but main descriptions don't

---

## 🟡 Medium: Port & URL Issues

### Issue: Hardcoded Ports Instead of Constants

**Affected Tasks**: Multiple backend task descriptions

**Problem**: Tasks mention ports directly:
- "Auth Worker (42069)"
- "Content-API (4001)"
- "Identity-API (42071)"

**Should Reference**: `@codex/constants` SERVICE_PORTS as **source of truth**:

```typescript
import { SERVICE_PORTS } from '@codex/constants';

// ✅ DO: Use constant
const authPort = SERVICE_PORTS.AUTH;  // 42069

// ❌ DON'T: Hardcode
const authPort = 42069;
```

**Reference**: `/packages/constants/src/urls.ts`

---

### Issue: Identity Worker Port Confusion

**Problem**: Documentation inconsistency

**Workers CLAUDE.md says**: Identity-API is port 42071
**Constants says**: `IDENTITY: 42074`

**Actual Ports in constants**:
```typescript
AUTH: 42069,
CONTENT: 4001,
ORGANIZATION: 42071,  // ← Organization, not Identity
ECOMMERCE: 42072,
ADMIN: 42073,
IDENTITY: 42074,      // ← Identity is 42074
NOTIFICATIONS: 42075,
MEDIA: 8788,
```

**Resolution Needed**: Clarify if Identity-API and Organization-API are separate or same worker

---

### Issue: Service URL Construction

**Some tasks don't mention**: Use `getServiceUrl()` from @codex/constants

**Correct Pattern**:
```typescript
import { getServiceUrl } from '@codex/constants';

const authUrl = getServiceUrl('auth', platform.env);
// Returns: http://localhost:42069 (dev) or https://auth.revelations.studio (prod)
```

**Don't construct manually**: `http://localhost:${SERVICE_PORTS.AUTH}`

---

## 🟢 Minor: Task-Specific Recommendations

### Codex-qv2 (Public Content Listing) — Too Brief

**Current**: 4 lines of description

**Should Add**:
1. **Exact endpoint path**: `GET /api/content?organizationSlug={slug}&visibility=public&status=published`
2. **Response schema**:
```typescript
{
  data: ContentItem[],
  meta: {
    page: number,
    limit: number,
    totalCount: number,
    totalPages: number
  }
}
```
3. **Security**: Rate limiting for unauthenticated requests (100/min per IP)
4. **Implementation file**: `workers/content-api/src/routes/content.ts` — modify existing list endpoint
5. **Service method**: `ContentService.listPublic()` — no auth required variant

---

### Backend Tasks Missing Schema Validation

**Should Specify**: Zod schema definition required

**Example for BE-09 (User Profile Update)**:
```typescript
// In packages/validation/src/user.ts
export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
});
```

Then use in procedure:
```typescript
input: { body: updateProfileSchema }
```

---

## 📋 Recommended Task Template Additions

### For Backend Tasks:

Add these sections to backend task templates:

```markdown
## Implementation Architecture

### Worker Layer
**File**: `workers/[worker-name]/src/routes/[domain].ts`

```typescript
app.METHOD('/api/path/:param',
  procedure({
    policy: { auth: 'required', roles: [...] },
    input: { params, body, query },
    successStatus: 201|200|204,
    handler: async (ctx) => {
      return await ctx.services.[service].[method](ctx.input, ctx.user.id);
    },
  })
);
```

### Service Layer
**File**: `packages/[service]/src/services/[domain].service.ts`

```typescript
export class ServiceName extends BaseService {
  async method(input, userId) {
    // 1. Validate business rules
    // 2. Query database with scoping: scopedNotDeleted(table, userId)
    // 3. Throw typed errors (NotFoundError, ForbiddenError, etc.)
    // 4. Return typed result
  }
}
```

### Validation Layer
**File**: `packages/validation/src/[domain].ts`

```typescript
export const inputSchema = z.object({ ... });
```

### Database Scoping
**Required**: Always filter by creatorId/orgId and check deletedAt
```typescript
where: and(
  eq(table.id, id),
  eq(table.creatorId, userId),  // ← REQUIRED
  isNull(table.deletedAt)       // ← REQUIRED
)
```
```

---

### For Frontend Tasks:

Add these sections:

```markdown
## Data Fetching Pattern

### Remote Function
**File**: `apps/web/src/lib/remote/[domain].remote.ts`

```typescript
export const functionName = query(
  inputSchema,
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.[service].[method](params);
  }
);
```

### Server Load
**File**: `apps/web/src/routes/[...]/+page.server.ts`

```typescript
export async function load({ params, locals }) {
  return {
    data: await functionName(params)
  };
}
```

### Component Usage
**File**: `apps/web/src/routes/[...]/+page.svelte`

```svelte
<script lang="ts">
  let { data } = $props();
</script>

{#if data}
  <Component {data} />
{/if}
```
```

---

## 🎯 Action Items

### Immediate (Before Implementation Starts)

1. **Update BE-02 through BE-11** with:
   - procedure() usage examples
   - BaseService extension requirement
   - File paths (worker route, service, schema)
   - Database scoping requirements
   - Which worker the endpoint belongs to

2. **Update Codex-qv2** with:
   - Exact endpoint path and query params
   - Response schema
   - Implementation file paths
   - Security/rate limiting notes

3. **Clarify Identity vs Organization Worker**:
   - Are they the same worker?
   - Update workers/CLAUDE.md or constants to match

### Medium Priority

4. **Update frontend tasks** (Codex-b0rx, Codex-xf08, etc.):
   - Remove direct `api.fetch()` references from main description
   - Promote remote function pattern from review notes to main spec

5. **Standardize port references**:
   - Always reference `@codex/constants` SERVICE_PORTS
   - Remove hardcoded port numbers

### Low Priority

6. **Create task templates** with architecture sections (above)
7. **Add "Common Mistakes" section** to package CLAUDE.md files

---

## ✅ What's Already Good

**Strengths of Current Tasks**:
- Clear objectives and acceptance criteria
- Effort estimates
- Dependency tracking (blocks/blocked-by)
- Most have review notes with corrections
- Frontend tasks have good file structure and component specs
- UI component tasks (ContentCard, Pagination) are excellent

**Keep These Patterns**:
- Acceptance criteria checklists
- Design doc references
- Code examples in task descriptions
- Review notes section for corrections

---

## 📚 Reference Quick Links

- **procedure() docs**: `/packages/worker-utils/CLAUDE.md`
- **BaseService docs**: `/packages/service-errors/CLAUDE.md`
- **Remote functions example**: `/apps/web/src/lib/remote/content.remote.ts`
- **SERVICE_PORTS**: `/packages/constants/src/urls.ts`
- **Worker architecture**: `/workers/CLAUDE.md`
- **Package overview**: `/packages/CLAUDE.md`
