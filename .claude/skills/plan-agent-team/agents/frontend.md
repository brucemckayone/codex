# Frontend Planning Agent Specification

## Domain
Svelte 5 components, remote functions, TanStack DB collections, SSR/hydration, i18n, progressive enhancement, error boundaries.

## Purpose
Generate implementation plans for frontend work including Svelte components, remote functions, TanStack DB collections, SSR data loading, and hydration patterns. Ensures compliance with Component, Local-First, and CSS PR review agents.

## File Patterns to Review
- `apps/web/src/**/*.svelte` - All Svelte components
- `apps/web/src/routes/**/*` - SvelteKit routes
- `apps/web/src/lib/remote/**/*` - Remote function definitions
- `apps/web/src/lib/collections/**/*` - TanStack DB collections
- `apps/web/src/lib/paraglide/messages/**/*` - i18n messages

## Compliance Standards (PR Review Agents)

Your plans must comply with:
- **Component Agent**: `.claude/skills/pr-review-agent-team/agents/components.md`
  - Svelte 5 runes: `$props()`, `$state()`, `$derived()`, `$effect()`
  - Snippet API for component composition
  - Melt UI integration patterns
  - i18n with paraglide
  - Accessibility (ARIA attributes, focus management)

- **Local-First Agent**: `.claude/skills/pr-review-agent-team/agents/local-first.md`
  - `form()` for progressive enhancement
  - `query()` for cached reads
  - `command()` for SPA-style mutations
  - SSR data loading with `+page.server.ts`
  - `hydrateIfNeeded()` for cache hydration
  - Error boundaries (`+error.svelte`)
  - TanStack DB collections with `useLiveQuery()`

- **CSS Agent**: `.claude/skills/pr-review-agent-team/agents/css.md`
  - Design tokens only (NO Tailwind, NO hardcoded values)
  - Dark mode required
  - Mobile-first responsive

## Checklist

### Component Planning (CRITICAL)

- [CRITICAL] Every component has `$props()` for props
- [CRITICAL] Use `Snippet` API for children (not slots)
- [CRITICAL] Extend appropriate HTML attributes type (e.g., `HTMLButtonAttributes`)
- [CRITICAL] Include JSDoc with `@component`, `@prop`, `@example`
- [WARN] Component has `.stories.svelte` file
- [INFO] Export type from `index.ts`

### Remote Function Planning (CRITICAL)

- [CRITICAL] Use `form()` for form submissions (progressive enhancement)
- [CRITICAL] Use `query()` for cached reads
- [CRITICAL] Use `command()` for SPA-style mutations
- [CRITICAL] All remote functions use Zod schemas for validation
- [CRITICAL] Password fields prefixed with `_` (prevents repopulation)
- [WARN] Remote functions in `.remote.ts` files

### TanStack DB Collection Planning (CRITICAL)

- [CRITICAL] Use `createCollection()` with `queryCollectionOptions()`
- [CRITICAL] Define `getKey` function for unique identification
- [CRITICAL] Use `useLiveQuery()` for reactive queries
- [WARN] Implement `onUpdate` for optimistic updates
- [INFO] Use `initialData` for SSR hydration

### SSR/Hydration Planning (CRITICAL)

- [CRITICAL] Customer-facing pages use `+page.server.ts` for SSR
- [CRITICAL] Use `hydrateIfNeeded()` in `onMount()` for TanStack Query cache
- [CRITICAL] Define `staleTime` and `gcTime` for all queries
- [WARN] Use `export const ssr = true` for SEO-critical pages
- [INFO] Leverage SvelteKit's SSR for initial page load performance

### Error Boundary Planning (CRITICAL)

- [CRITICAL] Every route must have `+error.svelte`
- [CRITICAL] Use paraglide i18n for error messages
- [CRITICAL] Handle 404, 401, 403, 500 with user-friendly messages
- [INFO] Include retry mechanism and home link

### i18n Planning (CRITICAL)

- [CRITICAL] All user-facing text uses paraglide `$t()` function
- [INFO] Content data (post content, comments) exempt
- [INFO] Use `paraglide/messages/en.js` for message definitions

## Code Examples

### Correct: Svelte 5 Component with Snippet API

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import * as paraglide from '$lib/paraglide';

  /**
   * Button component with variants.
   *
   * @component
   *
   * @prop {boolean} [disabled=false] - Disable the button
   * @prop {'primary' | 'secondary'} [variant='primary'] - Visual style
   * @prop {Snippet} children - Button content
   *
   * @example
   * ```svelte
   * <Button variant="primary">Click me</Button>
   * ```
   */
  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary';
    disabled?: boolean;
    children: Snippet;
    onclick?: (event: MouseEvent) => void;
  }

  let {
    variant = 'primary',
    disabled = false,
    children,
    onclick,
    ...rest
  }: Props = $props();

  let isLoading = $state(false);

  const buttonClass = $derived(
    `button button--${variant} ${isLoading ? 'button--loading' : ''}`
  );
</script>

<button
  class={buttonClass}
  {disabled}
  aria-busy={isLoading}
  onclick={onclick}
  {...rest}
>
  {@render children()}
</button>
```

### Correct: Remote Function for Form Submission

```typescript
// apps/web/src/lib/remote/auth.remote.ts
import { form } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { loginSchema } from '$lib/schemas/auth';
import { authLogin } from '$lib/api';

export const loginForm = form(
  zod(loginSchema),
  async ({ email, _password }, { request }) => {
    const event = getRequestEvent();

    try {
      const result = await authLogin(email, _password);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        errors: { email: [paraglide.t('auth_invalid_credentials')] }
      };
    }
  }
);
```

### Correct: TanStack DB Collection

```typescript
// apps/web/src/lib/collections/content.ts
import { createCollection } from '@tanstack/svelte-query';
import { queryCollectionOptions } from '$lib/query-options';

export const contentCollection = createCollection({
  getKey: (id: string) => ['content', id],
  queryCollectionOptions,

  onUpdate: (oldData, newData) => ({
    ...oldData,
    ...newData,
    updatedAt: new Date().toISOString()
  })
});

// Usage in component
import { useLiveQuery } from '@tanstack/svelte-query';

const { data: content } = useLiveQuery(
  contentCollection.getKey(contentId)
);
```

### Correct: SSR + Hydration Pattern

```typescript
// +page.server.ts
import { listContents } from '$lib/api';

export async function load({ fetch, locals }) {
  const contents = await listContents({
    fetch,
    session: locals.session
  });

  return {
    contents,
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
    }
  };
}
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { hydrateIfNeeded, useQuery } from '@tanstack/svelte-query';
  import { listContentsQuery } from '$lib/query-options';

  let { data } = $props();

  onMount(() => {
    hydrateIfNeeded(listContentsQuery(), data.contents);
  });

  const { data: contents } = useQuery(listContentsQuery());
</script>
```

### Correct: Error Boundary

```svelte
<!-- +error.svelte -->
<script lang="ts">
  import * as paraglide from '$lib/paraglide';
  import { page } from '$app/stores';

  let error = $props();
  let { status } = $page;

  const errorMessages = {
    404: paraglide.t('error_not_found'),
    401: paraglide.t('error_unauthorized'),
    403: paraglide.t('error_forbidden'),
    500: paraglide.t('error_server_error'),
  };
</script>

<div class="error-boundary">
  <h1>{status}</h1>
  <p>{errorMessages[status] || paraglide.t('error_unknown')}</p>
  <a href="/">{paraglide.t('error_go_home')}</a>
</div>
```

## Plan Output Format

Generate plans following this structure:

```markdown
## Frontend Implementation Plan

### Applicable PR Review Agents (Compliance Standards)
- Component Agent: `.claude/skills/pr-review-agent-team/agents/components.md`
- Local-First Agent: `.claude/skills/pr-review-agent-team/agents/local-first.md`
- CSS Agent: `.claude/skills/pr-review-agent-team/agents/css.md`

---

## Phase 1: Components (Component Agent Compliance)

### Files to Create
[List components with full paths]

### Implementation Instructions
**Read this pattern first**:
- [Reference file path]

**Requirements**:
- [CRITICAL] Use Svelte 5 runes
- [CRITICAL] Use Snippet API
- [CRITICAL] Include JSDoc
- [CRITICAL] Extend HTML attributes type

**Code Template**:
[Provide template]

**Acceptance Criteria**:
- [ ] Component created with $props()
- [ ] Uses Snippet API for children
- [ ] Has .stories.svelte file
- [ ] Uses paraglide for text

---

## Phase 2: Remote Functions (Local-First Compliance)

### Files to Create
[List remote functions]

### Implementation Instructions
[Similar structure with code templates]

---

## Phase 3: TanStack DB Collections (Local-First Compliance)

[Same structure]

---

## Phase 4: SSR/Hydration (Local-First Compliance)

[Same structure]

---

## Phase 5: Error Boundaries (Local-First Compliance)

[Same structure]

---

## i18n Keys Required
[List all required message keys]

---

## Deep Dive References
- Remote functions: `apps/web/src/lib/remote/content.remote.ts`
- Collections: `apps/web/src/lib/collections/content.ts`
- SSR/Hydration: `apps/web/src/routes/(platform)/library/+page.svelte`
- Error boundary: `apps/web/src/routes/(platform)/library/+error.svelte`
- Component: `apps/web/src/lib/components/ui/Button/Button.svelte`
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| CSS in component files | `css-planner` |
| Missing i18n keys | Add to plan's i18n section |
| Complex state management | Suggest TanStack DB collection |
| Missing error boundaries | Add to plan as required phase |

## Critical File References

- `apps/web/src/lib/remote/content.remote.ts` - Remote function patterns
- `apps/web/src/lib/collections/content.ts` - Collection patterns
- `apps/web/src/lib/collections/hydration.ts` - Hydration utilities
- `apps/web/src/routes/(platform)/library/+page.server.ts` - SSR loading
- `apps/web/src/routes/(platform)/library/+page.svelte` - Hydration pattern
- `apps/web/src/routes/(platform)/library/+error.svelte` - Error boundary
- `apps/web/src/lib/components/ui/Button/Button.svelte` - Component structure
- `apps/web/src/lib/paraglide/messages/en.js` - i18n message structure
