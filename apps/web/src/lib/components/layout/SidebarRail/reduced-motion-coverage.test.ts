import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Proof for Codex-rf1l9: every nav redesign surface must honour
 * prefers-reduced-motion (WCAG 2.3.3).
 *
 * CSS-only animations are gated by @media (prefers-reduced-motion: reduce).
 * Svelte JS transitions (fly/fade) bypass CSS media queries, so they must
 * gate their option object via a matchMedia-driven prefersReducedMotion state.
 * A surface that is a shared Dialog.Content panel moves only by its `motion`
 * prop, which Dialog.Content gates once for all of them (Codex-vlphc.4).
 *
 * JSDOM does not evaluate CSS media queries against computed styles, so a
 * runtime getComputedStyle assertion is unreliable. A source-text assertion
 * directly falsifies the regression this bug was filed against: "a new nav
 * component shipped without the reduced-motion gate."
 */

const COMPONENTS_ROOT = resolve(__dirname, '../..');

function readSource(rel: string): string {
  return readFileSync(resolve(COMPONENTS_ROOT, rel), 'utf-8');
}

const CSS_GATED = [
  'layout/SidebarRail/SidebarRail.svelte',
  'layout/SidebarRail/SidebarRailItem.svelte',
  'layout/SidebarRail/SidebarRailUserSection.svelte',
  'layout/MobileNav/MobileBottomNav.svelte',
];

// Each surface and the Dialog.Content `motion` it moves by.
const DIALOG_MOTION = [
  ['search/CommandPaletteSearch.svelte', 'drop'],
  ['command-palette/CommandPalette.svelte', 'none'],
  ['layout/MobileNav/MobileBottomSheet.svelte', 'rise'],
];

describe('Codex-rf1l9 — nav redesign honours prefers-reduced-motion', () => {
  test.each(
    CSS_GATED
  )('%s contains @media (prefers-reduced-motion: reduce) gate', (rel) => {
    const src = readSource(rel);
    expect(src).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  test('SidebarRailItem stagger delay collapses to 0ms under reduced-motion', () => {
    // The stagger (transition-delay: calc(30ms * --item-index)) is the worst
    // vestibular offender — it ripples across nav items. The reduced-motion
    // block must explicitly set transition-delay: 0ms.
    const src = readSource('layout/SidebarRail/SidebarRailItem.svelte');
    const match = src.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\}/
    );
    expect(match).not.toBeNull();
    expect(match![0]).toContain('transition-delay: 0ms');
    expect(match![0]).toContain('transform: none');
  });

  test.each(
    DIALOG_MOTION
  )('%s moves only by Dialog.Content motion="%s"', (rel, motion) => {
    const src = readSource(rel);
    expect(src).toContain(`motion="${motion}"`);
    // A transition of its own would run past the shared gate.
    expect(src).not.toMatch(/from\s*['"]svelte\/transition['"]/);
    expect(src).not.toMatch(/\s(transition|in|out):[a-z]/);
  });

  test('Dialog.Content plays drop and rise only when motion is allowed', () => {
    const src = readSource('ui/Dialog/DialogContent.svelte');
    expect(src).toMatch(
      /import\s*\{\s*prefersReducedMotion\s*\}\s*from\s*['"]svelte\/motion['"]/
    );
    expect(src).toMatch(
      /\(motion === 'drop' \|\| motion === 'rise'\)\s*&&\s*!prefersReducedMotion\.current/
    );
  });
});
