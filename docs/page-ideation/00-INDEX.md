# Codex Page Ideation Index

**Purpose**: Comprehensive brainstorm of features, layout ideas, and improvements for every page in the Codex frontend. These are ideas only — not implementation specs.

**Scope**: Subdomain paths (org + creator) and studio dashboards. Root domain deferred.

**Date**: 2026-04-04

---

## Document Map

| # | Document | Pages Covered | Priority |
|---|----------|---------------|----------|
| 01 | [Org Landing Page](01-org-landing.md) | `{slug}.*/` | Critical — first impression |
| 02 | [Org Explore Page](02-org-explore.md) | `{slug}.*/explore` | High — content discovery |
| 03 | [Org Creators Page](03-org-creators.md) | `{slug}.*/creators` | High — community showcase |
| 04 | [Org Library Page](04-org-library.md) | `{slug}.*/library` | Medium — user engagement |
| 05 | [Org Content Detail](05-org-content-detail.md) | `{slug}.*/content/{slug}` | Critical — conversion page |
| 06 | [Org Checkout Flow](06-org-checkout.md) | `{slug}.*/checkout/*` | Medium — purchase completion |
| 07 | [Org Studio Dashboard](07-studio-dashboard.md) | `{slug}.*/studio` | High — admin home |
| 08 | [Org Studio Content](08-studio-content.md) | `{slug}.*/studio/content/*` | High — core workflow |
| 09 | [Org Studio Media](09-studio-media.md) | `{slug}.*/studio/media` | Medium — asset management |
| 10 | [Org Studio Analytics](10-studio-analytics.md) | `{slug}.*/studio/analytics` | Medium — business intel |
| 11 | [Org Studio Customers](11-studio-customers.md) | `{slug}.*/studio/customers` | Medium — CRM |
| 12 | [Org Studio Team](12-studio-team.md) | `{slug}.*/studio/team` | Low — admin-only |
| 13 | [Org Studio Billing](13-studio-billing.md) | `{slug}.*/studio/billing` | Low — admin-only |
| 14 | [Org Studio Settings](14-studio-settings.md) | `{slug}.*/studio/settings/*` | Medium — config |
| 15 | [Creator Profile](15-creator-profile.md) | `creators.*/[username]` | High — creator brand |
| 16 | [Creator Content](16-creator-content.md) | `creators.*/[username]/content/*` | Medium — catalog |
| 17 | [Creator Studio](17-creator-studio.md) | `creators.*/studio/*` | Medium — personal dashboard |
| 18 | [Header & Navigation](18-headers-navigation.md) | All headers, nav, search | High — global UX |
| 19 | [Shared Components](19-shared-components.md) | Component library gaps | Medium — reusable building blocks |
| 20 | [Current State Audit](20-current-state-audit.md) | Corrections, patterns, quick wins | Reference — ground truth from code |
| 21 | [Feasibility Classification](21-feasibility-classification.md) | API cross-ref, effort ranking, implementation order | **START HERE** for execution |
| 22 | [Page Builder Investigation](22-page-builder-investigation.md) | Dynamic page composition: architecture, options, data model, SSR | Critical — enables org page customization |
| 23 | [Option A Design Spec](23-option-a-design-spec.md) | Section Picker: full stack spec, every file, every layer | **Implementation-ready** |

---

## Product Context (For Reference)

**Codex** = Creator monetization platform. "Your own Netflix + Calendly + Shopify."

**Customer journey**: Discover → Learn → Engage → Transform

**Organization** = A collective/business with a branded subdomain. Think "record label."
**Creator** = Content producer who owns their media. Think "musician."
**Customer** = Person who buys and consumes content.

**Org landing page scopes**: Explore (browse content), Creators (the people), Library (your purchased content)

**Currency**: GBP (£) by default

**Key future features** (design for but don't implement):
- Subscriptions (recurring billing)
- Offerings (events, workshops, coaching, retreats)
- Credits system
- Multi-creator revenue sharing
- Content licensing
- Following/feed system
