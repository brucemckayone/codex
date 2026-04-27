/**
 * Proof test for iter-012 F2 — simplification:dup-component-shape
 *
 * Finding: SidebarRailItem.svelte (120 lines) and StudioSidebarItem.svelte
 * (215 lines) implement the SAME UI primitive: an `<a>` row inside a
 * vertical rail with a Melt UI tooltip when collapsed and a label when
 * expanded.
 *
 * Both components:
 *   - Use createTooltip({ positioning: { placement: 'right' }, openDelay: 0,
 *     closeDelay: 0, forceVisible: true }) verbatim
 *   - Set `aria-current={active ? 'page' : undefined}`
 *   - Stagger label reveal via `style:--item-index={index}` + a
 *     `transition-delay: calc(... * var(--item-index, 0))` rule
 *   - Use color-mix(in oklch, var(--color-interactive) 12% / 15%, transparent)
 *     for hover/active backgrounds
 *   - Render the same 22px / 20px icon at the same gap and min-height
 *
 * StudioSidebarItem.svelte:50-52 contains an explicit comment admitting the
 * dup: "Matches the SidebarRailItem reference pattern exactly."
 *
 * The diff reduces to:
 *   - StudioSidebarItem adds a `badgeCount?: number` prop + NavBadge slot
 *   - StudioSidebarItem adds a `loading: boolean` modifier class
 *   - Class names ('rail-item' vs 'studio-rail__item') and CSS scoping
 *
 * Both are in-scope of this cycle (both files churned in last 14 days).
 *
 * Catalogue row: "Duplication count → programmatic assertion" — assert that
 * after the refactor the two files share a base via composition (e.g.
 * `<SidebarRailItem .../> <NavBadge .../>` inside StudioSidebar) or both
 * delegate to a shared `RailItemBase` snippet.
 *
 * Fingerprint: simplification:dup-component-shape
 * Severity: major — visual parity is currently maintained by manual
 *           synchronisation; a future tooltip-positioning change in one
 *           silently diverges from the other.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');
const sidebarRailItem = resolve(
  repoRoot,
  'apps/web/src/lib/components/layout/SidebarRail/SidebarRailItem.svelte'
);
const studioSidebarItem = resolve(
  repoRoot,
  'apps/web/src/lib/components/layout/StudioSidebar/StudioSidebarItem.svelte'
);

describe.skip('iter-012 F2 — SidebarRailItem and StudioSidebarItem share a single tooltip primitive', () => {
  it('only one createTooltip({ placement: right, openDelay: 0 }) instance exists across the two rail-item components', () => {
    const railSrc = readFileSync(sidebarRailItem, 'utf8');
    const studioSrc = readFileSync(studioSidebarItem, 'utf8');
    const tooltipPattern =
      /createTooltip\(\{\s*positioning:\s*\{\s*placement:\s*['"]right['"]/;

    const railHas = tooltipPattern.test(railSrc);
    const studioHas = tooltipPattern.test(studioSrc);

    // Pre-fix: both true.
    // Post-fix: at most one (the canonical primitive); the other consumes it.
    const both = railHas && studioHas;
    expect(both).toBe(false);
  });

  it('both components share a single source of the staggered-label CSS rule', () => {
    const railSrc = readFileSync(sidebarRailItem, 'utf8');
    const studioSrc = readFileSync(studioSidebarItem, 'utf8');
    const stagger = /transition-delay:\s*calc\([^)]*var\(--item-index,\s*0\)\)/;

    const railHas = stagger.test(railSrc);
    const studioHas = stagger.test(studioSrc);

    // Post-fix: at most one of the two carries this CSS — the other is a
    // composition that re-uses the primitive.
    expect(railHas && studioHas).toBe(false);
  });

  it('the explicit "Matches the SidebarRailItem reference pattern exactly" comment is gone', () => {
    const studioSrc = readFileSync(studioSidebarItem, 'utf8');
    // The comment is a maintenance smell. After dedup it disappears because
    // there is no longer a "reference pattern" to match — there is one
    // primitive both components depend on.
    expect(studioSrc).not.toMatch(
      /Matches the SidebarRailItem reference pattern/
    );
  });
});
