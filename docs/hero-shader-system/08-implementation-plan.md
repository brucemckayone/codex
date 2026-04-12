# 08 — Implementation Plan: Work Packets & Dependencies

**Purpose**: Break the project into parallelizable work packets with clear dependencies, estimated file counts, and acceptance criteria.

---

## Dependency Graph

```
Phase 0: Foundation
  WP-00 Config Keys & Type Changes (3 files)
    │
    ├── Phase 1: Content Enrichment (independent of shaders)
    │   WP-01 Creator Avatar Strip (2 files)
    │   WP-02 Stats Bar (2 files)
    │   WP-03 Social Links (3-5 files)
    │   WP-04 Smart CTAs (2 files)
    │
    ├── Phase 2: Shader Core
    │   WP-05 Common GLSL Library (1 file)
    │   WP-06 Shader Renderer Module (3 files)
    │   WP-07 ShaderHero Component (2 files)
    │     │
    │     └── Phase 3: Shader Presets (parallelizable after WP-07)
    │         WP-08a gradient-mesh.frag
    │         WP-08b noise-flow.frag
    │         WP-08c aurora.frag
    │         WP-08d voronoi.frag
    │         WP-08e metaballs.frag
    │         WP-08f waves.frag
    │         WP-08g particles.frag
    │         WP-08h geometric.frag
    │
    └── Phase 4: Brand Editor
        WP-09 Hero Effects Level (2 files) ─── depends on WP-07 + WP-08*
        WP-10 CSS Fallback (1 file) ─── depends on WP-07

Phase 5: Polish & Verification
  WP-11 Mobile Testing & Adaptive Quality
  WP-12 Cross-Browser Verification
  WP-13 Brand Preset × Shader Preset Matrix Testing
```

## Parallelization Strategy

After WP-00:
- **Stream A**: WP-01 → WP-02 → WP-03 → WP-04 (Content Enrichment)
- **Stream B**: WP-05 → WP-06 → WP-07 → WP-08a..h (Shader Core)
- **Stream C**: WP-09, WP-10 (Brand Editor — starts after WP-07 completes)

Streams A and B are fully independent. Stream C depends on B.

---

## Work Packets

### WP-00: Foundation (Config Keys & Types)

**Files modified**: 3
**Depends on**: Nothing

| File | Change |
|------|--------|
| `apps/web/src/lib/brand-editor/types.ts` | Add `'hero-effects'` to `LevelId` union |
| `apps/web/src/lib/brand-editor/levels.ts` | Add `'hero-effects'` level metadata |
| `apps/web/src/lib/brand-editor/css-injection.ts` | Add 6 shader keys to `BRAND_PREFIX_KEYS` |

**Acceptance criteria**:
- [ ] `LevelId` type includes `'hero-effects'`
- [ ] `LEVELS['hero-effects']` exists with correct depth/parent
- [ ] Shader keys in `BRAND_PREFIX_KEYS` produce `--brand-shader-*` CSS properties
- [ ] TypeScript compiles with no errors

---

### WP-01: Creator Avatar Strip

**Files modified**: 1-2
**Depends on**: Nothing (uses existing streamed data)

| File | Change |
|------|--------|
| `apps/web/src/routes/_org/[slug]/(space)/+page.svelte` | Add avatar strip inside hero, import Avatar components |

**Acceptance criteria**:
- [ ] Up to 5 creator avatars shown in overlapping strip
- [ ] "+N" badge when more than 5 creators exist
- [ ] Skeleton loading state while creator data streams
- [ ] All CSS uses design tokens
- [ ] Handles 0 creators gracefully (strip hidden)

---

### WP-02: Stats Bar

**Files modified**: 2
**Depends on**: WP-01 (for layout context)

| File | Change |
|------|--------|
| `apps/web/src/routes/_org/[slug]/(space)/+page.svelte` | Add stats line below avatar strip |
| `apps/web/src/routes/_org/[slug]/(space)/+page.server.ts` | Return pagination total from content API |

**Acceptance criteria**:
- [ ] Shows "N Creators · M Titles" with accurate counts
- [ ] Handles singular/plural correctly
- [ ] Loads inline with creator data (same await block)
- [ ] Gracefully handles 0 counts

---

### WP-03: Social Links

**Files modified**: 3-5
**Depends on**: API change (extend public info or separate fetch)

| File | Change |
|------|--------|
| `workers/organization-api/src/routes/organizations.ts` | Add social URLs to public info response |
| `packages/shared-types/src/api-responses.ts` | Update `PublicOrgInfoResponse` type |
| `apps/web/src/lib/types.ts` | Add `socialLinks` to `OrganizationData` |
| `apps/web/src/routes/_org/[slug]/+layout.server.ts` | Map social links from API response |
| `apps/web/src/routes/_org/[slug]/(space)/+page.svelte` | Render social link icons |

**Acceptance criteria**:
- [ ] Social icons appear for each non-null URL
- [ ] Links open in new tab with `rel="noopener"`
- [ ] Proper aria-labels on each link
- [ ] Handles no social URLs gracefully (section hidden)
- [ ] Icons use design tokens for sizing and color
- [ ] Public info endpoint response includes socialLinks
- [ ] VersionedCache correctly invalidated when contact settings change

---

### WP-04: Smart CTAs

**Files modified**: 2
**Depends on**: API change (feature flags in public info)

| File | Change |
|------|--------|
| `apps/web/src/routes/_org/[slug]/(space)/+page.svelte` | Conditional CTA text based on feature flags |
| `apps/web/src/paraglide/messages/en.js` | Add `org_hero_subscribe` message |

**Acceptance criteria**:
- [ ] Primary CTA says "Subscribe" when `enableSubscriptions` is true
- [ ] Falls back to "Explore" when false or missing
- [ ] i18n key added and used

---

### WP-05: Common GLSL Library

**Files created**: 1
**Depends on**: Nothing

| File | Contents |
|------|----------|
| `apps/web/src/lib/components/ui/ShaderHero/shaders/common.glsl` | Simplex noise (2D, 3D), FBM, hash functions, smoothmin, hexToRgb, color space conversions |

**Acceptance criteria**:
- [ ] All functions documented with comments
- [ ] `precision mediump float` declaration
- [ ] Compatible with GLSL ES 1.0 (WebGL 1)
- [ ] Functions tested with known input/output pairs (manual verification via test shader)

---

### WP-06: Shader Renderer Module

**Files created**: 3
**Depends on**: WP-05 (common.glsl)

| File | Contents |
|------|----------|
| `apps/web/src/lib/components/ui/ShaderHero/shader-renderer.ts` | WebGL context, compile, render loop, event handling |
| `apps/web/src/lib/components/ui/ShaderHero/shader-config.ts` | Config parsing from tokenOverrides |
| `apps/web/src/lib/components/ui/ShaderHero/shader-utils.ts` | Feature detection, DPR, hex conversion |

**Acceptance criteria**:
- [ ] `createShaderRenderer()` returns a working renderer
- [ ] `start()`, `stop()`, `destroy()` work correctly
- [ ] `updateConfig()` hot-swaps shader presets without flicker
- [ ] `updateColors()` updates uniforms without recompile
- [ ] Mouse tracking with lerp smoothing
- [ ] Scroll progress tracking with passive listener
- [ ] IntersectionObserver pauses when off-screen
- [ ] visibilitychange pauses on tab hide
- [ ] prefers-reduced-motion shows static frame
- [ ] webglcontextlost/restored handled
- [ ] DPR capped on mobile
- [ ] Idle slowdown after 15s
- [ ] Adaptive quality monitoring
- [ ] All GL resources cleaned up in `destroy()`

---

### WP-07: ShaderHero Component

**Files created**: 2
**Depends on**: WP-06

| File | Contents |
|------|----------|
| `apps/web/src/lib/components/ui/ShaderHero/ShaderHero.svelte` | Svelte component wrapping canvas + content |
| `apps/web/src/lib/components/ui/ShaderHero/index.ts` | Barrel export |

**Also modifies**:
| File | Change |
|------|--------|
| `apps/web/src/routes/_org/[slug]/(space)/+page.svelte` | Replace `<section class="hero">` with `<ShaderHero>` |

**Acceptance criteria**:
- [ ] Component renders with `preset: 'none'` (static gradient, matching current CSS)
- [ ] Canvas is SSR-safe (wrapped in `{#if mounted}`)
- [ ] Content overlay (logo, title, CTAs) remains clickable above canvas
- [ ] `$effect` watches brand editor changes and updates renderer live
- [ ] Falls back to CSS animation when WebGL unavailable
- [ ] Falls back to static gradient when CSS @property unavailable
- [ ] Children snippet renders correctly
- [ ] All CSS uses design tokens

---

### WP-08a-h: Individual Shader Presets

**Files created**: 1 each (8 total)
**Depends on**: WP-05 (common.glsl), WP-06 (renderer for testing)

Each preset is a `.frag` file + a registration entry in `shader-presets.ts`.

| WP | Preset | GPU Cost | Priority |
|----|--------|----------|----------|
| 08a | `gradient-mesh` | Very Low | P0 (ship with MVP) |
| 08b | `aurora` | Very Low | P0 (ship with MVP) |
| 08c | `noise-flow` | Low | P1 |
| 08d | `metaballs` | Low | P1 |
| 08e | `waves` | Low | P1 |
| 08f | `particles` | Low | P2 |
| 08g | `voronoi` | Medium | P2 |
| 08h | `geometric` | Medium | P2 |

**P0**: Ship with initial release (2 presets). Enough to validate the system.
**P1**: Second wave (3 presets). Fill out the popular categories.
**P2**: Third wave (3 presets). Complete the catalog.

**Acceptance criteria (per preset)**:
- [ ] Renders correctly with all 12 brand presets
- [ ] Mouse interaction implemented per the interaction matrix
- [ ] Scroll fade works correctly
- [ ] Runs at 60fps on desktop, 30fps+ on mid-range mobile
- [ ] Respects `u_intensity` (0 = invisible, 1 = full effect)
- [ ] Respects `u_complexity` (scales number of octaves/iterations)
- [ ] Looks good at both light and dark extremes of brand palettes
- [ ] No visual artifacts at canvas edges

---

### WP-09: Brand Editor Hero Effects Level

**Files created**: 1
**Files modified**: 2
**Depends on**: WP-07, at least WP-08a

| File | Change |
|------|--------|
| `apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte` | New component |
| `apps/web/src/lib/components/brand-editor/levels/BrandEditorHome.svelte` | Add 'hero-effects' to ADVANCED_CATEGORIES |
| `apps/web/src/routes/_org/[slug]/+layout.svelte` | Add `{:else if brandEditor.level === 'hero-effects'}` |

**Acceptance criteria**:
- [ ] Preset grid shows all registered presets with thumbnails
- [ ] "None" option to remove shader
- [ ] Speed, intensity, complexity sliders work and update live
- [ ] Mouse toggle works and updates live
- [ ] Scroll fade toggle works and updates live
- [ ] All values persist correctly via tokenOverrides on save
- [ ] Navigating to level and back preserves selections
- [ ] Keyboard accessible (arrow keys, enter, escape)

---

### WP-10: CSS Fallback

**Files modified**: 1
**Depends on**: WP-07

| File | Change |
|------|--------|
| `apps/web/src/lib/theme/tokens/org-brand.css` | Add `@property` declarations and fallback animation keyframes |

**Acceptance criteria**:
- [ ] CSS animation activates when `.hero--css` class is present
- [ ] Uses brand colors (same as shader would)
- [ ] Smooth 60fps animation via compositor
- [ ] Respects `prefers-reduced-motion`
- [ ] Degrades to static gradient on browsers without `@property`
- [ ] No visual regression on browsers with WebGL (CSS fallback not applied)

---

### WP-11: Mobile Testing

**Depends on**: WP-07, WP-08*

| Test | Method |
|------|--------|
| iPhone 15 Pro (A17, DPR 3) | Real device or Playwright emulation |
| iPhone SE 3 (A15, DPR 2) | Real device |
| Pixel 7 (Tensor G2) | Real device or emulation |
| Samsung Galaxy A23 (Helio G85 — low-end) | Real device |
| iPad Air (M1) | Real device |

**Criteria**:
- [ ] All presets render at 30fps+ on all devices
- [ ] DPR correctly capped to 1 on mobile
- [ ] Adaptive quality triggers on low-end device
- [ ] CSS fallback activates on software rendering
- [ ] No memory leaks after 5 minutes
- [ ] Context loss/restore works

---

### WP-12: Cross-Browser Verification

| Browser | Shader | CSS Fallback | Static |
|---------|--------|-------------|--------|
| Chrome 119+ | Yes | Yes | Yes |
| Firefox 128+ | Yes | Yes | Yes |
| Safari 16.4+ | Yes | Yes | Yes |
| Edge 119+ | Yes | Yes | Yes |
| Samsung Internet 24+ | Yes | Yes | Yes |
| Chrome Android | Yes | Yes | Yes |
| Safari iOS 15+ | Yes | Yes | Yes |
| Firefox Android | Yes | Yes | Yes |

---

### WP-13: Brand × Shader Matrix Testing

Test all combinations of the 12 brand presets × 8 shader presets (96 combinations).

Focus areas:
- [ ] Dark backgrounds + light text contrast
- [ ] Very saturated colors (neon palette)
- [ ] Very desaturated colors (mono palette)
- [ ] No accent color (metaballs with only 2 colors)
- [ ] No secondary color (gradient-mesh needs 3+ colors)

---

## Estimated File Summary

| Phase | New Files | Modified Files | Total |
|-------|-----------|---------------|-------|
| Phase 0: Foundation | 0 | 3 | 3 |
| Phase 1: Content Enrichment | 0 | 5-8 | 5-8 |
| Phase 2: Shader Core | 6 | 1 | 7 |
| Phase 3: Shader Presets | 8 | 1 | 9 |
| Phase 4: Brand Editor | 1 | 3 | 4 |
| Phase 5: Polish | 0 | 2-3 | 2-3 |
| **Total** | **~15** | **~15** | **~30** |
