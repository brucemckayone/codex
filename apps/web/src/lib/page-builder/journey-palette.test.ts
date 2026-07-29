/**
 * The shared journey palette (Codex-gfg50).
 *
 * The bug this locks down: the builder canvas derived its palette from the brand
 * BACKGROUND with auto-contrasted text, while the live sales page and the
 * checkout each derived their own from the brand PRIMARY at a HARDCODED dark
 * lightness with no light branch. A creator on a light theme saw light in the
 * builder and got a dark red live page, and the per-page `brandOverrides`
 * background looked inert because it was overwritten one level down.
 *
 * WHY THESE ASSERTIONS AND NOT COMPUTED STYLES. The bead asked for
 * computed-style checks ("a light `--brand-bg` yields a light
 * `--color-background`"), but jsdom implements neither `oklch(from …)` relative
 * colour nor `color-mix()`, and `getComputedStyle` hands custom properties back
 * as their raw declared string. Such a test would assert the string it was given
 * and pass against a palette that is still wrong. The genuinely falsifiable
 * invariants are structural, and each one is a regression that actually
 * happened or would be silent:
 *
 *   1. the ladder exists in exactly ONE file (divergence is the original bug);
 *   2. it derives from `--brand-bg`, never from the brand primary;
 *   3. no surface token is re-pointed off the brand primary again;
 *   4. the two palette classes never land on the SAME element — that is a
 *      custom-property cycle whose failure mode is a page that paints nothing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PageSection } from '@codex/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneyCoursePage } from './journey-queries';

vi.mock('$app/state', () => ({
  page: { url: new URL('http://of-blood-and-bones.lvh.me:3000/journeys/demo') },
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

const PALETTE = read('journey-palette.css');
const SECTIONS_CSS = read('render-edit/journey-sections.css');

/**
 * The base rule must out-specify org-brand.css, which sets the same tokens at
 * `[data-org-brand]` (0,1,0) and `[data-theme='dark'] [data-org-brand]` (0,2,0)
 * — and our wrapper carries `data-org-brand` itself, so those rules match the
 * SAME element. Three classes = (0,3,0), which wins under either theme.
 */
const BASE_SELECTOR = '.journey-palette.journey-palette.journey-palette {';

/** Declarations only — `--x: …`, not `var(--x)` reads. */
const declarationsOf = (css: string, prop: string): string[] => {
  const out: string[] = [];
  const re = new RegExp(`(^|[;{\\s])${prop}\\s*:([^;}]*)`, 'g');
  for (const m of css.matchAll(re)) out.push(m[2].trim());
  return out;
};

describe('journey palette — one derivation, three surfaces', () => {
  it('out-specifies org-brand.css, which sets the same tokens on the same element', () => {
    // Regression guard for a real break: moving these declarations out of a
    // Svelte component `<style>` lost the hash class that scoping appended, so
    // the rule dropped from (0,2,0) to (0,1,0) and org-brand.css won on source
    // order — headings silently reverted to the org's brand-derived colour on
    // every page that has per-page overrides.
    expect(PALETTE).toContain(BASE_SELECTOR);
    // Three occurrences of the class in one compound selector, no descendant
    // combinators — anything less loses to `[data-theme='dark'] [data-org-brand]`.
    const compound = BASE_SELECTOR.slice(0, -2).trim();
    expect(compound.split('.journey-palette').length - 1).toBe(3);
    expect(compound).not.toMatch(/[\s>+~]/);
  });

  it('declares the ink ladder in exactly one place', () => {
    // The ladder's root input. Two declarations means the divergence is back.
    expect(declarationsOf(PALETTE, '--jp-ink')).toHaveLength(1);
    expect(declarationsOf(SECTIONS_CSS, '--jp-ink')).toEqual([]);
    expect(declarationsOf(SECTIONS_CSS, '--jp-heading')).toEqual([]);
  });

  it('derives the ink from the brand BACKGROUND, not the brand primary', () => {
    const [ink] = declarationsOf(PALETTE, '--jp-ink');
    expect(ink).toContain('--brand-bg');
    expect(ink).not.toContain('--color-brand-primary');
    expect(ink).not.toContain('--brand-color');
  });

  it('auto-contrasts the heading off the ink rather than fixing its lightness', () => {
    const [heading] = declarationsOf(PALETTE, '--jp-heading');
    // Derived FROM the ink, and its lightness is a function of the ink's own `l`.
    expect(heading).toContain('from var(--jp-ink)');
    expect(heading).toMatch(/\bl\b/);
    // A bare numeric lightness (the old `0.96 calc(...)` shape) would mean the
    // text no longer follows the background and light pages break again.
    expect(heading).not.toMatch(/oklch\(\s*from\s+var\(--jp-ink\)\s+0?\.\d+/);
  });

  it('never re-points a background or surface token off the brand primary', () => {
    for (const prop of [
      '--color-background',
      '--color-surface',
      '--color-surface-secondary',
      '--color-surface-tertiary',
      '--color-surface-elevated',
    ]) {
      for (const decl of declarationsOf(PALETTE, prop)) {
        expect(decl).not.toContain('--color-brand-primary');
      }
    }
  });

  it('makes the atmosphere veil track the ink lightness', () => {
    const [veil] = declarationsOf(PALETTE, '--jp-atmos-veil');
    expect(veil).toContain('from var(--jp-ink)');
    // Alpha must be a clamp on `l`, else the bloom is fixed-strength again and a
    // light page gets the salmon wash.
    expect(veil).toMatch(/\/\s*clamp\([^)]*\bl\b/);
  });

  it('has the builder CSS consume the shared palette instead of restating it', () => {
    expect(SECTIONS_CSS).toContain("@import '../journey-palette.css'");
    // `@import` is only valid before other rules; a rule appearing first would
    // make the browser drop the import and silently un-style the canvas.
    const importAt = SECTIONS_CSS.indexOf('@import');
    const firstRuleAt = SECTIONS_CSS.search(/^\.[a-z]/m);
    expect(importAt).toBeGreaterThanOrEqual(0);
    expect(importAt).toBeLessThan(firstRuleAt);
  });
});

describe('journey palette — cycle safety', () => {
  it('splits the two classes so the ink and its re-point cannot cycle', () => {
    // `--jp-ink` falls back to `--color-background`. Re-pointing
    // `--color-background: var(--jp-ink)` in the SAME rule is a custom-property
    // cycle: both become invalid at computed-value time and the page paints
    // nothing. So the base class must NOT declare it, and the modifier must.
    const baseBlock = PALETTE.slice(
      PALETTE.indexOf(BASE_SELECTOR),
      PALETTE.indexOf('.journey-palette--page {')
    );
    const pageBlock = PALETTE.slice(
      PALETTE.indexOf('.journey-palette--page {')
    );

    expect(declarationsOf(baseBlock, '--jp-ink')).toHaveLength(1);
    expect(declarationsOf(baseBlock, '--color-background')).toEqual([]);

    expect(declarationsOf(pageBlock, '--color-background')).toEqual([
      'var(--jp-ink)',
    ]);
    expect(declarationsOf(pageBlock, '--jp-ink')).toEqual([]);
  });
});

const coursePage = (
  brandOverrides: JourneyCoursePage['page']['brandOverrides'] = null,
  sections: PageSection[] = []
): JourneyCoursePage => ({
  page: {
    id: 'p1',
    organizationId: 'o1',
    publishedAt: '2026-07-29T00:00:00.000Z',
    pageType: 'course',
    slug: 'demo',
    title: 'Demo course',
    status: 'published',
    subjectType: 'course',
    subjectId: 'c1',
    brandOverrides,
    sections,
  },
  course: {
    id: 'c1',
    slug: 'demo',
    title: 'Demo course',
    kicker: 'A course',
    lede: 'A short lede.',
    status: 'published',
    priceCents: 2499,
    stageCount: 0,
    practiceCount: 0,
  },
  stages: [],
  testimonials: [],
});

describe('JourneyRenderer (mount)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** Elements whose class attribute contains the given class as an exact token. */
  const withClass = (cls: string): Element[] =>
    [...document.body.querySelectorAll('[class]')].filter((el) =>
      (el.getAttribute('class') ?? '').split(/\s+/).includes(cls)
    );

  const render = async (page: JourneyCoursePage) => {
    const { default: JourneyRenderer } = await import(
      './render/JourneyRenderer.svelte'
    );
    const component = mount(JourneyRenderer, {
      target: document.body,
      props: { coursePage: page, sellPreview: Promise.resolve(null) },
    });
    flushSync();
    return component;
  };

  it('puts the ladder on the wrapper and the re-points on a DESCENDANT', async () => {
    const component = await render(coursePage());

    const base = withClass('journey-palette');
    const page = withClass('journey-palette--page');
    expect(base).toHaveLength(1);
    expect(page).toHaveLength(1);

    // The whole point: different elements, and the modifier is INSIDE the base
    // so it inherits an already-resolved `--jp-ink`.
    expect(page[0]).not.toBe(base[0]);
    expect(base[0].contains(page[0])).toBe(true);

    unmount(component);
  });

  it('never carries both palette classes on one element', async () => {
    const component = await render(coursePage());

    const both = [...document.body.querySelectorAll('[class]')].filter((el) => {
      const tokens = (el.getAttribute('class') ?? '').split(/\s+/);
      return (
        tokens.includes('journey-palette') &&
        tokens.includes('journey-palette--page')
      );
    });
    expect(both).toEqual([]);

    unmount(component);
  });

  it('still injects per-page brand overrides onto the wrapper', async () => {
    // The overrides were always computed and injected correctly — the bug was
    // that `.journey-page` overwrote them one level down. Assert they survive.
    const component = await render(coursePage({ backgroundColor: '#F3F0E7' }));

    const [base] = withClass('journey-palette');
    expect(base.getAttribute('style')).toContain('--brand-bg');
    expect(base.getAttribute('style')).toContain('#F3F0E7');
    expect(base.hasAttribute('data-org-brand')).toBe(true);

    unmount(component);
  });
});
