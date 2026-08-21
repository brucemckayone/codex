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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

/**
 * Every `.svelte` file in the section render tree(s), so the axis-emission guard
 * can be stated over the WHOLE surface rather than over a hand-kept list a new
 * component would quietly miss. Enumerated rather than named for the same reason
 * the guard derives the emitter from its markup: the invariant has to survive
 * someone moving the seam.
 */
const SECTION_TREE_FILES: string[] = [
  'render',
  'render-edit',
  'render/sections',
]
  .filter((dir) => existsSync(join(HERE, dir)))
  .flatMap((dir) =>
    readdirSync(join(HERE, dir))
      .filter((name) => name.endsWith('.svelte'))
      .map((name) => `${dir}/${name}`)
  );

const PALETTE = read('journey-palette.css');

/**
 * The canvas stylesheet is now an INDEX of per-type partials (F-B1 split the
 * 575-line original so the seven component work packages each have a disjoint
 * file to port from — contract A12/A16). Both views are needed:
 *
 *   `SECTIONS_CSS`   the index alone, for the `@import`-ordering assertions;
 *   `SECTIONS_ALL`   index + every partial, for "the ladder is not restated
 *                    here". Asserting that against the index alone would pass
 *                    trivially — the index declares nothing — which is exactly
 *                    the kind of assertion a refactor turns vacuous without
 *                    turning red.
 */
const SECTIONS_CSS = read('render-edit/journey-sections.css');
const SECTION_PARTIALS = [
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
const SECTIONS_ALL = [
  SECTIONS_CSS,
  ...SECTION_PARTIALS.map((name) =>
    read(`render-edit/journey-sections/${name}.css`)
  ),
].join('\n');

/** Comment-free view, for anything that locates a SELECTOR by substring. */
const PALETTE_CODE = PALETTE.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The base rule must out-specify org-brand.css, which sets the same tokens at
 * `[data-org-brand]` (0,1,0) and `[data-theme='dark'] [data-org-brand]` (0,2,0)
 * — and our wrapper carries `data-org-brand` itself, so those rules match the
 * SAME element. Three classes = (0,3,0), which wins under either theme.
 */
const BASE_SELECTOR = '.journey-palette.journey-palette.journey-palette {';

/**
 * Declarations only — `--x: …`, not `var(--x)` reads.
 *
 * Comments are stripped FIRST. These files document the token contract by
 * quoting real declarations in prose (e.g. org-brand.css's two-pole chain), and
 * without this the helper counts that prose as live CSS — a test that a comment
 * can break is not measuring the thing it claims to measure.
 */
const declarationsOf = (css: string, prop: string): string[] => {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  const re = new RegExp(`(^|[;{\\s])${prop}\\s*:([^;}]*)`, 'g');
  for (const m of code.matchAll(re)) out.push(m[2].trim());
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

  it('declares the ladder INPUT in exactly one place — one declaration per theme pole', () => {
    // The ladder's root input. Exactly TWO declarations, both in this file: the
    // light pole and the dark pole (Codex-a1tz6). A third would mean the
    // divergence this file exists to prevent has come back; a single one would
    // mean the dark pole was dropped and journeys stopped honouring dark mode.
    //
    // The INPUT is now `--jp-pole-a`, not `--jp-ink`. F-B1's two-pole refactor
    // made `--jp-ink` a POINTER at one of two poles so `surface: invert` can
    // re-point it without a custom-property cycle (research §2.4), and the dark
    // theme therefore re-points the input rather than the pointer. `--jp-ink`
    // is consequently declared ONCE here.
    expect(declarationsOf(PALETTE, '--jp-pole-a')).toHaveLength(2);
    expect(declarationsOf(PALETTE, '--jp-ink')).toEqual(['var(--jp-pole-a)']);
    expect(declarationsOf(SECTIONS_ALL, '--jp-pole-a')).toEqual([]);
    expect(declarationsOf(SECTIONS_ALL, '--jp-ink')).toEqual([]);
    expect(declarationsOf(SECTIONS_ALL, '--jp-heading')).toEqual([]);
  });

  it('derives the ladder input from the brand BACKGROUND, not the brand primary, in BOTH themes', () => {
    const poles = declarationsOf(PALETTE, '--jp-pole-a');
    expect(poles).toHaveLength(2);
    for (const pole of poles) {
      expect(pole).toContain('--brand-bg');
      expect(pole).not.toContain('--color-brand-primary');
      // `--brand-color` is the org PRIMARY. Anchoring the ink on it is the exact
      // bug this file was created to remove, and the one the member dashboard
      // still carried (Codex-4i8x5).
      expect(pole).not.toContain('--brand-color');
    }
    const [light, dark] = poles;
    // The light pole reads the light background only; the dark pole prefers the
    // org's dark companion and falls back to it.
    expect(light).not.toContain('--brand-bg-dark');
    expect(dark).toContain('--brand-bg-dark');
  });

  it('derives pole B from pole A alone, which is what makes invert cycle-free', () => {
    // `[data-jp-surface='invert']` re-points `--jp-ink` to pole B. If pole B
    // read `--jp-ink` or `--jp-heading` it would be defined in terms of
    // something the invert rule redefines, and both would go invalid at
    // computed-value time — the same class of failure as the
    // `--color-background` cycle this file already documents.
    const [poleB] = declarationsOf(PALETTE, '--jp-pole-b');
    expect(poleB).toContain('var(--jp-pole-a)');
    expect(poleB).not.toContain('--jp-ink');
    expect(poleB).not.toContain('--jp-heading');
    // Same auto-contrast step function as the heading, so pole B is genuinely
    // the ink's contrast partner rather than a second, drifting formula.
    expect(poleB).toMatch(/clamp\(0\.05, \(0\.62 - l\) \* 100, 0\.96\)/);
  });

  it('switches the ink on theme using BOTH selector forms the app emits', () => {
    // `app.html` sets `data-theme` on <html> AND adds a matching `.dark`/`.light`
    // class, and org-brand.css keys its dark branches on BOTH. A rule written
    // against only one form loses to the org-brand rule written against the
    // other, and the surface silently keeps the light background in dark mode.
    // (This is also why a browser check that flips only `data-theme` reports a
    // theme-correct surface as theme-invariant.)
    const darkRule = PALETTE_CODE.slice(
      PALETTE_CODE.indexOf('.dark .journey-palette')
    );
    const selector = darkRule.slice(0, darkRule.indexOf('{'));

    expect(selector).toContain('.dark .journey-palette');
    expect(selector).toContain("[data-theme='dark'] .journey-palette");
    // Each form keeps the triple-class compound, so it clears the (0,3,0) base
    // rule above it as well as org-brand.css's dark branch.
    for (const form of selector.split(',')) {
      expect(form.split('.journey-palette').length - 1).toBe(3);
    }
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

    // `@import` is only valid BEFORE any other rule; a rule appearing first
    // makes the browser drop every later import and silently un-style the
    // canvas. Since the split this file is an index of imports and declares no
    // rules at all, so the invariant is stated directly: nothing but `@import`.
    const code = SECTIONS_CSS.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const statements = code
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement.startsWith('@import '), statement).toBe(true);
    }

    // The palette must come FIRST: the axis rules and every partial read the
    // `--jp-*` ladder it declares.
    expect(statements[0]).toBe("@import '../journey-palette.css'");

    // Every partial is imported, in the order its declarations were in before
    // the split — import order IS the cascade order.
    const imported = statements
      .map((s) => s.match(/journey-sections\/(_[a-z]+)\.css/)?.[1])
      .filter((name): name is string => Boolean(name));
    expect(imported).toEqual([...SECTION_PARTIALS]);
  });

  it('imports the axis substrate in the very component that emits the axes', () => {
    // The invariant: whatever emits `data-jp-*` must also carry the stylesheet
    // that reads it, so no surface can end up with the markup and not the rules.
    // Without it, F-B2's design panel would have a control with no CSS behind it
    // in the one place a creator is looking while they use it.
    //
    // This asserts the RELATIONSHIP rather than a filename. It used to name
    // `render/SectionRenderer.svelte` on one side and the canvas's own
    // stylesheet on the other, because there were two section trees; the emitter
    // now lives in one place (`SectionFrame`, mounted by both the public
    // renderer and the studio canvas), and deriving the file from the emission
    // means a future move of the seam fails here instead of silently shipping
    // attributes with no rules.
    const frame = read('render/SectionFrame.svelte');
    expect(frame).toContain('data-jp-');
    expect(frame).toContain("import '../journey-design.css'");
    expect(frame).toContain("import '../journey-sections-shared.css'");

    // And nothing ELSE may emit the axes without importing the substrate.
    const emitters = SECTION_TREE_FILES.filter((file) =>
      read(file).includes('data-jp-width=')
    );
    expect(emitters, 'exactly one component emits the axis attributes').toEqual(
      ['render/SectionFrame.svelte']
    );
  });
});

describe('journey palette — cycle safety', () => {
  it('splits the two classes so the ink and its re-point cannot cycle', () => {
    // `--jp-ink` falls back to `--color-background`. Re-pointing
    // `--color-background: var(--jp-ink)` in the SAME rule is a custom-property
    // cycle: both become invalid at computed-value time and the page paints
    // nothing. So the base class must NOT declare it, and the modifier must.
    // `.journey-palette--page` now carries a `.jp-sec` twin so the semantic
    // surface tokens re-derive per section, so the slice marker is the selector
    // START rather than `… {`.
    const PAGE_AT = PALETTE_CODE.indexOf('.journey-palette--page');
    expect(PAGE_AT).toBeGreaterThan(0);
    const baseBlock = PALETTE_CODE.slice(
      PALETTE_CODE.indexOf(BASE_SELECTOR),
      PAGE_AT
    );
    const pageBlock = PALETTE_CODE.slice(PAGE_AT);

    // The ladder input is declared here twice — the light pole and the dark pole
    // — and `--jp-ink` once, pointing at whichever pole won. All three are ABOVE
    // `.journey-palette--page`, which is what keeps the ink and its re-point on
    // separate elements.
    expect(declarationsOf(baseBlock, '--jp-pole-a')).toHaveLength(2);
    expect(declarationsOf(baseBlock, '--jp-ink')).toHaveLength(1);
    expect(declarationsOf(baseBlock, '--color-background')).toEqual([]);

    expect(declarationsOf(pageBlock, '--color-background')).toEqual([
      'var(--jp-ink)',
    ]);
    expect(declarationsOf(pageBlock, '--jp-ink')).toEqual([]);
    expect(declarationsOf(pageBlock, '--jp-pole-a')).toEqual([]);
  });
});

describe('the ladder re-derives PER SECTION, not once per page', () => {
  /**
   * The correction that makes the whole `surface` axis work, and the one a future
   * tidy-up is most likely to undo by "deduplicating" a selector list.
   *
   * MEASURED, in Chrome, on the golden page: with the ladder declared only on the
   * palette root, an inverted section rendered its heading at **1.00:1** — ink
   * `#010000` on a `#010000` background, an invisible section. After applying the
   * same block to `.jp-sec` as well: **18.72:1** light / 18.56:1 dark, and
   * identical at nesting depth 2.
   *
   * WHY. A custom property's `var()` is substituted at computed-value time ON THE
   * ELEMENT WHERE IT IS DECLARED, and only the result inherits. Declared on the
   * root, `--jp-heading` bakes in pole A and every descendant inherits that
   * literal — so a section re-pointing its own `--jp-ink` changes nothing
   * downstream. Research §2.4 asserts the opposite ("the entire ladder re-derives
   * correctly inside an inverted section"); it is wrong, and the failure is total
   * rather than subtle.
   */
  const derivedRungs = [
    '--jp-heading',
    '--jp-ink-2',
    '--jp-ink-3',
    '--jp-ink-4',
    '--jp-text',
    '--jp-dim',
    '--jp-faint',
    '--jp-line-subtle',
    '--jp-line',
    '--jp-line-strong',
    '--jp-line-hover',
    '--jp-ember-text',
  ];

  /** The rule block a property is declared in, by its selector prelude. */
  const selectorDeclaring = (prop: string): string => {
    const code = PALETTE_CODE;
    const at = code.search(new RegExp(`[;{\\s]${prop}\\s*:`));
    expect(at, `${prop} is not declared`).toBeGreaterThan(0);
    const open = code.lastIndexOf('{', at);
    const prev = code.lastIndexOf('}', open);
    return code.slice(prev + 1, open).trim();
  };

  it('declares every derived rung on the section wrapper as well as the page', () => {
    for (const rung of derivedRungs) {
      const selector = selectorDeclaring(rung);
      expect(selector, `${rung} must also be declared on .jp-sec`).toContain(
        '.jp-sec'
      );
      // …and still on the palette root, or a page-level consumer outside any
      // section (the atmosphere, the floating CTA) loses the ladder entirely.
      expect(selector).toContain(BASE_SELECTOR.slice(0, -2).trim());
    }
  });

  it('keeps the INPUT on the palette root only, so a section can re-point it', () => {
    // `--jp-ink` and the two poles must NOT be re-declared on `.jp-sec`: the
    // `surface` axis's whole mechanism is a section declaring its own `--jp-ink`
    // at (0,1,0), and a palette rule at (0,2,0) would silently beat it.
    for (const input of ['--jp-pole-a', '--jp-pole-b', '--jp-ink']) {
      expect(selectorDeclaring(input), input).not.toContain('.jp-sec');
    }
  });

  it('re-derives the SEMANTIC tokens per section too, or the axis is inert', () => {
    // Contract A11: `--jp-*` appears 0x in `render/sections/*` — the public
    // sections speak `--color-*`. Without the section twin, `surface: invert`
    // would flip the `--jp-*` ladder and leave every section reading the PAGE's
    // colours, i.e. the axis would do nothing in the one tree it exists for.
    for (const semantic of [
      '--color-heading',
      '--color-text',
      '--color-text-muted',
      '--color-background',
      '--color-surface',
      '--color-border',
    ]) {
      expect(selectorDeclaring(semantic), semantic).toContain('.jp-sec');
    }
  });
});

describe('member dashboard consumes the shared palette (Codex-4i8x5)', () => {
  const DASHBOARD = read(
    '../../routes/_org/[slug]/(space)/journeys/[journeySlug]/dashboard/+page.svelte'
  );

  it('imports the shared palette and applies both classes on separate elements', () => {
    expect(DASHBOARD).toContain(
      "import '$lib/page-builder/journey-palette.css'"
    );
    // Base on the outer wrapper, re-points on a DESCENDANT — same split the
    // renderer and the checkout use. Both on one element is the cycle.
    expect(DASHBOARD).toContain('class="journey-portal journey-palette"');
    expect(DASHBOARD).toContain(
      'class="journey-portal__inner journey-palette--page"'
    );
  });

  it('no longer anchors the portal palette on the brand PRIMARY', () => {
    // The third private derivation: `--portal-anchor: var(--brand-color, …)`,
    // which made one journey purple on its sales page and orange inside.
    expect(declarationsOf(DASHBOARD, '--portal-anchor')).toEqual([]);
    for (const prop of [
      '--portal-bg',
      '--portal-bg-deep',
      '--portal-surface',
      '--portal-surface-2',
      '--portal-text',
      '--portal-text-dim',
      '--portal-text-faint',
    ]) {
      const [decl] = declarationsOf(DASHBOARD, prop);
      expect(decl, `${prop} must be declared`).toBeDefined();
      expect(decl, `${prop} must not read the brand primary`).not.toContain(
        '--brand-color'
      );
      expect(decl, `${prop} must come off the shared ladder`).toContain(
        '--jp-'
      );
    }
  });

  it('fixes no lightness on any portal surface or text token', () => {
    // The actual 4i8x5 defect was the FORCED lightness (0.15 bg / 0.94 text)
    // with no light branch — identical in both themes. Any bare numeric
    // lightness in an `oklch(from …)` here means a pole was hardcoded again.
    for (const prop of [
      '--portal-bg',
      '--portal-bg-deep',
      '--portal-surface',
      '--portal-surface-2',
      '--portal-text',
      '--portal-text-dim',
      '--portal-text-faint',
    ]) {
      for (const decl of declarationsOf(DASHBOARD, prop)) {
        expect(decl, `${prop} hardcodes a lightness`).not.toMatch(
          /oklch\(\s*from\s+[^)]*\)?\s+0?\.\d+/
        );
      }
    }
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

/**
 * TIMEOUT RAISED TO 45s — not a slow assertion, a one-time mount cost.
 *
 * Whichever test in this block mounts FIRST absorbs the entire cost of Vite
 * transforming + jsdom instantiating the `JourneyRenderer` component graph; its
 * siblings then run in single-digit milliseconds. Measured here, same machine,
 * same file, back-to-back runs — the first mount was 13190ms on a cold Vite
 * cache, 7067ms warmer and 6641ms warmest, tracking `transform` (19.82s → 13.33s
 * → 8.34s) rather than anything in the test. It has been measured at 33138ms on a
 * loaded box, against a 15000ms global budget (`vite.config.ts` `testTimeout`).
 *
 * So this is not flake: it is reliably too slow and has only ever passed because
 * the machine happened to be quiet. 45s clears the worst observed run with
 * headroom. Scoped to this `describe` rather than to one `it`, because the cost
 * lands on whichever mount runs first and test order is not guaranteed — pinning
 * a single test would just move the failure to its sibling.
 *
 * NOT a weakened test: every assertion below is unchanged. The underlying
 * pathology — a component mount costing seconds in jsdom — is tracked separately;
 * this only stops it failing the suite on a busy machine.
 *
 * `describe(name, options, fn)` is the supported shape for a suite-level timeout
 * in Vitest 4 (`SuiteCollectorCallable`); passing options as the THIRD argument
 * is not — that overload takes a bare number.
 */
describe('JourneyRenderer (mount)', { timeout: 45000 }, () => {
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
