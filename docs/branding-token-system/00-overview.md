# Branding Token System — Overview

## Purpose

Eliminate all hardcoded visual values from org-scoped CSS and make the entire org visual layer configurable through the brand editor's progressive disclosure model.

## Current State

- **Brand editor Level 1**: 7 high-level inputs (4 colors, radius, density, 2 fonts) + hero layout + shader + logo + intro video
- **Brand editor Level 2 fine-tune**: 10 overridable tokens (surfaces: 2, interactive: 3, focus: 2, text: 1, shadows: 2, typography: 3)
- **org-brand.css**: Derives 50+ tokens from the 7 Level 1 inputs via OKLCH relative color syntax
- **Hardcoded values**: 190+ across org-scoped components (hero, players, pricing, content detail, navigation)
- **Blind spots**: 6 semantic tokens in `light.css`/`dark.css` that never respond to org branding

## Target State

- **Zero hardcoded** color, opacity, or visual-design values in org-scoped CSS (documented exceptions only)
- **All derived tokens** overridable via fine-tune panel (Layer 4)
- **Player chrome**, hero section, pricing page, content detail — all fully brandable
- **New token categories**: player semantic tokens, glass tint, heading color, text-transform, card interaction, easing

## The 4-Layer CSS Cascade

```
Layer 1: :root (tokens/*.css)
         Raw palette, scale values, font stacks
         Files: colors.css, typography.css, spacing.css, radius.css, shadows.css,
                materials.css, motion.css, z-index.css, opacity.css, layout.css
         ↓ (semantic aliases)

Layer 2: :root / [data-theme] (themes/light.css, themes/dark.css)
         Semantic tokens: --color-text, --color-border, --color-surface-*, --color-interactive-*
         Maps palette → purpose. Light and dark themes provide different mappings.
         ↓ (org brand override)

Layer 3: [data-org-brand] / [data-org-bg] (theme/tokens/org-brand.css)
         OKLCH derivation from 7 brand inputs (--brand-color, --brand-secondary,
         --brand-accent, --brand-bg, --brand-radius, --brand-density, fonts)
         Overrides Layer 2 semantic tokens within .org-layout scope.
         ↓ (per-token override)

Layer 4: tokenOverrides (inline style on .org-layout element)
         Direct CSS custom property injection. Highest specificity.
         Written by the brand editor fine-tune panel.
         Stored as JSON in branding_settings.tokenOverrides column.
         Keys in BRAND_PREFIX_KEYS → --brand-{key}
         All other keys → --color-{key}
```

**Key architectural insight**: Layer 4 can override ANY CSS custom property. The fine-tune panel writes to Layer 4. So adding new overridable tokens is purely a UI + CSS change — no database migration needed.

## How Token Overrides Flow

```
User picks color in fine-tune panel
  → brandEditor.updateField('tokenOverrides', { ...current, 'text': '#1a1a2e' })
    → $effect in store triggers injectBrandVars(pending)
      → css-injection.ts: el.style.setProperty('--color-text', '#1a1a2e')
        → org-brand.css auto-derived value is overridden (inline style wins)
          → All components reading var(--color-text) update immediately
```

On save:
```
handleSave() serializes tokenOverrides as JSON string
  → API: PUT /organizations/:id/settings/branding { tokenOverrides: '{"text":"#1a1a2e"}' }
    → DB: branding_settings.tokenOverrides = '{"text":"#1a1a2e"}'
      → KV cache invalidated
        → Next page load: +layout.svelte reads tokenOverrides, calls injectTokenOverrides()
```

## Work Packet Index

| # | Work Packet | Scope | Files Touched |
|---|---|---|---|
| 01 | Foundation: Blind Spots & New Tokens | Fix 6 blind-spot tokens, add heading color, new token files, new easing/tracking/transform tokens | org-brand.css, colors.css, typography.css, motion.css, NEW player.css, global.css |
| 02 | Hero Section Tokenization | Replace 21 hardcoded hero values, implement blend mode control | +page.svelte (org landing), css-injection.ts |
| 03 | Player Chrome Tokenization | Define player semantic tokens, update 4 player components (~70 values) | player.css, VideoPlayer/styles.css, AudioPlayer.svelte, ImmersiveShaderPlayer.svelte, PreviewPlayer.svelte |
| 04 | Overlay Components Cleanup | HeroInlineVideo, IntroVideoModal, ContentDetailView, CreatorProfileDrawer | 4 component files |
| 05 | Content Card & Explore Cleanup | ContentCard scales/easing/text-transform, explore page | ContentCard.svelte, explore/+page.svelte |
| 06 | Pricing Page Cleanup | Biggest single file — 35 hardcoded values | pricing/+page.svelte |
| 07 | Navigation Components Cleanup | Sidebar, MobileNav, CommandPalette, MobileBottomSheet | 5 component files |
| 08 | Brand Editor Panel Expansion | Expand fine-tune panel from 7→35 tokens, add accordion UI, blend mode control, non-color inputs | BrandEditorFineTuneColors.svelte, css-injection.ts |
| 09 | CSS Injection Pipeline | Add ~20 keys to BRAND_PREFIX_KEYS, verify injection correctness | css-injection.ts |

## Dependency Order

```
WP-01 (Foundation) ← must complete first — all other WPs depend on tokens existing
  ├── WP-09 (CSS Injection) ← keys must be in BRAND_PREFIX_KEYS before editor can use them
  ├── WP-02 (Hero) ← depends on hero token keys existing
  ├── WP-03 (Player) ← depends on player.css tokens existing
  ├── WP-04 (Overlays) ← depends on player tokens for overlay components
  ├── WP-05 (Content Card) ← depends on new easing/transform tokens
  ├── WP-06 (Pricing) ← depends on glass-tint, easing tokens
  └── WP-07 (Nav) ← depends on easing tokens
WP-08 (Panel) ← must come last — needs all tokens defined and CSS wired before building UI
```

WP-02 through WP-07 can execute in parallel once WP-01 and WP-09 are done.

## Documented Exceptions (Values That Stay Hardcoded)

| Value | Location | Reason |
|---|---|---|
| `black` in `mask-image` gradients | explore/+page.svelte | CSS masks use black/white for alpha channels — this is spec behavior, not color |
| `scale(0.92)` / `scale(0.88)` | MobileBottomNav tap feedback | Interaction physics constant, not brand expression |
| `from` / `to` / percentage keyframe stops | Various `@keyframes` | Animation choreography structure, not visual design |
| `9999px` fallback in `--radius-full` | LibraryFilters | Defensive CSS fallback only |
| `border-radius: 9999px` on `--radius-full` | radius.css token definition | This IS the token definition |

## Key Files Reference

| File | Purpose |
|---|---|
| `apps/web/src/lib/styles/tokens/*.css` (12 files) | Layer 1 token definitions |
| `apps/web/src/lib/styles/themes/light.css` | Layer 2 light theme semantic aliases |
| `apps/web/src/lib/styles/themes/dark.css` | Layer 2 dark theme semantic aliases |
| `apps/web/src/lib/theme/tokens/org-brand.css` | Layer 3 OKLCH derivation engine |
| `apps/web/src/lib/brand-editor/css-injection.ts` | Layer 4 injection logic + BRAND_PREFIX_KEYS |
| `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts` | Editor state management (Svelte 5 runes) |
| `apps/web/src/lib/brand-editor/types.ts` | TypeScript types (BrandEditorState, LevelId) |
| `apps/web/src/lib/components/brand-editor/levels/BrandEditorFineTuneColors.svelte` | Fine-tune panel UI |
| `apps/web/src/routes/_org/[slug]/+layout.svelte` | Org layout — branding injection, save handler |
| `apps/web/src/lib/styles/global.css` | Import chain for all CSS |
