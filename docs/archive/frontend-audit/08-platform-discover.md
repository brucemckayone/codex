# 08 — Platform Discover

## Scope

The first data-bearing platform route — a filterable content grid with search.

| File | Lines | Role |
|---|---:|---|
| `apps/web/src/routes/(platform)/discover/+page.svelte` | 153 | Hero, search form, `ContentCard` grid, empty state, error banner |
| `apps/web/src/routes/(platform)/discover/+page.server.ts` | 58 | Calls `api.content.getDiscoverContent`, sets `DYNAMIC_PUBLIC` 5-min cache, handles errors |

Uses three primitives correctly: `ContentCard`, `EmptyState`, `ErrorBanner`. Falls back to hand-rolled search input + submit button.

## CSS modernity

### In use — good

- **Global `.content-grid` utility** — the page's `<section class="content-grid">` (line 68) consumes the shared layout class from `styles/utilities.css`, which in turn uses container queries and `@media (--breakpoint-sm|lg)` to drive the responsive 1→2→3 column layout. That's the kind of reuse the utility was built for.
- **`flex: 1`** on the search input (line 124) — input grows to fill space, button sits flush. Classic flex composition.
- **`aria-label="Content results"`** on the grid section (line 68) — names the listbox region.
- **`type="search"`** on the input — correct semantic HTML.
- **Svelte 5 `$derived` with binding override pattern** (lines 24, 56). Non-obvious but legitimate — `let searchValue = $derived(data.search)` seeds from server state, `bind:value={searchValue}` lets the user override, and when `data.search` changes (e.g. after navigation), the derivation reasserts. Svelte's autofixer validates this pattern.

### Gaps

- No use of `:has()` or container queries on this page — but the `.content-grid` utility already owns that concern.
- No loading indicator during search submission — the user clicks "Search" and nothing visually changes until the server responds (caught below as a UX gap, not a CSS one).

## Inheritance & reuse

### Re-implements two primitives that exist — again

Same pattern as Section 07:

| Reinvention | Lines | Existing primitive |
|---|---|---|
| `.search-input` (lines 123-136, 14 lines CSS) | 14 | `Input` primitive in `$lib/components/ui/Input` — has focus handling, disabled states, size variants, and type-appropriate defaults |
| `.search-btn` (lines 138-152, 15 lines CSS) | 15 | `Button` primitive with `variant="primary"`, `size`, `loading`, `disabled` |

Migrating the two hand-rolled forms to primitives would shed ~29 lines of CSS and gain:
- Loading state (`<Button loading={submitting}>` would show a spinner during form submission — addresses the "no loading indicator" gap).
- Consistent focus-visible treatment with the rest of the app.
- Dark-mode parity.

### Primitives correctly used

- **`ContentCard`** — 10 props passed (id, title, thumbnail, contentType, duration, creator, href, price, contentAccessType). Healthy.
- **`EmptyState`** — for zero-result case.
- **`ErrorBanner`** — for server-fetch failure.
- **`buildContentUrl(page.url, {...})`** — correct helper per CLAUDE.md for cross-org subdomain routing.

### Heading re-declaration (same pattern as 7.4)

`.discover-header h1` (lines 104-110) re-declares `font-family`, `font-size`, `font-weight`, `color` — already owned by `theme/base.css:36-46`'s `h1` rule. Only `margin-bottom: var(--space-2)` is genuinely page-specific.

### i18n drift (same pattern as 7.3)

- Body: 6 Paraglide calls (`m.discover_title()`, `m.discover_subtitle()`, `m.explore_search_placeholder()`, `m.discover_search_aria()`, `m.discover_search_button()`, `m.discover_empty_search()`, `m.discover_empty()`, error copy).
- `<svelte:head>` (lines 36-45): 100% hardcoded English. Title appears in Google results for every locale identically.

### Currency literal

Line 84: `currency: 'GBP'` hardcoded. Matches the memory rule (default is £), but:
- `'GBP'` appears as a literal across many files — worth a `CURRENCY_DEFAULT` constant in `@codex/constants` for single-source-of-truth.
- Individual orgs may later want to sell in their own currency; a hardcoded `'GBP'` on a cross-org discover page forecloses that.

## Wasted code

### Pagination plumbing exists but UI doesn't

- Server load (`+page.server.ts:37-43`) parses a `page` query param, clamps it `[1, 100]`, forwards it to the API.
- API returns `pagination: { page, limit, total, totalPages }` which gets proxied to `data.content.pagination`.
- The page template renders zero pagination controls.

Effect: users see only the first 20 items (the default `limit: 20` on the server-side empty fallback). Deep-linking `?page=2` works (server fetches it), but there's no UI path to reach it. This is either:
- **Unfinished**: pagination was planned but never built.
- **Replaced**: infinite-scroll was intended but not shipped.

Either way the server-side `page` parameter parsing (lines 37-43) is dead UX that still runs on every request. Either ship the pagination UI or remove the parameter handling and the empty-state `EMPTY_CONTENT.pagination` object to keep the contract honest.

### Minor: EMPTY_CONTENT hardcodes `limit: 20`

`+page.server.ts:15` uses `{ page: 1, limit: 20, total: 0, totalPages: 0 }` on the error path. The `20` matches the default page size but isn't tied to a constant — if page size changes, this fallback diverges silently.

### Database/UI naming drift

Line 75:
```svelte
contentType={(item.contentType === 'written' ? 'article' : item.contentType) as 'video' | 'audio' | 'article'}
```

Database has `written`, UI expects `article`. The cast and the conditional live inline on the page. This adapter logic should live closer to the API boundary (either the server load or `createServerApi`) so every consumer of `item.contentType` doesn't have to know about the rename. Small, but a reuse smell.

## Simplification opportunities

Ranked by impact/effort:

1. **Swap `.search-input` / `.search-btn` for `<Input>` + `<Button>`** — kills ~29 lines of CSS, inherits loading/focus/a11y treatments. Adds `<Button loading={submitting}>` to fix the missing submit feedback.
2. **Decide pagination** — either implement the pagination UI (using the existing `Pagination` primitive mentioned in the ui directory) or delete the dead server-side `page` parsing to keep the contract honest.
3. **i18n-ise `<svelte:head>`** — matches 7.3; same surface, same effort.
4. **Move the `written → article` content-type rename upstream** — either in `createServerApi` (preferred — canonical place for server/UI mapping) or in a small `mapContentForCard` helper, then consumers stay clean.
5. **Hoist `'GBP'` to `CURRENCY_DEFAULT`** in `@codex/constants` — one-time constant, replace literals.
6. **Drop redundant `.discover-header h1` declarations** — keep only `margin-bottom`.
7. **Tie `EMPTY_CONTENT.limit` to a `DEFAULT_PAGE_SIZE` constant** — or drop `EMPTY_CONTENT` entirely (return a sentinel object only in the error path).

## Findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| 8.1 | Medium | `.search-input` (14 lines CSS) re-implements `Input` primitive | Swap for `<Input type="search" bind:value={searchValue} />` |
| 8.2 | Medium | `.search-btn` (15 lines CSS) re-implements `Button` primitive | Swap for `<Button type="submit" loading={submitting}>` — also addresses the missing submit feedback |
| 8.3 | Medium | Server load supports `?page=` and returns `pagination` metadata, but no pagination UI renders | Implement pagination controls (the `Pagination` primitive exists) OR delete the dead server parameter handling |
| 8.4 | Medium | `<svelte:head>` hardcodes English; body uses Paraglide | Add `m.discover_head_*` messages, replace inline strings |
| 8.5 | Low | Inline content-type rename `written → article` on line 75 leaks DB naming into the template | Move the mapping into `createServerApi` or a server-load helper |
| 8.6 | Low | `currency: 'GBP'` hardcoded on line 84 | Introduce `CURRENCY_DEFAULT` in `@codex/constants` |
| 8.7 | Low | `.discover-header h1` redeclares `font-family`/`font-size`/`font-weight`/`color` already owned by `theme/base.css` | Keep only `margin-bottom: var(--space-2)` |
| 8.8 | Low | `EMPTY_CONTENT.pagination.limit = 20` — hardcoded, diverges silently if page size changes | Reference a `DEFAULT_PAGE_SIZE` constant |

## Quantitative summary

- **Files**: 2. **Lines**: 211 total (153 + 58). Token compliance: **~100%** in the CSS (no hardcoded px/hex).
- **Component reuse**: good for content/empty/error states (uses `ContentCard`, `EmptyState`, `ErrorBanner`, global `.content-grid`). Gap for form inputs (`Input`, `Button` bypassed) — the same gap as Section 07.
- **i18n coverage**: body complete, head zero. Consistent drift with Section 07.
- **Dead plumbing**: pagination parameter handling without a consumer UI.
- **Security hygiene**: search input length-capped (`slice(0, 200)`), page number bounds-clamped. Appropriate.
- **Graceful degradation**: `try/catch` on API fetch falls back to `EMPTY_CONTENT` with an `error: true` flag that renders `ErrorBanner`. Good.

## Next section

09 — Platform library (`(platform)/library/`) — the user's purchased/free content, using the localStorage `libraryCollection`.
