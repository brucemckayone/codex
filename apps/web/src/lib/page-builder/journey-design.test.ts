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
import { readdirSync, readFileSync } from 'node:fs';
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
 * This matters well beyond one typo: every file in the list documents its own
 * traps by QUOTING declarations, which is exactly the habit that produces an
 * early terminator. So the check is here rather than in a one-off script.
 *
 * The list shrank when `render-edit/` went: its index plus nine per-type
 * partials were the bulk of it. Per-section CSS now lives in each component's
 * Svelte `<style>` block, which is NOT covered here — deliberately, because the
 * Svelte compiler parses those at build time and a malformed comment fails the
 * build loudly rather than reaching the browser as prose.
 *
 * The invariant, after stripping comments with the real first-terminator rule:
 * no `*·/` may remain, and braces must balance. A stray terminator means a
 * comment closed early; imbalanced braces mean prose leaked into a block.
 */
const JOURNEY_STYLESHEETS = [
  'journey-palette.css',
  'journey-design.css',
  'journey-sections-shared.css',
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

  'surface:bare': {
    '--jp-sec-bg': 'transparent',
    '--jp-sec-pad-inline': '0px',
  },
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

  // `0px`, NOT `0` — and this pin is load-bearing. A unitless zero is a
  // `<number>`, not a `<length>`, so `max(var(--jp-edge-width), <length>)` mixes
  // types and invalidates the WHOLE declaration at computed-value time.
  // `MapSection:1056` did exactly that to FLOOR its card border, and because
  // `edge: none` is Candlelit the border died on every published page (A64).
  // If a future tidy-up drops the unit, this assertion is what catches it.
  'edge:none': { '--jp-edge-width': '0px', '--jp-edge-shadow': 'none' },
  'edge:hairline': {
    '--jp-edge-width': 'var(--border-width)',
    '--jp-edge-color': 'var(--jp-line)',
    '--jp-edge-shadow': 'var(--shadow-xs)',
  },
  'edge:soft': {
    // `0px` for the same reason as `edge:none` above — see A64.
    '--jp-edge-width': '0px',
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
    '--jp-measure-margin': '0px',
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
    '--jp-reveal-distance': '0px',
    '--jp-reveal-duration': '0ms',
    '--jp-reveal-stagger': '0ms',
    '--jp-reveal-ease': 'linear',
  },
  'motion:fade': {
    '--jp-reveal-distance': '0px',
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
    '--jp-media-radius': '0px',
    '--jp-media-inset': '0px',
    '--jp-media-aspect': '21 / 9',
    '--jp-media-scrim':
      'linear-gradient(to top, var(--jp-ink), transparent 62%)',
    '--jp-media-mask': 'none',
  },
  'media:frame': {
    '--jp-media-radius': 'var(--radius-lg)',
    '--jp-media-inset': '0px',
    '--jp-media-aspect': '16 / 9',
    '--jp-media-scrim': 'none',
    '--jp-media-mask': 'none',
  },
  'media:mask': {
    '--jp-media-radius': 'var(--radius-xl)',
    '--jp-media-inset': '0px',
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
          expect(want).toBe('0px');
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
      (r) => r.declarations['--jp-reveal-distance'] === '0px'
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

describe('--jp-stage-vh — the re-pointable height basis (O7 · the svh half)', () => {
  // WHY THIS SEAM EXISTS. `svh` resolves against the BROWSER viewport and cannot
  // be told not to, and `cqh` — the obvious alternative — silently falls back to
  // the small viewport under inline-size containment, which is exactly what
  // `.jp-sec` declares (`InviteSection.svelte:775` records that reasoning and it
  // is why `svh` was chosen). So inside the builder's fixed-width device frame a
  // `100svh` hero was as tall as the STUDIO WINDOW: measured live at
  // device=mobile, the hero was 390 x 900 (aspect 0.433) where a real 390 x 844
  // phone gives 0.462. The canvas could not preview the aspect of any
  // full-height section — four of the hero's six compositions plus the invite's
  // stage card.
  //
  // This file owns the SEAM. The two consumers live in `render/sections/`, which
  // another work package owns, so they are handed off — the guard here is that
  // the seam itself keeps the shape that makes the override reachable.

  it('declares the basis once, on the axis substrate root', () => {
    const declarations = declarationsOf(DESIGN, '--jp-stage-vh');
    expect(declarations).toHaveLength(1);
    expect(ruleFor(':where(.jp-sec)')?.declarations['--jp-stage-vh']).toBe(
      'var(--jp-device-vh, 1svh)'
    );
  });

  it('puts the fallback INSIDE the var(), not beside it', () => {
    // The resolution trap, and the reason a plain `--jp-stage-vh: 1svh;` line
    // would be wrong rather than merely different: `--jp-device-vh` arrives by
    // INHERITANCE from an ancestor of `.jp-sec` (the canvas's fit box sets it).
    // A bare declaration on `.jp-sec` itself would shadow the ancestor's
    // contribution on every section, and the override could never win — the
    // canvas would set a property nothing reads, which is the silent shape this
    // whole file exists to catch.
    const value = declarationsOf(DESIGN, '--jp-stage-vh')[0];
    expect(value).toMatch(/^var\(--jp-device-vh,\s*1svh\)$/);
  });

  it('never sets --jp-device-vh itself, so the PUBLIC page is byte-identical', () => {
    // The seam is inert off the canvas: with nothing declaring the device
    // height, `--jp-stage-vh` resolves to `1svh` and published output cannot
    // change. If this stylesheet ever declared it, every visitor would get the
    // canvas's pinned height.
    expect(declarationsOf(DESIGN, '--jp-device-vh')).toEqual([]);
  });
});

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
 * `oklch(from <c> clamp(0.05, (<pivot> - l) * <mult>, <ceil>) calc(c * <k>) h)` —
 * the auto-contrast step function `--jp-heading` and `--jp-pole-b` share.
 *
 * `mult` defaults to the 100 both declarations use, so every existing caller
 * models the shipped CSS. It is a parameter only so the `--jp-heading` sweep
 * below can MEASURE the multiplier a future reader will reach for — the change
 * looks like a strict improvement and is not.
 */
function autoContrast(
  base: Oklab,
  pivot: number,
  ceil: number,
  chromaScale: number,
  mult = 100
): Oklab {
  const [L, a, b] = base;
  const C = Math.hypot(a, b);
  const H = Math.atan2(b, a);
  const L2 = Math.min(ceil, Math.max(0.05, (pivot - L) * mult));
  const C2 = C * chromaScale;
  return [L2, C2 * Math.cos(H), C2 * Math.sin(H)];
}

/**
 * `oklch(from <c> clamp(0.05, (<pivot> - l) * <mult>, <ceil>) 0 0)` — chroma
 * zeroed. `mult` is a parameter because the whole `--jp-on-ember` finding turns
 * on it: at 100 the ramp between black and white is 0.01 wide in OKLCH L and a
 * fill landing inside it gets a genuine MID GREY. See
 * `--jp-on-ember`'s tests below, which measure every multiplier.
 */
function autoContrastGrey(
  base: Oklab,
  pivot: number,
  ceil: number,
  mult = 100,
  floor = 0.05
): Oklab {
  const L2 = Math.min(ceil, Math.max(floor, (pivot - base[0]) * mult));
  return [L2, 0, 0];
}

/**
 * `rgb(from <c> calc(255 * clamp(0, (0.1791 - <luminance>) * 1e6, 1)) …)` — the
 * @supports form of `--jp-on-ember`, and the same rule org-brand.css uses for
 * `--color-text-on-brand`.
 *
 * White and black contrast EQUALLY against a fill whose relative luminance is
 * sqrt(1.05 * 0.05) - 0.05 = 0.1791, both at 4.58:1. Deciding on which side of
 * that the fill sits cannot produce an AA failure for any sRGB fill — which is
 * exactly what an OKLCH-lightness pivot cannot promise, because `l` is
 * perceptual and the ratio is computed on luminance.
 *
 * `* 1e6` saturates the clamp for every representable colour, so the result is
 * pure black or pure white and this needs no ceiling parameter.
 */
const WCAG_INK_CROSSOVER = 0.1791;
function autoContrastLuminance(base: Oklab): Oklab {
  return relLum(oklabToLin(base)) < WCAG_INK_CROSSOVER ? [1, 0, 0] : [0, 0, 0];
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

/**
 * A GENERATED sweep of the colour space a creator actually picks from — the sRGB
 * cube at a stride of 5, i.e. 52³ = 140 608 colours.
 *
 * WHY THIS EXISTS, and it is the whole reason two contrast defects survived four
 * rounds of review: every ratio in this file was measured against a hand-written
 * list of eight brand/pole rows. Their inputs are five ember hexes at OKLCH L
 * 0.405, 0.555, 0.723, 0.586 and 0.546, and four backgrounds at L 0.947, 0.164,
 * 0.968 and 0.223. The failing regions of both auto-contrast steps are narrow
 * bands that NONE of those nine values enters, so the assertions were green over
 * 100 combinations that never approached their floors. A generated sweep cannot
 * be blind by construction.
 *
 * WHY sRGB AND NOT OKLCH. The brand editor takes a hex, so the pickable space is
 * the 8-bit cube; an OKLCH grid at any practical step misses colours that land
 * inside a narrow ramp and reports a floor that is too optimistic — measured, an
 * OKLCH grid at L step 0.001 put `--jp-heading`'s floor at 3.06:1 where the
 * exhaustive 8-bit answer is 1.00:1. Stride 5 rather than 1 keeps the suite fast;
 * every headline number quoted in the comments below was re-derived at stride 1
 * over all 16 777 216 colours and is labelled as such.
 */
const BRAND_GRID: Oklab[] = (() => {
  const out: Oklab[] = [];
  const lin = Array.from({ length: 256 }, (_, i) => srgbToLin(i / 255));
  for (let r = 0; r < 256; r += 5) {
    for (let g = 0; g < 256; g += 5) {
      for (let b = 0; b < 256; b += 5) {
        out.push(linToOklab([lin[r], lin[g], lin[b]]));
      }
    }
  }
  return out;
})();

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
    // The @supports form, because it is what every browser this product targets
    // actually paints — and what every ratio in `04-contrast-baseline.md` was
    // measured in. The OKLCH fallback is modelled explicitly, and compared
    // against this one, in the `--jp-on-ember` describe below; modelling the
    // fallback HERE would make the sweep measure a page no visitor sees.
    onEmber: autoContrastLuminance(ember),
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
      // The FALLBACK form. Ceiling 1, not 0.98 — round 3's fix. The live form is
      // the @supports luminance override, asserted separately below because
      // `declarationsOf` returns both and `toContain` would hide a swap.
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
 * Those TWO ENTRIES were genuinely resolved, in round 3 (commit 5614cbe0), by
 * raising `--jp-on-ember`'s clamp CEILING from 0.98 to 1: 0.98 versus 1 is 4.45:1
 * versus 4.70:1 on #E11D48, one side of the 4.5 floor each. That analysis was
 * also RIGHT that no PIVOT fixes it — 0.60, 0.62 and 0.65 measure identical,
 * because the fill's lightness saturates every threshold. So the emptying of this
 * set was correct FOR STUDIO-ALPHA and should not be undone.
 *
 * ── BUT THE SET BEING EMPTY WAS READ AS THE TOKEN BEING SETTLED, AND IT WAS NOT
 * (round 4, WT-C). Recorded here because an empty allow-list with a "RESOLVED"
 * note beside it is the most convincing false green in this file.
 *
 * The expression carries FOUR numbers — floor, pivot, multiplier, ceiling — and
 * only the ceiling and the pivot were ever examined. At `* 100` the ramp between
 * black and white is 0.01 wide in OKLCH L, and a fill landing inside it gets a
 * genuine MID GREY rather than either end. Swept over all 16 777 216 sRGB
 * brands, 718 821 of them (4.285%) put this label under 4.5:1 on its own fill,
 * floor **1.00:1** — an invisible label. `#059669` (emerald-600) measured
 * 2.41:1. One brand's 4.43 was repaired while a band of brands stayed at 1.00,
 * and both this note and the token's own comment read as finished.
 *
 * WHY THE SWEEP COULD NOT HAVE CAUGHT IT: the modelling was always correct — the
 * gap was the INPUT SET. The eight rows below feed five ember hexes whose OKLCH L
 * values are 0.405, 0.555, 0.723, 0.586 and 0.546. None is inside (0.59, 0.60),
 * so the ramp was never exercised. The generated sweeps added below fix that.
 *
 * FIXED, at the level the defect actually sits: `--jp-on-ember` now decides on
 * RELATIVE LUMINANCE under an `@supports` guard, exactly as
 * `tokens/org-brand.css` does for `--color-text-on-brand` — 0 failures out of
 * 16 777 216, floor 4.58:1, and zero regressions against the old form. The
 * arithmetic, and the measurement showing that merely raising the multiplier
 * would have made things WORSE for 70 907 brands, is in the
 * `--jp-on-ember` describe below.
 *
 * The premise the deferral rested on was also wrong, and is the reason the whole
 * bead family exists: `--jp-on-ember` was documented as a mirror of
 * `--color-text-on-brand`, so a fix looked like a platform-wide design decision.
 * Read side by side they were never the same expression — the platform token was
 * `clamp(0, (0.62 - l) * 1000, 1)`, differing in pivot, multiplier AND floor. It
 * is a true mirror now, and by construction rather than by claim: both files
 * carry the same luminance rule under the same `@supports` condition, and
 * `journey-palette.test.ts` asserts the condition strings are identical.
 *
 * The lesson worth keeping, now with its second half: a token DOCUMENTED as a
 * mirror of another is not a mirror until both expressions have been read side by
 * side — and reading two of four numbers is not reading the expression.
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

// ── The keyword / unitless-zero guard (A63, A64 · Codex-3kqqp) ───────────────
//
// WHY THIS EXISTS. A custom property that resolves to the KEYWORD `none`, or to
// a UNITLESS zero, cannot participate in a list, a shorthand, or a math
// function. The whole declaration then goes invalid at computed-value time and
// silently falls back to its initial value. The CSS still parses, so nothing
// lints it and nothing warns.
//
// It has shipped to published pages twice, two rounds apart:
//   · A54 — three rings composed `--jp-edge-shadow` (the keyword `none` at
//     `edge: none`, which IS Candlelit) into a larger `box-shadow` list and
//     painted nothing on every published page.
//   · A64 — `MapSection` floored its card border with
//     `max(var(--jp-edge-width), var(--border-width))`. `--jp-edge-width` was a
//     bare `0`, so the shorthand went invalid and `border-style` stayed `none`,
//     doing the exact opposite of what the floor intended.
//
// A54's diagnosis was recorded, correctly and completely, in a component header
// comment — and the tree was never swept, so the second instance survived a
// whole round. That is what this file is for: a paragraph reaches the reader of
// one file, a red test reaches everyone.
//
// The dangerous set is DERIVED from `AXIS_SPEC`, not hand-listed, so a token
// added tomorrow is covered on the day it is added.

/** Tokens whose pinned value is the bare keyword `none` at any axis value. */
const KEYWORD_VALUED_TOKENS = [
  ...new Set(
    Object.values(AXIS_SPEC).flatMap((props) =>
      Object.entries(props)
        .filter(
          ([, value]) => value.trim() === 'none' || value.trim() === 'auto'
        )
        .map(([prop]) => prop)
    )
  ),
].sort();

/** Tokens whose pinned value is a UNITLESS zero at any axis value. */
const UNITLESS_ZERO_TOKENS = [
  ...new Set(
    Object.values(AXIS_SPEC).flatMap((props) =>
      Object.entries(props)
        .filter(([, value]) => /^0$/.test(value.trim()))
        .map(([prop]) => prop)
    )
  ),
].sort();

const SECTION_DIR = 'render/sections';
const SECTION_SOURCES = readdirSync(join(HERE, SECTION_DIR))
  .filter((f) => f.endsWith('.svelte'))
  .map((f) => ({ file: f, css: stripComments(read(`${SECTION_DIR}/${f}`)) }));

interface Declaration {
  file: string;
  prop: string;
  value: string;
}

/** Every `prop: value` pair in a component, comments already stripped. */
const declarationsIn = ({ file, css }: { file: string; css: string }) => {
  const out: Declaration[] = [];
  const re = /(?:^|[;{}])\s*([-a-z]+)\s*:\s*([^;{}]+)/g;
  for (const m of css.matchAll(re)) {
    out.push({ file, prop: m[1], value: squash(m[2]) });
  }
  return out;
};

const ALL_DECLARATIONS = SECTION_SOURCES.flatMap(declarationsIn);

/** True when `value` has a comma at bracket depth zero — i.e. it is a LIST. */
const hasTopLevelComma = (value: string): boolean => {
  let depth = 0;
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) return true;
  }
  return false;
};

const usesInMath = (value: string, token: string): boolean =>
  new RegExp(
    `\\b(?:min|max|clamp|calc)\\s*\\([^;]*var\\(${token.replace(/-/g, '\\-')}`
  ).test(value);

/**
 * Known violations, each with the reason it is not yet fixed. An entry here is a
 * DEBT RECORD, not an exemption — the point is that the count cannot grow
 * silently. Empty this list rather than adding to it.
 */
const KNOWN_VIOLATIONS: {
  file: string;
  prop: string;
  token: string;
  bead: string;
}[] = [
  {
    // `background-image: var(--jp-media-scrim), linear-gradient(…)`. The scrim
    // is a real gradient at `media: bleed` — which is Candlelit — so this
    // WORKS on every published page today. At the other four media values the
    // token is `none`, the whole list goes invalid, and the second gradient
    // disappears along with it. Not fixed here because the honest fixes are
    // either restructuring the layers or making the axis token list-safe
    // (a transparent gradient instead of `none`), and the latter changes the
    // `media` axis's pinned semantics — a design-system decision, not a
    // drive-by.
    file: 'HeroSection.svelte',
    prop: 'background-image',
    token: '--jp-media-scrim',
    bead: 'Codex-3kqqp',
  },
];

const isKnown = (d: Declaration, token: string): boolean =>
  KNOWN_VIOLATIONS.some(
    (k) => k.file === d.file && k.prop === d.prop && k.token === token
  );

describe('axis tokens that can resolve to a keyword or a unitless zero', () => {
  it('derives its dangerous set from AXIS_SPEC rather than a hand-written list', () => {
    // Guards the guard: if this ever reads empty, the test below passes
    // vacuously and the whole file stops protecting anything.
    expect(KEYWORD_VALUED_TOKENS.length).toBeGreaterThan(0);
    expect(KEYWORD_VALUED_TOKENS).toContain('--jp-edge-shadow');
    expect(KEYWORD_VALUED_TOKENS).toContain('--jp-media-scrim');
    expect(ALL_DECLARATIONS.length).toBeGreaterThan(200);
  });

  it('has no UNITLESS-ZERO axis token left in any named axis rule', () => {
    // Every zero-valued token in the named axis rules now carries an explicit
    // `0px`, which is what makes component math on it safe (A64). A new bare
    // `0` here reintroduces the whole class, so this asserts EMPTY.
    //
    // Note what is deliberately out of scope: `AXIS_SPEC` pins the named
    // `[data-jp-*]` rules, not the `:where(.jp-sec)` defaults block. The one
    // legitimate unitless zero lives there — `--jp-sec-atmos: 0`, a 0/1
    // opacity gate consumed as `opacity: var(--jp-sec-atmos)`. It is a
    // `<number>` and MUST stay unitless, which is exactly why giving every
    // token a unit blindly would be wrong.
    expect(UNITLESS_ZERO_TOKENS).toEqual([]);
  });

  it('never composes a keyword-valued token into a LIST', () => {
    const offenders = ALL_DECLARATIONS.flatMap((d) =>
      KEYWORD_VALUED_TOKENS.filter(
        (token) =>
          d.value.includes(`var(${token}`) &&
          hasTopLevelComma(d.value) &&
          !isKnown(d, token)
      ).map((token) => `${d.file} — ${d.prop}: … var(${token}) … (list)`)
    );
    expect(offenders).toEqual([]);
  });

  it('never uses a keyword- or unitless-zero token inside min/max/clamp/calc', () => {
    const dangerous = [...KEYWORD_VALUED_TOKENS, ...UNITLESS_ZERO_TOKENS];
    const offenders = ALL_DECLARATIONS.flatMap((d) =>
      dangerous
        .filter((token) => usesInMath(d.value, token) && !isKnown(d, token))
        .map((token) => `${d.file} — ${d.prop}: ${d.value} (math on ${token})`)
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the known-violation list from growing silently', () => {
    // One entry, and it is the pre-existing HeroSection background-image list.
    // If you are adding to this, fix the declaration instead.
    expect(KNOWN_VIOLATIONS).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. THE PRIMARY CTA — the one element a visitor must read to pay (Codex-kdsuo)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The journey CTA does NOT consume the journey palette. `render/CtaLink.svelte`
 * is the only styler of `.cta` in the whole page-builder tree — the sole other
 * `.cta` selector is `InviteSection.svelte`'s `margin-top: auto` — and its
 * primary variant spends two ORG-BRAND tokens:
 *
 *   background: var(--color-brand-primary);
 *   color:      var(--color-text-on-brand);
 *
 * So the sweep above, which measures `--jp-on-ember` on `--jp-ember`, has never
 * touched it, and neither has anything else in the repo. Codex-kdsuo measured
 * 4.70:1 on `studio-alpha` at BOTH poles and asked for a pin; the pin was never
 * added, and in the meantime the DERIVATION was rewritten (org-brand.css now
 * decides the ink on relative luminance under an `@supports` guard). The element
 * the bead warned could silently cross the floor is the one element in this
 * effort whose colour rule changed with nothing watching it.
 *
 * The ratio has NO page-background term — the label is pure black or pure white
 * on the brand fill — which is why the bead measured it width-invariant and,
 * on an org with no dark brand override, pole-invariant too.
 *
 * THREE PARTS, and each fails for a different reason:
 *   (1) the CONSUMER — a future change that re-routes the CTA onto
 *       `--jp-accent-fill`/`--jp-accent-on-fill` would be covered by the sweep
 *       above and must not slip through as a silent re-route;
 *   (2) the DERIVATION — string-asserted, so the model below cannot drift off
 *       the stylesheet;
 *   (3) the RATIO — modelled, with the published figures pinned AND a generated
 *       brand sweep, because a pin over the eight seeded brands would be green
 *       and would assert nothing about the risk the bead names.
 */
describe('the primary CTA label on the brand fill (Codex-kdsuo)', () => {
  const CTA = read('render/CtaLink.svelte');

  /** The declaration body of one selector's rule block in a Svelte `<style>`. */
  const ruleBody = (css: string, selector: string): string => {
    const at = css.indexOf(selector);
    expect(at, `${selector} not found`).toBeGreaterThan(0);
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  };

  it('still spends exactly --color-brand-primary and --color-text-on-brand', () => {
    const body = ruleBody(CTA, ".cta[data-variant='primary'] {");
    expect(squash(body)).toContain('background: var(--color-brand-primary);');
    expect(squash(body)).toContain('color: var(--color-text-on-brand);');
    // And the journey palette is NOT in play here, which is the fact that makes
    // the sweep above blind to this pair. If a future change re-points the CTA
    // at the accent ladder this goes red, and the sweep starts covering it.
    expect(body).not.toContain('--jp-');
  });

  it('is the only styler of .cta in the section tree', () => {
    // The pin above is worth nothing if a second rule can repaint the label.
    // Today the only other `.cta` selector in the eleven sections is
    // `InviteSection`'s `:global(.cta)`, which sets `margin-top: auto`. A section
    // that starts painting the CTA's own colours must show up HERE, because the
    // pin above would keep passing while the page changed.
    const painters = SECTION_SOURCES.flatMap(({ file, css }) =>
      [...css.matchAll(/([^{}]*\.cta\)?[^{}]*)\{([^{}]*)\}/g)]
        .filter(([, , body]) => /(?:^|[;\s])(?:color|background)/.test(body))
        .map(([, selector]) => `${file} — ${squash(selector)}`)
    );
    // Guards the guard: an empty source set would pass this trivially.
    expect(SECTION_SOURCES).toHaveLength(11);
    expect(painters).toEqual([]);
  });

  it('derives the ink on LUMINANCE, with the OKLCH step kept as the fallback', () => {
    // Four declarations, in file order: the two OKLCH fallbacks (light, dark)
    // then the two `@supports` luminance overrides. Asserted as a set rather
    // than with `toContain`, so replacing one with the other cannot pass.
    const decls = declarationsOf(ORG_BRAND, '--color-text-on-brand');
    expect(decls).toHaveLength(4);

    expect(decls[0]).toBe(
      'oklch(from var(--brand-color, var(--color-primary-500)) clamp(0, (0.62 - l) * 1000, 1) 0 0)'
    );
    expect(decls[1]).toBe(
      'oklch(from var(--brand-color-dark, var(--brand-color, var(--color-primary-400))) clamp(0, (0.62 - l) * 1000, 1) 0 0)'
    );

    // Codex-5wgwf's correction, which must not be lost in either form: the dark
    // ink is derived from the colour ACTUALLY BEING PAINTED (`--brand-color-dark`
    // first), not from the light brand.
    for (const dark of [decls[1], decls[3]]) {
      expect(dark).toContain('--brand-color-dark');
    }
    for (const lum of [decls[2], decls[3]]) {
      expect(lum).toContain('rgb(');
      expect(lum).toContain(String(WCAG_INK_CROSSOVER));
      expect(lum).toContain('* 1e6, 1)');
      expect(lum).toContain('pow((r / 255 + 0.055) / 1.055, 2.4)');
    }

    // The same-shape sibling must not drift: an engine that can run one can run
    // the other, and the two are the same expression over two fills.
    expect(declarationsOf(ORG_BRAND, '--color-on-interactive')).toHaveLength(4);
  });

  /** The pair, exactly as painted: pure black or pure white on the brand fill. */
  const ctaRatio = (brand: string): number => {
    const fill = hex(brand);
    return ratio(autoContrastLuminance(fill), fill);
  };

  it('locks the three measured browser figures (A67 method, both poles)', () => {
    // Measured by canvas `getImageData` readback with the composite set to
    // `copy` and the ancestor walked to alpha > 250, on all three seeded orgs at
    // BOTH poles. Identical at both poles on every one of them: none of the
    // three sets `dark_mode_overrides.primaryColor`, so `--brand-color-dark` is
    // absent and dark falls back to the light brand.
    expect(ctaRatio('#A62B0C')).toBeCloseTo(7.07, 1); // of-blood-and-bones
    expect(ctaRatio('#2563EB')).toBeCloseTo(5.17, 1); // studio-beta
    expect(ctaRatio('#E11D48')).toBeCloseTo(4.7, 1); // studio-alpha  +0.20
    // The figure Codex-kdsuo itself recorded, on a brand this database does not
    // have. Kept because the bead's argument is about the MARGIN, not the org:
    // 0.16 is inside the noise of any brand edit.
    expect(ctaRatio('#e1233b')).toBeCloseTo(4.66, 1);
  });

  it('cannot be pushed below AA by ANY brand a creator can pick', () => {
    // THE PART THAT MAKES THIS TEST NON-VACUOUS. A pin over the eight seeded
    // brands stays green and proves nothing: the OKLCH-lightness form ADMITTED
    // hard AA failures on legal brands — swept over all 16 777 216 sRGB colours
    // it put the label under 4.5:1 for 1 420 883 of them (8.47%), worst case
    // #01a221 at 3.40:1, and in every one of those the OTHER ink would have
    // passed. #E11D48 (4.70) and #e1233b (4.66) sit just inside the passing edge
    // of that band, which is why the bead measured 0.16-0.20 of headroom and
    // could not attribute it. It is a band, not a margin.
    //
    // The luminance form cannot produce a failure at all: black and white
    // contrast equally at luminance 0.1791, both at 4.58:1, so that is the worst
    // attainable outcome. Asserted over a generated sRGB grid rather than
    // claimed.
    let floor = Number.POSITIVE_INFINITY;
    let failures = 0;
    for (const brand of BRAND_GRID) {
      const r = ratio(autoContrastLuminance(brand), brand);
      if (r < floor) floor = r;
      if (r < 4.5) failures += 1;
    }
    expect(BRAND_GRID.length).toBe(140608); // guards the guard
    expect(failures).toBe(0);
    expect(floor).toBeGreaterThan(4.5);
    expect(floor).toBeCloseTo(4.58, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. THE TWO AUTO-CONTRAST RAMPS, SWEPT — `--jp-on-ember` and `--jp-heading`
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Both tokens pick an ink by stepping on OKLCH lightness. Both have a failing
 * band. One is now fixed and one is recorded as a precondition, and the point of
 * these tests is that the DIFFERENCE between those two outcomes is measured
 * rather than asserted — including a pin on the change a future reader will
 * reach for first, which measurement shows makes things worse.
 */
describe('--jp-on-ember, the accent plate label (Codex-kdsuo · Codex-g7ipk)', () => {
  /** The FALLBACK declaration: `clamp(0.05, (0.6 - l) * <mult>, 1)`. */
  const fallback = (fill: Oklab, mult: number): Oklab =>
    autoContrastGrey(fill, 0.6, 1, mult);

  const sweepRamp = (
    ink: (fill: Oklab) => Oklab
  ): { floor: number; failures: number } => {
    let floor = Number.POSITIVE_INFINITY;
    let failures = 0;
    for (const fill of BRAND_GRID) {
      const r = ratio(ink(fill), fill);
      if (r < floor) floor = r;
      if (r < 4.5) failures += 1;
    }
    return { floor, failures };
  };

  it('the LIVE (luminance) form cannot fail AA for any brand', () => {
    // Exhaustive at stride 1: 0 failures out of 16 777 216, floor 4.582:1.
    const { floor, failures } = sweepRamp(autoContrastLuminance);
    expect(failures).toBe(0);
    expect(floor).toBeCloseTo(4.58, 1);
  });

  it('the FALLBACK form still admits a 1.00:1 label — the defect, measured', () => {
    // This is the red the emptied `KNOWN_OPEN` note above hid. Exhaustive at
    // stride 1: 718 821 brands (4.285%) under 4.5:1, floor 1.00:1.
    //
    // It is left in place deliberately — see the token's comment. An unguarded
    // override would not degrade to it: a custom property only fails when
    // SUBSTITUTED, at which point the consuming `color` is invalid at
    // computed-value time and the label loses its colour entirely. So the
    // `@supports` guard is what makes the fix monotonic, and this assertion
    // records what an engine older than Chrome 125 still gets.
    const { floor, failures } = sweepRamp((f) => fallback(f, 100));
    expect(failures).toBeGreaterThan(0);
    expect(floor).toBeLessThan(1.01);
  });

  it('RAISING THE MULTIPLIER MAKES IT WORSE — do not "fix" it that way', () => {
    // The obvious change, and the trap. `* 1000` narrows the mid-grey ramp
    // tenfold but MOVES it rather than removing it: inside the new band a fill
    // that took the near-black floor now takes the white ceiling.
    //
    // Exhaustive at stride 1:
    //   * 100    floor 1.00:1   under 4.5: 718 821 (4.285%)
    //   * 1000   floor 1.00:1   under 4.5: 694 679 (4.141%)   70 907 WORSE
    //   * 1e6    floor 1.03:1   under 4.5: 696 762 (4.153%)   71 002 WORSE
    // Worst single regression: #149b0b 5.70:1 -> 1.00:1.
    const x100 = sweepRamp((f) => fallback(f, 100));
    const x1000 = sweepRamp((f) => fallback(f, 1000));
    expect(x1000.floor).toBeLessThan(1.01); // the band never leaves

    let regressions = 0;
    for (const fill of BRAND_GRID) {
      if (
        ratio(fallback(fill, 1000), fill) <
        ratio(fallback(fill, 100), fill) - 0.01
      ) {
        regressions += 1;
      }
    }
    expect(regressions).toBeGreaterThan(0);

    // The named case, exactly.
    const emerald = hex('#149b0b');
    expect(ratio(fallback(emerald, 100), emerald)).toBeCloseTo(5.7, 1);
    expect(ratio(fallback(emerald, 1000), emerald)).toBeCloseTo(1.0, 1);
    // Whereas the luminance form regresses NOTHING against `* 100` — it is a
    // strict improvement, which is what licenses landing it at all.
    let luminanceRegressions = 0;
    for (const fill of BRAND_GRID) {
      if (
        ratio(autoContrastLuminance(fill), fill) <
        ratio(fallback(fill, 100), fill) - 0.01
      ) {
        luminanceRegressions += 1;
      }
    }
    expect(luminanceRegressions).toBe(0);
    expect(x100.failures).toBeGreaterThan(0);
  });

  it('preserves every published figure and repairs the failing brands', () => {
    const on = (h: string) => {
      const fill = hex(h);
      return ratio(autoContrastLuminance(fill), fill);
    };
    // UNCHANGED — the seeded orgs, the golden ember and both platform primaries.
    expect(on('#A62B0C')).toBeCloseTo(7.07, 1);
    expect(on('#2563EB')).toBeCloseTo(5.17, 1);
    expect(on('#E11D48')).toBeCloseTo(4.7, 1);
    expect(on('#552e8e')).toBeCloseTo(9.69, 1);
    expect(on('#c24129')).toBeCloseTo(5.14, 1);
    // MOVED — and only upward, and only where it was failing.
    const emerald = hex('#059669');
    expect(ratio(fallback(emerald, 100), emerald)).toBeCloseTo(2.41, 1);
    expect(on('#059669')).toBeCloseTo(5.57, 1);
  });
});

/**
 * `--jp-heading` — RECORDED, NOT FIXED, and the record is the deliverable.
 *
 * The derivation is unchanged and this suite says why in numbers, because the
 * defect is real and the two obvious repairs both make it worse. See the long
 * note on the token in `journey-palette.css`; these assertions are that note's
 * evidence, so the note cannot rot into prose.
 */
describe('--jp-heading collapses on a mid-luminance ink (recorded)', () => {
  const heading = (ink: Oklab, mult: number): Oklab =>
    autoContrast(ink, 0.62, 0.96, 0.25, mult);
  const faint = (ink: Oklab, mult: number): Oklab =>
    mix(heading(ink, mult), ink, 0.58);

  const sweepPair = (mult: number) => {
    let headFloor = Number.POSITIVE_INFINITY;
    let faintFloor = Number.POSITIVE_INFINITY;
    let headFails = 0;
    let faintFails = 0;
    for (const ink of BRAND_GRID) {
      const h = ratio(heading(ink, mult), ink);
      const f = ratio(faint(ink, mult), ink);
      if (h < headFloor) headFloor = h;
      if (f < faintFloor) faintFloor = f;
      if (h < 4.5) headFails += 1;
      if (f < 4.5) faintFails += 1;
    }
    return { headFloor, faintFloor, headFails, faintFails };
  };

  it('THE DEFECT: a mid-lightness --brand-bg renders headings unreadable', () => {
    // The spot values, which are what a reviewer can reproduce in a browser by
    // setting `--brand-bg` on `.journey-palette` and reading `--color-heading`
    // against `--color-background`.
    const at = (h: string) => {
      const ink = hex(h);
      return ratio(heading(ink, 100), ink);
    };
    expect(at('#bd618f')).toBeCloseTo(1.27, 1); // a dusty pink — INVISIBLE
    expect(at('#808080')).toBeCloseTo(3.52, 1); // a plain mid grey
    expect(at('#9C6B4F')).toBeCloseTo(4.02, 1); // a mid tan

    // Exhaustive at stride 1: 2 409 483 inks (14.36%) under 4.5:1, floor 1.00:1.
    const { headFloor, headFails } = sweepPair(100);
    expect(headFloor).toBeLessThan(1.01);
    expect(headFails).toBeGreaterThan(0);
  });

  it('is invisible to the eight hardcoded rows, which is why it survived', () => {
    // The four backgrounds the sweep above feeds are OKLCH L 0.947, 0.164, 0.968
    // and 0.223; the failing band is 0.528-0.618. Every seeded org has enormous
    // headroom, so no amount of re-measuring the fixture would find this.
    for (const [bg, want] of [
      ['#F3F0E7', 18.38], // of-blood-and-bones, this database's actual value
      ['#F6EFE6', 18.36], // the value the docs quote
      ['#200000', 17.53],
      ['#fafafa', 20.07],
      ['#171717', 15.96],
    ] as [string, number][]) {
      const ink = hex(bg);
      expect(ratio(heading(ink, 100), ink), bg).toBeCloseTo(want, 1);
    }
  });

  it('RAISING THE MULTIPLIER MAKES IT WORSE — the change not to make', () => {
    // Exhaustive at stride 1, and this is the decisive measurement:
    //   * 100   floor 1.00:1   under 4.5: 2 409 483 (14.36%)
    //   * 1000  floor 1.00:1   under 4.5: 2 484 004 (14.81%)   116 339 WORSE
    //   * 1e6   floor 1.01:1   under 4.5: 2 492 478 (14.86%)   118 623 WORSE
    // The band narrows and MOVES; some ink always lands inside it (32 of the
    // 16 777 216 even at 1e6), so the floor never leaves 1.00.
    const x100 = sweepPair(100);
    const x1000 = sweepPair(1000);
    expect(x1000.headFails).toBeGreaterThanOrEqual(x100.headFails);
    expect(x1000.headFloor).toBeLessThan(1.01);

    // The named regression: a vivid green just under the pivot flips from the
    // near-black FLOOR to the near-white CEILING.
    const green = hex('#05a22b');
    expect(ratio(heading(green, 100), green)).toBeCloseTo(6.16, 1);
    expect(ratio(heading(green, 1000), green)).toBeCloseTo(1.01, 1);
  });

  it('and the PIVOT cannot be moved to luminance without losing the hue', () => {
    // `--color-text-on-brand` escaped this by deciding on relative luminance,
    // and `--jp-on-ember` follows it above. Neither carries a hue: `r`/`g`/`b`
    // are in scope only inside `rgb(from …)` and `l`/`c`/`h` only inside
    // `oklch(from …)`, so a luminance decision cannot also emit `calc(c * 0.25)
    // h`. This assertion is the reason the token still steps on `l`.
    expect(declarationsOf(PALETTE, '--jp-heading')[0]).toContain(
      'calc(c * 0.25) h'
    );
    expect(declarationsOf(PALETTE, '--jp-heading')[0]).toContain('(0.62 - l)');
    // Same expression, same reason, one axis over.
    expect(declarationsOf(PALETTE, '--jp-pole-b')[0]).toContain(
      'calc(c * 0.25) h'
    );
  });

  it('and no multiplier can rescue --jp-faint, so the fix is an INPUT guard', () => {
    // THE FACT THAT SETTLES IT. `--jp-faint` is a 58% mix of heading into ink,
    // so its ratio is bounded by the two ends' separation rather than by the
    // step — its failure count is IDENTICAL at every multiplier (exhaustive at
    // stride 1: 9 181 154, i.e. 54.72%, in all three sweeps). A mid-luminance
    // page background cannot carry this ladder however the step is written, so
    // the guard belongs where `--brand-bg` is CHOSEN — the brand editor — and
    // not in this file.
    expect(sweepPair(100).faintFails).toBe(sweepPair(1000).faintFails);
    expect(sweepPair(100).faintFails).toBe(sweepPair(1e6).faintFails);
    expect(sweepPair(100).faintFails).toBeGreaterThan(
      sweepPair(100).headFails * 3
    );
    // And the seeded orgs are comfortably outside it, which is the other half of
    // why this is a precondition rather than a live bug.
    for (const [bg, want] of [
      ['#F6EFE6', 7.11],
      ['#200000', 5.37],
    ] as [string, number][]) {
      const ink = hex(bg);
      expect(ratio(faint(ink, 100), ink), bg).toBeCloseTo(want, 1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. THE PRACTICE-CARD FLOOR — the one mechanism in this branch that neither
//    jsdom nor a horizontal-overflow check can see
// ═══════════════════════════════════════════════════════════════════════════

/**
 * WHY A CSS-MECHANISM CHECK, AND WHY HERE.
 *
 * `MapSection`'s practice pool overflowed at a 390px viewport: the uppercase
 * type label inside `.descent__card-top` painted 41px past the card's own edge,
 * over the border. Nothing else in this branch's gate could see it.
 *
 *   * jsdom has no layout and no container queries, so the section's own
 *     component test renders both cards at width 0 and asserts nothing about
 *     either. The `@container (max-width: 45rem)` rule that CAUSES the squeeze
 *     is not even evaluated.
 *   * `document.documentElement.scrollWidth` stayed equal to `clientWidth` at
 *     all three measured widths, because the spill is INSIDE a section that
 *     does not itself overflow the page. A page-level horizontal-overflow probe
 *     — the usual guard for this bug class — is blind to it by construction.
 *   * A visual snapshot would have caught it, but the repo's journey snapshots
 *     capture blank sections (the reveal never fires in a headless full-page
 *     shot), so they did not.
 *
 * That leaves the declarations themselves, which is what this file already does
 * for colour: parse the CSS, model the mechanism it declares, and license the
 * model by reproducing numbers measured in a real browser. The model below
 * reproduces FOUR live measurements to the pixel across both arms, which is why
 * the assertions that follow it mean something.
 *
 * This is the only per-section Svelte `<style>` block this file reads. The
 * stylesheet-integrity sweep at the top deliberately excludes them (the Svelte
 * compiler fails the build on a malformed comment), and that exclusion still
 * holds — nothing here re-litigates it.
 */
const MAP_SVELTE = read('render/sections/MapSection.svelte');
const MAP_STYLE = MAP_SVELTE.slice(
  MAP_SVELTE.indexOf('<style>') + '<style>'.length,
  MAP_SVELTE.lastIndexOf('</style>')
);
const MAP_RULES = parseRules(MAP_STYLE);

/** The at-rule preludes the practice pool's width chain passes through. */
const NARROW_AT = '@container (max-width: 45rem)';
const ONE_UP_AT = '@container (max-width: 24rem)';

/** Rules whose selector LIST contains `sel` exactly — grouped rules included. */
const mapRulesFor = (sel: string, at = ''): Rule[] =>
  MAP_RULES.filter(
    (r) => r.at === at && r.selector.split(',').some((s) => s.trim() === sel)
  );

/** The winning declaration of `prop` on `sel` within `at` — later wins. */
const mapDecl = (sel: string, prop: string, at = ''): string | undefined => {
  const hits = mapRulesFor(sel, at)
    .map((r) => r.declarations[prop])
    .filter((v): v is string => v !== undefined);
  return hits.at(-1);
};

/** The first `<n>rem` length in a value, in rem. */
const remIn = (value: string | undefined): number => {
  const m = value === undefined ? null : /(-?[\d.]+)rem/.exec(value);
  return m ? Number(m[1]) : Number.NaN;
};

// ── the layout model ───────────────────────────────────────────────────────
//
// Two equal flex items in a wrapping row. Everything below is arithmetic the
// CSS states outright: there is no line-breaking heuristic here, because with
// two items of equal basis a wrap happens exactly when the pair plus the gap
// cannot fit, and `min-width` is the only thing that stops the shrink.

const REM = 16; // `rootFont` measured 16px on every seeded org
const SPACE_UNIT = 4; // `--space-unit` = 0.25rem * `--brand-density-scale: 1`
const BORDER = 1; // `--border-width`, the floor `max()` in the card rule

interface Arm {
  /** `.descent__practices` content-box width. */
  rowWidth: number;
  /** `--jp-rhythm`, the section's own multiplier on gap AND padding. */
  rhythm: number;
  /** `flex-basis`, in rem — 11 at base, 8.25 under the 45rem container. */
  basisRem: number;
  /** `min-width`'s rem term, or `null` for the arm that has no `min-width`. */
  floorRem: number | null;
}

interface Arranged {
  twoUp: boolean;
  /** `.descent__card`'s `clientWidth` — border excluded, padding included. */
  cardClientWidth: number;
  /** `.descent__card-top`'s box: the card's content width. */
  labelBox: number;
}

function arrange({ rowWidth, rhythm, basisRem, floorRem }: Arm): Arranged {
  const gap = 3 * SPACE_UNIT * rhythm; // `--space-3` * `--jp-rhythm`
  const pad = 4 * SPACE_UNIT * rhythm; // `--space-4` * `--jp-rhythm`
  const basis = basisRem * REM;
  // `min(100%, 11rem)`: the `100%` term resolves against the flex container's
  // own content box, so a row NARROWER than the floor yields the row. That term
  // is what stops a single card overflowing a container tighter than 11rem.
  const floor = floorRem === null ? 0 : Math.min(rowWidth, floorRem * REM);
  const perItem = Math.max(basis, floor);
  const twoUp = 2 * perItem + gap <= rowWidth;
  const outer = twoUp ? (rowWidth - gap) / 2 : rowWidth;
  return {
    twoUp,
    cardClientWidth: outer - 2 * BORDER,
    labelBox: outer - 2 * BORDER - 2 * pad,
  };
}

/**
 * THE LABEL'S MIN-CONTENT, and it is measured rather than derived.
 *
 * `.descent__card-top` is a flex row: a 14px glyph, 6px gap, the practice type
 * at `--text-xs` upper-cased at `--tracking-wider`, then an 8px gap and a 14px
 * lock. Its `scrollWidth` read 131px on of-blood-and-bones/bone-deep at a 390
 * viewport with "REFLECTION" as the longest type in the pool. Content-dependent
 * by nature — a longer type string raises it — so it is a recorded floor to
 * clear, not a formula. The `min-width` fix is deliberately indifferent to it:
 * it states the card's own minimum instead of tracking the label's.
 */
const LABEL_MIN_CONTENT = 131;

/** `--jp-rhythm`'s declared values, read from the axis stylesheet. */
const RHYTHMS = [
  ...new Set(declarationsOf(DESIGN, '--jp-rhythm').map(Number)),
].sort((a, b) => a - b);

/** The section's rhythm on the page every number below was measured on. */
const MEASURED_RHYTHM = 1.25;
/** `.descent__practices` clientWidth at a 390px viewport, measured. */
const MEASURED_ROW = 279;

describe('the practice-card floor — .descent__card min-width (F4)', () => {
  it('the model reproduces the live browser, in BOTH arms', () => {
    // MEASURED on of-blood-and-bones/bone-deep AND studio-alpha/bone-deep, 390
    // viewport, reveals forced in, via getComputedStyle + clientWidth readback:
    //   --jp-rhythm 1.25 · gap 15px · padding 20px · border 1px
    //   flex-basis 132px (the 45rem container override, section CQ width 390)
    //   .descent__practices clientWidth 279
    //
    // BEFORE (no min-width): .descent__card scrollWidth 151 / clientWidth 130,
    //   .descent__card-top 131 / 90 — a 41px spill, both cards on one line.
    // AFTER  (min-width live): .descent__card 279 wide / clientWidth 277,
    //   .descent__card-top 237 / 237 — zero spill, card tops 1664 and 1768,
    //   i.e. one card per line.
    const before = arrange({
      rowWidth: MEASURED_ROW,
      rhythm: MEASURED_RHYTHM,
      basisRem: 8.25,
      floorRem: null,
    });
    expect(before.twoUp).toBe(true);
    expect(before.cardClientWidth).toBe(130); // live: 130
    expect(before.labelBox).toBe(90); // live: 90

    const after = arrange({
      rowWidth: MEASURED_ROW,
      rhythm: MEASURED_RHYTHM,
      basisRem: 11,
      floorRem: 11,
    });
    expect(after.twoUp).toBe(false);
    expect(after.cardClientWidth).toBe(277); // live: 277
    expect(after.labelBox).toBe(237); // live: 237
  });

  it('THE DEFECT — without the floor the label does not fit its own card', () => {
    // The control arm, and the reason this test is not vacuous: delete the
    // `min-width` declaration and this is what the page goes back to. The
    // margin was ONE PIXEL of slack in the wrong direction — 2 x 132 + 15 = 279
    // against a 279px row — which is why it survived review.
    const control = arrange({
      rowWidth: MEASURED_ROW,
      rhythm: MEASURED_RHYTHM,
      basisRem: 8.25,
      floorRem: null,
    });
    expect(control.labelBox).toBeLessThan(LABEL_MIN_CONTENT);
    expect(LABEL_MIN_CONTENT - control.labelBox).toBe(41); // the live spill
  });

  it('the floor clears the label at every rhythm and every narrow width', () => {
    // The claim the fix makes, and the reason it is a constraint rather than a
    // fourth breakpoint: `min-width` holds at every axis bag and every width,
    // with no number to keep in step. Swept over `--jp-rhythm`'s four declared
    // values x every row width from a 320px viewport up.
    expect(RHYTHMS).toEqual([0.75, 1, 1.25, 1.6]);
    const failures: string[] = [];
    for (const rhythm of RHYTHMS) {
      for (let rowWidth = 209; rowWidth <= 320; rowWidth += 1) {
        const got = arrange({ rowWidth, rhythm, basisRem: 8.25, floorRem: 11 });
        if (got.labelBox < LABEL_MIN_CONTENT)
          failures.push(`${rowWidth}px @ rhythm ${rhythm}: ${got.labelBox}`);
      }
    }
    expect(failures).toEqual([]);

    // THE LIMIT, STATED. The floor cannot help below the width at which the row
    // itself is too narrow for the label plus its padding: at the widest rhythm
    // a single full-row card needs rowWidth >= 131 + 51.2 + 2 = 184.2px. A 320px
    // viewport gives a 209px row (the 390 viewport's 279 less the same chrome),
    // so the nearest real device clears it by ~25px. Below ~185px of row no
    // `min-width` can fix this and the label itself would have to wrap.
    const atLimit = arrange({
      rowWidth: 184,
      rhythm: 1.6,
      basisRem: 8.25,
      floorRem: 11,
    });
    expect(atLimit.labelBox).toBeLessThan(LABEL_MIN_CONTENT);
  });

  it('and does NOT collapse the two-up design where two cards fit', () => {
    // The regression the fix could plausibly have caused: forcing one-up
    // everywhere. At the 45rem container boundary the row measures ~609px, so
    // the pair still shares a line with room to spare.
    const wide = arrange({
      rowWidth: 609,
      rhythm: 1,
      basisRem: 11,
      floorRem: 11,
    });
    expect(wide.twoUp).toBe(true);
    expect(Math.round(wide.cardClientWidth)).toBe(297);
    expect(wide.labelBox).toBeGreaterThan(LABEL_MIN_CONTENT);
  });

  it('the declarations the model reads are the ones in the stylesheet', () => {
    // The string half. If any of these five moves, the numbers above stop
    // describing the file and this fails rather than going quietly stale.
    expect(mapDecl('.descent__card', 'min-width')).toBe('min(100%, 11rem)');
    expect(mapDecl('.descent__card', 'flex')).toBe('1 1 11rem');
    expect(mapDecl('.descent__card', 'padding')).toBe(
      'calc(var(--space-4) * var(--jp-rhythm))'
    );
    expect(mapDecl('.descent__practices', 'gap')).toBe(
      'calc(var(--space-3) * var(--jp-rhythm))'
    );
    // The narrow-container basis is the CONTROL the A/B held constant: both arms
    // ran at 8.25rem and varied only `min-width`. Change it and re-measure.
    expect(remIn(mapDecl('.descent__card', 'flex', NARROW_AT))).toBe(8.25);

    // The 24rem rule still exists, and is still NOT what saves a 390 viewport:
    // 24rem is 384px, and 390px is the width of every iPhone from the 12 to the
    // 15. It missed by six pixels, which is the whole reason for the floor.
    expect(mapDecl('.descent__card', 'flex-basis', ONE_UP_AT)).toBe('100%');
    expect(24 * REM).toBeLessThan(390);

    // Nothing else re-declares either property on this element — no later rule
    // (`.descent--enhanced`, reduced motion) can unset the floor.
    const touching = MAP_RULES.filter(
      (r) =>
        /\.descent__card(?![-\w])/.test(r.selector) &&
        ('min-width' in r.declarations || 'flex' in r.declarations)
    );
    expect(touching.map((r) => `${r.at}|${r.selector}`).sort()).toEqual([
      '@container (max-width: 45rem)|.descent__card',
      '|.descent__card', // `at` is '' at top level
    ]);
  });
});
