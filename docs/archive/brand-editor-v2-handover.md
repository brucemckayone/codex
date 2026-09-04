# Brand Editor v2 — Implementation Handover

**Date**: 2026-04-03
**Context**: Brand editor v1 built in single session (58 tasks). User testing revealed broken controls, missing features, and UX improvements needed. This document is the complete handover for the v2 implementation session.

**Read first**: `docs/brand-editor-design-spec.md` (original UX spec)

---

## 1. What Exists (Architecture Summary)

The brand editor is a floating glass panel activated via `?brandEditor=true` URL param on org subdomain pages. It lets admins customize branding with live preview.

### Core Architecture (Working)
- **Store**: `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts` — Svelte 5 `$state` with `$effect.root()` for lazy init. Actions: open/close/minimize/expand/navigateTo/updateField/applyPreset/discard/markSaved
- **CSS Injection**: `apps/web/src/lib/brand-editor/css-injection.ts` — `injectBrandVars()` sets `--brand-*` CSS vars on `.org-layout` element. The CSS engine (`org-brand.css`) derives ~50 tokens from 8 input variables via OKLCH relative colors
- **OKLCH Math**: `apps/web/src/lib/brand-editor/oklch-math.ts` — Pure TS conversion (OKLCH↔sRGB↔hex), gamut detection, binary-search gamut clamping. Verified: all test colors round-trip perfectly
- **Panel Shell**: `apps/web/src/lib/components/brand-editor/BrandEditorPanel.svelte` — Glass material, fixed position, 3 states (open/minimized/closed), mobile bottom sheet
- **Org Layout Wiring**: `apps/web/src/routes/_org/[slug]/+layout.svelte` — Renders panel outside `.org-layout`, handles URL param, beforeunload/beforeNavigate guards, save handler, level routing

### Token System (Completed in v1)
All 245 Svelte files migrated to semantic tokens. Zero `--color-primary-N` references remain. The semantic tokens (`--color-interactive`, `--color-focus`, `--color-text-on-brand`, etc.) auto-switch between light/dark via `light.css`/`dark.css` and are overridden by org branding via `org-brand.css`.

### CSS Variable Chain
```
org-brand.css [data-org-brand] sets:
  --brand-color → --color-brand-primary, --color-interactive, --color-focus, --color-text-on-brand
  --brand-secondary → --color-brand-secondary
  --brand-accent → --color-brand-accent
  --brand-bg → --color-background, --color-surface, --color-text (auto-contrast)
  --brand-radius → --radius-* scale
  --brand-density → --space-* scale
  --brand-font-body → --font-body (BUT NOT --font-sans — this is a bug, see §3.4)
  --brand-font-heading → --font-heading
```

### DB Schema (Current)
Table `branding_settings` has: `primary_color_hex`, `secondary_color_hex`, `accent_color_hex`, `background_color_hex`, `font_body`, `font_heading`, `radius_value`, `density_value`, `logo_url`, `logo_r2_path`, `token_overrides` (text/JSON), `text_color_hex`, `shadow_scale`, `shadow_color`, `text_scale`, `heading_weight`, `body_weight`.

---

## 2. What's Broken (P0)

### 2.1 Logo Upload Button — No-Op
**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorLogo.svelte`
**Problem**: `<Button>Upload Logo</Button>` has no onclick, no file input, no form wiring. The `uploadLogoForm` remote function exists in `branding.remote.ts` but is never called.
**Fix**: Follow the avatar upload pattern from `(platform)/account/+page.svelte` — hidden `<input type="file">` + `<form {...uploadLogoForm}>` + programmatic submit on file select.

### 2.2 Save Flow Incomplete
**Files**: `branding.remote.ts` (updateBrandingCommandSchema), `_org/[slug]/+layout.svelte` (handleSave)
**Problem**: Save handler sends 8 fields but NOT `tokenOverrides`, `textColorHex`, `shadowScale`, `shadowColor`, `textScale`, `headingWeight`, `bodyWeight`. The command schema also doesn't accept them. Backend schema and service layer DO support them (added in v1).
**Fix**: Expand command schema + save handler payload to include all fine-tune fields. Serialize `tokenOverrides` Record as JSON string.

### 2.3 Fine-Tune Colors — No Edit Affordance
**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorFineTuneColors.svelte`
**Problem**: Shows "Auto" `<span>` with no way to switch to custom mode. Users see labels but can't interact.
**Fix**: Make "Auto" a clickable button. On click: read computed color from DOM via `getComputedStyle(orgLayoutEl).getPropertyValue('--color-{key}')`, convert to hex, set as initial override. Now the ColorInput appears. Clicking "Auto" again clears the override.

---

## 3. What Doesn't Work (P1)

### 3.1 Secondary/Accent/Background — Hex Only
**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorColors.svelte`
**Problem**: Only primary gets the full OKLCH picker. Secondary/accent/background only get `ColorInput` (hex text field).
**Fix**: Replace with collapsible `OklchColorPicker` instances. Only one expanded at a time (accordion pattern) to fit the 360px panel.

### 3.2 Fine-Tune Typography Sliders — No Effect
**Root cause**: `injectBrandVars()` in `css-injection.ts` only handles 8 base `--brand-*` variables. Token overrides written to `state.tokenOverrides` never become CSS variables.
**Fix**: Extend `injectBrandVars()` to iterate `state.tokenOverrides` and set CSS vars. Color keys → `--color-{key}`. Typography keys → `--brand-{key}`. Also add rules in `org-brand.css` that consume the new typography override vars.

### 3.3 Shadows — Placeholder Only
**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorShadows.svelte`
**Status**: Intentional placeholder showing preview cards. Needs real controls: shadow intensity slider (scales `--shadow-strength`), shadow tint picker (changes `--shadow-color`).

### 3.4 Body Font Doesn't Apply — CSS Scoping Bug
**Root cause (confirmed)**: `global.css` line 32: `html { font-family: var(--font-sans) }`. The `--font-sans` token is defined at `:root` in `typography.css` and references `var(--brand-font-body, 'Inter')`. But `--brand-font-body` is only set on `.org-layout[data-org-brand]` (a descendant), so `:root`-level `--font-sans` resolves to the fallback `'Inter'`.

Components using `var(--font-sans)` inside `.org-layout` never get the brand font.

**Fix**: In `org-brand.css`, re-declare `--font-sans` inside `[data-org-brand]`:
```css
[data-org-brand] {
  --font-sans: var(--brand-font-body, 'Inter'), 'Inter-fallback', system-ui, -apple-system, sans-serif;
}
```
This ensures all descendants using `--font-sans` pick up the brand font within org scope.

### 3.5 OKLCH Canvas Gamut Boundary
**File**: `apps/web/src/lib/components/brand-editor/color-picker/OklchColorArea.svelte`
**Problem**: Out-of-gamut pixels show checkerboard but no visible boundary line. Users see a confusing "triangle" of selectable colors.
**Fix**: After rendering canvas, stroke a boundary curve using `maxChromaForLH()` (already in `oklch-math.ts`). Semi-transparent line shows where sRGB gamut ends.

---

## 4. New Features (P2)

### 4.1 Palette Generator
**Decision**: Auto-apply immediately when strategy selected (like presets).
**Algorithm**: OKLCH hue rotation. Given primary color hex:
- **Complementary**: secondary = hue + 180°
- **Analogous**: secondary = hue + 30°, accent = hue - 30°
- **Split-complementary**: secondary = hue + 150°, accent = hue + 210°
- **Triadic**: secondary = hue + 120°, accent = hue + 240°

Maintain same lightness, reduce chroma to 80% for secondary. Clamp to gamut. Use existing `hexToOklch`, `oklchToHex`, `clampToGamut` from `oklch-math.ts`.

**New file**: `apps/web/src/lib/brand-editor/palette-generator.ts`
**UI**: Dropdown in BrandEditorColors.svelte above the color sections. "Generate Palette" → strategy list → auto-applies.

### 4.2 Per-Theme Branding (Light + Dark)
**Decision**: Full dual branding. User can customize colors independently for light and dark themes.

**DB approach**: JSON overrides column. Keep existing columns as light/default values. Add one `dark_mode_overrides` text column (JSON: `{ primaryColorHex?, secondaryColorHex?, accentColorHex?, backgroundColorHex? }`). If a dark value is null/missing, auto-derive from light via OKLCH (the existing dark mode rules in org-brand.css).

**Store changes**: Add `darkOverrides: Partial<ThemeColors> | null` to `BrandEditorState`. The existing `primaryColor`/`secondaryColor`/etc. remain as light values.

**UI changes**: The theme toggle in the header now switches which color set is being edited. A badge shows "Editing: Light" or "Editing: Dark". Color pickers update to show the relevant theme's values.

**CSS injection**: When injecting, check current `data-theme`. If dark and dark overrides exist, inject those. Otherwise inject light values (the OKLCH auto-derivation handles the rest).

**Palette generation**: When user generates palette, ask "Apply to both themes?" or auto-apply to both, then user can fine-tune each independently.

### 4.3 Home Screen Reorganization
Restructure into sections:
- **Quick Start**: Primary color swatch + "Generate Palette" button (most common workflow)
- **Customize**: Colors, Typography, Shape (the main editing categories)
- **Advanced**: Shadows, Logo
- Presets gets own dedicated level (link from home)

### 4.4 Expanded Presets
Move from 4 inline pills to 8-12 presets on a dedicated level. Categories: Professional, Creative, Bold, Minimal. Larger preview cards with color swatches + font name + shape indicator.

### 4.5 Shape Slider Ranges
Expand: density 0.75-1.25 (was 0.85-1.15), radius 0-2rem (was 0-1). Fix preview component alignment.

---

## 5. File Reference

### Brand Editor Core
| File | Purpose |
|------|---------|
| `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts` | Reactive store (Svelte 5 runes) |
| `apps/web/src/lib/brand-editor/css-injection.ts` | CSS variable injection to DOM |
| `apps/web/src/lib/brand-editor/oklch-math.ts` | Color space conversion |
| `apps/web/src/lib/brand-editor/types.ts` | TypeScript interfaces |
| `apps/web/src/lib/brand-editor/presets.ts` | Built-in presets |
| `apps/web/src/lib/brand-editor/levels.ts` | Navigation hierarchy |
| `apps/web/src/lib/brand-editor/index.ts` | Barrel export |

### Components
| File | Purpose |
|------|---------|
| `apps/web/src/lib/components/brand-editor/BrandEditorPanel.svelte` | Panel shell |
| `apps/web/src/lib/components/brand-editor/BrandEditorHeader.svelte` | Breadcrumb + controls |
| `apps/web/src/lib/components/brand-editor/BrandEditorFooter.svelte` | Save/reset + dirty indicator |
| `apps/web/src/lib/components/brand-editor/color-picker/OklchColorArea.svelte` | Canvas color area |
| `apps/web/src/lib/components/brand-editor/color-picker/HueSlider.svelte` | Hue range input |
| `apps/web/src/lib/components/brand-editor/color-picker/ColorInput.svelte` | Hex input + swatch |
| `apps/web/src/lib/components/brand-editor/color-picker/SwatchRow.svelte` | Preset color circles |
| `apps/web/src/lib/components/brand-editor/color-picker/OklchColorPicker.svelte` | Assembled picker |
| `apps/web/src/lib/components/brand-editor/levels/BrandEditorHome.svelte` | Level 0 |
| `apps/web/src/lib/components/brand-editor/levels/BrandEditorColors.svelte` | Level 1 |
| `apps/web/src/lib/components/brand-editor/levels/BrandEditorTypography.svelte` | Level 1 |
| `apps/web/src/lib/components/brand-editor/levels/BrandEditorShape.svelte` | Level 1 |
| `apps/web/src/lib/components/brand-editor/levels/BrandEditorShadows.svelte` | Level 1 (placeholder) |
| `apps/web/src/lib/components/brand-editor/levels/BrandEditorLogo.svelte` | Level 1 |
| `apps/web/src/lib/components/brand-editor/levels/BrandEditorFineTuneColors.svelte` | Level 2 |
| `apps/web/src/lib/components/brand-editor/levels/BrandEditorFineTuneTypography.svelte` | Level 2 |

### Infrastructure
| File | Purpose |
|------|---------|
| `apps/web/src/routes/_org/[slug]/+layout.svelte` | Org layout wiring (opens editor, save handler, level routing) |
| `apps/web/src/lib/remote/branding.remote.ts` | API commands (updateBrandingCommand, uploadLogoForm, deleteLogo) |
| `apps/web/src/lib/theme/tokens/org-brand.css` | CSS derivation engine (OKLCH relative colors) |
| `apps/web/src/lib/styles/tokens/typography.css` | Font tokens (--font-sans, --font-heading) |
| `apps/web/src/lib/styles/global.css` | Base styles (html font-family) |
| `packages/database/src/schema/settings.ts` | DB schema (branding_settings table) |
| `packages/validation/src/schemas/settings.ts` | Zod schemas + defaults |
| `packages/shared-types/src/api-responses.ts` | BrandingSettingsResponse type |
| `packages/platform-settings/src/services/branding-settings-service.ts` | Service layer |

---

## 6. Testing Approach

After each change group:
1. Kill and restart dev servers (`pnpm dev` from monorepo root)
2. Navigate to platform pages (`lvh.me:3000/`, `/discover`, `/login`) — verify no regressions
3. Navigate to org subdomain (`studio-alpha.lvh.me:3000/`) — verify branding loads
4. Open brand editor (`?brandEditor=true`) — verify panel opens
5. Test each control: change value → verify site updates live behind panel
6. Test save: click Save → reload → verify persistence
7. Test discard: make changes → click Reset → verify revert
8. Check console for errors (`mcp__chrome-devtools__list_console_messages` types: ["error"])
9. Take screenshots for before/after comparison
10. Test both themes: use theme toggle in header, verify colors adapt
