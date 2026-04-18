# Frontend Audit — 2026-04-18

> Comprehensive audit of the Codex web app front end. Generated section-by-section by a recurring `/loop` task. One section per firing.

## Scope

Verify correct and modern application of CSS, inheritance and reuse across the app, wasted code, and simplification opportunities. Produce per-section reports and a synthesised rollup.

## Prior work

The 2026-04-03 `docs/frontend-audit-results.md` audit covered **token-migration violations** (pattern-based regex scan: hardcoded colours, rgba literals, undefined `-dark` tokens, component-reuse gaps). That audit is **not superseded** — it still owns the violations inventory. This new audit is broader:

- Modern CSS usage (`:has()`, container queries, `@layer`, view transitions, cascade features, `text-wrap`, custom media)
- Style architecture (scoped vs global, cascade layers, import graph, dead code)
- Runtime efficiency (unused selectors, duplicate rules, oversized bundles)
- Simplification (redundant wrappers, over-engineered abstractions, premature variants)

## Sections

One section per `/loop` firing. Tick the box and link the report when done.

### A — Foundation (cross-cutting)

- [x] 01. CSS Foundation — `styles/`, `theme/`, tokens, themes, utilities, view-transitions → [01-css-foundation.md](01-css-foundation.md)
- [x] 02. Base elements — `theme/base.css` (h1-h6, forms, tables, code, lists, focus) → [02-base-elements.md](02-base-elements.md)
- [x] 03. Global utilities — `styles/utilities.css` + unused `theme/utilities.css` → [03-global-utilities.md](03-global-utilities.md)
- [x] 04. Design tokens — colour system, spacing scale, typography, motion, radius, z-index, materials → [04-design-tokens.md](04-design-tokens.md)
- [x] 05. Org branding overlay — `org-brand.css` (OKLCH relative colors, hero data-attrs, token overrides) → [05-org-branding-overlay.md](05-org-branding-overlay.md)
- [ ] 06. Root shell — `+layout.svelte`, SkipLink, NavigationProgress, Toaster

### B — Route sections

- [ ] 07. Platform home — `(platform)/+page.svelte` + landing sections
- [ ] 08. Platform discover — `(platform)/discover/`
- [ ] 09. Platform library — `(platform)/library/`
- [ ] 10. Platform account — `(platform)/account/`
- [ ] 11. Platform pricing — `(platform)/pricing/`
- [ ] 12. Platform about & become-creator — static marketing
- [ ] 13. Org landing — `_org/[slug]/(space)/+page.svelte`
- [ ] 14. Org content detail & player — `_org/[slug]/(space)/content/[slug]/`
- [ ] 15. Org explore/creators/library — `(space)/explore/`, `creators/`, `library/`, `pricing/`, `checkout/success/`
- [ ] 16. Studio — dashboard + content management + media library
- [ ] 17. Studio — analytics, billing, customers, monetisation, team
- [ ] 18. Studio — settings (general, branding, email templates)
- [ ] 19. Auth pages — `(auth)/` group + layout
- [ ] 20. Creator subdomain — `_creators/[username]/`

### C — Component systems

- [ ] 21. UI primitives — Button, Input, Select, Checkbox, Switch, Card, Badge, Dialog, Toast, Tabs, Tooltip, Pagination
- [ ] 22. Layout primitives — SidebarRail, Header, MobileNav, MobileBottomNav, MobileBottomSheet, StudioSidebar, PageContainer, Footer
- [ ] 23. Content primitives — ContentCard, CreatorCard, content viewers, carousels
- [ ] 24. Brand editor — floating panel + level components (`brand-editor/`)
- [ ] 25. VideoPlayer — HLS player, cinema mode, controls
- [ ] 26. AudioPlayer + ImmersiveShaderPlayer — audio controls, visualisation
- [ ] 27. ShaderHero — WebGL presets, audio reactivity, hero layout variants
- [ ] 28. Editor — Tiptap rich text
- [ ] 29. Search & Command Palette
- [ ] 30. SEO & meta

### D — Rollup

- [ ] 31. `findings-summary.md` — prioritised cross-section findings with effort/impact

## Running the audit

Fired by cron `7,37 * * * *` (every 30 min). Each firing picks the next unticked section, writes a report, ticks the box, and commits.

## Report template

Each `NN-<section>.md` follows:

```
# NN — <Section Name>

## Scope
Files/components covered.

## CSS modernity
What modern CSS is used, what's missing, and what would simplify things.

## Inheritance & reuse
Token adoption, component reuse, duplication.

## Wasted code
Unused files, dead selectors, duplicate rules, bloat candidates (with line numbers).

## Simplification opportunities
Specific diffs or refactors, ordered by impact/effort.

## Findings
| # | Severity | Finding | Recommendation |
```
