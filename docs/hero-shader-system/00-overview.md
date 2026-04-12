# Hero Shader System — Design Documentation

**Version**: 0.1 (Research Phase)
**Date**: 2026-04-08
**Status**: Deep research, iterating every 4 hours
**Last Updated**: 2026-04-08T22:30Z

---

## Executive Summary

Replace the flat CSS gradient hero section on organization landing pages with a configurable, shader-driven animated background. Org admins select from 8 shader presets via the existing Brand Editor panel. The shader reads brand colors as uniforms — every organization gets a visually unique animation from the same code.

**Key constraint**: Zero API, database, or validation schema changes. Shader configuration piggybacks on the existing `tokenOverrides` JSON field in `branding_settings`.

---

## Document Index

| # | Document | Status |
|---|----------|--------|
| [00](./00-overview.md) | Overview & Index (this file) | Draft |
| [01](./01-current-state-audit.md) | Current State Audit — Hero, Header, Branding Pipeline | Draft |
| [02](./02-shader-architecture.md) | Shader System Architecture — Renderer, Presets, Uniforms | Draft |
| [03](./03-shader-presets.md) | Shader Preset Catalog — 8 Effects with GLSL Specs | Draft |
| [04](./04-interaction-system.md) | Mouse, Touch & Scroll Interaction Design | Draft |
| [05](./05-mobile-strategy.md) | Mobile Performance, Fallbacks & CSS-Only Mode | Draft |
| [06](./06-brand-editor-integration.md) | Brand Editor "Hero Effects" Level | Draft |
| [07](./07-content-enrichment.md) | Hero Content Enhancements (Non-Shader) | Draft |
| [08](./08-implementation-plan.md) | Work Packets, Phases & Dependency Graph | Draft |
| [09](./09-risk-assessment.md) | Risk Matrix & Mitigation Strategies | Draft |
| [10](./10-research-log.md) | Running Research Notes (Updated Each Loop) | Active |
| [11](./11-implementation-readiness.md) | Implementation Readiness Assessment & Go/No-Go | **Ready** |
| [12](./12-fluid-interaction-system.md) | Fluid Interaction — Ping-Pong FBOs, Navier-Stokes, Momentum | Superseded |
| [13](./13-revised-shader-approach.md) | Revised Approach — 2-pass RDA, Shadertoy analysis, new preset categories | Complete |
| [14](./14-final-preset-catalog.md) | **Final Preset Catalog** — 4 approved presets, production integration plan | **Approved** |

---

## Design Principles

1. **Brand-native**: Every shader effect derives its personality from the org's brand colors. No preset-specific color palettes — the org's primary/secondary/accent colors ARE the palette.

2. **Zero API changes**: Configuration stored in the existing `tokenOverrides` JSON field. No new database columns, API endpoints, or Zod schemas.

3. **Progressive enhancement**: Static gradient (current) → CSS animated gradient (no WebGL) → Full shader (WebGL). Each layer adds richness without breaking the layer below.

4. **Performance by default**: DPR cap on mobile, IntersectionObserver pause, idle timeout, reduced-motion respect. No shader should exceed 1ms/frame on a 2020-era phone.

5. **Live-previewable**: The brand editor's existing `$effect` → `injectBrandVars()` pipeline means shader config changes appear instantly on the live page, same as color/font changes today.

6. **Design token compliance**: All CSS values in new components use design tokens from `$lib/styles/tokens/`. No hardcoded px, hex, or rgb values.

---

## Architecture Snapshot

```
Brand Editor                     Data Pipeline                    Rendering
┌──────────────┐    ┌──────────────────────────────┐    ┌──────────────────┐
│ Hero Effects │    │ tokenOverrides (JSON string)  │    │ ShaderHero.svelte│
│ Level (new)  │───>│ in branding_settings table    │───>│                  │
│              │    │                               │    │ ┌──────────────┐ │
│ Preset grid  │    │ Flows through:                │    │ │ <canvas>     │ │
│ Speed slider │    │  API → Server Load → Layout   │    │ │ WebGL quad   │ │
│ Mouse toggle │    │  → CSS injection → Component  │    │ │ Fragment     │ │
│ Scroll mode  │    │                               │    │ │ shader       │ │
└──────────────┘    └──────────────────────────────┘    │ └──────────────┘ │
                                                        │ ┌──────────────┐ │
                                                        │ │ Content      │ │
                                                        │ │ overlay      │ │
                                                        │ │ (logo,title) │ │
                                                        │ └──────────────┘ │
                                                        └──────────────────┘
```

---

## Scope Boundaries

### In Scope
- ShaderHero component (canvas + content overlay)
- 8 shader presets (GLSL fragment shaders)
- Shader renderer module (WebGL context, compile, render loop)
- Mouse/touch interaction system
- Scroll-linked animation (parallax + fade)
- Brand editor "Hero Effects" level
- CSS-only animated fallback
- Mobile performance guards
- Accessibility (reduced-motion, aria-hidden, seizure safety)
- Hero content enrichment (social links, creator strip, stats)

### Out of Scope (Future)
- Custom GLSL upload by creators
- Shader effects on SidebarRail background
- Audio-reactive shaders
- Video background integration
- Page builder / drag-drop hero layouts
- 3D model rendering in hero

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| WebGL library | Raw WebGL (no library). TWGL.js (7.2KB gzip) as backup. | Single fullscreen quad = ~80 lines. OGL (13.5KB), regl (42KB, outdated), Three.js (50KB+) all overkill. TWGL eliminates boilerplate if maintenance burden grows. |
| Config storage | `tokenOverrides` JSON | Existing extensibility hook. No API changes. Already persisted, cached, and live-injected. |
| Shader language | GLSL ES 1.0 (WebGL 1) | 98% browser support. WebGL 2 features not needed for 2D effects. |
| Canvas positioning | `position: absolute` within hero | Scrolls with content. Fixed would render off-screen (waste GPU) and fight sidebar z-index. |
| Mobile DPR | Capped at 1 | 9x fewer fragments vs DPR 3. Imperceptible quality difference for smooth gradients. |
| Fallback | 3-tier: CSS `@property` → `mix-blend-mode` blobs → static gradient | `@property` not in Firefox (April 2026). Blend-mode blobs cover Firefox at 95% support. Static gradient is zero-regression baseline. |
| Preset count | 8 | Covers the aesthetic spectrum (professional → bold → minimal → organic). More than 8 creates paradox of choice. |
