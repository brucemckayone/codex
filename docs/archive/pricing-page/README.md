# Pricing Page Redesign — Design Specification

**Date**: 2026-04-15
**Status**: Implementation-ready (v1.1 — reviewed by 8 agents)

---

## Summary

Premium pricing page for org subdomains with glassmorphic tier cards, Disney-principled animations, content preview, creator-configurable FAQ, and smart sticky CTA. Fully brand-aware via the design token injection system.

## Documents

| Phase | Document | Scope | Depends on |
|-------|----------|-------|------------|
| **1A** | [Recommended Tier Flag](phase-1a-recommended-tier.md) | `isRecommended` boolean on subscription tiers + service-layer uniqueness | Nothing |
| **1B** | [Pricing FAQ Storage](phase-1b-pricing-faq.md) | `pricingFaq` JSONB on branding_settings + validation schemas | Nothing |
| **2** | [Pricing Page Frontend](phase-2-pricing-page-frontend.md) | Complete page rewrite — hero, glass cards, content preview, FAQ, trust strip, sticky CTA, all animations | 1A + 1B |
| **3** | [Studio UI](phase-3-studio-ui.md) | Recommended tier toggle on monetisation page + FAQ simple list editor in settings | 1A + 1B |

## Dependency Graph

```
Phase 1A (isRecommended) ──┐
                           ├──> Phase 2 (Frontend) ──> Polish & verify
Phase 1B (pricingFaq)    ──┘         │
                                     │
Phase 3A (Recommended toggle) ───────┘ (after 1A)
Phase 3B (FAQ editor) ───────────────┘ (after 1B)
```

Phases 1A and 1B are fully independent and can run in parallel. Phase 2 is the main work. Phase 3 sub-tasks can start as soon as their backend dependency is ready.

## Key Design Decisions

- **Glass + elevation** card style (backdrop-blur, color-mix, brand-primary glow)
- **Creator picks** recommended tier via Studio toggle
- **Real content thumbnails** (blurred) with graceful fallback
- **Creator-configurable FAQ** with hardcoded defaults
- **Smart sticky CTA** — mobile always-visible, desktop scroll-triggered
- **Disney animation principles** — stagger, squash/stretch, overshoot, reduced-motion compliant
