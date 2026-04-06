# Shared Context for Implementation Specs

This document provides the patterns and conventions that ALL implementation specs must follow. Agents writing specs should reference this rather than re-reading the codebase.

---

## Component Pattern (Svelte 5)

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLDivAttributes } from 'svelte/elements';

  interface Props extends HTMLDivAttributes {
    variant?: 'default' | 'compact';
    children: Snippet;
  }

  const { variant = 'default', children, class: className, ...restProps }: Props = $props();
  
  // Reactive state
  let isOpen = $state(false);
  const label = $derived(isOpen ? 'Close' : 'Open');
</script>

<div class="component {className}" data-variant={variant} {...restProps}>
  {@render children()}
</div>

<style>
  .component {
    /* MUST use design tokens — never hardcode */
    padding: var(--space-4);
    color: var(--color-text);
    border-radius: var(--radius-md);
  }
</style>
```

## Design Tokens (MANDATORY — never hardcode CSS values)

| Category | Examples |
|----------|---------|
| Spacing | `--space-1` (4px) through `--space-24` |
| Colors | `--color-text`, `--color-text-secondary`, `--color-surface`, `--color-border`, `--color-interactive`, `--color-interactive-hover` |
| Brand | `--color-brand-accent`, `--org-brand-primary` (org-specific, injected by layout) |
| Typography | `--font-heading`, `--font-sans`, `--text-sm`/`--text-base`/`--text-lg`/`--text-xl`/`--text-2xl`, `--font-medium`/`--font-semibold`/`--font-bold` |
| Borders | `--border-width`, `--border-style`, `--color-border`, `--radius-sm`/`--radius-md`/`--radius-lg` |
| Shadows | `--shadow-sm`, `--shadow-md`, `--shadow-lg` |
| Transitions | `--transition-colors`, `--transition-transform`, `--transition-shadow` |
| Breakpoints | `@media (--breakpoint-sm)`, `@media (--breakpoint-md)`, `@media (--breakpoint-lg)` |
| Layout | `--layout-max-width`, `--sidebar-width` |

## Key File Paths

| What | Path |
|------|------|
| UI Components | `apps/web/src/lib/components/ui/` |
| Studio Components | `apps/web/src/lib/components/studio/` |
| Layout Components | `apps/web/src/lib/components/layout/` |
| Icons | `apps/web/src/lib/components/ui/Icon/` |
| Org public pages | `apps/web/src/routes/_org/[slug]/(space)/` |
| Org studio pages | `apps/web/src/routes/_org/[slug]/studio/` |
| Creator pages | `apps/web/src/routes/_creators/` |
| Platform pages | `apps/web/src/routes/(platform)/` |
| Collections | `apps/web/src/lib/collections/` |
| Remote functions | `apps/web/src/lib/remote/` |
| API client | `apps/web/src/lib/server/api.ts` |
| Types | `apps/web/src/lib/types.ts` |
| Styles/tokens | `apps/web/src/lib/styles/` |
| i18n messages | `apps/web/src/paraglide/messages/` (use `* as m from '$paraglide/messages'`) |

## Data Loading Pattern

```typescript
// +page.server.ts
import { createServerApi } from '$lib/server/api';
export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
  const api = createServerApi(platform, cookies);
  const data = await api.content.getPublicContent(params);
  return { data };
};
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
  let { data } = $props();
  // data.xxx comes from server load
</script>
```

## Existing Components to Reuse

- `Card`, `CardContent`, `CardHeader`, `CardTitle`, `CardFooter` — card wrappers
- `Button` — variant: primary/secondary/ghost/destructive, size: sm/md/lg
- `Badge` — variant: success/error/warning/neutral
- `Skeleton` — loading placeholders (width, height props)
- `EmptyState` — title, description, icon, action snippet
- `Pagination` — currentPage, totalPages, baseUrl
- `StatCard` — label, value, change%, loading
- `Select` — options, value, onValueChange
- `Dialog` — modal dialogs (Melt UI)
- `Tabs`, `TabsList`, `TabsContent` — tabbed interfaces
- `PageHeader` — title, description, actions snippet
- `Stack`, `Cluster`, `PageContainer` — layout primitives
- 40+ Icon components in `ui/Icon/`

## ContentWithRelations Shape (from API)

```typescript
{
  id: string;
  title: string;
  slug: string;
  description: string | null;
  contentType: 'video' | 'audio' | 'written';
  thumbnailUrl: string | null;
  priceCents: number | null; // null = free
  status: 'draft' | 'published' | 'archived';
  category: string | null;
  tags: string[] | null;
  viewCount: number;
  purchaseCount: number;
  publishedAt: string | null;
  createdAt: string;
  creator?: { id: string; email: string; name: string | null };
  organization?: { id: string; name: string; slug: string } | null;
  mediaItem?: { durationSeconds: number | null; thumbnailKey: string | null; ... } | null;
}
```

## Rules

1. All CSS MUST use design tokens — no hardcoded px, hex, or raw values
2. Components MUST use `$props()` with typed `Props` interface
3. Use `$app/state` not `$app/stores` (`page.url` not `$page.url`)
4. Currency is GBP (£) by default
5. Use `buildContentUrl(page.url, content)` for content links
6. Keep paths root-relative on org subdomains
7. Use scoped `<style>` in components — `:global()` only when styling child component classes
8. Prefer extending existing components over creating new ones where possible
