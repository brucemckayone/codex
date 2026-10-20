/**
 * The Type facet's guards (03 X73). A page may set its headlines in another
 * Style's Type, so a Style's type rules are keyed on the page's Type
 * (`[data-lp-type-facet='<id>']`, which the renderer always sets) and
 * everything else on its Style (`[data-lp-style='<id>']`). On a page that
 * borrows a Type, both match at once, so three things must hold or the
 * borrowed Type is decided by load order, or drawn by halves:
 *
 *   one key     a rule is keyed on the Type or on the Style, never both (a
 *               second key, if one is ever needed, sits inside `:where()`,
 *               which weighs nothing);
 *   the filing  a rule keyed on the Type declares only type, and a rule keyed
 *               on the Style declares none, but for the devices below;
 *   one owner   no token is declared by a Type's root and a Style's root.
 *
 * TYPE is how the words are set: their sizes, weights, case, tracking,
 * leading and hyphenation, a line's measure (a count of the face's own `0`s,
 * and the unit it counts in, `styles/kit.css`), the hero's fit
 * (`--lp-display-scale`, and a borrowed Type's factor, `--lp-type-fit`, X74)
 * and the heading fit's face and run (Heading.svelte).
 * Spacing stays the Style's, and so do a centred line's balance
 * (`text-wrap`), a title's lift (a layout's hook, Heading.svelte), a button
 * drawn as a link (`text-decoration`) and a light behind a title
 * (`text-shadow`).
 */
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type CssRule, componentRules, sheetRules } from '../blocks/testing';
import {
  PAGE_STYLE_IDS,
  type PageStyleId,
  TYPE_FACET_BASES,
  TYPE_FACETS,
} from '../model/ids';

const STYLES = dirname(fileURLToPath(import.meta.url));
const KIT = dirname(STYLES);

const TYPE_PROPERTY =
  /^(font|font-[a-z-]+|letter-spacing|line-height|text-transform|hyphens|hyphenate-[a-z-]+)$/;
const TYPE_TOKEN =
  /^--lp-(size|leading|tracking|weight|case|font)-|^--lp-(display-scale|type-fit|heading-face|heading-run)$|^--lp-button-(size|weight|tracking)$|^--lp-measure|^--_figure$/;

/** A line's measure: so many of the face's own `0`s (Codex-61zsk.64). */
const MEASURE = /^calc\(\d+(\.\d+)? \* var\(--lp-measure-unit\)\)$/;

/** A type declaration, as the header files it. */
function isType(property: string, value: string): boolean {
  if (property === 'max-inline-size') return MEASURE.test(value);
  return property.startsWith('--')
    ? TYPE_TOKEN.test(property)
    : TYPE_PROPERTY.test(property);
}

/**
 * A Style's devices that carry type and stay its own, whole: on a page that
 * borrows another Type they keep the Style's, and a borrowed Type brings
 * none of them (the data design's couplings, `type-facet/data-design.md`).
 */
const DEVICES: Record<
  string,
  { style: string; selector: RegExp; reason: string }
> = {
  H9: {
    style: 'bold',
    selector: /\.timeline__marker$/,
    reason:
      'the stage’s number is its block’s: the block’s size, the Type’s tracking token',
  },
  H10: {
    style: 'cinematic',
    selector: /\.story-scroll__step \.story-words::before$/,
    reason: 'the scroll story’s numerals are a mark in the display face',
  },
  H15: {
    style: 'poster',
    selector: /:is\(\.lp-eyebrow, \.offer__badge, \.tf-label\)$/,
    reason: 'the sticker is surface, type, colour and mark in one device',
  },
  figure: {
    style: 'poster',
    selector: /\.story-chapter__num$/,
    reason:
      'the chapter’s number is the poster’s big figure, a device as H10’s numerals are',
  },
};

const STYLE_KEY = /\[data-lp-style='(\w+)'\]/g;
const TYPE_KEY = /\[data-lp-type-facet='(\w+)'\]/g;
/** A selector without its `:where()` parts, which add no weight. */
const weighed = (selector: string) =>
  selector.replace(/:where\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, '');
const keys = (selector: string, key: RegExp) => [
  ...new Set([...weighed(selector).matchAll(key)].map((m) => m[1])),
];

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : /\.(css|svelte)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : []
  );

type Keyed = CssRule & { file: string; styles: string[]; types: string[] };
const RULES: Keyed[] = files(KIT).flatMap((path) =>
  (path.endsWith('.css') ? sheetRules(path) : componentRules(path)).map(
    (rule) => ({
      ...rule,
      file: relative(KIT, path),
      styles: keys(rule.selector, STYLE_KEY),
      types: keys(rule.selector, TYPE_KEY),
    })
  )
);
const where = (rule: Keyed) => `${rule.file}: ${rule.selector}`;
const device = (rule: Keyed) =>
  Object.entries(DEVICES).find(
    ([, d]) => rule.styles.includes(d.style) && d.selector.test(rule.selector)
  )?.[0];
const isRoot = (rule: Keyed, key: 'style' | 'type-facet', id: string) =>
  rule.selector === `.lp[data-lp-${key}='${id}']` && rule.within.length === 0;

describe('the Type facet’s keys (03 X73)', () => {
  it('reads the rules it guards', () => {
    expect(RULES.filter((r) => r.types.length).length).toBeGreaterThan(60);
    expect(RULES.filter((r) => r.styles.length).length).toBeGreaterThan(200);
  });

  it('keys every rule on the Type or on the Style, never both', () => {
    expect(
      RULES.filter((r) => r.styles.length && r.types.length).map(where)
    ).toEqual([]);
  });

  it('gives every Style a Type, and every Type a Style', () => {
    for (const id of PAGE_STYLE_IDS)
      expect(
        RULES.some((r) => isRoot(r, 'type-facet', id)),
        id
      ).toBe(true);
    for (const type of TYPE_FACETS) expect(PAGE_STYLE_IDS).toContain(type);
  });
});

describe('the Type facet’s filing (03 X73)', () => {
  it('declares nothing but type on a Type’s key', () => {
    const stray = RULES.filter((r) => r.types.length).flatMap((r) =>
      [...r.decls]
        .filter(([property, value]) => !isType(property, value))
        .map(([property]) => `${where(r)} sets ${property}`)
    );
    expect(stray).toEqual([]);
  });

  it('declares no type on a Style’s key, but for its devices', () => {
    const stray = RULES.filter((r) => r.styles.length && !device(r)).flatMap(
      (r) =>
        [...r.decls]
          .filter(([property, value]) => isType(property, value))
          .map(([property]) => `${where(r)} sets ${property}`)
    );
    expect(stray).toEqual([]);
  });

  it.each(
    Object.entries(DEVICES).map(([name, d]) => [name, d.style, d.reason])
  )('%s still names a rule of %s’s', (name, _, reason) => {
    expect(
      RULES.filter((r) => device(r) === name).map(where),
      reason
    ).not.toEqual([]);
  });
});

describe('one owner per token (03 X73)', () => {
  // A Type's root and a Style's root weigh the same, so a token both declare
  // would be decided by which sheet loads last.
  it('declares no token on both a Type’s root and a Style’s root', () => {
    const declared = (key: 'style' | 'type-facet') =>
      new Set(
        RULES.filter((r) =>
          PAGE_STYLE_IDS.some((id) => isRoot(r, key, id))
        ).flatMap((r) => [...r.decls.keys()])
      );
    const styles = declared('style');
    expect(
      [...declared('type-facet')].filter((token) => styles.has(token))
    ).toEqual([]);
  });
});

/**
 * A borrowed Type's fit (03 X74): a factor on its hero, measured per pair and
 * layout (`type-fit.spec.ts`), declared in the Type's sheet and keyed on the
 * Type with its base inside `:where()`, so it weighs what the Type's own rules
 * weigh and never reaches a page's own Type. A pair whose hero would need a
 * factor under the floor is not offered.
 */
const FIT_FLOOR = 0.85;
const BASE_KEY = /:where\(\[data-lp-style='(\w+)'\]\)/;
const HERO_COPY =
  /\.lp-section\[data-lp-type='hero'\] \.hero-(statement|split__copy|cover__copy|centered|poster):has\(> \.hero__headline\)$/;

describe('a borrowed Type’s fit (03 X74)', () => {
  const fits = RULES.filter((r) => r.decls.has('--lp-type-fit'));
  const baseOf = (rule: Keyed) =>
    rule.selector.match(BASE_KEY)?.[1] as PageStyleId | undefined;

  it('reads the factors it guards', () => {
    expect(fits.length).toBeGreaterThan(0);
  });

  it('fits only a pair the allow-list offers, in the Type’s sheet', () => {
    for (const rule of fits) {
      const base = baseOf(rule);
      expect(rule.types, where(rule)).toHaveLength(1);
      expect(base, where(rule)).toBeDefined();
      expect(base, where(rule)).not.toBe(rule.types[0]);
      expect(TYPE_FACET_BASES[base as PageStyleId], where(rule)).toContain(
        rule.types[0]
      );
      expect(rule.file, where(rule)).toBe(`styles/style-${rule.types[0]}.css`);
    }
  });

  it('only draws a hero smaller, where it is wide, on its words', () => {
    for (const rule of fits) {
      const fit = Number(rule.decls.get('--lp-type-fit'));
      expect(fit >= FIT_FLOOR && fit < 1, `${where(rule)}: ${fit}`).toBe(true);
      expect(rule.within, where(rule)).toEqual([
        '@container (min-width: 56rem)',
      ]);
      expect(rule.selector, where(rule)).toMatch(HERO_COPY);
    }
  });

  it('fits each pair and layout once', () => {
    const keys = fits.map(
      (r) =>
        `${r.types[0]} on ${baseOf(r)}: ${r.selector.match(HERO_COPY)?.[1]}`
    );
    expect(keys.length).toBe(new Set(keys).size);
  });
});
