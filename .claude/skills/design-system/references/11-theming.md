# Reference 11 — Theming (Light / Dark)

> **Part of `/design-system`.** Pair with [`01-tokens.md`](01-tokens.md) (where the
> light/dark token values are defined) and [`02-css-architecture.md`](02-css-architecture.md)
> (where the `[data-theme]` selector sits in the cascade). Brand-editor preview behaviour
> is cross-referenced in [`10-brand-editor.md`](10-brand-editor.md).

# Theming — The `<html data-theme>` Contract

Codex supports light and dark mode for every page via a **single global attribute**:
`<html data-theme="light|dark">`. One file owns it, one function writes it, every component
reads it through a shared reactive state. This reference documents the contract the landed
code enforces — violating it re-introduces the family of bugs caught in iter-019
(Codex-9u8wg, Codex-micw3, Codex-z91af).

---

## 1. The Single Owner

```
apps/web/src/lib/theme.svelte.ts
```

That file (and **only** that file) is allowed to:
1. Write `<html data-theme>`
2. Write `<html class="light|dark">`
3. Write `localStorage['theme']`
4. Write the `theme=` cookie
5. Mutate the reactive `themeState`

Every one of those steps happens **together in one atomic operation** — `setTheme(theme)`
at `theme.svelte.ts:45-57`:

```ts
function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);

  localStorage.setItem(STORAGE_KEY, theme);
  document.cookie = `${COOKIE_NAME}=${theme};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;

  themeState.theme = theme;
}
```

`toggleTheme()` is the only public write path (`theme.svelte.ts:60-64`). No feature is
allowed to reach past it and poke any one of those five surfaces in isolation — doing so
breaks the invariant that DOM, persistence, and reactive state always agree.

> **File extension matters**: `theme.svelte.ts`, not `theme.ts`. Module-level `$state` only
> compiles in `.svelte.ts` files. Changing the extension drops the reactive contract on the
> floor — every `ThemeToggle` instance would silently stop re-rendering.

---

## 2. The Three-Source Read Order

Initial theme is resolved **before first paint** by a blocking script in `apps/web/src/app.html:22-30`:

```html
<script>
  (function() {
    const theme = document.cookie.match(/theme=(dark|light)/)?.[1]
      || localStorage.getItem('theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.add(theme);
  })();
</script>
```

Read order (highest priority first):

| Source | Why |
|---|---|
| `cookie['theme']` | Works on the first render in SSR environments (the cookie is on the request) |
| `localStorage['theme']` | Survives across sessions for the same device |
| `prefers-color-scheme` | User's OS-level preference as last resort |

`theme.svelte.ts` reads the same source chain on boot (`theme.svelte.ts:31-37`) — specifically
the DOM attribute the blocking script just wrote, which is why the reactive state stays in
sync with first paint.

**Rule**: any code path that asks "what theme is it" MUST go through `themeState.theme`
(or its derived reactive consumer) — never re-implement the three-source resolution inline.
If you find yourself reading `localStorage.getItem('theme')` outside `theme.svelte.ts`,
stop and use `themeState` instead.

---

## 3. Reactive Subscription Pattern

Every component that displays theme state — toggle icons, "currently: Dark" labels, the
future "theme picker" — MUST subscribe reactively to `themeState`, not snapshot the value
once on mount.

### Canonical pattern (landed fix for Codex-micw3)

`apps/web/src/lib/components/ui/ThemeToggle/ThemeToggle.svelte:1-27`:

```svelte
<script lang="ts">
  import { themeState, toggleTheme } from '$lib/theme.svelte';
  import { SunIcon, MoonIcon } from '$lib/components/ui/Icon';

  // Subscribe to the shared theme state — every instance of this component
  // (sidebar, studio, mobile nav, mobile bottom sheet) stays in sync when
  // any one of them fires toggleTheme().
  const theme = $derived(themeState.theme);

  function handleToggle() {
    toggleTheme();
  }
</script>

{#if theme === 'light'}
  <MoonIcon {size} />
{:else}
  <SunIcon {size} />
{/if}
```

Why this is load-bearing: the app renders **multiple** ThemeToggle instances (sidebar rail,
studio sidebar, mobile bottom nav, mobile bottom sheet). Before Codex-micw3 each instance
had its own local `$state<Theme>('light')` snapshotted once on mount, so toggling one
left the others showing stale icons. `$derived(themeState.theme)` makes every instance
reactive to the shared module-level `$state`.

### MutationObserver fallback — do not use

Technically you could attach a `MutationObserver` to `<html>`'s `data-theme` attribute and
update local state. **Don't.** Reasons:

- Couples the consumer to the DOM attribute instead of the reactive source of truth.
- Fires after the next microtask, not the same tick — introduces a visible flicker.
- Doesn't detect writes that mutate `themeState.theme` via the Svelte runtime path (a
  theoretical future callsite) without also touching the DOM.

The only defensible use is legacy code that can't import `themeState` (e.g., a vanilla DOM
snippet running outside a Svelte component tree). Prefer refactoring.

---

## 4. Scoped Preview — Don't Touch `<html data-theme>`

The brand editor needs to **preview** what an org's dark palette looks like while the user
is still in light mode on the rest of the app (and vice versa). The naive implementation
writes `<html data-theme="dark">` temporarily — this is forbidden.

### Why touching the global attribute is forbidden (Codex-9u8wg)

Before the fix, `setThemePreview(theme)` in the brand editor store called
`document.documentElement.setAttribute('data-theme', theme)`. Three bugs stacked on top
of that single mistake:

1. **Leaked into user preference** — the global attribute is the persistence surface.
   Any listener that re-reads it (sync code in another tab's storage event handler, a
   future feature that snapshots theme on some trigger) will treat preview as permanent.
2. **Desync'd the toggle icon** — ThemeToggle's local `$state` wasn't subscribed to
   external attribute changes (Codex-micw3), so the sidebar's moon/sun flipped independently
   of the edit-time preview toggle.
3. **Clobbered on close** — the editor captured `originalTheme` on open and restored it
   on close (Codex-z91af). If the user clicked the sidebar toggle during editing, that
   mid-session change was overwritten when the editor closed.

### The landed pattern — scope to a different attribute

`apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts:237-252`:

```ts
function setThemePreview(theme: 'light' | 'dark'): void {
  if (!browser) return;
  // Scope preview to .org-layout, NOT <html>. Writing to the global
  // data-theme attribute would leak into the user's persisted theme
  // preference via localStorage/cookie round-trips (see Codex-9u8wg).
  document
    .querySelector('.org-layout')
    ?.setAttribute('data-editing-theme', theme);
}
```

**Three invariants hold after the fix:**

- The editor never writes `<html data-theme>`, `localStorage['theme']`, or the cookie.
- The sidebar's `ThemeToggle` is uninvolved in the editor's preview — clicking it during
  editing updates the user's real preference and the editor's preview is independent.
- `close()` removes `data-editing-theme` from `.org-layout` and falls back cleanly to
  whatever the user's current global preference is (`brand-editor-store.svelte.ts:161-168`):

  ```ts
  function close(): void {
    if (browser) {
      document
        .querySelector('.org-layout')
        ?.removeAttribute('data-editing-theme');
    }
    // ...
  }
  ```

### Parallel CSS rules are mandatory

Every CSS rule in `apps/web/src/lib/theme/tokens/org-brand.css` that matches
`[data-theme='dark']` MUST have a parallel `[data-editing-theme='dark']` clause — otherwise
the preview scope has no visible effect. The landed pattern uses compound selectors
(`org-brand.css:212-218`):

```css
.dark [data-org-brand],
[data-theme='dark'] [data-org-brand],
/* Brand editor scoped dark preview — data-editing-theme lives on .org-layout
   so the editor can preview dark palette without mutating <html data-theme>
   (Codex-9u8wg). The element has BOTH data-editing-theme and data-org-brand
   so this selector uses compound attribute form (no descendant combinator). */
[data-editing-theme='dark'][data-org-brand] {
  /* dark palette overrides */
}
```

Note the compound form — `[data-editing-theme='dark'][data-org-brand]`, no descendant
combinator. That's because `data-editing-theme` and `data-org-brand` both live on the
same element (`.org-layout`). Writing `[data-editing-theme='dark'] [data-org-brand]`
(with a space) would match nothing.

**Checklist for adding a new theme-dependent rule**: if you write `[data-theme='dark']
{ ... }`, ALSO write `[data-editing-theme='dark'] { ... }` alongside it (with the correct
compound/descendant form for where the attribute lives). Missing this = editor shows
wrong preview.

---

## 5. Generalising the Preview Pattern

The `data-editing-theme` pattern is not unique to the brand editor. Any preview-only UI
that needs to "show what X would look like" without committing follows the same rules:

| Surface | Attribute | Scope |
|---|---|---|
| Brand editor dark preview | `data-editing-theme="dark"` | `.org-layout` |
| (future) Accessibility "try high contrast" | `data-preview-contrast` | on element being previewed |
| (future) Per-page theme override | `data-page-theme` | on the route's layout element |

**Three rules for new preview surfaces:**

1. Use a **different** attribute name than the persistence attribute. Never `data-theme`.
2. **Scope it as narrowly as possible** — usually to the feature's container, not `<html>`.
3. **Mirror all CSS rules** that consume the persistence attribute with parallel rules that
   consume the preview attribute. If `[data-theme='dark']` turns a token red, so must
   `[data-preview-*='dark']`.

---

## 6. Anti-Patterns

Each of these directly regresses an iter-019 fix.

### 6.1. Writing `<html data-theme>` from anywhere except `theme.svelte.ts`

**Canonical bug**: Codex-9u8wg.

**What broke**: the brand editor's `setThemePreview(theme)` called
`document.documentElement.setAttribute('data-theme', theme)`. Every downstream consumer
assumed that write meant "user changed preference."

**Rule**: only `setTheme()` in `theme.svelte.ts` writes `<html data-theme>`. Preview-only
UI scopes to a sub-container with a different attribute name.

**Audit check**: grep for `documentElement.setAttribute('data-theme'`. Exactly **one** hit
expected — `theme.svelte.ts:46`. More than one = regression.

```bash
grep -rn "documentElement.setAttribute('data-theme'" apps/web/src
grep -rn 'documentElement.setAttribute("data-theme"' apps/web/src
```

### 6.2. Snapshotting theme into component-local `$state`

**Canonical bug**: Codex-micw3.

**What broke**: `ThemeToggle.svelte` initialised `let theme = $state<Theme>('light')`
on mount and only mutated it via its own click handler. Any external theme change
(brand editor, future accessibility override, a second `ThemeToggle` instance) left the
local copy stale.

**Rule**: components that display theme state read it via `$derived(themeState.theme)`,
never via `$state`. The only valid `$state` for theme is the module-level one in
`theme.svelte.ts:31-37`.

**Audit check**: grep for `$state<Theme>` or `$state<'light'|'dark'>`. Only hits should
be in `theme.svelte.ts` itself.

### 6.3. Capture-and-restore of theme preference across async sessions

**Canonical bug**: Codex-z91af.

**What broke**: the brand editor captured `state.originalTheme` on open (from
`documentElement.getAttribute('data-theme')`) and wrote it back to `<html>` on close.
If the user toggled their real preference via the sidebar during the edit session,
the captured-on-open value was stale by close time — overwriting the new preference.

**Rule**: never snapshot the user's theme preference at the start of an async session
and restore it at the end. Theme is a **global** piece of state that other UI (the
sidebar toggle) can legitimately change during your session. Either:

- (a) Don't touch the global attribute in the first place (the landed fix — scope to
  `data-editing-theme`), or
- (b) Re-read the current persisted preference at close time instead of using the
  captured one, or
- (c) Subscribe to storage events during the session so the captured value stays fresh.

(a) is strictly better than (b) and (c) because it removes the capture entirely. The
landed brand-editor code uses (a): `state.originalTheme` no longer exists as a tracked
field; `close()` at `brand-editor-store.svelte.ts:160-177` simply removes the preview
attribute and doesn't try to restore anything.

> **Known follow-up**: the `brandEditor.originalTheme` getter at
> `brand-editor-store.svelte.ts:348-350` still references `state.originalTheme` as dead
> code after the Codex-9u8wg fix removed the field. It's a leftover — worth a cleanup
> bead (not a runtime bug; TS returns `undefined`).

---

## 7. Checklist — Adding a New Theme-Dependent Token

When you add a token whose value differs between light and dark:

```
[ ] Define the light value in apps/web/src/lib/styles/themes/light.css
    (or the applicable :root token file)
[ ] Define the dark value in apps/web/src/lib/styles/themes/dark.css
    gated by [data-theme='dark']
[ ] If the token is org-brand-aware: mirror the dark rule in
    apps/web/src/lib/theme/tokens/org-brand.css with a
    [data-editing-theme='dark'] parallel selector (see §4)
[ ] Verify in TWO scenarios:
    (1) Real theme toggle — sidebar click, refresh, value persists
    (2) Brand editor dark preview — click editor's Light/Dark toggle,
        assert <html data-theme> does NOT change, preview reflects dark palette
[ ] Grep for any test that asserts 'light' / 'dark' values and update
    if the new token is part of the assertion surface
```

---

## 8. Candidate Hard-Rule Promotion

Two rules in this reference have recurrence patterns that might merit promotion to
SKILL.md §2's hard-rules table on future regressions:

- **"Only `theme.svelte.ts` writes `<html data-theme>`"** (§6.1) — one incident so far
  (Codex-9u8wg). One more recurrence = promote. The shape is analogous to R15: a small
  violation produces a big downstream mess (persistence leak), which argues for earlier
  promotion if it recurs.
- **"Components that display theme state subscribe via `$derived(themeState.theme)`, never
  snapshot into local `$state`"** (§6.2) — one incident (Codex-micw3). Second recurrence
  = promote. Related to R13 in shape (both are "silently broken reactive contract" bugs).

Promotion is a SKILL.md edit, not a reference edit — file a bead if you observe a second
occurrence. Do not add `R16`/`R17` to SKILL.md pre-emptively from this reference; §7 of
SKILL.md governs promotion.

---

## 9. When to Re-Verify This Reference

- `apps/web/src/lib/theme.svelte.ts` — if `setTheme()`, `toggleTheme()`, `themeState`
  change shape, update §1 and §3
- `apps/web/src/app.html` — if the blocking script changes source-chain order, update §2
- `apps/web/src/lib/theme/tokens/org-brand.css` — if the `[data-editing-theme='dark']`
  selectors are renamed or removed, update §4
- `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts` — `setThemePreview`,
  `setEditingTheme`, `open`, `close` — update §4 and §6.3 if the scoping attribute or the
  close-time behaviour changes
- `apps/web/src/lib/components/ui/ThemeToggle/ThemeToggle.svelte` — canonical consumer
  pattern cited in §3

If the code disagrees with this reference, **the code wins** — update here.

---

## 10. Cross-References

- `10-brand-editor.md` §1 "Architecture Overview" — the brand editor's preview path
- `01-tokens.md` — light/dark token authoring patterns
- `02-css-architecture.md` — where `[data-theme]` sits in the cascade
- `docs/brand-editor-investigation/implementation-summary.md` — the iter-019 investigation
  record (history, not reference — cite here for context, not as authoritative code)
