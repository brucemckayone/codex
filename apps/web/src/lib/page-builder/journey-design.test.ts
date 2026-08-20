/**
 * The nine design axes (`journey-design.css`) and the two-pole palette refactor
 * that `surface: invert` depends on.
 *
 * WHY A TEST AND NOT A BROWSER CHECK. The axis CSS has no consumer yet — the 11
 * public sections adopt it one work package at a time — so nothing on a rendered
 * page moves when an axis value is wrong. The failure mode is silent by
 * construction: a value selectable in the builder that matches no CSS rule
 * renders with the axis default, and the creator sees a control that appears to
 * do nothing. That is exactly what a probe over the closed enums catches.
 *
 * The four things this file proves:
 *
 *   1. EVERY axis value in `SECTION_DESIGN_VALUES` has a rule, and the rule
 *      emits the properties research §2.3 specifies. The selector set is derived
 *      FROM the TypeScript enum, so adding an editor value without CSS fails
 *      here rather than shipping a dead control.
 *   2. `surface: invert` is cycle-free, measured rather than inspected: the whole
 *      ladder resolves to a real colour inside an inverted section nested in
 *      another inverted section.
 *   3. MEASURED CONTRAST across the dangerous combination set — `surface` ×
 *      `accent` × `type`, 100 combinations at both ink poles. Ratios are computed
 *      from the derivation the CSS actually declares (the formulas are string-
 *      asserted against the file, so the model cannot drift away from it), which
 *      is the same approach `journey-palette.test.ts` documents: jsdom implements
 *      neither `oklch(from …)` nor `color-mix()`, so a computed-style check would
 *      assert the string it was handed.
 *   4. `--tap-target-min` cannot be lowered below 44px by a brand density.
 *
 * The colour model is validated, not assumed: it reproduces every published
 * number in `docs/design/journey-sections/04-contrast-baseline.md` — measured in
 * Chrome via canvas `getImageData` readback — to within 0.03. The
 * `reproduces the measured browser baseline` test below is that check, and it is
 * what licenses every other ratio in this file.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SECTION_DESIGN_AXES,
  SECTION_DESIGN_DEFAULTS,
  SECTION_DESIGN_VALUES,
  type SectionDesignAxis,
} from './section-catalog';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

const DESIGN = read('journey-design.css');
const PALETTE = read('journey-palette.css');
const SPACING = read('../styles/tokens/spacing.css');
const ORG_BRAND = read('../styles/tokens/org-brand.css');
const TYPOGRAPHY = read('../styles/tokens/typography.css');
const SHARED = read('journey-sections-shared.css');

/** The nine per-type partials the 575-line canvas stylesheet was split into. */
const SECTION_PARTIAL_NAMES = [
  '_base',
  '_hero',
  '_prose',
  '_video',
  '_descent',
  '_proof',
  '_guide',
  '_faq',
  '_invite',
] as const;

// ── a minimal CSS rule reader ───────────────────────────────────────────────
// Enough for these files: strip comments, then walk brace depth so an @media /
// @container block's inner rules are reachable under a composed key.

const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, '');

const squash = (value: string): string => value.replace(/\s+/g, ' ').trim();

interface Rule {
  /** The selector, whitespace-squashed. */
  selector: string;
  /** `''` at top level, else the at-rule preludes joined by ` `. */
  at: string;
  declarations: Record<string, string>;
}

function parseRules(css: string): Rule[] {
  const src = stripComments(css);
  const rules: Rule[] = [];
  const atStack: string[] = [];
  let i = 0;
  let buffer = '';

  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      const prelude = squash(buffer);
      buffer = '';
      if (prelude.startsWith('@')) {
        atStack.push(prelude);
        i += 1;
        continue;
      }
      // A style rule: consume to its matching close brace.
      let depth = 1;
      let body = '';
      i += 1;
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
        body += src[i];
        i += 1;
      }
      i += 1;
      const declarations: Record<string, string> = {};
      for (const part of body.split(';')) {
        const at = part.indexOf(':');
        if (at < 0) continue;
        const prop = part.slice(0, at).trim();
        if (!prop) continue;
        declarations[prop] = squash(part.slice(at + 1));
      }
      rules.push({ selector: prelude, at: atStack.join(' '), declarations });
      continue;
    }
    if (ch === '}') {
      atStack.pop();
      buffer = '';
      i += 1;
      continue;
    }
    if (ch === ';' && buffer.trim().startsWith('@')) {
      // A statement at-rule (`@import …;`) — not a block.
      buffer = '';
      i += 1;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  return rules;
}

const DESIGN_RULES = parseRules(DESIGN);

const ruleFor = (selector: string, at = ''): Rule | undefined =>
  DESIGN_RULES.find((r) => r.selector === selector && r.at === at);

/** Declarations of one property from a stylesheet, comments stripped first. */
const declarationsOf = (css: string, prop: string): string[] => {
  const code = stripComments(css);
  const out: string[] = [];
  const re = new RegExp(`(^|[;{\\s])${prop}\\s*:([^;}]*)`, 'g');
  for (const m of code.matchAll(re)) out.push(squash(m[2]));
  return out;
};

// ═══════════════════════════════════════════════════════════════════════════
// 0. STYLESHEET INTEGRITY — the bug class that 500s SSR from a comment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CSS COMMENTS DO NOT NEST, and the failure is silent until it is catastrophic.
 *
 * Caught in this branch: a comment explaining the WRONG way to write
 * `surface: invert` quoted the bad declaration and tagged it with an inline
 * `/·* WRONG *·/`. The comment's first `*·/` is its terminator, so everything
 * after it — three paragraphs of prose — became CSS. The dev server returned
 * HTTP 500 on the journey page with no message, and every one of the four gates
 * (`check:ci`, both brand-boundary checks, `typecheck`, the whole vitest suite)
 * stayed green, because none of them parse CSS.
 *
 * This matters well beyond one typo: the seven component work packages are about
 * to edit nine heavily-commented partials, and these files document their own
 * traps by QUOTING declarations. So the check is here rather than in a one-off
 * script.
 *
 * The invariant, after stripping comments with the real first-terminator rule:
 * no `*·/` may remain, and braces must balance. A stray terminator means a
 * comment closed early; imbalanced braces mean prose leaked into a block.
 */
const JOURNEY_STYLESHEETS = [
  'journey-palette.css',
  'journey-design.css',
  'journey-sections-shared.css',
  'render-edit/journey-sections.css',
  ...SECTION_PARTIAL_NAMES.map((n) => `render-edit/journey-sections/${n}.css`),
  '../styles/tokens/spacing.css',
  '../styles/tokens/typography.css',
  '../styles/tokens/org-brand.css',
];

/** Strip comments the way a CSS parser does: the FIRST `*<slash>` terminates. */
function stripCssComments(css: string): {
  code: string;
  unterminated: boolean;
} {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      if (end < 0) return { code: out, unterminated: true };
      i = end + 2;
    } else {
      out += css[i];
      i += 1;
    }
  }
  return { code: out, unterminated: false };
}

describe.each(JOURNEY_STYLESHEETS)('%s parses as CSS', (rel) => {
  it('has no comment that closes early, and balanced braces', () => {
    const { code, unterminated } = stripCssComments(read(rel));
    expect(unterminated, 'unterminated comment').toBe(false);

    const stray = code.indexOf('*/');
    expect(
      stray,
      stray < 0
        ? ''
        : `a comment closed early — the prose after it is being parsed as CSS:\n  ...${code
            .slice(Math.max(0, stray - 90), stray + 40)
            .replace(/\s+/g, ' ')}`
    ).toBe(-1);

    const open = (code.match(/\{/g) ?? []).length;
    const close = (code.match(/\}/g) ?? []).length;
    expect(open, 'brace imbalance').toBe(close);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE PROBE HARNESS — every axis value has a rule, and it emits the spec
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Research §2.3, transcribed. Keys are `<axis>:<value>`, values are the exact
 * property set that value must declare.
 *
 * This is not a restatement of the CSS. The SET of keys is derived from
 * `SECTION_DESIGN_VALUES` in the test below, so an axis value that exists in the
 * editor enum and not here fails; and the property NAMES are what stop a value
 * from silently omitting one and inheriting a sibling's.
 */
const AXIS_SPEC: Record<string, Record<string, string>> = {
  'width:narrow': {
    '--jp-content-max': '48rem',
    '--jp-measure': 'var(--measure-narrow)',
  },
  'width:text': {
    '--jp-content-max': '64rem',
    '--jp-measure': 'var(--measure-lede)',
  },
  'width:wide': {
    '--jp-content-max': 'var(--container-max)',
    '--jp-measure': 'var(--measure-wide)',
  },
  'width:full': {
    '--jp-content-max': '100%',
    '--jp-measure': 'var(--measure-wide)',
  },

  'density:compact': { '--jp-rhythm': '0.75' },
  'density:regular': { '--jp-rhythm': '1' },
  'density:airy': { '--jp-rhythm': '1.25' },
  'density:vast': { '--jp-rhythm': '1.6' },

  'surface:bare': { '--jp-sec-bg': 'transparent', '--jp-sec-pad-inline': '0' },
  // `tint` and `panel` re-point `--jp-ink` rather than painting `--jp-ink-2/3`
  // directly. The painted colour is identical — outside `invert`, `--jp-heading`
  // is `autoContrast(--jp-ink)` and `--jp-pole-b` is `autoContrast(--jp-pole-a)`
  // by the same formula, and `--jp-ink` IS `--jp-pole-a` — but re-pointing makes
  // the whole text ladder re-derive against the LIFTED surface. Painting the lift
  // without re-anchoring dropped `--jp-faint` to 4.43 / 4.17 in dark, which is
  // research §5.2's "vanishing card" and §5.1's "must re-derive, never hardcode".
  // Spelled in POLES because `--jp-ink: var(--jp-ink-2)` would be a cycle.
  'surface:tint': {
    '--jp-ink':
      'color-mix(in oklab, var(--jp-pole-a) 94%, var(--jp-pole-b) 6%)',
    '--jp-sec-bg': 'var(--jp-ink)',
  },
  'surface:panel': {
    '--jp-ink':
      'color-mix(in oklab, var(--jp-pole-a) 88%, var(--jp-pole-b) 12%)',
    '--jp-sec-bg': 'var(--jp-ink)',
    '--jp-sec-radius': 'var(--radius-card)',
  },
  // `--jp-sec-bg` is an addition to §2.3 — without it invert flips the text and
  // paints nothing, i.e. bone-on-cream. See the rule's comment in the CSS.
  'surface:invert': {
    '--jp-ink': 'var(--jp-pole-b)',
    '--jp-sec-bg': 'var(--jp-ink)',
  },
  'surface:media': { '--jp-sec-bg': 'transparent', '--jp-sec-atmos': '1' },

  'edge:none': { '--jp-edge-width': '0', '--jp-edge-shadow': 'none' },
  'edge:hairline': {
    '--jp-edge-width': 'var(--border-width)',
    '--jp-edge-color': 'var(--jp-line)',
    '--jp-edge-shadow': 'var(--shadow-xs)',
  },
  'edge:soft': {
    '--jp-edge-width': '0',
    '--jp-edge-shadow': 'var(--shadow-lg)',
  },
  'edge:heavy': {
    '--jp-edge-width': 'var(--border-width-thick)',
    '--jp-edge-color': 'var(--jp-accent-edge)',
    '--jp-edge-shadow': 'none',
  },
  'edge:offset': {
    '--jp-edge-width': 'var(--border-width-thick)',
    '--jp-edge-color': 'var(--jp-line-strong)',
    '--jp-edge-shadow':
      'var(--space-1) var(--space-1) 0 0 var(--jp-line-strong)',
  },

  'align:start': {
    '--jp-align': 'start',
    '--jp-text-align': 'left',
    '--jp-measure-margin': '0',
  },
  'align:center': {
    '--jp-align': 'center',
    '--jp-text-align': 'center',
    '--jp-measure-margin': 'auto',
  },

  'type:restrained': {
    '--jp-display': 'var(--text-2xl)',
    '--jp-heading-size': 'var(--text-xl)',
    '--jp-display-leading': 'var(--leading-snug)',
    '--jp-display-tracking': 'var(--tracking-normal)',
  },
  'type:balanced': {
    '--jp-display': 'var(--text-4xl)',
    '--jp-heading-size': 'var(--text-2xl)',
    '--jp-display-leading': 'var(--leading-tight)',
    '--jp-display-tracking': 'var(--tracking-normal)',
  },
  'type:expressive': {
    '--jp-display': 'var(--text-5xl)',
    '--jp-heading-size': 'var(--text-3xl)',
    '--jp-display-leading': 'var(--leading-tight)',
    '--jp-display-tracking': 'var(--tracking-tight)',
  },
  'type:monumental': {
    '--jp-display': 'var(--text-display)',
    '--jp-heading-size': 'var(--text-4xl)',
    '--jp-display-leading': 'var(--leading-none)',
    '--jp-display-tracking': 'var(--tracking-tighter)',
  },

  // `--jp-accent-mark` was added after the WT-3 pilot measured a real hole:
  // `--jp-accent-fill` is `transparent` on `text` and `edge`, so a small
  // decorative brand mark (the hero's trust dot, its motes, its cue spark) had
  // nothing to paint with and VANISHED on two of five values. A mark is closer to
  // text than to a fill, so it carries the accent hue and neutralises to
  // `--jp-heading` at `accent: none` — never `transparent`, on any value. WT-4's
  // spine + gate nodes and WT-5/WT-7's accent dots consume it too.
  'accent:text': {
    '--jp-accent-text': 'var(--jp-ember-text)',
    '--jp-accent-fill': 'transparent',
    '--jp-accent-mark': 'var(--jp-ember-text)',
    '--jp-accent-edge': 'var(--jp-line)',
    '--jp-accent-glow': 'none',
  },
  'accent:fill': {
    '--jp-accent-text': 'var(--jp-ember-text)',
    '--jp-accent-fill': 'var(--jp-ember)',
    '--jp-accent-on-fill': 'var(--jp-on-ember)',
    '--jp-accent-mark': 'var(--jp-ember-text)',
    '--jp-accent-edge': 'var(--jp-ember)',
    '--jp-accent-glow': 'none',
  },
  'accent:edge': {
    '--jp-accent-text': 'var(--jp-text)',
    '--jp-accent-fill': 'transparent',
    '--jp-accent-mark': 'var(--jp-ember-text)',
    '--jp-accent-edge': 'var(--jp-ember)',
    '--jp-accent-glow': 'none',
  },
  'accent:glow': {
    '--jp-accent-text': 'var(--jp-ember-text)',
    '--jp-accent-fill': 'var(--jp-ember)',
    '--jp-accent-on-fill': 'var(--jp-on-ember)',
    '--jp-accent-mark': 'var(--jp-ember-text)',
    '--jp-accent-edge': 'color-mix(in oklab, var(--jp-ember) 45%, transparent)',
    '--jp-accent-glow':
      '0 var(--space-6) var(--space-14) calc(var(--space-10) * -1) var(--jp-blood)',
  },
  'accent:none': {
    '--jp-accent-text': 'var(--jp-heading)',
    '--jp-accent-fill': 'var(--jp-ink-4)',
    '--jp-accent-on-fill': 'var(--jp-heading)',
    '--jp-accent-mark': 'var(--jp-heading)',
    '--jp-accent-edge': 'var(--jp-line)',
    '--jp-accent-glow': 'none',
  },

  'motion:none': {
    '--jp-reveal-distance': '0',
    '--jp-reveal-duration': '0ms',
    '--jp-reveal-stagger': '0ms',
    '--jp-reveal-ease': 'linear',
  },
  'motion:fade': {
    '--jp-reveal-distance': '0',
    '--jp-reveal-duration': 'var(--duration-slower)',
    '--jp-reveal-stagger': '0ms',
    '--jp-reveal-ease': 'var(--ease-out)',
  },
  'motion:rise': {
    '--jp-reveal-distance': 'var(--space-4)',
    '--jp-reveal-duration': 'var(--duration-slow)',
    '--jp-reveal-stagger': 'var(--duration-fast)',
    '--jp-reveal-ease': 'var(--ease-out)',
  },
  'motion:stagger': {
    '--jp-reveal-distance': 'var(--space-6)',
    '--jp-reveal-duration': 'var(--duration-slow)',
    '--jp-reveal-stagger': 'var(--duration-normal)',
    '--jp-reveal-ease': 'var(--ease-spring)',
  },
  'motion:drift': {
    '--jp-reveal-distance': 'var(--space-8)',
    '--jp-reveal-duration': 'var(--duration-slowest)',
    '--jp-reveal-stagger': 'var(--duration-normal)',
    '--jp-reveal-ease': 'var(--ease-smooth)',
  },

  'media:bleed': {
    '--jp-media-radius': '0',
    '--jp-media-inset': '0',
    '--jp-media-aspect': '21 / 9',
    '--jp-media-scrim':
      'linear-gradient(to top, var(--jp-ink), transparent 62%)',
    '--jp-media-mask': 'none',
  },
  'media:frame': {
    '--jp-media-radius': 'var(--radius-lg)',
    '--jp-media-inset': '0',
    '--jp-media-aspect': '16 / 9',
    '--jp-media-scrim': 'none',
    '--jp-media-mask': 'none',
  },
  'media:mask': {
    '--jp-media-radius': 'var(--radius-xl)',
    '--jp-media-inset': '0',
    '--jp-media-aspect': '4 / 5',
    '--jp-media-scrim': 'none',
    '--jp-media-mask':
      'inset( 0 round 48% 48% var(--radius-xl) var(--radius-xl) / 34% 34% var(--radius-xl) var(--radius-xl) )',
  },
  'media:inset': {
    '--jp-media-radius': 'var(--radius-none)',
    '--jp-media-inset': 'var(--space-12)',
    '--jp-media-aspect': '3 / 2',
    '--jp-media-scrim': 'none',
    '--jp-media-mask': 'none',
  },
  'media:none': { '--jp-media-display': 'none' },
};

/** Every `<axis>:<value>` the editor can produce, from the ONE source of truth. */
const ALL_AXIS_VALUES: { axis: SectionDesignAxis; value: string }[] =
  SECTION_DESIGN_AXES.flatMap((axis) =>
    SECTION_DESIGN_VALUES[axis].map((value) => ({ axis, value: String(value) }))
  );

describe('journey-design.css — the axis probe', () => {
  it('covers all 39 axis values and nothing else', () => {
    // 4 width + 4 density + 5 surface + 5 edge + 2 align + 4 type + 5 accent +
    // 5 motion + 5 media. Research §2.1 says "38 CSS rules"; the enums it
    // defines in §2.2 sum to 39, so the doc's total is one short of its own
    // table. 39 is the number.
    expect(ALL_AXIS_VALUES).toHaveLength(39);
    expect(Object.keys(AXIS_SPEC).sort()).toEqual(
      ALL_AXIS_VALUES.map(({ axis, value }) => `${axis}:${value}`).sort()
    );
  });

  it.each(
    ALL_AXIS_VALUES
  )('$axis: $value emits exactly its specified properties', ({
    axis,
    value,
  }) => {
    const selector = `[data-jp-${axis}='${value}']`;
    const rule = ruleFor(selector);
    // The failure this catches: a value selectable in the design panel that
    // matches NO rule. It renders with the axis default, so the page looks
    // fine and the control looks broken.
    expect(rule, `no rule for ${selector}`).toBeDefined();

    const spec = AXIS_SPEC[`${axis}:${value}`];
    // Exact property set, not a subset: a value that forgets one of its
    // properties inherits whatever a sibling value left behind, which is how a
    // `soft` edge ends up with a hairline's border colour.
    expect(Object.keys(rule?.declarations ?? {}).sort()).toEqual(
      Object.keys(spec).sort()
    );
    for (const [prop, want] of Object.entries(spec)) {
      expect(rule?.declarations[prop], `${selector} ${prop}`).toBe(want);
    }
  });

  it('writes ONLY custom properties — no axis value paints', () => {
    // The constraint that holds the file at 39 rules and keeps it out of a
    // specificity war with the sections' scoped styles. One `padding` here and
    // some section needs to out-specify it.
    for (const { axis, value } of ALL_AXIS_VALUES) {
      const rule = ruleFor(`[data-jp-${axis}='${value}']`);
      for (const prop of Object.keys(rule?.declarations ?? {})) {
        expect(prop.startsWith('--'), `${axis}:${value} sets ${prop}`).toBe(
          true
        );
      }
    }
  });

  it('gives every axis property a default, so no section reads an unset value', () => {
    // The canvas tree renders `.jp-sec` with NO `data-jp-*` attributes at all
    // (contract A16 keeps the trees separate until consolidation). A section
    // reading `calc(var(--space-6) * var(--jp-rhythm))` against an unset
    // property goes invalid-at-computed-value-time and loses its padding.
    const defaults = ruleFor(':where(.jp-sec)');
    expect(defaults).toBeDefined();
    const declared = new Set(Object.keys(defaults?.declarations ?? {}));

    const missing = new Set<string>();
    for (const spec of Object.values(AXIS_SPEC)) {
      for (const prop of Object.keys(spec)) {
        // `--jp-ink` is the palette's, not an axis default: `surface: invert`
        // re-points it and the base value has to keep coming from the palette
        // root, or the section would stop following the page background.
        if (prop === '--jp-ink') continue;
        if (!declared.has(prop)) missing.add(prop);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it('puts the defaults at specificity zero so axis order cannot matter', () => {
    // `:where()` — without it the defaults and every axis rule are both (0,1,0)
    // and correctness depends on the order the blocks happen to sit in, which
    // survives until someone alphabetises the file.
    expect(DESIGN).toContain(':where(.jp-sec) {');
    expect(ruleFor('.jp-sec')).toBeUndefined();
  });

  it('resolves every axis DEFAULT to the same value its named rule emits', () => {
    // `SECTION_DESIGN_DEFAULTS` (TypeScript) and the `:where(.jp-sec)` block
    // (CSS) are two hand-written statements of the same defaults. They drift
    // silently: the CSS default only ever shows on the canvas tree, so a
    // mismatch is invisible on the public page.
    const defaults = ruleFor(':where(.jp-sec)')?.declarations ?? {};
    for (const axis of SECTION_DESIGN_AXES) {
      const spec = AXIS_SPEC[`${axis}:${SECTION_DESIGN_DEFAULTS[axis]}`];
      for (const [prop, want] of Object.entries(spec)) {
        if (prop === '--jp-ink') continue;
        // `surface: bare` zeroes `--jp-sec-pad-inline`; the shared default is
        // the padded value every OTHER surface uses, so this one legitimately
        // differs. Assert it is the documented pair rather than skipping it.
        if (prop === '--jp-sec-pad-inline') {
          expect(want).toBe('0');
          expect(defaults[prop]).toContain('--space-');
          continue;
        }
        expect(defaults[prop], `default ${axis} → ${prop}`).toBe(want);
      }
    }
  });
});

describe('journey-design.css — the accessibility floors that are structural', () => {
  it('never resolves accent TEXT to --jp-ember', () => {
    // Measured 2.04:1 in dark on the golden org and 8.49:1 in light, so a
    // light-theme check passes it. The research calls this the single most
    // likely regression in the programme; `--jp-ember-text` is 5.40 / 13.93.
    for (const value of SECTION_DESIGN_VALUES.accent) {
      const rule = ruleFor(`[data-jp-accent='${value}']`);
      expect(rule?.declarations['--jp-accent-text']).not.toBe(
        'var(--jp-ember)'
      );
    }
    expect(
      ruleFor(':where(.jp-sec)')?.declarations['--jp-accent-text']
    ).not.toBe('var(--jp-ember)');
  });

  it('keeps the CTA a filled control even at accent: none', () => {
    // The luxury-minimal signature failure: remove the last colour cue and a
    // price-bearing CTA becomes indistinguishable from body text.
    const none = ruleFor("[data-jp-accent='none']")?.declarations ?? {};
    expect(none['--jp-accent-fill']).toBe('var(--jp-ink-4)');
    expect(none['--jp-accent-fill']).not.toBe('transparent');
  });

  it('ships a scrim on media: bleed and on no other media value', () => {
    // Aspect and scrim are coupled: `bleed`'s 21:9 and its 62% stop are tuned
    // together, and any composition placing text over media must use `bleed`.
    for (const value of SECTION_DESIGN_VALUES.media) {
      const scrim =
        ruleFor(`[data-jp-media='${value}']`)?.declarations[
          '--jp-media-scrim'
        ] ?? 'none';
      if (value === 'bleed') expect(scrim).toContain('linear-gradient');
      else expect(scrim).toBe('none');
    }
  });

  it('neutralises the reveal DISTANCE under reduced motion, above the axis rules', () => {
    // `--duration-*` already collapse to 0.01ms, which handles timing. This is
    // the other half: a 0.01ms animation to a translated end state still moves
    // the element — it just jumps. Speeding an animation up is not stopping it.
    const guard = DESIGN_RULES.filter(
      (r) => r.at === '@media (prefers-reduced-motion: reduce)'
    );
    expect(guard.length).toBeGreaterThan(0);
    const zeroed = guard.find(
      (r) => r.declarations['--jp-reveal-distance'] === '0'
    );
    expect(zeroed, 'no reduced-motion --jp-reveal-distance: 0').toBeDefined();
    // The motion axis rules are (0,1,0), so the guard has to out-specify them on
    // the same element — a bare attribute selector would only tie and would lose
    // on source order if the file were ever reordered.
    expect(zeroed?.selector).toContain('.jp-sec[data-jp-motion]');
    expect(zeroed?.declarations['--jp-reveal-stagger']).toBe('0ms');
  });

  it('stops keyframe animations rather than accelerating them', () => {
    // The shared public layer carries the kill switch the 11 sections each wrote
    // their own version of. `!important` is required: it has to beat the
    // `animation` shorthands the sections set on themselves.
    const shared = parseRules(SHARED).filter(
      (r) => r.at === '@media (prefers-reduced-motion: reduce)'
    );
    expect(shared.length).toBeGreaterThan(0);
    expect(
      shared.some((r) => r.declarations.animation === 'none !important')
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. --tap-target-min — a floor a brand setting can lower is not a floor
// ═══════════════════════════════════════════════════════════════════════════

describe('--tap-target-min (contract A2)', () => {
  const FORMULA = 'max(2.75rem, var(--space-11))';

  it('is declared at :root AND at org scope, with the same formula', () => {
    // R12: `--space-11` derives from `--space-unit`, so a `:root` declaration
    // substitutes it ONCE against density 1 and descendants inherit the resolved
    // length — the org's density never reaches it without the twin. And a token
    // declared ONLY at org scope is unset on every platform route.
    expect(declarationsOf(SPACING, '--tap-target-min')).toEqual([FORMULA]);
    expect(declarationsOf(ORG_BRAND, '--tap-target-min')).toEqual([FORMULA]);
  });

  it('does not fall below 44px at a sub-1 brand density', () => {
    // The bug the contract corrects. Research §2.5 spelled this
    // `var(--space-11)` and called it "44px x density"; that multiplication is
    // what makes a WCAG 2.5.5 floor brand-dependent.
    const spaceUnitPx = (density: number) => 0.25 * 16 * density;
    const space11 = (density: number) => spaceUnitPx(density) * 11;
    const resolved = (density: number) => Math.max(2.75 * 16, space11(density));

    // What the research's spelling would have produced.
    expect(space11(0.9)).toBeCloseTo(39.6, 5);
    expect(space11(0.8)).toBeCloseTo(35.2, 5);

    // What `max()` produces: density may only ever make the target LARGER.
    for (const density of [0.7, 0.8, 0.9, 0.95, 1]) {
      expect(resolved(density), `density ${density}`).toBe(44);
    }
    expect(resolved(1.25)).toBeCloseTo(55, 5);
    expect(resolved(1.5)).toBeCloseTo(66, 5);
  });

  it('declares the two new measures at :root, where a ch value belongs', () => {
    // `ch` tracks the element's own font-size, so unlike every `--text-*` step
    // these need no `--brand-text-scale` re-declaration at org scope.
    expect(declarationsOf(TYPOGRAPHY, '--measure-narrow')).toEqual(['46ch']);
    expect(declarationsOf(TYPOGRAPHY, '--measure-wide')).toEqual(['78ch']);
    expect(declarationsOf(ORG_BRAND, '--measure-narrow')).toEqual([]);
    expect(declarationsOf(ORG_BRAND, '--measure-wide')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The colour model — and the string assertions that keep it honest
// ═══════════════════════════════════════════════════════════════════════════

type Oklab = readonly [number, number, number];
type LinRgb = readonly [number, number, number];

const srgbToLin = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

function hexToLin(hex: string): LinRgb {
  const h = hex.replace('#', '');
  const at = (i: number) => srgbToLin(parseInt(h.slice(i, i + 2), 16) / 255);
  return [at(0), at(2), at(4)];
}

function linToOklab([r, g, b]: LinRgb): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLin([L, a, b]: Oklab): LinRgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const hex = (h: string): Oklab => linToOklab(hexToLin(h));

/** `color-mix(in oklab, a p%, b)` — both opaque, so a plain component lerp. */
const mix = (a: Oklab, b: Oklab, p: number): Oklab => [
  a[0] * p + b[0] * (1 - p),
  a[1] * p + b[1] * (1 - p),
  a[2] * p + b[2] * (1 - p),
];

/**
 * `oklch(from <c> clamp(0.05, (<pivot> - l) * 100, <ceil>) calc(c * <k>) h)` —
 * the auto-contrast step function `--jp-heading` and `--jp-pole-b` share.
 */
function autoContrast(
  base: Oklab,
  pivot: number,
  ceil: number,
  chromaScale: number
): Oklab {
  const [L, a, b] = base;
  const C = Math.hypot(a, b);
  const H = Math.atan2(b, a);
  const L2 = Math.min(ceil, Math.max(0.05, (pivot - L) * 100));
  const C2 = C * chromaScale;
  return [L2, C2 * Math.cos(H), C2 * Math.sin(H)];
}

/** `oklch(from <c> clamp(0.05, (0.6 - l) * 100, 0.98) 0 0)` — chroma zeroed. */
function autoContrastGrey(base: Oklab, pivot: number, ceil: number): Oklab {
  const L2 = Math.min(ceil, Math.max(0.05, (pivot - base[0]) * 100));
  return [L2, 0, 0];
}

const relLum = (lin: LinRgb): number =>
  0.2126 * Math.min(1, Math.max(0, lin[0])) +
  0.7152 * Math.min(1, Math.max(0, lin[1])) +
  0.0722 * Math.min(1, Math.max(0, lin[2]));

function ratio(fg: Oklab, bg: Oklab): number {
  const a = relLum(oklabToLin(fg));
  const b = relLum(oklabToLin(bg));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** The whole `--jp-*` ladder, derived from one ink exactly as the CSS does. */
interface Ladder {
  ink: Oklab;
  heading: Oklab;
  ink2: Oklab;
  ink3: Oklab;
  ink4: Oklab;
  text: Oklab;
  dim: Oklab;
  faint: Oklab;
  lineSubtle: Oklab;
  line: Oklab;
  lineStrong: Oklab;
  lineHover: Oklab;
  ember: Oklab;
  emberText: Oklab;
  onEmber: Oklab;
}

function ladderFrom(ink: Oklab, ember: Oklab): Ladder {
  const heading = autoContrast(ink, 0.62, 0.96, 0.25);
  return {
    ink,
    heading,
    ink2: mix(ink, heading, 0.94),
    ink3: mix(ink, heading, 0.88),
    ink4: mix(ink, heading, 0.82),
    text: mix(heading, ink, 0.82),
    dim: mix(heading, ink, 0.7),
    faint: mix(heading, ink, 0.58),
    lineSubtle: mix(ink, heading, 0.88),
    line: mix(ink, heading, 0.8),
    lineStrong: mix(ink, heading, 0.68),
    lineHover: mix(ink, heading, 0.56),
    ember,
    emberText: mix(ember, heading, 0.55),
    onEmber: autoContrastGrey(ember, 0.6, 1),
  };
}

describe('the colour model matches the CSS it claims to model', () => {
  /**
   * Every formula the model implements, asserted against the stylesheet. Without
   * this the model is a second, independent derivation that can silently drift
   * from the palette — and then every ratio below measures a page that does not
   * exist.
   */
  const FORMULAS: [string, string][] = [
    ['--jp-pole-a', 'var(--brand-bg, var(--color-background))'],
    [
      '--jp-pole-b',
      'oklch( from var(--jp-pole-a) clamp(0.05, (0.62 - l) * 100, 0.96) calc(c * 0.25) h )',
    ],
    ['--jp-ink', 'var(--jp-pole-a)'],
    [
      '--jp-heading',
      'oklch( from var(--jp-ink) clamp(0.05, (0.62 - l) * 100, 0.96) calc(c * 0.25) h )',
    ],
    [
      '--jp-ink-2',
      'color-mix(in oklab, var(--jp-ink) 94%, var(--jp-heading) 6%)',
    ],
    [
      '--jp-ink-3',
      'color-mix(in oklab, var(--jp-ink) 88%, var(--jp-heading) 12%)',
    ],
    [
      '--jp-ink-4',
      'color-mix(in oklab, var(--jp-ink) 82%, var(--jp-heading) 18%)',
    ],
    ['--jp-text', 'color-mix(in oklab, var(--jp-heading) 82%, var(--jp-ink))'],
    ['--jp-dim', 'color-mix(in oklab, var(--jp-heading) 70%, var(--jp-ink))'],
    ['--jp-faint', 'color-mix(in oklab, var(--jp-heading) 58%, var(--jp-ink))'],
    [
      '--jp-line',
      'color-mix(in oklab, var(--jp-ink) 80%, var(--jp-heading) 20%)',
    ],
    [
      '--jp-ember-text',
      'color-mix(in oklab, var(--jp-ember) 55%, var(--jp-heading))',
    ],
    [
      '--jp-on-ember',
      // Ceiling 1, not 0.98 — `Codex-g7ipk`. See the note on `KNOWN_OPEN`.
      'oklch(from var(--jp-ember) clamp(0.05, (0.6 - l) * 100, 1) 0 0)',
    ],
  ];

  it.each(
    FORMULAS
  )('%s is still the formula the model implements', (prop, want) => {
    expect(declarationsOf(PALETTE, prop)).toContain(want);
  });

  it('reproduces the measured browser baseline', () => {
    // `docs/design/journey-sections/04-contrast-baseline.md`, measured in Chrome
    // via canvas `getImageData` readback on `of-blood-and-bones`. The dim/text
    // rows are unchanged by this work, so they are the control: if the model can
    // reproduce them it can be trusted for the sweep below. `--jp-faint` is
    // excluded here because this branch is the change to it.
    const light = ladderFrom(hex('#F6EFE6'), hex('#552e8e'));
    const dark = ladderFrom(hex('#200000'), hex('#552e8e'));
    // ONLY rungs this branch leaves alone — otherwise the check would be
    // validating the model against numbers the change invalidated. `--jp-faint`
    // (50% → 58%) and `--jp-ember-text` (60% → 55%) are therefore absent; their
    // before-values are locked in the two tests below instead, computed with the
    // OLD ratio so the fix is proved to move them rather than just asserted.
    const table: [string, number, number, number][] = [
      // role, doc light, doc dark, tolerance
      ['heading', 18.38, 17.51, 0.1],
      ['text', 15.41, 11.04, 0.1],
      ['dim', 11.05, 7.79, 0.1],
      ['ember', 8.49, 2.04, 0.1],
      ['line', 1.79, 1.49, 0.05],
    ];
    for (const [role, wantLight, wantDark, tol] of table) {
      const key = role as keyof Ladder;
      expect(
        ratio(light[key], light.ink),
        `${role} light (doc ${wantLight})`
      ).toBeCloseTo(wantLight, -Math.log10(tol * 2));
      expect(
        ratio(dark[key], dark.ink),
        `${role} dark (doc ${wantDark})`
      ).toBeCloseTo(wantDark, -Math.log10(tol * 2));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. surface: invert — cycle-free, proved by resolving the ladder
// ═══════════════════════════════════════════════════════════════════════════

describe('the model matches the BROWSER on the surface axis', () => {
  /**
   * Measured in Chrome on the golden page (`of-blood-and-bones` →
   * `/journeys/pricing-smoke-test`), canvas `getImageData` readback, theme flipped
   * by setting BOTH `data-theme="dark"` and the `.dark` class. Each section was a
   * real `.jp-sec` with the axis attribute set, injected under
   * `.journey-palette--page`, and the ratio is against the section's own
   * `--jp-sec-bg`.
   *
   * These rows are the ones the two-pole + per-section-derivation work PRODUCED,
   * so they are the regression lock for it. `bare` and `media` are absent because
   * their `--jp-sec-bg` is `transparent`: their real background is the page ink,
   * measured in the baseline test above.
   */
  /**
   * TOLERANCE, and why it is not tighter. The browser numbers come from an 8-bit
   * canvas readback, so each channel is quantised to 1/255. At a ratio above ~10
   * a single least-significant bit on a near-black pixel moves the computed ratio
   * by around 0.1 — larger than the model's own error, which is 0.03 on the
   * mid-range rows. So 0.5% relative, floored at 0.12 absolute, measures the
   * readback's resolution rather than the model's accuracy.
   */
  const expectMatchesBrowser = (
    model: number,
    browser: number,
    what: string
  ) => {
    const tol = Math.max(0.12, browser * 0.005);
    expect(
      Math.abs(model - browser),
      `${what}: model ${model.toFixed(2)} vs browser ${browser} (tol ${tol.toFixed(2)})`
    ).toBeLessThanOrEqual(tol);
  };

  const MEASURED: [string, number, string, number][] = [
    // surface, mix toward pole B, role, browser ratio
    ['tint', 0.94, 'faint', 6.65],
    ['tint', 0.94, 'text', 13.41],
    ['panel', 0.88, 'faint', 6.17],
    ['panel', 0.88, 'heading', 13.16],
  ];

  it.each(
    MEASURED
  )('light %s (%s) — %s matches the browser at %s', (_surface, p, role, browser) => {
    const poleA = hex('#F6EFE6');
    const poleB = autoContrast(poleA, 0.62, 0.96, 0.25);
    const l = ladderFrom(mix(poleA, poleB, p), hex('#552e8e'));
    expectMatchesBrowser(
      ratio(l[role as keyof Ladder], l.ink),
      browser,
      `${_surface} ${role}`
    );
  });

  const MEASURED_DARK: [string, number, string, number][] = [
    ['tint', 0.94, 'faint', 5.39],
    ['panel', 0.88, 'faint', 5.24],
    ['panel', 0.88, 'text', 9.68],
  ];

  it.each(
    MEASURED_DARK
  )('dark %s (%s) — %s matches the browser at %s', (_surface, p, role, browser) => {
    const poleA = hex('#200000');
    const poleB = autoContrast(poleA, 0.62, 0.96, 0.25);
    const l = ladderFrom(mix(poleA, poleB, p), hex('#552e8e'));
    expectMatchesBrowser(
      ratio(l[role as keyof Ladder], l.ink),
      browser,
      `${_surface} ${role}`
    );
  });

  it('invert flips the section and stays flipped when nested — 18.7 measured, was 1.00', () => {
    // The headline number of this whole stage. Before the per-section derivation
    // an inverted section measured 1.00:1 — ink on ink, an invisible section.
    for (const [pole, bg, browser] of [
      ['light', '#F6EFE6', 18.72],
      ['dark', '#200000', 18.56],
    ] as [string, string, number][]) {
      const poleB = autoContrast(hex(bg), 0.62, 0.96, 0.25);
      const l = ladderFrom(poleB, hex('#552e8e'));
      // Idempotent by construction: the second invert re-points to pole B
      // again, so depth 2 IS depth 1 — measured identical in the browser, which
      // is why one assertion covers both depths.
      expectMatchesBrowser(
        ratio(l.heading, l.ink),
        browser,
        `${pole} invert heading`
      );
      // And unmistakably flipped, not merely resolved: 1.00 was the bug.
      expect(ratio(l.heading, l.ink)).toBeGreaterThan(4.5);
    }
  });
});

describe('surface: invert — the two-pole refactor (research §2.4)', () => {
  it('declares both poles from the ONE input, so neither reads what invert redefines', () => {
    const poleA = declarationsOf(PALETTE, '--jp-pole-a');
    // Two: the light pole in the base rule, the dark pole in the theme rule.
    // The dark pole re-points the INPUT now, not `--jp-ink`.
    expect(poleA).toHaveLength(2);
    for (const decl of poleA) {
      expect(decl).toContain('--brand-bg');
      // Anchoring the page on the brand PRIMARY is the bug journey-palette.css
      // was created to remove (Codex-gfg50 / Codex-4i8x5).
      expect(decl).not.toContain('--brand-color');
      expect(decl).not.toContain('--color-brand-primary');
    }
    const [lightPole, darkPole] = poleA;
    expect(lightPole).not.toContain('--brand-bg-dark');
    expect(darkPole).toContain('--brand-bg-dark');

    // Pole B depends ONLY on pole A. If it read `--jp-ink` or `--jp-heading`
    // instead, the invert rule would redefine an input of its own definition and
    // both would go invalid at computed-value time.
    const [poleB] = declarationsOf(PALETTE, '--jp-pole-b');
    expect(poleB).toContain('var(--jp-pole-a)');
    expect(poleB).not.toContain('--jp-ink');
    expect(poleB).not.toContain('--jp-heading');

    // And `--jp-ink` only POINTS at a pole, so inverting is one declaration.
    expect(declarationsOf(PALETTE, '--jp-ink')).toEqual(['var(--jp-pole-a)']);
    expect(
      ruleFor("[data-jp-surface='invert']")?.declarations['--jp-ink']
    ).toBe('var(--jp-pole-b)');
  });

  it('never writes the naive --jp-ink: var(--jp-heading)', () => {
    // The cycle. Nesting does not save it either: custom properties inherit as
    // unresolved token streams, so an intermediate alias re-substitutes the
    // child's own `--jp-ink` one level down.
    for (const css of [PALETTE, DESIGN]) {
      for (const decl of declarationsOf(css, '--jp-ink')) {
        expect(decl).not.toContain('--jp-heading');
      }
    }
  });

  it('resolves every rung of the ladder inside a DOUBLY nested invert', () => {
    // Measurement, not inspection. Invert is idempotent by construction — both
    // poles are fixed at the palette root, so an inverted section inside an
    // inverted section resolves to pole B again rather than recursing. Every
    // rung must still be a real colour, not `unset`.
    const brandBg = '#F6EFE6';
    const poleA = hex(brandBg);
    const poleB = autoContrast(poleA, 0.62, 0.96, 0.25);
    const ember = hex('#552e8e');

    for (const [depth, ink] of [
      [0, poleA],
      [1, poleB],
      [2, poleB], // idempotent: the second invert re-points to pole B again
    ] as [number, Oklab][]) {
      const rungs = ladderFrom(ink, ember);
      for (const [name, value] of Object.entries(rungs)) {
        const lin = oklabToLin(value as Oklab);
        for (const c of lin) {
          expect(
            Number.isFinite(c),
            `depth ${depth} rung ${name} did not resolve`
          ).toBe(true);
        }
        // A real colour, not a degenerate one: something must be paintable.
        expect(
          relLum(lin),
          `depth ${depth} rung ${name}`
        ).toBeGreaterThanOrEqual(0);
      }
      // The point of inverting: the ladder actually flipped.
      const contrast = ratio(rungs.heading, rungs.ink);
      expect(contrast, `depth ${depth} heading on its own ink`).toBeGreaterThan(
        4.5
      );
    }

    // And pole B really is the other pole, not a re-derivation of pole A.
    expect(ratio(poleB, poleA)).toBeGreaterThan(4.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. --jp-faint — the AA fix (Codex-rvkmc), locked at both poles
// ═══════════════════════════════════════════════════════════════════════════

describe('--jp-faint clears AA at BOTH poles (Codex-rvkmc)', () => {
  const ORGS: [string, string, string][] = [
    // label, light bg, dark bg
    ['of-blood-and-bones', '#F6EFE6', '#200000'],
    ['platform default', '#fafafa', '#171717'],
  ];

  it.each(
    ORGS
  )('%s — faint is above 4.5 in light AND dark', (_l, lightBg, darkBg) => {
    // The bead reported one number and did not say which theme. Measured: 5.22
    // light / 4.11 dark — it PASSED in light and FAILED in dark, so a fix
    // validated in light theme only would have looked correct and shipped the
    // bug. Both poles, every time.
    for (const bg of [lightBg, darkBg]) {
      const l = ladderFrom(hex(bg), hex('#552e8e'));
      expect(ratio(l.faint, l.ink), `faint on ${bg}`).toBeGreaterThan(4.5);
    }
  });

  it('reproduces the FAILING before-value, then clears it', () => {
    // The fix is proved by the delta, not by the post-value alone: a test that
    // only asserts "> 4.5" passes just as happily against a token that was never
    // broken, and would not have caught the original report's missing theme.
    const OLD_FAINT_MIX = 0.5;
    for (const [pole, bg, docBefore] of [
      ['light', '#F6EFE6', 5.22],
      ['dark', '#200000', 4.11],
    ] as [string, string, number][]) {
      const l = ladderFrom(hex(bg), hex('#552e8e'));
      const before = ratio(mix(l.heading, l.ink, OLD_FAINT_MIX), l.ink);
      // Matches the browser-measured baseline for the OLD value.
      expect(before, `${pole} before (doc ${docBefore})`).toBeCloseTo(
        docBefore,
        1
      );
      const after = ratio(l.faint, l.ink);
      expect(after, `${pole} after`).toBeGreaterThan(before);
      expect(after, `${pole} after`).toBeGreaterThan(4.5);
    }
  });

  it('--jp-ember-text clears AA on a PANEL surface, which 60% did not', () => {
    // `surface: panel` lifts the section background 12% toward the contrast
    // pole, and the accent-text rung had only 0.9 of headroom on the page ink.
    // Three of the five accent values put text in that position, so this was 12
    // of the sweep's 100 combinations — a broken preset, not an edge case.
    const OLD_EMBER_MIX = 0.6;
    for (const [pole, bg] of [
      ['light', '#F6EFE6'],
      ['dark', '#200000'],
    ] as [string, string][]) {
      const poleA = hex(bg);
      const poleB = autoContrast(poleA, 0.62, 0.96, 0.25);
      const panelInk = mix(poleA, poleB, 0.88);
      const panel = ladderFrom(panelInk, hex('#552e8e'));
      const before = ratio(
        mix(panel.ember, panel.heading, OLD_EMBER_MIX),
        panel.ink
      );
      const after = ratio(panel.emberText, panel.ink);
      if (pole === 'dark') expect(before).toBeLessThan(4.5); // 4.45, measured
      expect(after, `${pole} on panel`).toBeGreaterThan(before);
      expect(after, `${pole} on panel`).toBeGreaterThan(4.5);
    }
  });

  it('stays a distinct rung below --jp-dim', () => {
    // Overshooting is the other failure: `--jp-faint` is a real tier in the
    // ladder, not a synonym for `--jp-dim`. It must clear 4.5 and stay visibly
    // quieter.
    for (const bg of ['#F6EFE6', '#200000']) {
      const l = ladderFrom(hex(bg), hex('#552e8e'));
      const faint = ratio(l.faint, l.ink);
      const dim = ratio(l.dim, l.ink);
      expect(faint).toBeLessThan(dim);
      expect(dim / faint, `dim:faint separation on ${bg}`).toBeGreaterThan(
        1.25
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. THE SWEEP — surface x accent x type, 100 combinations, both ink poles
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Research §5.3: the dangerous set is `surface` × `accent` × `type` = 5 × 5 × 4
 * = 100, each at both ink poles. This catches the two failures the research
 * predicts mechanically rather than by eye: the vanishing card (a `panel`
 * surface whose text is derived off the PAGE ink rather than the panel's own
 * lift) and the invisible hairline.
 */
const TYPE_MIN_PX: Record<string, { display: number; sub: number }> = {
  // The clamp MINIMUM of each `--text-*` step at a 16px root — the worst case,
  // because the large-text allowance is a size threshold.
  restrained: { display: 24, sub: 20 }, // --text-2xl / --text-xl
  balanced: { display: 36, sub: 24 }, // --text-4xl / --text-2xl
  expressive: { display: 28, sub: 30 }, // --text-5xl / --text-3xl
  monumental: { display: 44, sub: 36 }, // --text-display / --text-4xl
};

/** WCAG: large text is >= 24px, or >= 18.66px bold. These are not bold. */
const floorFor = (px: number): number => (px >= 24 ? 3 : 4.5);

interface Failure {
  pole: string;
  surface: string;
  accent: string;
  type: string;
  role: string;
  measured: number;
  floor: number;
}

function sweep(label: string, bg: string, emberHex: string): Failure[] {
  const base = ladderFrom(hex(bg), hex(emberHex));
  const failures: Failure[] = [];

  const poleA = base.ink;
  const poleB = autoContrast(poleA, 0.62, 0.96, 0.25);

  for (const surface of SECTION_DESIGN_VALUES.surface) {
    // THREE of the five surface values re-point `--jp-ink`, so the ENTIRE ladder
    // re-derives inside the section. That is the mechanism, not an optimisation:
    // a section that paints a different background and keeps the page's text
    // colours is the vanishing card. `media` paints nothing itself — the page ink
    // shows through under the atmosphere bloom, which this model does not attempt
    // to include, so `media` is measured as `bare`.
    const sectionInk: Oklab = {
      bare: poleA,
      tint: mix(poleA, poleB, 0.94),
      panel: mix(poleA, poleB, 0.88),
      invert: poleB,
      media: poleA,
    }[surface];
    const l = ladderFrom(sectionInk, hex(emberHex));
    const surfaceBg = l.ink;

    for (const accent of SECTION_DESIGN_VALUES.accent) {
      const accentDecl = ruleFor(`[data-jp-accent='${accent}']`)?.declarations;
      const accentTextToken = accentDecl?.['--jp-accent-text'] ?? '';
      const accentText: Oklab =
        accentTextToken === 'var(--jp-ember-text)'
          ? l.emberText
          : accentTextToken === 'var(--jp-text)'
            ? l.text
            : l.heading;
      const fillToken = accentDecl?.['--jp-accent-fill'] ?? '';
      const onFillToken = accentDecl?.['--jp-accent-on-fill'] ?? '';

      for (const type of SECTION_DESIGN_VALUES.type) {
        const size = TYPE_MIN_PX[type];
        const checks: [string, Oklab, Oklab, number][] = [
          // Accent text at BODY size — an eyebrow or kicker, which is where
          // accent text actually lands today. No large-text exemption.
          ['accent-text', accentText, surfaceBg, 4.5],
          ['heading(display)', l.heading, surfaceBg, floorFor(size.display)],
          ['heading(sub)', l.heading, surfaceBg, floorFor(size.sub)],
          ['body(--jp-text)', l.text, surfaceBg, 4.5],
          ['muted(--jp-dim)', l.dim, surfaceBg, 4.5],
          ['quiet(--jp-faint)', l.faint, surfaceBg, 4.5],
        ];
        if (fillToken && fillToken !== 'transparent') {
          const fill = fillToken === 'var(--jp-ember)' ? l.ember : l.ink4;
          const onFill =
            onFillToken === 'var(--jp-on-ember)' ? l.onEmber : l.heading;
          checks.push(['cta-label-on-fill', onFill, fill, 4.5]);
        }
        for (const [role, fg, sbg, floor] of checks) {
          const measured = ratio(fg, sbg);
          if (measured < floor) {
            failures.push({
              pole: label,
              surface,
              accent,
              type,
              role,
              measured: Number(measured.toFixed(2)),
              floor,
            });
          }
        }
      }
    }
  }
  return failures;
}

/**
 * KNOWN-OPEN failures, with their cause, so the sweep can be green without the
 * finding being lost. Anything NOT on this list turns the suite red.
 *
 * EMPTY, and deliberately kept rather than deleted — the mechanism below is the
 * point, not the entries. It held two:
 *
 *   'studio-alpha light|cta-label-on-fill'
 *   'studio-alpha dark|cta-label-on-fill'
 *
 * `cta-label-on-fill` measures `--jp-on-ember` on `--jp-ember` — the CTA's own
 * label on its own fill. Both were 4.43:1 for `studio-alpha` (`#E11D48`) at BOTH
 * poles and on ALL five surfaces, because the ratio does not involve the page
 * background at all: `#E11D48` is OKLCH L = 0.5858, just under `--jp-on-ember`'s
 * 0.60 pivot, so the label resolved to near-white on a mid-lightness red.
 *
 * RESOLVED in round 3 (`Codex-g7ipk`) by raising `--jp-on-ember`'s clamp CEILING
 * from 0.98 to 1 — see the comment on the token in `journey-palette.css`. The
 * original analysis was RIGHT that no PIVOT fixes it (0.60, 0.62 and 0.65 all
 * measure identical, because the fill's lightness saturates every threshold) and
 * wrong about what followed from that: the ceiling, not the pivot, was the
 * difference, and 0.98 versus 1 is 4.45:1 versus 4.70:1 — one side of the 4.5
 * floor each.
 *
 * It was also deferred on a premise that measurement did not support — that
 * `--jp-on-ember` mirrors `--color-text-on-brand`, so the same 4.43 hit every
 * primary Button on that org and any fix was therefore a platform-wide design
 * decision. Read side by side they were never the same expression: the platform
 * token is `clamp(0, (0.62 - l) * 1000, 1)`, with a different pivot, multiplier
 * AND ceiling. The blast radius was journey-only throughout. `platform-500
 * #c24129` (4.86) and `studio-beta #2563EB` (4.88) always passed, which is why a
 * single-brand check missed it entirely.
 *
 * The lesson worth keeping: a token DOCUMENTED as a mirror of another is not a
 * mirror until both expressions have been read side by side.
 */
const KNOWN_OPEN = new Set<string>([]);

describe('the dangerous combination sweep — surface x accent x type', () => {
  const GOLDEN_EMBER = '#552e8e';

  it('measures all 100 combinations at each pole', () => {
    expect(
      SECTION_DESIGN_VALUES.surface.length *
        SECTION_DESIGN_VALUES.accent.length *
        SECTION_DESIGN_VALUES.type.length
    ).toBe(100);
  });

  it.each([
    ['of-blood-and-bones light', '#F6EFE6', GOLDEN_EMBER],
    ['of-blood-and-bones dark', '#200000', GOLDEN_EMBER],
    ['platform light', '#fafafa', '#c24129'],
    ['platform dark', '#171717', '#f47d67'],
    ['studio-alpha light', '#fafafa', '#E11D48'],
    ['studio-alpha dark', '#171717', '#E11D48'],
    ['studio-beta light', '#fafafa', '#2563EB'],
    ['studio-beta dark', '#171717', '#2563EB'],
  ])('%s — no combination drops below its floor', (label, bg, ember) => {
    const all = sweep(label, bg, ember);
    const failures = all.filter((f) => !KNOWN_OPEN.has(`${f.pole}|${f.role}`));
    // The allow-list may not go stale unnoticed: if a known-open entry stops
    // failing, it must be deleted rather than silently carried forever.
    for (const key of KNOWN_OPEN) {
      const [pole, role] = key.split('|');
      if (pole !== label) continue;
      expect(
        all.some((f) => f.role === role),
        `KNOWN_OPEN entry "${key}" no longer fails — delete it`
      ).toBe(true);
    }
    // Printed as a table rather than a bare count: a failing combination is a
    // BROKEN PRESET, and the component work packages need to know which one.
    expect(
      failures,
      failures.length
        ? `\n${failures
            .map(
              (f) =>
                `  ${f.surface}/${f.accent}/${f.type} ${f.role}: ${f.measured} < ${f.floor}`
            )
            .join('\n')}`
        : ''
    ).toEqual([]);
  });
});
