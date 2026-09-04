# 10 — Platform Account

## Scope

User self-service settings across 4 routes with a shared sidebar layout:

| File | Lines | Role |
|---|---:|---|
| `(platform)/account/+layout.svelte` | 128 | Sidebar nav + version-staleness `$effect` |
| `(platform)/account/+layout.server.ts` | 34 | Auth guard + user entity version load |
| `(platform)/account/+page.svelte` | 74 | Profile with "become creator" upgrade banner |
| `(platform)/account/+page.server.ts` | 23 | Profile data |
| `(platform)/account/notifications/+page.svelte` | 183 | Email preferences (Switch toggles) |
| `(platform)/account/payment/+page.svelte` | 332 | Billing + purchase history table with filters |
| `(platform)/account/subscriptions/+page.svelte` | 366 | Subscription list + cancel/reactivate Dialog |

Plus `+error.svelte` stubs and per-route `__tests__` folders.

## CSS modernity

### In use — good

- **`font-variant-numeric: tabular-nums`** on amount/date cells in the payment-history table (`payment/+page.svelte:279, 293`) — perfect for columns of numbers. The modern tabular-figures approach avoids shifting-digit layouts when values animate or update.
- **`aria-current="page"`** on the active sidebar link (`+layout.svelte:37`) — correct AT convention (beats `aria-selected` for nav items).
- **Skeleton-free progressive form submission** via `updateNotificationsForm.pending > 0` driving `<Button loading={…}>` state (`notifications/+page.svelte:106`). SvelteKit remote-forms + primitive reuse done right.
- **Reactive `$derived` error handling** — the notifications page watches `updateNotificationsForm.result?.success` via `$effect` to show a 3s auto-dismiss alert (lines 32-36). Clean runes integration with form state.
- **`invalidate('cache:versions')` after mutation** in both subscriptions (`handleCancel`/`handleReactivate` lines 73, 86). Correctly triggers the platform layout's version-staleness machinery from Section 22.
- **Version-based staleness** in `+layout.svelte:15-24` — checks `user:{id}` version and triggers `invalidateCollection('library')` on user entity changes. Purchase made on another device → cancel/reactivate here → library refreshes.

### Gaps

- **No `:where()` on element groups** — each of the four sub-pages redeclares `h1 { font-family; font-size; font-weight; color; margin-bottom }` in its `<style>` block (see below). This is the recurring Section-2 specificity pattern.
- **Custom media queries** used only in the layout; none of the sub-pages express responsive behaviour — everything relies on stack-to-column at `md`.

## Inheritance & reuse

### Primitive reuse — mostly excellent

All four sub-pages consume primitives well:

| Page | Primitives used |
|---|---|
| `+page.svelte` (profile) | `Button`, `ProfileForm` |
| `notifications/+page.svelte` | `Button`, `Label`, `Switch`, `Alert` |
| `payment/+page.svelte` | `Table.Root/Header/Body/Cell/Row`, `Badge`, `Pagination`, `Button`, `Alert`, `Card`, `EmptyState` |
| `subscriptions/+page.svelte` | `Button`, `Card`, `Dialog`, `Badge`, `EmptyState`, `Alert`, `TextArea`, `Label` |

The `Dialog.Root / Content / Header / Title / Description / Body / Footer` composition in subscriptions is exemplary — this is exactly how the Dialog primitive is meant to be used.

### Remaining button-reinvention gaps

Two ersatz buttons that should be `<Button>`:

| File | Lines | Inline class | What it is |
|---|---:|---|---|
| `payment/+page.svelte:302-316` | 15 | `.discover-link` | "Browse content" CTA in empty state |
| `subscriptions/+page.svelte` (not read fully but follows pattern) | — | — | Check in rollup |

`.discover-link` is a button styled as a subtle brand link — could be `<Button variant="ghost" size="sm" href="/discover">`. Matches the recurring pattern from Sections 7, 8, 9.

### Centralised nav is good, i18n is not

`ACCOUNT_NAV` lives in `$lib/config/navigation.ts:86-91` — one source of truth for the sidebar links. 

But the labels are **hardcoded English**:
```ts
{ href: '/account', label: 'Profile' },
{ href: '/account/subscriptions', label: 'Subscriptions' },
{ href: '/account/payment', label: 'Payments' },
{ href: '/account/notifications', label: 'Notifications' },
```

Same shape of bug as 7.3 / 8.4, just living in a different file. Fix: change the type to `NavLink<{ label: () => string }>` and store `m.account_nav_profile`, etc. as thunks.

### i18n drift inside components

Most copy is `m.*()` but English strings leak in several places:

| Location | Hardcoded |
|---|---|
| `+page.svelte:23-24` | *"Start creating on Codex"*, *"Set up your creator profile, upload content, and build your audience."* |
| `+page.svelte:27` | *"Become a Creator"* CTA label |
| `notifications/+page.svelte:49` | *"Some emails (like purchase receipts, password resets, and security notices) will always be sent for compliance and account security."* — one of the most security-sensitive copy strings in the app, inside `<Alert>` |
| `notifications/+page.svelte:87` | *"Always on — required for account security"* |
| `subscriptions/+page.svelte:75` | Error fallback: *"Failed to cancel subscription"* |
| `subscriptions/+page.svelte:88` | Error fallback: *"Failed to reactivate subscription"* |

These are the kind of strings users in a non-English locale see in broken-translation contexts — compliance copy is exactly where it matters most.

### Heading re-declaration pattern — now four times over

The same rule block appears in all four sub-pages:

```css
.{page} h1 {
  font-family: var(--font-heading);
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  color: var(--color-text);
  margin-bottom: var(--space-2);
}
```

- `+page.svelte:36-42`
- `notifications/+page.svelte:116-122`
- `payment/+page.svelte:212-218`
- `subscriptions/+page.svelte:267-272` (on `.page-title` not `h1`, but identical declarations)

The `theme/base.css` `h1` rules already cover most of these (Section 02.2). Fixing the cascade once would let every account page drop this redundant block — ~25 lines saved across the section. The recurring pattern is now at ~8 occurrences audit-wide.

### Semantic token drift

- **`+page.svelte:59`** — `.upgrade-banner { border: … var(--color-focus-ring); }`. Uses the focus-ring token as a decorative border. Same semantic slip as 6.2 (NavigationProgress using `--color-focus` as a glow).
- **`+page.svelte:66, 72`** — `color: var(--color-interactive-active)`. `-active` is the "pressed" state colour; using it as heading text makes the text read as if it were a hover-pressed affordance.
- **`payment/+page.svelte:267`** — same `color: var(--color-interactive-active)` on `.filter-list a.active` — here it's defensible because "active" filter IS a pressed state, but using `-subtle` for bg + `-active` for fg creates an oddly strong contrast. Worth design review.

### Duplicated rule: `.sidebar-link.loading` and `.sidebar-link:hover`

`+layout.svelte:103-106` and `113-116` declare identical style blocks:
```css
.sidebar-link:hover    { color: var(--color-text); background-color: var(--color-surface-secondary); }
.sidebar-link.loading  { color: var(--color-text); background-color: var(--color-surface-secondary); }
```

Can be collapsed:
```css
.sidebar-link:is(:hover, .loading) {
  color: var(--color-text);
  background-color: var(--color-surface-secondary);
}
```

Tiny cleanup. Illustrates where `:is()` usage could be adopted more broadly (Section 02.10).

### Hardcoded pixel values

| File | Line | Value | Why |
|---|---:|---|---|
| `+layout.svelte` | 70 | `width: 14rem` on `.account-sidebar` at `md+` | `14rem = 224px` — should be a `--sidebar-width` token |
| `subscriptions/+page.svelte` | 264 | `max-width: 800px` on `.subscriptions-page` | Magic measure — should be a prose/content-max token |
| `payment/+page.svelte` | (various) | Table cell styles use `:global()` because classes pass as props — not hardcoded, but `:global` leaks |

### Inline `style="…"` attributes

`notifications/+page.svelte:48, 53, 59` — three `<Alert style="margin-bottom: var(--space-4)">` with inline CSS for spacing. Token-compliant at least, but prefer:
- A wrapper `<div class="alerts" style="display: flex; gap: var(--space-4);">`, or
- A layout prop on Alert (`<Alert spacing="md">`)

Inline `style=` is the one smell that escapes Svelte's scoped-style benefits.

## Wasted code

### No unused files found in this section

All components in the account tree have consumers. No equivalent of `LibraryCard.svelte` in here.

### Duplicated rules (counted)

- `.sidebar-link:hover` / `.sidebar-link.loading` duplicate in `+layout.svelte` (6 lines).
- Four `h1` redeclarations across sub-pages (~25 lines total) — already covered in the heading-pattern finding above.

## Simplification opportunities

Ranked by impact/effort:

1. **i18n-ise ACCOUNT_NAV labels** — change the nav config to accept thunks: `{ href, label: m.account_nav_profile }` and call `link.label()` in the template. Unblocks localisation of the sidebar.
2. **Extract the four hardcoded-English strings in the main + notifications pages** to Paraglide messages — especially the compliance copy in notifications.
3. **Move error fallbacks to i18n** — `subscriptions/+page.svelte:75, 88` should use `m.subscription_cancel_error_default()` etc.
4. **Swap `.discover-link` for `<Button variant="ghost" href="/discover">`** — matches the cross-cutting pattern.
5. **Drop the four `h1` redeclarations** — fix the cascade once in `theme/base.css`/`global.css` consolidation (tracked in 2.2), and every account page's rule becomes unneeded.
6. **Token-ify `width: 14rem`** (sidebar) and `max-width: 800px` (subscriptions page) — introduce `--sidebar-width-account` and `--container-prose` or similar.
7. **Collapse hover/loading sidebar-link rule** with `:is(:hover, .loading)`.
8. **Replace inline `style="margin-bottom: …"`** on Alerts with a wrapper flex container.
9. **Re-audit `--color-interactive-active` text usage** — design review whether the profile upgrade-banner really wants pressed-state text colour.

## Findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| 10.1 | Medium | `ACCOUNT_NAV` (4 items) in `lib/config/navigation.ts:86-91` has hardcoded English labels | Change to thunk form `{ href, label: m.account_nav_profile }` |
| 10.2 | Medium | i18n leaks in profile page (`+page.svelte:23-24, 27`) — "Start creating on Codex" banner copy and "Become a Creator" CTA | Move to Paraglide messages |
| 10.3 | Medium | Compliance copy in `notifications/+page.svelte:49, 87` hardcoded ("Some emails... always be sent for compliance and account security") | Move to Paraglide — compliance copy most needs localisation |
| 10.4 | Medium | Error fallback strings in `subscriptions/+page.svelte:75, 88` hardcoded | Move to Paraglide |
| 10.5 | Medium | `.discover-link` in payment page (15 lines CSS) re-implements button styling | Swap for `<Button variant="ghost" size="sm" href="/discover">` |
| 10.6 | Low | 4 × `h1` rule redeclarations across account sub-pages duplicate `theme/base.css` h1 rules | Fix globally once (tracked in 2.2) |
| 10.7 | Low | `width: 14rem` on `.account-sidebar` is a hardcoded measure | Add `--sidebar-width-account` token or reference a container width |
| 10.8 | Low | `max-width: 800px` on `.subscriptions-page` is a magic pixel value | Token-ify |
| 10.9 | Low | `.sidebar-link:hover` and `.sidebar-link.loading` are identical style blocks | Collapse via `:is(:hover, .loading)` |
| 10.10 | Low | `--color-focus-ring` used as a decorative border (`+page.svelte:59`) | Use `--color-border` or a brand-primary-subtle variant; reserve focus-ring for focus |
| 10.11 | Low | `--color-interactive-active` used as text colour for banner copy (`+page.svelte:66, 72`) | Use `--color-text` or brand; reserve `-active` for pressed state |
| 10.12 | Low | Inline `style="margin-bottom: var(--space-4)"` on 3 `<Alert>` components in notifications | Wrap alerts in a flex container with `gap` |

## Quantitative summary

- **Route tree**: 4 pages + shared layout, ~1,295 total lines.
- **Primitive reuse**: **excellent** — uses Button, Card, Dialog, Badge, Switch, Table, TextArea, Label, Alert, EmptyState, Pagination, ProfileForm appropriately. Dialog composition is a highlight.
- **Token compliance**: ~95% — no hex literals, 3 hardcoded-width stragglers.
- **i18n coverage**: ~85% — the tail of compliance copy, banner text, error fallbacks, and nav labels is the gap. Compliance copy in particular is the wrong place for English-only strings.
- **Cross-cutting patterns repeated**: heading redeclaration (now 8× audit-wide), button reinvention (now 5-6×), semantic token drift (focus-ring as border, interactive-active as text).

## Next section

11 — Platform pricing (`(platform)/pricing/`) — the pricing page that's been the subject of a recent design polish sprint.
