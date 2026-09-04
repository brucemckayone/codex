# 11 — Implementation Readiness Assessment

**Purpose**: Determine what's required before moving from `docs/` research prototypes to `src/` production code. This is the go/no-go gate for beginning WP-00.

---

## Readiness Checklist

### Design Documentation

| Item | Status | Evidence |
|------|--------|---------|
| Architecture specified | Done | `02-shader-architecture.md` — renderer module, uniform contract, component structure |
| All 8 presets specified | Done | `03-shader-presets.md` — GLSL basis, GPU cost, config knobs, mouse behavior |
| Interaction system designed | Done | `04-interaction-system.md` — mouse lerp, touch, click ripple, scroll parallax, idle |
| Mobile strategy defined | Done | `05-mobile-strategy.md` — DPR cap, adaptive quality, CSS fallback, context loss |
| Brand editor integration designed | Done | `06-brand-editor-integration.md` — new level, tokenOverrides keys, live preview |
| Content enrichment specified | Done | `07-content-enrichment.md` — avatar strip, stats, social links, smart CTAs |
| Work packets defined | Done | `08-implementation-plan.md` — 13 WPs, dependency graph, parallelization |
| Risks assessed | Done | `09-risk-assessment.md` — 18 risks, mitigations, regression analysis, rollback |

### Research Questions

| Question | Status | Resolution |
|----------|--------|-----------|
| WebGL library choice | Resolved | Raw WebGL (TWGL.js backup at 7.2KB) |
| Noise implementation | Resolved | Ashima/Gustavson simplex (MIT), same authors, mediump 2D variant exists |
| Dark mode handling | Resolved | OKLAB blending in GLSL, no shader-side dark-mode logic |
| Thumbnail generation | Resolved | Static PNGs via Puppeteer (WebGL context limit: 2 on Firefox mobile) |
| Content stats data | Resolved | `pagination.total` already in API response, just not accessed |
| Social links data | Resolved | Extend public info endpoint (one API change) |
| CSS fallback for Firefox | Resolved | 3-tier: @property → mix-blend-mode blobs → static gradient |
| Mediump 3D noise | Resolved | Dual code path: highp → snoise3, mediump → animatedNoise2D or psrdnoise2 |
| Blend modes | Resolved | 5 modes in common.glsl, per-preset recommendations |
| Procedural vs texture noise | Resolved | Procedural wins on mobile (memory bandwidth bottleneck) |
| Stripe minigl pattern | Resolved | 521 lines, validated our 522-line renderer independently |
| Scroll integration | Resolved | IntersectionObserver + passive scroll listener (no ScrollTimeline) |

### Code Prototypes

| Prototype | Status | Lines | Production Path |
|-----------|--------|-------|----------------|
| `common.glsl` | Done | 467 | → `ShaderHero/shaders/common.glsl` |
| `fullscreen-quad.vert` | Done | 17 | → `ShaderHero/shaders/fullscreen-quad.vert` |
| `gradient-mesh.frag` | Done + blend modes | 81 | → `ShaderHero/shaders/gradient-mesh.frag` |
| `aurora.frag` | Done | 132 | → `ShaderHero/shaders/aurora.frag` |
| `noise-flow.frag` | Done | 88 | → `ShaderHero/shaders/noise-flow.frag` |
| `metaballs.frag` | Done | 161 | → `ShaderHero/shaders/metaballs.frag` |
| `waves.frag` | Done | 106 | → `ShaderHero/shaders/waves.frag` |
| `particles.frag` | Done | 178 | → `ShaderHero/shaders/particles.frag` |
| `voronoi.frag` | Done | 118 | → `ShaderHero/shaders/voronoi.frag` |
| `geometric.frag` | Done | 125 | → `ShaderHero/shaders/geometric.frag` |
| `shader-renderer-prototype.ts` | Done | 522 | → `ShaderHero/shader-renderer.ts` |
| `BrandEditorHeroEffects-prototype.svelte` | Done | 322 | → `brand-editor/levels/BrandEditorHeroEffects.svelte` |
| `hero-css-fallback.css` | Done | 178 | → merge into `org-brand.css` or `ShaderHero.svelte` scoped style |
| `page-server-load-enhanced.ts` | Done | 73 | → modify existing `+page.server.ts` (one-line change) |

---

## What's Blocking Implementation?

**Nothing.** The design documentation is comprehensive, all research questions are resolved, and code prototypes exist for every component. Implementation can begin with WP-00.

### Minor Items to Address During Implementation (Not Blockers)

1. **GLSL import mechanism**: Prototypes use raw string concatenation (`common + preset`). In production, decide between:
   - Template literal imports (`import commonGlsl from './shaders/common.glsl?raw'` — Vite raw import)
   - Inline strings in `shader-presets.ts`
   - Recommendation: Vite `?raw` imports. Clean, tree-shakeable, works with Vite's build.

2. **Preset thumbnails**: Need to generate actual WebP files. Can be done in Phase 3 (brand editor) — the prototype uses CSS gradient approximations as placeholders.

3. **Social links API change**: Extending `GET /api/organizations/public/:slug/info` to include social URLs. This is a Phase 1 (content enrichment) task — independent of the shader system.

4. **Blend mode integration**: Only `gradient-mesh` has been updated with Screen blend. The other 7 presets still use `mix()`. This can be done preset-by-preset during WP-08a-h.

5. **psrdnoise2 integration**: The mediump flow noise from Gustavson. Currently using our simpler `animatedNoise2D` fallback. psrdnoise2 is better quality but requires importing a third-party GLSL file (MIT licensed). Evaluate during WP-05 (common GLSL library).

---

## Recommended Implementation Sequence

Based on the dependency graph in `08-implementation-plan.md`:

### Sprint 1: Foundation + First Shader

```
WP-00: Config keys & types (3 files, ~30 min)
  ↓
WP-05: common.glsl → production (copy from prototype, 1 file)
  ↓
WP-06: shader-renderer.ts → production (adapt prototype, 3 files)
  ↓
WP-07: ShaderHero.svelte → production (2 files + modify +page.svelte)
  ↓
WP-08a: gradient-mesh preset (1 file + preset registry entry)
WP-08b: aurora preset (1 file)
  ↓
WP-10: CSS fallback (1 file — merge hero-css-fallback.css)
```

**Deliverable**: Working shader hero with 2 presets, CSS fallback, no brand editor UI yet. Testable on real pages.

### Sprint 2: Brand Editor + More Presets

```
WP-09: BrandEditorHeroEffects.svelte (adapt prototype, 2 files + wiring)
  ↓
WP-08c-e: noise-flow, metaballs, waves (3 files)
```

**Deliverable**: Brand editor can configure shader presets. 5 presets available.

### Sprint 3: Content Enrichment + Final Presets

```
WP-01-04: Creator avatars, stats, social links, smart CTAs (5-8 files)
WP-08f-h: particles, voronoi, geometric (3 files)
```

**Deliverable**: Full hero enhancement — shader + enriched content.

### Sprint 4: Polish + Verification

```
WP-11: Mobile testing
WP-12: Cross-browser verification
WP-13: Brand × shader matrix testing
```

---

## Size Budget Assessment

| Item | Size (gzip) | Status |
|------|------------|--------|
| common.glsl | ~3KB | Within budget |
| Largest preset (particles) | ~1.5KB | Within budget |
| shader-renderer.ts | ~4KB | Within budget |
| ShaderHero.svelte | ~2KB (estimated) | Within budget |
| BrandEditorHeroEffects.svelte | ~3KB | Within budget |
| hero-css-fallback.css | ~1KB | Within budget |
| 8 preset thumbnails (WebP) | ~16KB | Within budget |
| **Total JS/CSS addition** | **~15KB gzip** | Well under 30KB target |
| **Total with thumbnails** | **~31KB** | Acceptable |

Note: Only the active preset's GLSL is loaded (not all 8). The renderer lazy-compiles on first use.

---

## Risk Check (Pre-Implementation)

| Risk | Still Valid? | Current Status |
|------|------------|---------------|
| WebGL crashes | Yes | Mitigated: failIfMajorPerformanceCaveat, try/catch, CSS fallback |
| Battery drain | Yes | Mitigated: DPR cap, idle pause, IntersectionObserver, 30fps mobile |
| Bad color combos | Yes | Mitigated: OKLAB blending, blend modes, "None" escape hatch |
| mediump artifacts | Yes | Mitigated: GL_FRAGMENT_PRECISION_HIGH dual path |
| SSR mismatch | No risk | Canvas in `{#if mounted}` — zero server rendering |
| Firefox @property | Handled | 3-tier fallback with mix-blend-mode Tier 2 |
| iOS context loss | Handled | webglcontextlost/restored events |
| Bundle size | No risk | ~15KB gzip JS/CSS — well within budget |

---

## Verdict

**Implementation-ready.** All design decisions are documented, all research questions resolved, code prototypes exist for every component. The recommended starting point is WP-00 (config keys & types) followed immediately by WP-05 through WP-08b to get a working prototype on-screen.

The 4-hour research loop has served its purpose. Further loops should shift from research to implementation review — or this cron job can be cancelled.
