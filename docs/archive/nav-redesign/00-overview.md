# Navigation Redesign — Work Packet Index

## Summary

Replace top header bars with a left sidebar rail (collapsed icons, expand-on-hover as floating glass overlay), a command palette search (Cmd+K), and a mobile bottom navigation bar. Studio keeps its sidebar but gains a view-transition morph from the org rail.

## Dependency Graph

```
WP-01 Foundation (icons, nav config, i18n)
  ├── WP-02 SidebarRailItem
  ├── WP-03 SidebarRailUserSection
  ├── WP-05 CommandPaletteSearch
  └── WP-06 MobileBottomNav
        └── WP-07 MobileBottomSheet
WP-02 + WP-03 → WP-04 SidebarRail
WP-04 + WP-05 + WP-06 + WP-07 → WP-08 Layout Wiring
WP-08 → WP-09 Studio Transition
WP-09 → WP-10 Verification
WP-10 → WP-11 Review & Cleanup
```

## Parallelisation

After WP-01 completes, the following can run in parallel:
- **Stream A**: WP-02 → WP-03 → WP-04
- **Stream B**: WP-05
- **Stream C**: WP-06 → WP-07

WP-08 merges all three streams. WP-09–WP-11 are sequential.

## Work Packets

| WP | Title | Est. Files | Depends On |
|----|-------|------------|------------|
| [WP-01](./WP-01-foundation.md) | Foundation — Icons, Nav Config, i18n | ~10 | None |
| [WP-02](./WP-02-sidebar-rail-item.md) | SidebarRailItem Component | 1 | WP-01 |
| [WP-03](./WP-03-sidebar-rail-user.md) | SidebarRailUserSection Component | 1 | WP-01 |
| [WP-04](./WP-04-sidebar-rail.md) | SidebarRail Main Component | 2 | WP-01, WP-02, WP-03 |
| [WP-05](./WP-05-command-palette-search.md) | CommandPaletteSearch | 1 | WP-01 |
| [WP-06](./WP-06-mobile-bottom-nav.md) | MobileBottomNav | 2 | WP-01 |
| [WP-07](./WP-07-mobile-bottom-sheet.md) | MobileBottomSheet | 1 | WP-06 |
| [WP-08](./WP-08-layout-wiring.md) | Platform + Org Layout Wiring | 2 | WP-04, WP-05, WP-06, WP-07 |
| [WP-09](./WP-09-studio-transition.md) | Studio View Transition | 2 | WP-08 |
| [WP-10](./WP-10-verification.md) | Verification (DevTools + Playwright) | 0 | WP-09 |
| [WP-11](./WP-11-review-cleanup.md) | Review & Cleanup | ~5 | WP-10 |

## Design Principles

1. **All CSS uses design tokens** — zero hardcoded px/hex/rgb values
2. **Glass morphism is brandable** — derived from `var(--color-surface)` via `color-mix()`, so org branding flows through automatically
3. **Disney animation principles** — anticipation (bounce easing), secondary action (staggered label fade), follow-through (overshoot settle)
4. **Accessibility first** — ARIA roles, keyboard nav, reduced motion, focus management
5. **Mobile-first responsive** — bottom nav for mobile, sidebar for desktop, breakpoint at `--breakpoint-md` (768px)
