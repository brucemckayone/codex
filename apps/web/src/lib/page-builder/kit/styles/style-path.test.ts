// @vitest-environment node
/**
 * Path's stops (03 X24): each section's stop sits on the middle of its
 * heading's first line, so a stop's height is the words above it plus half
 * that line. X24 found two that sat above their headings, because they left
 * something out: a creator's eyebrow over the heading (41px above) and the
 * closing band's own padding (25px above). Nothing held the formulas to it, so
 * this does (Codex-61zsk.28).
 *
 * Read with svelte's own CSS parser, which drops the comments.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sheetRules } from '../blocks/testing';

const RULES = sheetRules(
  join(dirname(fileURLToPath(import.meta.url)), 'style-path.css')
);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Every declaration of one property, with the rule it sits in. */
const declared = (property: string) =>
  RULES.flatMap((rule) => {
    const value = rule.decls.get(property);
    return value === undefined ? [] : [{ rule, value: squash(value) }];
  });

/** The cover hero's words sit at the picture's foot, so its route sets out
 *  from there, not from a heading. Every other stop sits on one. */
const fromTheFoot = (selector: string) =>
  selector.includes("[data-lp-layout='cover']");

const EYEBROW = 'var(--_path-eyebrow, 0px)';
/** Half the first line of the words the stop sits on: their size, at their
 *  step, times their leading. */
const HALF_A_LINE =
  /var\(--lp-size-(heading|display|cta)\)( \* 0\.7)? \* var\(--lp-leading-(heading|display)\) \/ 2 ?\)$/;

describe('Path’s stops sit on their headings (03 X24)', () => {
  const onHeadings = declared('--_path-y').filter(
    ({ rule }) => !fromTheFoot(rule.selector)
  );

  it('reads the stop formulas it guards', () => {
    // The sections' own, the hero's, the split hero's and the closing band's.
    expect(onHeadings.length).toBeGreaterThanOrEqual(4);
    expect(
      declared('--_path-y').filter(({ rule }) => fromTheFoot(rule.selector))
    ).toHaveLength(1);
  });

  it('counts a creator’s eyebrow above every heading a stop sits on', () => {
    const blind = onHeadings
      .filter(({ value }) => !value.includes(EYEBROW))
      .map(({ rule }) => rule.selector);
    expect(blind).toEqual([]);
  });

  it('stops on the middle of the first line of the words it sits on', () => {
    const off = onHeadings
      .filter(({ value }) => !HALF_A_LINE.test(value))
      .map(({ rule, value }) => `${rule.selector}: ${value}`);
    expect(off).toEqual([]);
  });

  it('measures an eyebrow as one label line and the stack gap, wherever one heads a heading', () => {
    const eyebrows = declared('--_path-eyebrow');
    expect(eyebrows).toHaveLength(1);
    const [{ rule, value }] = eyebrows;
    expect(rule.selector).toContain(
      ':has(.lp-eyebrow + .lp-heading, .hero__eyebrow + .hero__headline)'
    );
    expect(value).toBe(
      'calc(var(--lp-size-label) * var(--lp-leading-title) + var(--lp-stack))'
    );
  });

  it('sets the closing band’s target below the band’s own padding, on the ask’s line', () => {
    const band = onHeadings.filter(({ rule }) =>
      rule.selector.includes(".cta[data-layout='band']")
    );
    expect(band).toHaveLength(1);
    expect(band[0].value).toContain('var(--space-4)');
    expect(band[0].value).toContain('var(--lp-size-cta)');
  });
});
