# Per-Theme Shader and tokenOverrides Design

**Bead**: `Codex-wwedk` (P2 feature)
**Iteration**: 022 Agent J
**Date**: 2026-04-23
**Status**: Design proposal — blocked by `Codex-9u8wg` (editor preview scope)

---

## §1. Problem Statement

The user wants the brand editor to support independent visual configuration for light and dark modes beyond just the four color palette fields. Concretely: a creator running a music platform may want a luminous `flow` shader in light mode and a moody `ink` shader in dark mode, making the two modes feel like distinct presences rather than a color-inverted copy of each other. The same applies to glass tint (white-tinted glass panels in light mode, dark-tinted in dark), player chrome colors, shadow color (warm amber shadow in light, cool grey shadow in dark), and potentially heading color overrides.

The keys most likely to benefit from per-theme values are: `shader-preset`, `shader-intensity`, `glass-tint`, `shadow-color`, `heading-color`, and the player chrome cluster (`player-text`, `player-surface`, `player-overlay`). Keys that carry no meaningful per-theme semantic are: `card-hover-scale` and `card-image-hover-scale` (hover animation multipliers — identical behavior in both themes), `text-scale` (global proportional scaling — a theme change should not shift type size), `heading-weight` and `body-weight` (font-weight selection is typography identity, not a light/dark concern), `text-transform-label` (stylistic — same in both modes), and the hero visibility flags `hero-hide-*` (boolean visibility toggles unrelated to light/dark preference). These shared keys should remain single-valued to keep the editor surface manageable.

---

## §2. Current State Recap

| Token Category | # Keys | Per-Theme Today? | Notes |
|---|---|---|---|
| `brand-color-input` (primaryColor, secondaryColor, accentColor, backgroundColor) | 4 | **Yes** — via `darkModeOverrides` JSON on `branding_settings.dark_mode_overrides` | Only color fields; shape is `Partial<ThemeColors>` typed in `types.ts:36` |
| `brand-fine-tune` (heading-color, text-scale, heading-weight, body-weight, text-transform-label) | 11 | **No** — single value in `tokenOverrides` | Source: `token-registry.json` category `brand-fine-tune` |
| `brand-shader-presets` (shader-preset) | 1 | **No** — single value in `tokenOverrides` | Source: `token-registry.json:474-486`; consumed by `ShaderHero.svelte` |
| `brand-player-chrome` (player-text, player-surface, etc.) | 9 | **No** — single value in `tokenOverrides` | Source: `token-registry.json:489-612` |
| `brand-glass` (glass-tint) | 1 | **No** — single value in `tokenOverrides` | Source: `token-registry.json:436-448` |
| `brand-card-interaction` (card-hover-scale, card-image-hover-scale) | 2 | **No** — and should remain shared | Multipliers; no per-theme semantic |
| `brand-hero-visibility` (hero-hide-*) | 5 | **No** — and should remain shared | Boolean presence; light/dark invariant |
| `brand-shadow-input` (shadow-scale, shadow-color) | 2 | **No** — single value in `tokenOverrides` | shadow-color is a candidate for per-theme; shadow-scale is not |

The routing pattern that makes colors per-theme today lives in `brand-editor-store.svelte.ts:244-260` (`setThemeColor`): it writes to `state.pending.darkOverrides[field]` when `state.editingTheme === 'dark'`, otherwise to the top-level field. No equivalent routing exists for `tokenOverrides`.

---

## §3. Three Schema Options

### Option A — Unified darkOverrides Widening

Widen the `darkOverrides` JSON blob to accept any tokenOverride key, not just `ThemeColors`.

**Schema diff (TypeScript)**

```typescript
// types.ts — today
interface ThemeColors {
  primaryColor: string;
  secondaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
}
darkOverrides: Partial<ThemeColors> | null;

// types.ts — Option A
// ThemeColors unchanged, but darkOverrides accepts arbitrary keys too:
darkOverrides: (Partial<ThemeColors> & Record<string, string | null>) | null;
// OR — cleaner break:
darkOverrides: Record<string, string | null> | null;
// Existing orgs: { primaryColor: '#...', backgroundColor: '#...' }
// New per-theme token: { primaryColor: '#...', 'shader-preset': 'ink' }
```

**Schema diff (SQL / Drizzle)**

No column change needed. `dark_mode_overrides` is already `text` (JSON string). The existing column accepts any valid JSON object — widening the TypeScript shape requires no migration.

**Migration for existing data**

None required. Existing rows store `{ primaryColor: '...', ... }` — the color keys remain valid within the wider shape.

**Code touchpoints**

- `apps/web/src/lib/brand-editor/types.ts:36` — widen `darkOverrides` type
- `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts:244-260` — `setThemeColor` becomes `setThemedToken(key, value)` routing both color keys and tokenOverride keys by `editingTheme`
- `apps/web/src/lib/brand-editor/css-injection.ts` — `injectBrandVars` must read dark overrides and emit them under a theme gate when `editingTheme === 'dark'`
- `apps/web/src/routes/_org/[slug]/+layout.svelte:102-132` — SSR injection must emit dark tokenOverrides keys with `[data-theme='dark']` gate
- `packages/platform-settings/src/services/branding-settings-service.ts:120` — `darkModeOverrides` mapping in `mapRow` is unchanged (it's a raw JSON string)
- `packages/validation/src/` — if the Zod schema for `UpdateBrandingInput` validates the shape of `darkModeOverrides`, it must be relaxed to `Record<string, string | null>` or made a passthrough

**Pros**

- Single column, zero DB migration — lowest operational risk.
- All per-theme data (colors + fine-tunes) lives in one blob, so the save payload and the read path have one merge point.
- The `setThemeColor` routing pattern already solves the write path for colors; extending it to all tokenOverride keys is a clean generalization.
- When querying "what is the effective value for `shader-preset` in dark mode?": `darkOverrides['shader-preset'] ?? tokenOverrides['shader-preset']`.

**Cons**

- The column name `dark_mode_overrides` now holds non-color data, which is a naming mismatch that will confuse future maintainers.
- `Partial<ThemeColors>` was a useful type-narrowing guard — widening to `Record<string, string>` removes it. TypeScript will no longer catch a typo like `primarycolor` in dark overrides.
- If colors ever need a different treatment than fine-tune tokens (e.g., colors derive an OKLCH palette, tokens don't), a single blob makes it harder to split them.

**Query complexity**

Simple: `effectiveValue = (darkOverrides?.[key] ?? tokenOverrides?.[key]) ?? undefined`. One null-coalesce expression.

---

### Option B — Parallel darkTokenOverrides Column

Add a new column `branding_settings.dark_token_overrides` alongside the existing `dark_mode_overrides` and `token_overrides`.

**Schema diff (Drizzle)**

```typescript
// packages/database/src/schema/settings.ts — add inside brandingSettings pgTable
darkTokenOverrides: text('dark_token_overrides'), // JSON: Record<string, string | null>
```

**Schema diff (SQL — generated by `pnpm db:generate`)**

```sql
ALTER TABLE "branding_settings"
  ADD COLUMN "dark_token_overrides" text;
```

**Migration for existing data**

Add the column as nullable. All existing rows default to `null`, which the application treats as "no dark overrides for tokens — fall back to light tokenOverrides." No data transformation needed.

**Code touchpoints**

- `packages/database/src/schema/settings.ts` — new column definition
- `packages/platform-settings/src/services/branding-settings-service.ts:68-200` — select, mapRow, and fieldMap must include `darkTokenOverrides`
- `packages/validation/src/` — `UpdateBrandingInput` Zod schema must accept `darkTokenOverrides`
- `packages/shared-types/src/` — `BrandingSettingsResponse` must include `darkTokenOverrides: string | null`
- `apps/web/src/lib/brand-editor/types.ts` — add `darkTokenOverrides: Record<string, string | null> | null` to `BrandEditorState`
- `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts` — new `setThemedTokenOverride(key, value)` function routes to `darkTokenOverrides` vs `tokenOverrides` based on `editingTheme`
- `apps/web/src/lib/brand-editor/css-injection.ts` — `injectBrandVars` emits dark token overrides with CSS theme gate
- `apps/web/src/routes/_org/[slug]/+layout.svelte` — SSR injection reads `darkTokenOverrides` and emits gated vars
- `apps/web/src/lib/remote/branding.remote.ts` — save payload must include `darkTokenOverrides`
- Worker route `workers/organization-api/src/routes/settings.ts:258` — procedure already delegates to service; service change covers it

**Pros**

- Colors and non-color token overrides remain cleanly separated across three columns: `dark_mode_overrides` (colors only, semantically correct), `token_overrides` (light fine-tunes), `dark_token_overrides` (dark fine-tunes).
- `ThemeColors` type contract on `dark_mode_overrides` is preserved.
- The new column is independently nullable — existing callers that only read `dark_mode_overrides` are untouched.
- Future expansion (e.g., per-breakpoint overrides) follows the same pattern: add another column.

**Cons**

- DB migration required (though non-destructive — nullable column add).
- Spreads branding state across three JSON blobs. To reconstruct the full effective token set for a given theme requires merging `tokenOverrides` + (`darkTokenOverrides` if dark), which is two reads per query path.
- The editor state shape grows: `BrandEditorState` carries `tokenOverrides`, `darkOverrides`, AND `darkTokenOverrides`. The `getSavePayload()` and sessionStorage serialization touch three fields.
- More touchpoints = more surface for bugs to hide. Option B has roughly 2× the diff size of Option A.

**Query complexity**

Two-step: `effectiveValue = (isDark ? (darkTokenOverrides?.[key] ?? tokenOverrides?.[key]) : tokenOverrides?.[key]) ?? undefined`. Slightly more verbose but still trivial.

---

### Option C — Dual-Keyed tokenOverrides Keys

Store both `shader-preset` (light) and `shader-preset-dark` as separate keys inside the existing `token_overrides` JSON object. No new column or type widening needed.

**Schema diff (TypeScript / SQL)**

None.

**Migration for existing data**

None. Existing `shader-preset` keys become the "light" value by convention. Dark keys are absent until the user explicitly sets them; absence means "fall back to light value."

**Code touchpoints**

- `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts` — `updateTokenOverride(key, val)` must suffix `-dark` when `editingTheme === 'dark'`
- `apps/web/src/lib/brand-editor/css-injection.ts` — `injectBrandVars` must emit `--brand-shader-preset` (from `tokenOverrides['shader-preset']`) AND `--brand-shader-preset-dark` (from `tokenOverrides['shader-preset-dark']`)
- `apps/web/src/routes/_org/[slug]/+layout.svelte` — SSR injection must emit both vars per key; CSS gate selects by theme
- `apps/web/src/lib/brand-editor/presets.ts` — presets currently store `{ 'shader-preset': 'ether' }`; applying a preset in dark mode would write `'shader-preset-dark': 'ether'`; applying in light writes `'shader-preset': 'ether'`

**Pros**

- Zero DB migration, zero new TypeScript types, zero new columns.
- Conceptually simple: every dark-variant key is just `{key}-dark`.
- The merged `tokenOverrides` blob contains both themes' data — one fetch, all data.

**Cons**

- The `-dark` suffix convention is implicit and undocumented. Nothing in the type system prevents a rogue key like `shader-preset-dark-experimental` from being stored.
- The `tokenOverrides` blob grows roughly 2× for every org that configures both themes. For an org with 25 fine-tune keys active, this means up to 50 keys in the JSON blob.
- CSS must know at render time which keys have dark variants and emit paired vars. If a new key is added to the editor, the CSS emitter must be manually updated to emit the dark counterpart — no structural enforcement.
- The "effective value" query is now string-manipulation (`key + '-dark'`), which is fragile and not discoverable by TypeScript.
- Presets that intend to set "both themes at once" must explicitly enumerate `shader-preset` and `shader-preset-dark`. Today's preset shape (`tokenOverrides?: Record<string, string>` in `types.ts:53`) would silently accept either — no guard.

**Query complexity**

`effectiveValue = isDark ? (tokenOverrides?.[key + '-dark'] ?? tokenOverrides?.[key]) : tokenOverrides?.[key]`. The string concatenation makes this error-prone and hard to grep.

---

## §4. UX Flow

### Which fine-tunes should vary by theme?

**Per-theme eligible** (visual character changes meaningfully between light/dark):

| Key | Reason |
|---|---|
| `shader-preset` | Luminous shaders suit light mode; dark atmospheric shaders suit dark |
| `shader-intensity` | May want subtler intensity in dark mode to avoid eye strain |
| `glass-tint` | White glass panels clash in dark mode; dark tint needed |
| `shadow-color` | Warm amber shadows clash on dark backgrounds |
| `heading-color` | Org-branded heading colors often need dark adjustment |
| `player-text` | Chromatic player chrome colors need theme adjustment |
| `player-surface`, `player-overlay` | Background colors inside the player are theme-sensitive |

**Shared (single-valued across themes)**:

| Key | Reason |
|---|---|
| `card-hover-scale`, `card-image-hover-scale` | Animation multiplier; no light/dark semantic |
| `text-scale` | Proportional sizing; should be invariant |
| `heading-weight`, `body-weight` | Typography identity; not theme-dependent |
| `text-transform-label` | Stylistic constant |
| `hero-hide-*` | Boolean visibility; invariant |
| `shadow-scale` | Proportional multiplier; invariant |

### Should every eligible fine-tune have a per-theme variant, or only a curated subset?

A curated subset. Exposing a per-theme toggle on every control would create a UI where every slider and color picker has a secondary unlocked state, overwhelming the interface. The recommended subset for phase 1: `shader-preset`, `glass-tint`, `shadow-color`, `heading-color`, and the three most-used player chrome keys (`player-text`, `player-surface`, `player-overlay`). The remaining player chrome keys (`player-text-secondary`, `player-text-muted`, `player-surface-hover`, `player-surface-active`, `player-border`, `player-overlay-heavy`) can follow in phase 2 — their values are typically derived from the primary three anyway.

### Visual indicator: how does the user know a value is per-theme vs shared?

The `BrandEditorHeader.svelte:21` Light/Dark toggle already switches `state.editingTheme`. The proposed approach: when a control's key is in the "per-theme eligible" set, the control displays a small theme indicator (a sun/moon chip or a two-tone swatch dot) next to its label when the dark value differs from the light value. When both themes use the same value, no indicator is shown. There is no "Make this vary by theme" checkbox — the routing is always per-theme for eligible keys (write to dark bucket when editing dark, light bucket when editing light). The user discovers divergence naturally: they switch to dark mode, change the shader, and the light shader is untouched.

For keys in the "shared" set (scale multipliers, visibility flags), the control is always unaffected by the `editingTheme` toggle — it writes directly to `tokenOverrides` regardless. A subtle "shared" label or disabled-appearance toggle can optionally make this explicit.

### Does the existing Light/Dark toggle extend cleanly?

Yes, with one important constraint: `Codex-9u8wg` (editor preview writes to global `<html data-theme>`) must land first. Once the editor scopes its preview to `[data-editing-theme]` on the org layout element rather than the `<html>` root, the toggle already models the intent — switching editing context, not mutating user preference. The new behavior is purely additive: for eligible keys, the `updateTokenOverride(key, val)` call routes to a dark bucket instead of the light bucket when `editingTheme === 'dark'`. No new UI idiom is required.

### Preset semantics

A preset (defined in `apps/web/src/lib/brand-editor/presets.ts`, typed as `BrandPreset` in `types.ts:47-56`) applies to both themes simultaneously today: it overwrites all tokenOverrides and sets `darkOverrides`. The proposed behavior for per-theme presets:

- **"Apply to both" (default)**: Preset sets the base `shader-preset` in `tokenOverrides`. Dark mode inherits it unless a dark-specific shader was already set. This matches current behavior — minimal surprise.
- **"Apply to current theme only"**: An opt-in when browsing presets from within a specific theme context. If the user is in dark mode and clicks a preset card, a small secondary action "Apply to dark mode only" sets only the dark-keyed tokens.

The `BrandPreset` shape should gain an optional `darkTokenOverrides?: Record<string, string>` field, parallel to the existing `tokenOverrides`. A preset that ships with both means: "light mode gets `tokenOverrides`, dark mode gets `darkTokenOverrides`." Applying the preset populates both fields in one action.

### User Story 1: "I want my light mode to show a light flow shader, and my dark mode to show a dark ink shader."

1. User opens brand editor, `editingTheme` defaults to `'light'`.
2. User navigates to Hero Effects → selects `flow` preset. This writes `tokenOverrides['shader-preset'] = 'flow'`.
3. User clicks the Dark tab in the brand editor header. `editingTheme` switches to `'dark'`.
4. User navigates to Hero Effects → selects `ink` preset. Because `editingTheme === 'dark'`, this writes `darkTokenOverrides['shader-preset'] = 'ink'` (Option B) or `darkOverrides['shader-preset'] = 'ink'` (Option A).
5. The live preview (gated by `[data-editing-theme='dark']`) shows the ink shader. Switching back to Light tab shows the flow shader.
6. User saves. Both values are persisted. On page reload, the site shows `flow` in light mode and `ink` in dark mode.

### User Story 2: "I want my glass-tint to be white on light mode and black on dark mode."

1. User navigates to Fine-Tune Colors. `editingTheme === 'light'`.
2. User sets glass-tint color picker to `#ffffff`. Writes `tokenOverrides['glass-tint'] = '#ffffff'`.
3. User clicks Dark tab. `editingTheme === 'dark'`.
4. User sets glass-tint to `#000000`. Writes `darkTokenOverrides['glass-tint'] = '#000000'`.
5. A small theme indicator (sun/moon chip) appears next to the glass-tint label — signaling the two modes diverge.
6. Save. CSS gate serves `#ffffff` in light mode and `#000000` in dark mode.

### User Story 3: "I'm applying a preset and want it to set both themes' shaders at once."

1. User navigates to Presets. `editingTheme` is irrelevant.
2. User clicks preset "Midnight Atmospheric". The preset object carries `tokenOverrides: { 'shader-preset': 'ether' }` AND `darkTokenOverrides: { 'shader-preset': 'ink' }`.
3. `applyPreset` merges both: light `tokenOverrides` gets `'shader-preset': 'ether'`; dark `darkTokenOverrides` gets `'shader-preset': 'ink'`.
4. The preset card UI shows a split thumbnail — light preview on the left, dark preview on the right — making the dual nature visible.

---

## §5. CSS Consumption

The render path must work without JavaScript — it must emit all necessary data at SSR time and let pure CSS select the correct value. The JS-swap approach (swapping a single token on theme change) is explicitly rejected: it creates a flash-of-wrong-theme on OS-preference-triggered theme changes and couples the render to client-side initialization.

### Recommended pure-CSS approach (applicable to Options A and B)

Emit both the light and dark token values as separate CSS custom properties. Use a CSS fallback chain so missing dark values gracefully inherit from light.

```css
/* Emitted by org layout server-side injection: */
[data-org-brand] {
  --brand-shader-preset: ether;          /* light value */
  --brand-shader-preset-dark: ink;       /* dark value — absent if not set */
  --brand-glass-tint: #ffffff;
  --brand-glass-tint-dark: #000000;
}

/* CSS gate — light mode uses the base var */
[data-org-brand] {
  --shader-preset: var(--brand-shader-preset);
  --glass-tint: var(--brand-glass-tint);
}

/* CSS gate — dark mode falls back to light if no dark value set */
[data-theme='dark'] [data-org-brand],
[data-editing-theme='dark'] [data-org-brand] {
  --shader-preset: var(--brand-shader-preset-dark, var(--brand-shader-preset));
  --glass-tint: var(--brand-glass-tint-dark, var(--brand-glass-tint));
}
```

The fallback `var(--brand-shader-preset-dark, var(--brand-shader-preset))` means: use the dark value if present, otherwise inherit the light value. No JS required. The `[data-editing-theme='dark']` parallel rule is needed after `Codex-9u8wg` lands — the brand editor scopes its preview to the org layout element rather than `<html>`, so the standard `[data-theme='dark']` selector on `<html>` will not fire for editor preview.

### Option C CSS approach

Option C stores dark values as `--brand-shader-preset-dark` in the same `tokenOverrides` blob. The CSS gate is structurally identical to the above. The only difference is in how the SSR injector discovers which keys need dark variants: it must scan the `tokenOverrides` object for keys ending in `-dark` and emit them under the CSS gate block.

```css
/* Option C: injector scans for 'shader-preset-dark' in tokenOverrides */
[data-org-brand] {
  --brand-shader-preset: ether;
  --brand-shader-preset-dark: ink;
}
[data-theme='dark'] [data-org-brand] {
  --shader-preset: var(--brand-shader-preset-dark, var(--brand-shader-preset));
}
```

This is CSS-identical to Option A/B. The difference is purely in how the data reaches the template.

### CSS file placement

The gate rules belong in `apps/web/src/lib/theme/tokens/org-brand.css` alongside the existing `[data-org-brand]` block and `[data-theme='dark'] [data-org-brand]` block. The SSR emitter in `_org/[slug]/+layout.svelte` must emit both `--brand-{key}` and `--brand-{key}-dark` as inline style properties — the same `injectTokenOverrides(el, overrides)` function in `css-injection.ts` needs a corresponding `injectDarkTokenOverrides(el, darkOverrides)` call that writes the `-dark`-suffixed vars.

---

## §6. Recommendation

**Recommend Option B — Parallel darkTokenOverrides column.**

### Rationale

Option B is cleaner structurally, safer type-theoretically, and sets a better precedent for future expansion:

**Structural cleanliness**: The three storage slots have clear semantic boundaries: `dark_mode_overrides` holds color palette dark overrides (the four `ThemeColors` fields); `token_overrides` holds light fine-tune overrides; `dark_token_overrides` holds dark fine-tune overrides. A developer reading the schema instantly understands the three-way split. Option A's widened `Record<string, string>` shape loses the `ThemeColors` constraint, creating a schemaless blob that could silently accept misspelled color keys (`primarycolor: '#...'` would be stored without error).

**Type safety**: Option B preserves the narrow `Partial<ThemeColors>` type on `darkModeOverrides` (or `dark_mode_overrides`), protecting the OKLCH color derivation pipeline from receiving unexpected keys. The new `dark_token_overrides` column is typed `Record<string, string | null>` — consistent with `token_overrides`.

**Migration safety**: Adding a nullable column is the safest possible DB migration — it never touches existing data, and adding it via Drizzle's `pnpm db:generate` produces a reviewed SQL file before it runs. No data transformation is required. This is the "MUST use `db:generate`" path per user memory feedback.

**Future expansion**: If a future feature requires per-user-role tokens or per-breakpoint tokens, Option B's pattern (a new column per additional dimension) is easy to understand and repeat. Option A's "widen the blob" approach and Option C's "suffix the key" approach both produce blobs that are harder to introspect, migrate, or schema-validate independently.

**Option C is rejected** because the string-suffix convention is not enforced by the type system, the blob grows unboundedly, and the CSS emitter needs to understand key naming conventions rather than column structure. It trades database clarity for application complexity.

### On the naming question: rename `darkOverrides` → `darkColorOverrides`?

Yes. Now that a parallel `darkTokenOverrides` field is being added, the existing `darkOverrides` name in `BrandEditorState` (defined at `types.ts:36`) is ambiguous. Rename it to `darkColorOverrides` in TypeScript and ensure the DB column `dark_mode_overrides` maps to `darkColorOverrides` in `mapRow`. This is a purely cosmetic rename — no column change, no data migration. Update `brand-editor-store.svelte.ts` references accordingly (the `setThemeColor` function at line 248 and the open-restore at line 136).

---

## §7. Migration Path

### Step 1: DB Migration (Drizzle — never hand-write)

Add `darkTokenOverrides: text('dark_token_overrides')` to `brandingSettings` in `packages/database/src/schema/settings.ts`. Run `pnpm db:generate` — Drizzle produces a reviewed migration file under `packages/database/src/migrations/`. Review the generated SQL (`ALTER TABLE "branding_settings" ADD COLUMN "dark_token_overrides" text`). Run `pnpm db:migrate`.

### Step 2: Backend Service Update

In `packages/platform-settings/src/services/branding-settings-service.ts`:
- Add `darkTokenOverrides: schema.brandingSettings.darkTokenOverrides` to the `.select()` call (currently `get()` at line 68).
- Add `darkTokenOverrides: row.darkTokenOverrides` to `mapRow()` at line 130.
- Add `darkTokenOverrides: 'darkTokenOverrides'` to the `fieldMap` in `update()` at line 165.

In `packages/validation/src/` (`UpdateBrandingInput` Zod schema):
- Add `darkTokenOverrides: z.string().nullable().optional()` mirroring the existing `tokenOverrides` field.

In `packages/shared-types/src/` (`BrandingSettingsResponse`):
- Add `darkTokenOverrides: string | null`.

### Step 3: Worker Response Shape

The worker route at `workers/organization-api/src/routes/settings.ts:258` delegates entirely to `ctx.services.settings.updateBranding(body)` — the service change covers the write path. The public org info route at `workers/organization-api/src/routes/organizations.ts:362` passes through whatever `BrandingSettingsResponse` returns — adding the new field is automatically forwarded to the client.

### Step 4: SvelteKit Server Load + Layout Render

In `apps/web/src/routes/_org/[slug]/+layout.svelte`:
- Read `data.org?.brandFineTune?.darkTokenOverrides` (alongside `tokenOverrides`).
- In the SSR injection `$effect` block (lines 116-132), call a new `injectDarkTokenOverrides(el, darkOverrides)` that emits `--brand-{key}-dark` vars under a CSS gate.

The `injectDarkTokenOverrides` function belongs in `apps/web/src/lib/brand-editor/css-injection.ts`. Its shape: iterate `Record<string, string | null>`, for each key emit `el.style.setProperty('--brand-' + key + '-dark', value ?? '')`.

### Step 5: Editor State Updates

In `apps/web/src/lib/brand-editor/types.ts`:
- Add `darkTokenOverrides: Record<string, string | null> | null` to `BrandEditorState`.
- Rename `darkOverrides` → `darkColorOverrides` (cosmetic only).

In `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts`:
- Update `state.pending` initialization to include `darkTokenOverrides: null`.
- Add `setThemedTokenOverride(key: string, value: string | null)` function: when `state.editingTheme === 'dark'` and the key is in the per-theme eligible set, write to `state.pending.darkTokenOverrides`; otherwise write to `state.pending.tokenOverrides`.
- Update `applyPreset` to merge `preset.darkTokenOverrides` into `state.pending.darkTokenOverrides` (additive, not replace, per `Codex-oqv3r` semantics).
- Update `open()` session restore to also restore `darkTokenOverrides`.

In `apps/web/src/lib/brand-editor/css-injection.ts`:
- Update `injectBrandVars` to also call `injectDarkTokenOverrides(el, state.darkTokenOverrides)` when `state.editingTheme === 'dark'` is active for the live preview.

In `apps/web/src/lib/remote/branding.remote.ts`:
- Include `darkTokenOverrides` in the save payload (serialized to JSON string, same as `tokenOverrides`).

### Step 6: CSS Gate Additions

In `apps/web/src/lib/theme/tokens/org-brand.css`, add fallback rules for each per-theme eligible key:

```css
[data-theme='dark'] [data-org-brand],
[data-editing-theme='dark'] [data-org-brand] {
  --brand-shader-preset: var(--brand-shader-preset-dark, var(--brand-shader-preset));
  --brand-glass-tint: var(--brand-glass-tint-dark, var(--brand-glass-tint));
  --brand-shadow-color: var(--brand-shadow-color-dark, var(--brand-shadow-color));
  --color-heading: var(--brand-heading-color-dark, var(--brand-heading-color));
  /* player chrome cluster */
  --color-player-text: var(--brand-player-text-dark, var(--brand-player-text));
  --color-player-surface: var(--brand-player-surface-dark, var(--brand-player-surface));
  --color-player-overlay: var(--brand-player-overlay-dark, var(--brand-player-overlay));
}
```

### Step 7: Testing Strategy

**Unit tests** — `packages/platform-settings/src/__tests__/branding-settings.test.ts`:
- Test `update()` persists `darkTokenOverrides` as JSON string.
- Test `get()` returns `darkTokenOverrides: null` for rows that predate the migration.
- Test `mapRow()` parses `darkTokenOverrides` correctly.

**Integration tests** — `packages/platform-settings/src/services/__tests__/`:
- Round-trip test: save `{ darkTokenOverrides: '{"shader-preset":"ink"}' }`, read back, assert equality.
- Null-safe test: org with no `darkTokenOverrides` row returns `null` without throwing.

**Editor tests** — `apps/web/src/lib/brand-editor/__tests__/`:
- `setThemedTokenOverride('shader-preset', 'ink')` when `editingTheme === 'dark'` writes to `darkTokenOverrides`, not `tokenOverrides`.
- `setThemedTokenOverride('shader-preset', 'ink')` when `editingTheme === 'light'` writes to `tokenOverrides`.
- `setThemedTokenOverride('card-hover-scale', '1.05')` (shared key) always writes to `tokenOverrides` regardless of `editingTheme`.

**CSS gate verification** — visual regression snapshot (Playwright):
- Load org page in light mode → assert `--brand-shader-preset` resolves to light value.
- Load org page with `?theme=dark` → assert `--brand-shader-preset` resolves to dark value.
- Load org page with no dark override → assert dark mode inherits light value via CSS fallback.

**Rollout**: No feature flag needed — the column is additive and nullable. The editor UI for per-theme token selection can ship behind a `?darkTokens=1` URL param initially, removed once the full flow is verified in production.

---

## §8. Open Questions for the User

1. **Default inheritance direction**: If a user sets `shader-preset: 'flow'` in light mode but never visits dark mode settings, should dark mode automatically inherit `flow`, or should dark mode have a platform-defined default (e.g., `'none'`) that ignores the light-mode choice? The current design proposes CSS fallback inheritance (dark inherits light by default), but if the user prefers explicit configuration for dark mode, the fallback chain should not exist and dark mode would render the platform default shader until the user configures it.

2. **Preset dual-theme support**: When a preset is applied from the presets panel (not from within a theme context), should it always set both `tokenOverrides` and `darkTokenOverrides` simultaneously? Or should "Apply preset" only affect the currently-editing theme, requiring the user to switch to dark mode and apply a second preset? The former (dual-set) is less surprising; the latter gives more control.

3. **Curated set vs full exposure**: The proposal limits per-theme eligibility to 7 keys for phase 1. Are there additional keys the user specifically wants per-theme in phase 1? In particular: `shader-intensity` is not currently in the token registry as a standalone key — is this a new key the user has in mind, or would it be expressed through a different token?

4. **Player chrome per-theme priority**: The player chrome cluster (`player-text`, `player-surface`, `player-overlay` and 6 more) is entirely `darkModeAware: false` in the token registry today. Should all 9 player chrome keys be per-theme-eligible, or only the primary 3 listed in this proposal? The secondary 6 (`player-text-secondary`, `player-text-muted`, `player-surface-hover`, `player-surface-active`, `player-border`, `player-overlay-heavy`) are typically derived from the primary 3 — does the user configure them independently?

5. **Naming alignment for the rename**: The proposal renames `darkOverrides` → `darkColorOverrides` in `BrandEditorState`. The DB column `dark_mode_overrides` is NOT renamed (column rename is a higher-risk migration). Is the TypeScript rename sufficient, or should the column also be renamed to `dark_color_overrides` for long-term consistency? (Column rename requires a reviewed migration and a short window where old code would break — this should be a coordinated deploy.)

---

## §9. Skill Evaluation

**References 01–10 relevance**: Reference 10 (`references/10-brand-editor.md`) is the most directly relevant — it documents the brand editor pipeline, the `setThemeColor` routing pattern, and the existing `darkOverrides` shape that this feature extends. The partial-Record-update anti-pattern row added to reference 10 as part of `Codex-v4wao` directly informed the analysis of `applyPreset` behavior in §4 (presets should merge, not replace, when setting `darkTokenOverrides`). References 01–09 (system tokens, color derivation, component patterns, etc.) did not contribute materially to this schema design work.

**Gap identified**: This design work exposed a gap in the skill references — there is no reference covering multi-theme token architecture patterns (how to structure CSS custom properties for multiple themes, when to use CSS fallback chains vs JS-driven swapping, how to coordinate SSR emission with client preview for multi-theme tokens). A new `references/12-multi-theme-tokens.md` reference should be drafted once this feature lands — it would capture the `--brand-{key}` / `--brand-{key}-dark` emission pattern, the `[data-editing-theme='dark']` parallel CSS gate rule, and the "curated per-theme eligible set" principle. This is the kind of architectural decision that will recur if breakpoint-responsive tokens or high-contrast tokens are ever added. The `Codex-zv85e` bead (draft skill references after bugs land) should be updated to include this reference as a deliverable.
