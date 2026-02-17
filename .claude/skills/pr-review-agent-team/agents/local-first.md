# Local-First Agent Specification

## Domain
TanStack DB collections, SvelteKit remote functions, SSR/hydration patterns, progressive enhancement, sync mechanisms, form handling.

## File Patterns to Review
- `apps/web/src/lib/collections/**/*.ts`
- `apps/web/src/lib/remote/*.remote.ts`
- `apps/web/src/routes/**/*.server.ts`
- `apps/web/src/routes/**/+page.svelte`
- `apps/web/src/routes/**/+page.ts`

## Checklist

### SvelteKit Remote Functions (CRITICAL)

**CRITICAL** = Blocking issue, **WARN** = Should fix, **INFO** = Suggestion

- [CRITICAL] Use `form()` for all form submissions (progressive enhancement)
- [CRITICAL] Use `query()` for cached reads
- [CRITICAL] Use `command()` for SPA-style mutations
- [CRITICAL] All remote functions use Zod schemas for validation
- [CRITICAL] Password fields prefixed with `_` to prevent repopulation
- [WARN] Remote functions defined in `.remote.ts` files
- [INFO] Use action result helper for consistent responses

### Progressive Enhancement (CRITICAL)

- [CRITICAL] All forms must work without JavaScript
- [CRITICAL] Use `<form {...formName}>` spread pattern
- [CRITICAL] Show `formName.pending` state for loading feedback
- [CRITICAL] Handle `formName.errors` for validation feedback
- [INFO] Forms enhance with `use:enhance` for better UX
- [INFO] Provide visual feedback during pending state

### SSR Data Loading

- [CRITICAL] Customer-facing pages use `+page.server.ts` for SSR
- [WARN] Admin dashboards may use client-side rendering
- [CRITICAL] Use `hydrateIfNeeded()` in `onMount()` for TanStack Query cache
- [CRITICAL] Define `staleTime` and `gcTime` for all queries
- [WARN] Use `export const ssr = true` for SEO-critical pages
- [INFO] Leverage SvelteKit's SSR for initial page load performance

### TanStack DB Collections (CRITICAL)

- [CRITICAL] Use `createCollection()` with `queryCollectionOptions()`
- [CRITICAL] Use `useLiveQuery()` for reactive queries over collections
- [CRITICAL] Define `getKey` function for unique identification
- [WARN] Implement `onUpdate` for optimistic updates
- [INFO] Use `initialData` for SSR hydration
- [INFO] Collection names follow plural convention (e.g., `contents`, `users`)

### Sync Mechanisms

- [CRITICAL] Background sync every 30 seconds when online
- [CRITICAL] Beacon API for critical uploads on page unload
- [WARN] Conflict resolution: timestamp-based (newer wins)
- [WARN] Show sync status to user (pending, syncing, synced, error)
- [INFO] Handle offline/online transitions gracefully
- [INFO] Queue failed requests for retry when online

### Session Handling

- [CRITICAL] Forward session cookies to all API calls
- [CRITICAL] Use `getRequestEvent()` for platform/cookies in remote functions
- [WARN] Handle session expiration gracefully
- [WARN] Redirect to login on 401 responses
- [INFO] Implement session refresh logic

### Error Boundaries (CRITICAL)

- [CRITICAL] Every route must have `+error.svelte`
- [CRITICAL] Error boundaries provide helpful fallback UI
- [WARN] Log errors server-side, don't expose internals
- [INFO] Include retry mechanisms in error boundaries

## Code Examples

### Correct: Remote Function with Form
```typescript
// apps/web/src/lib/remote/auth.remote.ts
import { form } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { loginSchema } from '$lib/schemas/auth';
import { authLogin } from '$lib/api';

export const loginForm = form(
  zod(loginSchema),
  async (data, { request }) => {
    const event = getRequestEvent();

    try {
      const result = await authLogin(data.email, data.password);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, errors: { email: ['Invalid credentials'] } };
    }
  }
);
```

### Correct: Progressive Enhancement Form
```svelte
<!-- apps/web/src/routes/(platform)/auth/login/+page.svelte -->
<script lang="ts">
  import { loginForm } from '$lib/remote/auth.remote';
  import { t } from '$lib/paraglide';
</script>

<form method="POST" {...loginForm}>
  <label>
    {$t('auth.email')}
    <input
      name="email"
      type="email"
      required
      aria-invalid={$loginForm.errors.email ? 'true' : undefined}
    />
    {#if $loginForm.errors.email}
      <span class="error">{$loginForm.errors.email}</span>
    {/if}
  </label>

  <label>
    {$t('auth.password')}
    <input
      name="_password"
      type="password"
      required
      aria-invalid={$loginForm.errors._password ? 'true' : undefined}
    />
    {#if $loginForm.errors._password}
      <span class="error">{$loginForm.errors._password}</span>
    {/if}
  </label>

  <button type="submit" disabled={$loginForm.pending}>
    {#if $loginForm.pending}
      {$t('auth.signing-in')}
    {:else}
      {$t('auth.sign-in')}
    {/if}
  </button>
</form>

{#if $loginForm.errors.general}
  <div role="alert" class="error">{$loginForm.errors.general}</div>
{/if}
```

### Incorrect: No Progressive Enhancement
```svelte
<!-- ❌ CRITICAL: Form doesn't work without JavaScript -->
<script>
  async function handleSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    // Direct fetch - no progressive enhancement
    await fetch('/api/login', { method: 'POST', body: formData });
  }
</script>

<form onsubmit={handleSubmit}>
  <input name="email" />
  <input name="password" />
  <button type="submit">Submit</button>
</form>
```

### Correct: TanStack DB Collection
```typescript
// apps/web/src/lib/collections/progress.ts
import { createCollection } from '@tanstack/svelte-query';
import { queryCollectionOptions } from '$lib/query-options';

export const progressCollection = createCollection({
  getKey: (id: string) => ['progress', id],
  queryCollectionOptions,
  onUpdate: (oldData, newData) => ({
    ...oldData,
    ...newData,
    updatedAt: new Date().toISOString()
  })
});

// Usage in component
import { useLiveQuery } from '@tanstack/svelte-query';
import { progressCollection } from '$lib/collections/progress';

const { data: progress } = useLiveQuery(
  progressCollection.getKey(contentId)
);
```

### Correct: SSR with Hydration
```typescript
// apps/web/src/routes/(platform)/library/+page.server.ts
import { listContents } from '$lib/api';

export async function load({ fetch, locals }) {
  const contents = await listContents({ fetch, session: locals.session });

  return {
    contents,
    // Set cache headers for SSR
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
    }
  };
}
```

```svelte
<!-- apps/web/src/routes/(platform)/library/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { hydrateIfNeeded, useQuery } from '@tanstack/svelte-query';
  import { listContentsQuery } from '$lib/query-options';

  // Data from SSR
  let { data } = $props();

  // Hydrate TanStack Query cache
  onMount(() => {
    hydrateIfNeeded(listContentsQuery(), data);
  });

  // Use reactive query
  const { data: contents } = useQuery(listContentsQuery());
</script>
```

### Incorrect: Missing Hydration
```svelte
<!-- ❌ CRITICAL: SSR data not hydrated to TanStack Query cache -->
<script>
  // Data from SSR but query will refetch on mount
  let { data } = $props();

  // Missing hydrateIfNeeded() - causes unnecessary refetch
  const { data: contents } = useQuery({
    queryKey: ['contents'],
    queryFn: () => listContents()
  });
</script>
```

### Correct: Query Options
```typescript
// apps/web/src/lib/query-options.ts
import { queryOptions } from '@tanstack/svelte-query';
import { listContents, getContentById } from '$lib/api';

export const listContentsQuery = (filters = {}) =>
  queryOptions({
    queryKey: ['contents', 'list', filters],
    queryFn: () => listContents(filters),
    staleTime: 30_000, // 30 seconds
    gcTime: 300_000 // 5 minutes
  });

export const contentByIdQuery = (id: string) =>
  queryOptions({
    queryKey: ['contents', 'detail', id],
    queryFn: () => getContentById(id),
    staleTime: 60_000, // 1 minute
    gcTime: 600_000 // 10 minutes
  });
```

### Correct: Error Boundary
```svelte
<!-- apps/web/src/routes/(platform)/library/+error.svelte -->
<script lang="ts">
  import { page } from '$app/stores';
  import * as paraglide from '$lib/paraglide';

  let error = $props();
  let { status } = $page;

  const errorMessages = {
    404: $t('errors.not-found'),
    401: $t('errors.unauthorized'),
    403: $t('errors.forbidden'),
    500: $t('errors.server-error')
  };
</script>

<div class="error-boundary">
  <h1>{status}</h1>
  <p>{errorMessages[status] || $t('errors.unknown')}</p>
  <a href="/">{/* @html */ $t('errors.go-home')}</a>
</div>
```

### Incorrect: Missing Error Boundary
```svelte
<!-- ❌ CRITICAL: No +error.svelte in route directory -->
<!-- If an error occurs, users see unhandled error message -->

<!-- Directory structure missing error boundary:
routes/
  (platform)/
    library/
      +page.svelte
      +page.server.ts
      # Missing: +error.svelte ❌
*/
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| Missing i18n in user-facing text | `component-reviewer` |
| Form accessibility issues | `component-reviewer` |
| CSS in component files | `css-reviewer` |
| Collection schema issues | `database-reviewer` |

## Critical File References

- `apps/web/src/lib/remote/auth.remote.ts` - Form patterns, progressive enhancement
- `apps/web/src/lib/remote/content.remote.ts` - Query and command patterns
- `apps/web/src/lib/collections/progress.ts` - Collection pattern
- `apps/web/src/lib/query-options.ts` - Query options factory
- `apps/web/src/routes/(platform)/library/+page.server.ts` - SSR loading
- `apps/web/src/routes/(platform)/library/+page.svelte` - Hydration pattern
- `apps/web/src/routes/(platform)/library/+error.svelte` - Error boundary example
- `apps/web/src/lib/paraglide/messages.js` - i18n messages

## Anti-Patterns to Watch For

```typescript
// ❌ CRITICAL: Direct fetch without remote function
const data = await fetch('/api/content').then(r => r.json());

// ❌ CRITICAL: No progressive enhancement
<form onsubmit={handleSubmit}>
  <input name="email" />
</form>

// ❌ CRITICAL: Password not prefixed (repopulated on error)
<input name="password" />

// ❌ CRITICAL: No Zod validation
export const myAction = async ({ request }) => {
  const data = await request.json();
  // No validation!
};

// ❌ CRITICAL: Missing staleTime/gcTime
useQuery({
  queryKey: ['contents'],
  queryFn: fetchContents
  // Missing cache config
});

// ❌ WARN: Missing error boundary
// routes/example/+page.svelte exists but no +error.svelte

// ✅ CORRECT
export const loginForm = form(zod(loginSchema), async (data) => {
  return await authLogin(data);
});

<form method="POST" {...loginForm}>
  <input name="_password" />
  <button disabled={$loginForm.pending}>Submit</button>
</form>

useQuery({
  queryKey: ['contents'],
  queryFn: fetchContents,
  staleTime: 30_000,
  gcTime: 300_000
});
```
