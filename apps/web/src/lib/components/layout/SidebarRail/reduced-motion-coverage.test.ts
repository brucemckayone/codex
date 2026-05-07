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
  'command-palette/CommandPalette.svelte',
];

const JS_TRANSITION_GATED = [
  'layout/MobileNav/MobileBottomSheet.svelte',
  'search/CommandPaletteSearch.svelte',
];

describe('Codex-rf1l9 — nav redesign honours prefers-reduced-motion', () => {
  test.each(
    CSS_GATED
  )('%s contains @media (prefers-reduced-motion: reduce) gate', (rel) => {
    const src = readSource(rel);
    expect(src).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  test.each(
    JS_TRANSITION_GATED
  )('%s wires prefersReducedMotion state via matchMedia', (rel) => {
    const src = readSource(rel);
    expect(src).toContain('prefersReducedMotion');
    expect(src).toMatch(
      /matchMedia\(\s*['"]\(prefers-reduced-motion:\s*reduce\)['"]\s*\)/
    );
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

  test('MobileBottomSheet fly transition zeroes y-translate under reduced-motion', () => {
    // fly={{ y: 400 }} is a 400px slide-up — must collapse to y: 0 (or
    // equivalent duration: 0) when the user opts out of motion.
    const src = readSource('layout/MobileNav/MobileBottomSheet.svelte');
    expect(src).toMatch(/y:\s*prefersReducedMotion\s*\?\s*0\s*:/);
    expect(src).toMatch(/duration:\s*prefersReducedMotion\s*\?\s*0\s*:/);
  });

  test('CommandPaletteSearch fly transition zeroes y-translate under reduced-motion', () => {
    const src = readSource('search/CommandPaletteSearch.svelte');
    expect(src).toMatch(/y:\s*prefersReducedMotion\s*\?\s*0\s*:/);
    expect(src).toMatch(/duration:\s*prefersReducedMotion\s*\?\s*0\s*:/);
  });
});
