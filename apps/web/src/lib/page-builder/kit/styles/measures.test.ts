// @vitest-environment node
/**
 * A line's measure holds while the face loads (Codex-61zsk.64).
 *
 * `1ch` is the `0` of whatever font draws the line, and until the brand's
 * face lands that is its fallback's, so a measure in `ch` widened as the face
 * arrived and the block re-wrapped: 27 blocks on three sell pages, 22 of them
 * because their own width moved. So a measure counts the face's own `0`s: a
 * count (`--lp-measure`, or a number) times `--lp-measure-unit`, which each
 * face the kit draws sets from `styles/faces.css` (`styles/kit.css`).
 *
 * Every part of it fails silently. A `ch` brought back moves at the swap
 * again; a count used without the unit is no length, so the declaration is
 * invalid when computed and the line runs the width of its column; a zero
 * misspelt is never set; and a rule that draws its words in another face or
 * weight without its unit measures them in the body's. So each is held here.
 */
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type CssRule, componentRules, sheetRules } from '../blocks/testing';

const STYLES = dirname(fileURLToPath(import.meta.url));
const KIT = dirname(STYLES);

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : /\.(css|svelte)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : []
  );

type Placed = CssRule & { file: string };
const RULES: Placed[] = files(KIT).flatMap((path) =>
  (path.endsWith('.css') ? sheetRules(path) : componentRules(path)).map(
    (rule) => ({ ...rule, file: relative(KIT, path) })
  )
);
const DECLS = RULES.flatMap((rule) =>
  [...rule.decls].map(([property, value]) => ({ rule, property, value }))
);
const where = (rule: Placed) => `${rule.file}: ${rule.selector}`;

const UNIT = 'var(--lp-measure-unit)';
const isMeasured = (rule: Placed) =>
  (rule.decls.get('max-inline-size') ?? '').includes(UNIT);

describe('a line’s measure (Codex-61zsk.64)', () => {
  it('reads the rules it guards', () => {
    expect(RULES.filter(isMeasured).length).toBeGreaterThan(50);
  });

  it('is never in ch, which moves when the face lands', () => {
    // The unit's own default, where no face is known, is the only `ch`.
    const stray = DECLS.filter(
      ({ property, value }) =>
        /(^|[^\w.-])\d*\.?\d+ch\b/.test(value) &&
        !(
          (property === '--lp-measure-unit' ||
            property.startsWith('--lp-zero-')) &&
          value === '1ch'
        )
    ).map(
      ({ rule, property, value }) => `${where(rule)} ${property}: ${value}`
    );
    expect(stray).toEqual([]);
  });

  it('declares the measure tokens as counts', () => {
    const tokens = DECLS.filter(({ property }) =>
      /^--lp-measure(-lead)?$/.test(property)
    );
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    for (const { rule, property, value } of tokens)
      expect(value, `${where(rule)} ${property}`).toMatch(/^\d+$/);
  });

  it('multiplies every count it reads by the unit', () => {
    const bare = DECLS.filter(({ value }) =>
      /var\(--lp-measure(-lead)?\)(?! \* var\(--lp-measure-unit\))/.test(value)
    ).map(
      ({ rule, property, value }) => `${where(rule)} ${property}: ${value}`
    );
    expect(bare).toEqual([]);
  });

  it('reads only the zeros the kit declares', () => {
    const declared = new Set(
      DECLS.filter(({ property }) => property.startsWith('--lp-zero-')).map(
        ({ property }) => property
      )
    );
    const read = DECLS.flatMap(({ rule, value }) =>
      [...value.matchAll(/var\((--lp-zero-[\w-]+)\)/g)].map(([, token]) => ({
        rule,
        token: token ?? '',
      }))
    );
    expect(read.length).toBeGreaterThan(0);
    expect(
      read
        .filter(({ token }) => !declared.has(token))
        .map(({ rule, token }) => `${where(rule)} reads ${token}`)
    ).toEqual([]);
  });

  // Display, heading and title are drawn in the display face, body and label
  // in the body face, each at its own weight.
  it.each([
    ['display', 'display'],
    ['heading', 'display'],
    ['title', 'display'],
    ['body', 'body'],
    ['label', 'body'],
  ])('reckons the %s role in the %s face at its weight', (role, face) => {
    const section = RULES.find(
      (rule) =>
        rule.file === 'styles/kit.css' &&
        rule.selector === '.lp-section' &&
        rule.within.length === 0
    );
    expect(section?.decls.get(`--lp-zero-${role}`)).toBe(
      `calc(var(--lp-zero-${face}-400) + (var(--lp-zero-${face}-700) - var(--lp-zero-${face}-400)) * (clamp(400, var(--lp-weight-${role}), 700) - 400) / 300)`
    );
  });

  it('measures the rest of a section in the body’s zero', () => {
    const section = RULES.find(
      (rule) =>
        rule.file === 'styles/kit.css' &&
        rule.selector === '.lp-section' &&
        rule.within.length === 0
    );
    expect(section?.decls.get('--lp-measure-unit')).toBe('var(--lp-zero-body)');
  });

  it.each([
    'display',
    'heading',
    'title',
  ])('measures a %s heading in its own role', (size) => {
    const heading = RULES.find(
      (rule) =>
        rule.file === 'primitives/Heading.svelte' &&
        rule.selector === `.lp-heading[data-size='${size}']` &&
        rule.within.length === 0
    );
    expect(heading?.decls.get('--lp-measure-unit')).toBe(
      `var(--lp-zero-${size})`
    );
  });

  it('takes its unit wherever a rule sets the face or weight it measures', () => {
    const unitless = RULES.filter(
      (rule) =>
        isMeasured(rule) &&
        (rule.decls.has('font-family') || rule.decls.has('font-weight')) &&
        !rule.decls.has('--lp-measure-unit')
    ).map(where);
    expect(unitless).toEqual([]);
  });
});
