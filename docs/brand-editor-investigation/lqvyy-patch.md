# Codex-lqvyy — PR-Ready Patch Spec

**Bead**: `Codex-lqvyy` (P1 bug)
**Title**: `darkModeOverrides` NEVER rendered for non-editor visitors
**Iteration**: 023 Agent L
**Date**: 2026-04-23
**Target file**: `apps/web/src/routes/_org/[slug]/+layout.svelte`
**Estimated diff size**: ~30 lines (additive only)

---

## §1. Diff

The patch adds a `$derived.by()` block that parses `darkModeOverrides` from the server load and exposes four per-field derived values, then binds those values as `style:--brand-*-dark` attributes on `.org-layout`. Both the parse and the bindings mirror the existing pattern for light-mode colors (`brandPrimary`, `brandSecondary`, etc.) at lines 51–54.

```diff
--- a/apps/web/src/routes/_org/[slug]/+layout.svelte
+++ b/apps/web/src/routes/_org/[slug]/+layout.svelte
@@ -51,6 +51,30 @@ import * as m from '$paraglide/messages';
   const brandPrimary = $derived(data.org?.brandColors?.primary ?? undefined);
   const brandSecondary = $derived(data.org?.brandColors?.secondary ?? undefined);
   const brandAccent = $derived(data.org?.brandColors?.accent ?? undefined);
   const brandBackground = $derived(data.org?.brandColors?.background ?? undefined);
+
+  // Dark-mode color overrides — parsed once from the JSON string stored in
+  // branding_settings.dark_mode_overrides (Partial<ThemeColors> shape).
+  // SSR-rendered so dark-mode visitors receive the correct override values
+  // on first paint with no client-side JS required.
+  // Safe: malformed JSON or absent field silently returns null (no override).
+  const darkColorOverrides = $derived.by(() => {
+    const raw = data.org?.brandFineTune?.darkModeOverrides;
+    if (!raw) return null;
+    try {
+      return JSON.parse(raw) as Partial<{
+        primaryColor: string;
+        secondaryColor: string | null;
+        accentColor: string | null;
+        backgroundColor: string | null;
+      }>;
+    } catch {
+      return null;
+    }
+  });
+  const brandPrimaryDark = $derived(darkColorOverrides?.primaryColor ?? undefined);
+  const brandSecondaryDark = $derived(darkColorOverrides?.secondaryColor ?? undefined);
+  const brandAccentDark = $derived(darkColorOverrides?.accentColor ?? undefined);
+  const brandBackgroundDark = $derived(darkColorOverrides?.backgroundColor ?? undefined);
+
   const brandFontBody = $derived(data.org?.brandFonts?.body ?? undefined);
```

Then in the template element (`.org-layout` div, currently lines 370–383), add four `style:` bindings after the existing light-mode color bindings:

```diff
@@ -370,6 +394,10 @@ import * as m from '$paraglide/messages';
   style:--brand-color={brandPrimary}
   style:--brand-secondary={brandSecondary}
   style:--brand-accent={brandAccent}
   style:--brand-bg={brandBackground}
+  style:--brand-color-dark={brandPrimaryDark}
+  style:--brand-secondary-dark={brandSecondaryDark}
+  style:--brand-accent-dark={brandAccentDark}
+  style:--brand-bg-dark={brandBackgroundDark}
   style:--brand-density={brandDensity}
   style:--brand-radius={brandRadius}
```

### Line number anchors

These are the exact current-file locations:

- **Parse block insertion**: after line 54 (`const brandBackground = ...`) and before line 55 (`const brandFontBody = ...`). The four `$derived` lines and the `$derived.by()` block total 25 lines.
- **Template binding insertion**: after line 373 (`style:--brand-bg={brandBackground}`) and before line 374 (`style:--brand-density={brandDensity}`). The four `style:` bindings are 4 lines.

### Why `$derived` runs in SSR

Svelte 5 `$derived` (and `$derived.by()`) executes synchronously during server-side rendering when computing the component's initial props. Because the bindings are on a DOM element attribute, SvelteKit emits them as inline `style` attributes in the HTML response. Dark-mode visitors see `--brand-color-dark: #...` in the initial HTML before any JS loads — no FOUC, no flash-of-wrong-color.

The existing `$effect` block (lines 116–132) that calls `injectTokenOverrides` is intentionally **not** modified — it handles the editor-open path. The new `$derived` values are complementary and scoped to the SSR / non-editor path.

---

## §2. Type Safety Check

### Existing type: `Partial<ThemeColors>`

`apps/web/src/lib/brand-editor/types.ts` defines at line 12:

```typescript
interface ThemeColors {
  primaryColor: string;
  secondaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
}
```

And at line 36 of `BrandEditorState`:

```typescript
darkOverrides: Partial<ThemeColors> | null;
```

`ThemeColors` is declared with `interface` but is NOT exported from `types.ts`. The exported type `ThemeColorField = keyof ThemeColors` (line 20) is exported, but `ThemeColors` itself is not.

### Recommendation for the patch

There are two correct options:

**Option A (inline, no import required — recommended for this minimal patch)**: Inline the type in the `$derived.by()` parse cast, as shown in §1. This matches the pattern used elsewhere in the layout (e.g., the `heroHideFlags` block at line 74–89 also inlines its parsed type without importing from `types.ts`). No changes to `types.ts` needed.

**Option B (export and import)**: Export `ThemeColors` from `types.ts` and import it in `+layout.svelte`. This adds a dependency on the brand-editor package from the layout, which is already present (line 25: `import { brandEditor, injectTokenOverrides, clearTokenOverrides } from '$lib/brand-editor'`). If the brand-editor barrel (`$lib/brand-editor/index.ts`) already re-exports `ThemeColors`, this is clean. If not, the export must be added to `types.ts:20` and the barrel.

For this P1 bug fix, **Option A (inline type)** is preferred because:
1. It keeps the PR diff in one file.
2. `ThemeColors` is not currently exported, and adding an export touches two files unnecessarily.
3. The inline cast is self-documenting — the shape of `darkModeOverrides` is visible at the point of use.

The `wwedk` epic (which will rename `darkOverrides → darkColorOverrides` and introduce parallel `darkTokenOverrides`) is the right time to formalize and export `ThemeColors`. That larger refactor is out of scope here.

### Data flow verification

```
branding_settings.dark_mode_overrides (TEXT JSON)
  → BrandingSettingsService.mapRow() → brandFineTune.darkModeOverrides: string | null
  → workers/organization-api fetchPublicOrgInfo → BrandingSettingsResponse.brandFineTune.darkModeOverrides
  → +layout.server.ts data.org.brandFineTune.darkModeOverrides
  → +layout.svelte darkColorOverrides ($derived.by parse)
  → brandPrimaryDark / brandSecondaryDark / brandAccentDark / brandBackgroundDark
  → style:--brand-color-dark / --brand-secondary-dark / --brand-accent-dark / --brand-bg-dark (inline HTML)
  → org-brand.css:215–265 reads var(--brand-color-dark, ...) for OKLCH dark-mode palette
```

The field `data.org.brandFineTune.darkModeOverrides` is typed as `string | null` throughout the server-to-client path (verified in `branding-settings-service.ts` — the column is `text('dark_mode_overrides')` in Drizzle, which maps to `string | null` in TypeScript). The `JSON.parse(raw)` cast in the new `$derived.by()` is therefore safe — `raw` is never `undefined` (the null check guards that).

---

## §3. Unit Test Scaffolding

The layout component has deep dependencies (SvelteKit `page` store, the brand editor store, collections, etc.) that make mounting `+layout.svelte` directly impractical without significant mocking infrastructure. The correct test target for this logic is a **pure function extracted from the parse block**.

### Recommended approach: extract + test the parser

Extract the dark-override parse logic into a small utility function in a new file:

```typescript
// apps/web/src/lib/brand-editor/parse-dark-overrides.ts

import type { ThemeColorField } from './types';

type DarkColorOverrides = Partial<Record<ThemeColorField, string | null>>;

/**
 * Parse the raw JSON string stored in branding_settings.dark_mode_overrides.
 * Returns null on absent or malformed input — safe to call unconditionally.
 */
export function parseDarkColorOverrides(raw: string | null | undefined): DarkColorOverrides | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DarkColorOverrides;
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
```

Then in `+layout.svelte`, replace the inline `$derived.by()` parse with:

```svelte
import { parseDarkColorOverrides } from '$lib/brand-editor/parse-dark-overrides';
// ...
const darkColorOverrides = $derived(parseDarkColorOverrides(data.org?.brandFineTune?.darkModeOverrides));
```

This removes the need to mount the layout in tests. If the implementer prefers to keep the logic inline (acceptable for a P1 hotfix), the unit tests below can be adapted to test the inline logic via a thin wrapper.

### Unit test file

**Path**: `apps/web/src/lib/brand-editor/__tests__/parse-dark-overrides.test.ts`

```typescript
import { describe, expect, test } from 'vitest';
import { parseDarkColorOverrides } from '../parse-dark-overrides';

describe('parseDarkColorOverrides', () => {
  test('returns parsed object for valid JSON with primaryColor', () => {
    const result = parseDarkColorOverrides('{"primaryColor":"#00ff00"}');
    expect(result).toEqual({ primaryColor: '#00ff00' });
  });

  test('returns all four color fields when present', () => {
    const raw = JSON.stringify({
      primaryColor: '#111111',
      secondaryColor: '#222222',
      accentColor: '#333333',
      backgroundColor: '#444444',
    });
    const result = parseDarkColorOverrides(raw);
    expect(result?.primaryColor).toBe('#111111');
    expect(result?.secondaryColor).toBe('#222222');
    expect(result?.accentColor).toBe('#333333');
    expect(result?.backgroundColor).toBe('#444444');
  });

  test('returns partial object for partial JSON (most orgs only set primaryColor)', () => {
    const result = parseDarkColorOverrides('{"primaryColor":"#ff0000"}');
    expect(result?.primaryColor).toBe('#ff0000');
    expect(result?.secondaryColor).toBeUndefined();
  });

  test('returns null for malformed JSON — graceful degradation', () => {
    expect(parseDarkColorOverrides('not-json')).toBeNull();
    expect(parseDarkColorOverrides('{broken')).toBeNull();
    expect(parseDarkColorOverrides('null')).toBeNull();
    expect(parseDarkColorOverrides('[]')).toBeNull();
  });

  test('returns null for null input — no override emitted', () => {
    expect(parseDarkColorOverrides(null)).toBeNull();
  });

  test('returns null for undefined input', () => {
    expect(parseDarkColorOverrides(undefined)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseDarkColorOverrides('')).toBeNull();
  });

  test('handles null field values inside valid JSON', () => {
    const result = parseDarkColorOverrides('{"primaryColor":"#00ff00","secondaryColor":null}');
    expect(result?.primaryColor).toBe('#00ff00');
    expect(result?.secondaryColor).toBeNull();
  });
});
```

### CSS binding integration test (if full layout mount is desired)

If the team later wants a mount-level test verifying the style bindings, the pattern from `Card.svelte.test.ts` applies — use `mount` from `$tests/utils/component-test-utils.svelte`. However, `+layout.svelte` requires extensive mocking of SvelteKit internals (`page` rune, `beforeNavigate`, `onMount`). Defer this to a follow-up; the pure-function unit tests above provide sufficient coverage of the P1 logic. The Playwright e2e test in §4 closes the gap for the style-binding assertion.

---

## §4. Playwright E2E Test

**Path**: `apps/web/e2e/org/dark-override-render.spec.ts`

This test follows the existing pattern in `e2e/studio/settings.spec.ts` — uses `registerSharedStudioUser` for auth setup and `injectSharedStudioAuth` to inject cookies. It adds a new assertion: dark-mode visitors see `--brand-color-dark` resolved to the configured value.

```typescript
import { expect } from '@playwright/test';
import { test } from '../fixtures/auth';
import {
  cleanupSharedStudioAuth,
  injectSharedStudioAuth,
  navigateToStudioPage,
  registerSharedStudioUser,
  type SharedStudioAuth,
} from '../helpers/studio';

/**
 * Dark-mode color overrides render test — Codex-lqvyy
 *
 * Verifies that darkModeOverrides set via the brand editor are rendered
 * as --brand-color-dark CSS custom properties on .org-layout for
 * non-editor visitors in dark mode.
 *
 * This test uses page.emulateMedia({ colorScheme: 'dark' }) to simulate
 * a dark-mode OS preference. The org layout applies [data-theme='dark']
 * based on this preference, which activates the OKLCH dark-mode rules in
 * org-brand.css:215–265 that read var(--brand-color-dark, ...).
 */

const DARK_PRIMARY = '#00ff42'; // Distinctive green — unlikely to be a default value

test.describe('Dark-mode color overrides render (Codex-lqvyy)', () => {
  test.describe.configure({ mode: 'serial' });

  let sharedAuth: SharedStudioAuth;

  test.beforeAll(async () => {
    sharedAuth = await registerSharedStudioUser({ orgRole: 'owner' });
  });

  test.afterAll(async () => {
    await cleanupSharedStudioAuth(sharedAuth);
  });

  test('dark-mode visitor sees --brand-color-dark from saved darkModeOverrides', async ({ browser }) => {
    const { member } = sharedAuth;
    const orgSlug = member.organization.slug;

    // ── Step 1: As platform admin/owner, open the brand editor and save dark overrides ──
    const editorContext = await browser.newContext();
    const editorPage = await editorContext.newPage();
    await injectSharedStudioAuth(editorPage, sharedAuth);

    // Navigate to org landing with brand editor open
    await editorPage.goto(`http://${orgSlug}.lvh.me:5173/?brandEditor`);
    await editorPage.waitForLoadState('networkidle');

    // The brand editor panel should be visible
    await expect(editorPage.locator('[data-testid="brand-editor-panel"]')).toBeVisible({
      timeout: 10000,
    });

    // ── Step 2: Set dark-mode primary color via the editor API (direct DB write) ──
    // Rather than driving the full editor UI (fragile), write directly to the DB
    // via the branding settings API, matching the exact JSON shape.
    const orgId = member.organization.id;
    const response = await editorPage.request.put(
      `http://localhost:42075/api/organizations/${orgId}/settings/branding`,
      {
        data: {
          darkModeOverrides: JSON.stringify({ primaryColor: DARK_PRIMARY }),
        },
        headers: {
          // Auth cookie is already in editorPage context via injectSharedStudioAuth
        },
      }
    );
    expect(response.ok()).toBeTruthy();

    await editorContext.close();

    // ── Step 3: Open a fresh context in dark mode (no editor param, no session) ──
    const darkContext = await browser.newContext({
      colorScheme: 'dark',
    });
    const visitorPage = await darkContext.newPage();

    await visitorPage.goto(`http://${orgSlug}.lvh.me:5173/`);
    await visitorPage.waitForLoadState('networkidle');

    // ── Step 4: Assert --brand-color-dark is set on .org-layout ──
    const cssVarValue = await visitorPage.evaluate(() => {
      const el = document.querySelector('.org-layout') as HTMLElement | null;
      if (!el) return null;
      return el.style.getPropertyValue('--brand-color-dark').trim();
    });

    expect(cssVarValue).toBe(DARK_PRIMARY);

    // ── Step 5: Assert the OKLCH-derived dark primary resolves via the CSS var chain ──
    // org-brand.css reads --brand-color-dark inside [data-theme='dark'] [data-org-brand].
    // We verify the CSS custom property exists; computed-style verification of derived
    // OKLCH colours requires a live browser paint and is deferred to visual regression.
    const brandColorDark = await visitorPage.evaluate(() => {
      const el = document.querySelector('[data-org-brand]') as HTMLElement | null;
      if (!el) return null;
      return getComputedStyle(el).getPropertyValue('--brand-color-dark').trim();
    });

    expect(brandColorDark).toBe(DARK_PRIMARY);

    await darkContext.close();
  });

  test('light-mode visitor is unaffected by darkModeOverrides', async ({ browser }) => {
    const { member } = sharedAuth;
    const orgSlug = member.organization.slug;

    const lightContext = await browser.newContext({
      colorScheme: 'light',
    });
    const visitorPage = await lightContext.newPage();

    await visitorPage.goto(`http://${orgSlug}.lvh.me:5173/`);
    await visitorPage.waitForLoadState('networkidle');

    // --brand-color (light) should NOT equal DARK_PRIMARY
    const lightPrimary = await visitorPage.evaluate(() => {
      const el = document.querySelector('.org-layout') as HTMLElement | null;
      if (!el) return null;
      return el.style.getPropertyValue('--brand-color').trim();
    });

    // The dark override should not leak into the light primary
    expect(lightPrimary).not.toBe(DARK_PRIMARY);

    await lightContext.close();
  });

  test('malformed darkModeOverrides does not set --brand-color-dark', async ({ browser }) => {
    const { member } = sharedAuth;
    const orgSlug = member.organization.slug;

    // Write malformed JSON to darkModeOverrides
    const orgId = member.organization.id;
    const editorContext = await browser.newContext();
    const editorPage = await editorContext.newPage();
    await injectSharedStudioAuth(editorPage, sharedAuth);

    await editorPage.request.put(
      `http://localhost:42075/api/organizations/${orgId}/settings/branding`,
      {
        data: { darkModeOverrides: 'NOT_VALID_JSON' },
      }
    );
    await editorContext.close();

    // Fresh dark-mode visitor
    const darkContext = await browser.newContext({ colorScheme: 'dark' });
    const visitorPage = await darkContext.newPage();
    await visitorPage.goto(`http://${orgSlug}.lvh.me:5173/`);
    await visitorPage.waitForLoadState('networkidle');

    const cssVarValue = await visitorPage.evaluate(() => {
      const el = document.querySelector('.org-layout') as HTMLElement | null;
      if (!el) return null;
      return el.style.getPropertyValue('--brand-color-dark').trim();
    });

    // Malformed JSON → $derived.by returns null → style: binding is undefined → not emitted
    expect(cssVarValue).toBe('');

    await darkContext.close();
  });
});
```

**Notes on the test design**:
- Uses `browser.newContext({ colorScheme: 'dark' })` (Playwright's `emulateMedia` equivalent at context level) to simulate a dark-mode OS preference without touching the system.
- Steps 1–2 write directly to the branding API rather than driving the full editor UI. This avoids test fragility from editor-specific selectors while still verifying the real data path.
- The `--brand-color-dark` assertion checks the inline style attribute, which is what the `style:--brand-color-dark={brandPrimaryDark}` binding produces. This is sufficient to confirm the SSR patch is working.
- The full OKLCH color chain (`--color-brand-primary` in dark mode resolving via `org-brand.css:215–265`) is not asserted here — computed-style resolution across CSS var chains is fragile in Playwright and is better covered by the visual regression suite.

---

## §5. Pre-PR Verification Checklist

- [ ] Run `pnpm typecheck` in `apps/web` — verify zero new TypeScript errors
- [ ] Run `pnpm test` from `apps/web` — existing tests still pass; new `parse-dark-overrides.test.ts` tests are green (8 assertions)
- [ ] Run `pnpm test:e2e` with the dev server running — Playwright `dark-override-render.spec.ts` passes (3 tests)
- [ ] Start `pnpm dev` from **monorepo root** (never from `apps/web`) — confirm all workers start
- [ ] Load a test org with a `darkModeOverrides` value already set in the DB — open in dark mode (toggle OS or use DevTools > Rendering > Emulate CSS prefers-color-scheme > dark) and confirm `--brand-color-dark` appears on `.org-layout` in the Elements panel
- [ ] Load the same org in light mode — confirm `--brand-color-dark` IS still emitted (the binding is always present; `org-brand.css` gates its application) and that the light primary color is unaffected
- [ ] Open the org with `?brandEditor` URL param — confirm the editor still works, no console errors, live dark-override preview still functional (the editor `$effect` path is unchanged)
- [ ] `git diff --stat` — verify only `+layout.svelte` (and optionally the new utility file + test) are modified; no other files changed
- [ ] Check `bd ready` — confirm `Codex-wcwpw` (tokenOverrides FOUC) and `Codex-wwedk` (per-theme shader feature) are unblocked or annotated correctly once this lands
- [ ] Verify `Codex-lqvyy` dependencies: `Codex-wwedk` is blocked by this bead — after merge, update `wwedk`'s blocker list to remove `lqvyy`
- [ ] Confirm `pnpm typecheck` passes in the monorepo root as well (cross-package types are checked there)

---

## §6. Scope Boundaries

This patch does **not**:

- **Change DB schema** — `dark_mode_overrides` column already exists as `text` in `branding_settings`. No migration required.
- **Change the worker response shape** — `brandFineTune.darkModeOverrides` is already returned by `fetchPublicOrgInfo` and flows through to `data.org.brandFineTune.darkModeOverrides` in the layout server load. No changes to any worker.
- **Change types in packages/** — `ThemeColors` in `packages/platform-settings` and `packages/shared-types` are unchanged. The inline cast in `$derived.by()` does not affect package-level types.
- **Touch the editor preview path** — The `$effect` block (lines 116–132) that calls `injectTokenOverrides` and `injectBrandVars` when the brand editor is open is untouched. The editor preview already correctly handles `darkOverrides` via `css-injection.ts` — that path works and is not part of this bug.
- **Address `Codex-wcwpw`** (tokenOverrides FOUC for shader/hero visibility) — separate bug, separate fix. The FOUC issue is in the `$effect`-based `injectTokenOverrides` path; this patch only adds `$derived`-based bindings for the four color fields.
- **Address `Codex-wwedk`** (per-theme shader and full tokenOverrides) — this patch is the **prerequisite** for `wwedk`. The `wwedk` feature will extend the pattern introduced here to `darkTokenOverrides`, `--brand-shader-preset-dark`, etc. The naming (`darkColorOverrides`, `brandPrimaryDark`) deliberately anticipates the rename from Agent J's design doc, but the actual `darkOverrides → darkColorOverrides` rename in `types.ts` and `brand-editor-store.svelte.ts` is deferred to `wwedk` to keep this PR minimal.
- **Rename `darkOverrides` in `BrandEditorState`** — Agent J's design doc (`per-theme-tokens-design.md §6`) recommends renaming `darkOverrides → darkColorOverrides` in `types.ts:36`. That rename touches `brand-editor-store.svelte.ts`, `types.ts`, and potentially several editor components. It is the right call but belongs in the `wwedk` PR, not this hotfix. The local variable name `darkColorOverrides` in this patch (used inside `+layout.svelte` only) previews the intended convention without modifying the shared type.

### Ambiguity callout: should this patch also emit the CSS gate rules?

The `org-brand.css` rules at lines 215–265 already consume `var(--brand-color-dark, var(--brand-color))` — the fallback chain is pre-existing. This means the CSS side is already correct. The only missing piece was the inline style attribute on `.org-layout` that populates `--brand-color-dark`. This patch supplies exactly that. No changes to `org-brand.css` are required.

---

## §7. Rollout and Monitoring

**Feature flag**: Not required. The patch is strictly additive — it adds four `style:` bindings that previously emitted `undefined` (no attribute). For orgs with `darkModeOverrides = null` (the majority), the new bindings still emit nothing (Svelte's `style:prop={undefined}` behaviour omits the property). For orgs with `darkModeOverrides` set, the bindings now correctly populate the CSS variables. There is no changed behavior for the null/unset case.

**Zero risk of regression**: The light-mode color bindings (`--brand-color`, `--brand-secondary`, `--brand-accent`, `--brand-bg`) are unchanged. The OKLCH derivation chain in `org-brand.css` that reads `--brand-color-dark` already has a fallback (`var(--brand-color-dark, var(--brand-color))`) — if the dark var is absent, it falls back to the light value, which is the pre-patch behavior for all visitors.

**Post-deploy monitoring**:
1. Query the DB for orgs with a non-null `dark_mode_overrides` column: `SELECT slug FROM organizations o JOIN branding_settings bs ON bs.organization_id = o.id WHERE bs.dark_mode_overrides IS NOT NULL;`
2. For each such org, load the org landing page in a browser with dark mode enabled (DevTools Rendering panel or OS setting) and verify the rendered primary color matches the saved `darkModeOverrides.primaryColor` (visually or via Elements → Computed → `--brand-color-dark`).
3. Check the Cloudflare Workers log for the `organization-api` worker: confirm no new 500s from `fetchPublicOrgInfo` — the patch adds no server-side code, but any latent serialization issues in `mapRow` would surface here.
4. No metrics are expected to change: the patch does not add network requests, DB queries, or KV reads. The only observable change is pixel-level color in dark mode for orgs that have configured `darkModeOverrides`.

---

## §8. PR Description Template

```
fix(org-layout): render darkModeOverrides as CSS vars for non-editor visitors (Codex-lqvyy)

**Problem**
Dark-mode color overrides configured via the brand editor were never rendered
for regular visitors. The feature worked in editor preview (via an $effect-based
CSS injection path) but the server-rendered layout path was missing the $derived
parse and style: bindings entirely, so all dark-mode visitors saw the light
primary color regardless of what the creator had configured.

**Fix**
Add a $derived.by() parse block that reads data.org.brandFineTune.darkModeOverrides
(a JSON string already present in the server load) and exposes four per-field
$derived values (brandPrimaryDark, brandSecondaryDark, brandAccentDark,
brandBackgroundDark). Bind these to style:--brand-color-dark / --brand-secondary-dark /
--brand-accent-dark / --brand-bg-dark on .org-layout. Because $derived runs in
SSR, the correct dark colors arrive in the initial HTML response — no FOUC.
The existing org-brand.css rules (lines 215–265) already consume these vars via
a var(--brand-color-dark, var(--brand-color)) fallback chain; no CSS changes needed.

**Test plan**
- [ ] `pnpm typecheck` — no new errors
- [ ] `pnpm test` — new parse-dark-overrides unit tests pass (8 assertions)
- [ ] `pnpm test:e2e` — dark-override-render.spec.ts passes (3 tests)
- [ ] Manual: load org with dark overrides set in dark mode → verify --brand-color-dark in DevTools Elements
- [ ] Manual: load same org in light mode → light primary unaffected
- [ ] Manual: load org with ?brandEditor → editor preview still functional

**Risk assessment**: Low.
- Strictly additive: 4 new $derived + 4 new style: bindings.
- For orgs without darkModeOverrides (majority), bindings emit undefined → no attribute (unchanged behavior).
- No DB, worker, or CSS file changes.
- The existing var(--brand-color-dark, var(--brand-color)) fallback in org-brand.css ensures
  the pre-patch behavior (use light color) is preserved for any case where the dark var is absent.

**Linked bead**: Codex-lqvyy (P1)
**Prerequisite for**: Codex-wwedk (per-theme shader + full tokenOverrides)
**Design context**: docs/brand-editor-investigation/per-theme-tokens-design.md (Agent J, iter-022)
**Investigation context**: docs/brand-editor-investigation/README.md §3 iter-022 findings
```
