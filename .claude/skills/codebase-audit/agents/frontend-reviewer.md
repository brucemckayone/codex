# Frontend Reviewer

## Domain
SvelteKit web application — components, routes, state management, remote functions, utilities, editor, player, design system compliance.

## File Patterns
- `apps/web/src/lib/components/**/*.svelte`
- `apps/web/src/lib/components/**/*.ts`
- `apps/web/src/routes/**/*.svelte`
- `apps/web/src/routes/**/*.ts`
- `apps/web/src/lib/remote/**/*.ts`
- `apps/web/src/lib/collections/**/*.ts`
- `apps/web/src/lib/utils/**/*.ts`
- `apps/web/src/lib/editor/**/*.ts`
- `apps/web/src/lib/types.ts`
- `apps/web/src/app.css`

## Checklist

### Svelte 5 Compliance
- [CRITICAL] Zero `export let` — all components use `$props()`
- [CRITICAL] Zero `$:` reactive statements — use `$derived()`, `$effect()`
- [CRITICAL] Zero `$app/stores` imports — use `$app/state`
- [WARN] `$bindable()` used for two-way bindings
- [WARN] `Snippet` type for content slots with `{@render children()}`

### Type Safety
- [CRITICAL] No `form: any` in component Props — use proper form type unions
- [CRITICAL] No `as any` casts in production code — type properly
- [WARN] Props interfaces extend appropriate HTML element types
- [INFO] JSDoc `@prop` tags match actual Props interface

### Design System / CSS
- [CRITICAL] No hardcoded hex colors in production components (brand editor excluded)
- [CRITICAL] No primitive neutral tokens (`--color-neutral-*`) — use semantic tokens
- [WARN] No hardcoded px values — use spacing tokens (`--space-*`)
- [WARN] No hardcoded media query breakpoints — use custom media tokens (`--breakpoint-*`)
- [WARN] No hardcoded durations — use `--duration-*` tokens
- [WARN] `.sr-only` class defined in global CSS, not per-component
- [INFO] `color-mix()` and `var(--token, fallback)` patterns acceptable

### Accessibility (a11y)
- [CRITICAL] Interactive components have full keyboard navigation (not mouse-only)
- [CRITICAL] ARIA roles match actual keyboard behaviour (no `role="combobox"` without arrow keys)
- [WARN] `aria-label` on icon buttons and close buttons
- [WARN] `aria-live` regions for dynamic content changes
- [WARN] `focus-visible` outlines on interactive elements
- [WARN] `prefers-reduced-motion` respected for animations
- [WARN] `loading="lazy"` on non-critical images
- [INFO] `aria-current="page"` on active nav links

### Internationalisation (i18n)
- [WARN] All user-facing strings use `$paraglide/messages`
- [WARN] No hardcoded English in `aria-label`, `alt`, placeholder, or error messages
- [INFO] Auth server action errors should use i18n

### State Management
- [CRITICAL] Shell+Stream pattern: await critical data, stream secondary with `.catch()`
- [CRITICAL] All streamed promises have `.catch()` handlers
- [WARN] Collections use `localStorageCollectionOptions` with `browser` guard
- [WARN] Version staleness detection wired correctly in layouts
- [WARN] `initProgressSync` called in both platform and org layouts

### Route Structure
- [WARN] Error pages exist for all route groups (especially `(platform)/`)
- [WARN] SPA mode (`ssr = false`) only on auth-gated, non-SEO routes
- [WARN] Cache headers set correctly (STATIC_PUBLIC, DYNAMIC_PUBLIC, PRIVATE)
- [WARN] No duplicate header setting between layouts and pages

### Code Duplication
- [WARN] Formatting functions imported from `$lib/utils/format` — no local copies
- [WARN] No duplicate component implementations across org/creator routes
- [WARN] Content form schemas share a base (not 95% copy-paste)
- [INFO] CSS utility classes in global scope, not per-component

### Loading States
- [WARN] Every async operation has loading indicator
- [WARN] Skeleton loading for streamed data via `{#await}` blocks
- [WARN] Button `loading` prop with `aria-busy` for mutations

## Output Requirements
- Deep-dive 5+ interactive components for keyboard/a11y compliance
- Count and list all hardcoded English strings
- Count and list all hardcoded CSS values
- Report on form handling patterns (use:enhance vs remote form())
- Report on error page coverage (which route groups have +error.svelte)
