/**
 * Builder top-bar brand link (Codex-a1tz6).
 *
 * WHY STRUCTURAL ASSERTIONS OVER A RENDERED COMPONENT. The two things that can
 * actually regress here are a wrong link target and a hardcoded colour, and
 * neither is observable in jsdom: the builder only mounts behind
 * `pageBuilder.isOpen` with a loaded draft, and jsdom does no layout and does
 * not implement the OKLCH/`color-mix` machinery the brand tokens are built from
 * (see journey-palette.test.ts for the same reasoning). Overflow behaviour is
 * verified by measuring the real bar in a browser, as PR #435 did.
 *
 * What each assertion protects, all of which are silent failures:
 *   1. the link targets the Portals INDEX, not /studio — the prototype
 *      contradicts itself here (`href="studio-journeys.html"` but
 *      `title="Studio home"`), so the resolved choice needs pinning or the next
 *      reader will "correct" it back from the title;
 *   2. the period is tinted from `--color-brand-primary`, NOT the prototype's
 *      literal `--st-gold: #cdb489` — the prototype sits in-repo at
 *      docs/design/course-journeys/prototype/builder.html, so copying its hex is
 *      the live risk, and it would pin one org's palette into shared chrome;
 *   3. the mark precedes the document title, which sets both the visual order
 *      and the tab order out of the builder;
 *   4. the period is `aria-hidden` — it is decoration, and screen readers
 *      otherwise announce the trailing stop.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE = readFileSync(join(HERE, '..', '+page.svelte'), 'utf8');

/** The `.jb__brand { … }` rule body, so assertions can't drift onto other rules. */
function brandRule(): string {
  const match = ROUTE.match(/\.jb__brand\s*\{([^}]*)\}/);
  if (!match) throw new Error('.jb__brand rule not found');
  return match[1];
}

/** The `.jb__brand span { … }` rule body — the period's own declarations. */
function brandSpanRule(): string {
  const match = ROUTE.match(/\.jb__brand\s+span\s*\{([^}]*)\}/);
  if (!match) throw new Error('.jb__brand span rule not found');
  return match[1];
}

describe('builder top bar — brand home link', () => {
  it('renders a brand link targeting the Portals index, not /studio', () => {
    const anchor = ROUTE.match(/<a\s+class="jb__brand"[^>]*>/);
    expect(anchor).not.toBeNull();
    expect(anchor?.[0]).toContain('href="/studio/journeys"');
    // Guard the near-miss the prototype's own title="Studio home" invites.
    expect(anchor?.[0]).not.toMatch(/href="\/studio"/);
  });

  it('reads "Studio." with the period marked decorative', () => {
    // The visible mark is Studio + a tinted stop; the accessible name is
    // "Studio", because a trailing full stop carries no meaning aloud.
    expect(ROUTE).toMatch(/Studio<span aria-hidden="true">\.<\/span>/);
  });

  it('tints the period from --color-brand-primary', () => {
    expect(brandSpanRule()).toContain('var(--color-brand-primary)');
  });

  it("hardcodes no colour — in particular not the prototype's --st-gold hex", () => {
    const css = `${brandRule()}${brandSpanRule()}`;
    // The prototype's fixed studio gold, sitting in-repo one directory away.
    expect(css.toLowerCase()).not.toContain('#cdb489');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgb\(|\bhsl\(/);
  });

  it('sizes and weights the mark from tokens, never raw units', () => {
    const css = brandRule();
    expect(css).toContain('var(--text-sm)');
    expect(css).toContain('var(--font-bold)');
    // The prototype's .82rem/.7rem values must not survive the translation.
    expect(css).not.toMatch(/\d+(\.\d+)?(px|rem|em)\b/);
  });

  it('places the mark before the document title, fixing visual and tab order', () => {
    const brandAt = ROUTE.indexOf('class="jb__brand"');
    const docAt = ROUTE.indexOf('class="jb__doc"');
    const barAt = ROUTE.indexOf('<header class="jb__top">');
    expect(brandAt).toBeGreaterThan(barAt);
    expect(brandAt).toBeLessThan(docAt);
  });

  it('does not import the builder chrome the brand link was scoped apart from', () => {
    // Codex-a1tz6 took ONLY the prototype's brand link. The gold uppercase
    // status pill would have removed the publish/unpublish affordance we ship
    // as a <select>, so that <select> must still be here.
    expect(ROUTE).toContain('class="jb__status"');
    expect(ROUTE).toContain('aria-label="Page status"');
  });
});
