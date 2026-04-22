# Preset Expansion — Overview

## Goal

Expand brand presets from 10 (controlling 9 fields) to 25 (controlling 9 fields + tokenOverrides + heroLayout + darkOverrides + shader). Each preset becomes a complete, opinionated design system — not just a colour palette.

## Current State

- 10 presets across 4 categories (Professional, Creative, Bold, Minimal)
- Each preset sets: primaryColor, secondaryColor, accentColor, backgroundColor, fontBody, fontHeading, radius, density, darkOverrides
- Presets do NOT touch tokenOverrides, heroLayout, or shader settings
- Applying a preset feels incomplete — hero, player, cards, glass, and shader all stay at defaults

## Target State

- 25 presets across 9 categories
- Each preset optionally bundles: tokenOverrides (hero, player, glass, cards, text-transform, heading-color), shader-preset, heroLayout, darkOverrides
- Applying a preset transforms the entire org in one click

## Categories

| Category | Existing | New | Total |
|---|---|---|---|
| Professional | 3 (Corporate, Executive, Consulting) | 0 | 3 |
| Creative | 3 (Vibrant, Sunset, Ocean) | 0 | 3 |
| Bold | 3 (Dark, Neon, Ember) | 0 | 3 |
| Minimal | 3 (Minimal, Paper, Mono) | 0 | 3 |
| Organic | 0 | 3 (Forest, Desert, Bloom) | 3 |
| Tech | 0 | 3 (Terminal, Blueprint, Gradient) | 3 |
| Luxury | 0 | 3 (Onyx, Marble, Velvet) | 3 |
| Playful | 0 | 3 (Bubblegum, Retro, Arcade) | 3 |
| Atmospheric | 0 | 3 (Midnight, Storm, Zen) | 3 |

## Dependency Order

```
WP-01 (Architecture) ← must complete first
  ├── WP-02 (Enrich existing 10) ── can run after WP-01
  ├── WP-03 (Organic + Tech)     ── can run after WP-01
  ├── WP-04 (Luxury + Playful)   ── can run after WP-01
  └── WP-05 (Atmospheric + UI)   ── can run after WP-01
WP-06 (Verification) ← needs all above done
```

WP-02 through WP-05 all modify `presets.ts` but in different sections (existing entries vs new category blocks). They can be serialised or done by one agent sequentially.

## Work Packets

| WP | Title | Scope | Depends On |
|---|---|---|---|
| 01 | Architecture | types.ts, store, UI category tabs | — |
| 02 | Enrich existing presets | 10 existing presets get tokenOverrides + shader + heroLayout | WP-01 |
| 03 | Organic + Tech presets | 6 new presets (2 new categories) | WP-01 |
| 04 | Luxury + Playful presets | 6 new presets (2 new categories) | WP-01 |
| 05 | Atmospheric + UI polish | 3 new presets + shader badge on cards | WP-01 |
| 06 | Verification | Visual testing of all 25 presets | All |

## Key Files

| File | Purpose |
|---|---|
| `apps/web/src/lib/brand-editor/types.ts` | BrandPreset type extension |
| `apps/web/src/lib/brand-editor/brand-editor-store.svelte.ts` | applyPreset() update |
| `apps/web/src/lib/brand-editor/presets.ts` | All 25 preset definitions |
| `apps/web/src/lib/components/brand-editor/levels/BrandEditorPresets.svelte` | Preset browser UI |
| `apps/web/src/lib/brand-editor/index.ts` | Barrel export for new categories |
