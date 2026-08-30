/**
 * THE WHOLE-CATALOGUE SWEEP — every declared (section, variant) pair, mounted.
 *
 * WHY THIS FILE EXISTS. Eleven section components were built in seven parallel
 * work packages, each with its own `.svelte.test.ts` covering its own
 * compositions in depth. Nothing ever asserted a property ACROSS the catalogue,
 * so a rule every section is supposed to obey ("degrade to nothing rather than to
 * a hollow frame", "never publish a present-and-inert affordance", "one `<h1>`,
 * one title fallback") could hold in ten files and fail in the eleventh, and no
 * test would go red. Four separate dead-end affordances have been removed from
 * this surface already; each was found by a person looking, not by a test.
 *
 * So the pairs are DERIVED, never listed: `SECTION_CATALOG` is the source, and a
 * new section type or a new composition joins this sweep the moment it is
 * declared. That is the property that matters — a hand-written list of 62 pairs
 * would be stale on the next commit, and a sweep that silently covers 61 of 62 is
 * worse than no sweep, so {@link PAIRS} is length-pinned against the catalogue
 * itself and the pair count is asserted.
 *
 * WHAT IS SWEPT, per pair:
 *   1. RENDERS — with the catalogue's own `defaultProps`, with `{}`, and
 *      HALF-AUTHORED (every second key dropped). A section may self-hide; what it
 *      may not do is emit a subtree with no text, no media and no control — the
 *      hollow shell — or a text leaf that is nothing but a join glyph.
 *   2. NO DEAD-END AFFORDANCE — every anchor has a real target and a name; on an
 *      UNPURCHASABLE course nothing anywhere offers a purchase.
 *   3. ACCESSIBLE — one `<h1>` and only from `hero`, no heading-level skips, every
 *      `<img>` carries an `alt` attribute, every media element carries the
 *      controls it needs, and no decorative glyph is inside an accessible name.
 *   4. TITLE-CLAIM — page-level, through `SectionRenderer`: the course title is
 *      printed exactly once, and the claim survives a disabled or unknown-type
 *      claimant.
 *   5. SHAPE VALIDITY — `validatePageShape` over combinations built from these
 *      same types.
 *
 * WHAT THIS FILE CANNOT SAY, and does not pretend to. jsdom implements neither
 * container queries nor `color-mix()`, and `IntersectionObserver` is a
 * never-firing stub in `src/tests/setup.ts` — so every `use:reveal` node here
 * stays `reveal--armed` and would read as `opacity: 0` to a computed-style
 * assertion. Nothing below asserts geometry, paint or visibility; the assertions
 * are on MARKUP. Painted contrast at the dark pole and responsive overflow at
 * 1440/834/390 need a real browser and are recorded as a named gap in the WP
 * report, with the method to use.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CourseOffer, PageSection, SectionProps } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { resolveVariant, SECTION_CATALOG } from '../../section-catalog';
import SectionFrame from '../SectionFrame.svelte';
import SectionRenderer from '../SectionRenderer.svelte';
import {
  claimTitleFallback,
  resolveSectionComponent,
  selectRenderableSections,
  validatePageShape,
} from '../section-registry';
import type { JourneySalesContext, SellPreview } from '../types';

/**
 * `feel` and `reel` mount a real HLS player against the streamed clip. The
 * factory is stubbed rather than the sections: what the sweep needs to know is
 * that a media element with a source reaches the DOM, not that hls.js parses a
 * manifest in jsdom.
 */
vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async () => ({ hls: null, cleanup: () => {} })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// THE INVENTORY — derived from the catalogue, never listed
// ─────────────────────────────────────────────────────────────────────────────

interface Pair {
  type: string;
  variant: string;
  /** The catalogue's stated reason this composition is not built, if any. */
  unavailable?: string;
}

const PAIRS: Pair[] = SECTION_CATALOG.flatMap((def) =>
  def.variants.map((v) => ({
    type: def.type,
    variant: v.id,
    unavailable: v.unavailable,
  }))
);

/** Section types with at least one declared composition. */
const TYPES = SECTION_CATALOG.map((def) => def.type);

const label = (p: Pair) => `${p.type} · ${p.variant}`;

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const COURSE_TITLE = 'Bone Deep';

/** A resolved 30s public preview — what `sellPreview` actually looks like. */
const PREVIEW: SellPreview = {
  intro: {
    playlistUrl: 'https://cdn.example.test/hls/intro/preview.m3u8',
    durationSeconds: 30,
  },
  reel: {
    playlistUrl: 'https://cdn.example.test/hls/reel/preview.m3u8',
    durationSeconds: 30,
  },
  guidePortraitUrl: 'https://cdn.example.test/img/guide.webp',
  heroImageUrl: 'https://cdn.example.test/img/hero.webp',
  heroClip: {
    playlistUrl: 'https://cdn.example.test/hls/hero/preview.m3u8',
    durationSeconds: 30,
  },
  signatureUrl: 'https://cdn.example.test/img/signature.webp',
};

/** The empty pole: the read succeeded and there is no media anywhere. */
const NO_MEDIA: SellPreview = { intro: null, reel: null };

function offerWithPurchase(): CourseOffer {
  return {
    courseId: 'course-1',
    organizationId: 'org-1',
    paths: ['purchase'],
    purchase: { priceCents: 4900 },
    subscription: null,
    tiers: [],
    entitled: false,
  };
}

function context(over: Partial<JourneySalesContext> = {}): JourneySalesContext {
  return {
    course: {
      id: 'course-1',
      slug: 'bone-deep',
      title: COURSE_TITLE,
      kicker: 'A four-practice descent',
      lede: 'A slow way back into the body.',
      status: 'published',
      priceCents: 4900,
      stageCount: 3,
      practiceCount: 9,
    },
    stages: [
      {
        id: 'st-1',
        title: 'Regulation',
        summary: 'Finding the ground.',
        sortOrder: 0,
        practiceCount: 3,
        locked: false,
        practices: [
          {
            id: 'pr-1',
            title: 'The first breath',
            kind: 'audio',
            durationSeconds: 600,
            sortOrder: 0,
          },
        ],
      },
      {
        id: 'st-2',
        title: 'Descent',
        summary: 'Going further down.',
        sortOrder: 1,
        practiceCount: 6,
        locked: true,
        practices: [],
      },
    ] as unknown as JourneySalesContext['stages'],
    testimonials: [
      {
        id: 'tm-1',
        quote: 'It gave me somewhere to put it.',
        authorName: 'Ada L.',
        authorContext: 'six months in',
        sortOrder: 0,
      },
    ] as unknown as JourneySalesContext['testimonials'],
    checkoutUrl: '/journeys/bone-deep/checkout',
    dashboardUrl: '/journeys/bone-deep/dashboard',
    enrolled: false,
    offer: offerWithPurchase(),
    purchasable: true,
    sellPreview: Promise.resolve<SellPreview | null>(PREVIEW),
    ...over,
  };
}

/** The catalogue's own seed copy — the state a freshly added section is in. */
function authored(type: string): SectionProps {
  const def = SECTION_CATALOG.find((d) => d.type === type);
  return structuredClone(def?.defaultProps ?? {}) as SectionProps;
}

/**
 * HALF-AUTHORED: every second key of the seed bag removed. This is the state
 * that produced a leading `&nbsp;` on a heading whose accent half was blank —
 * the joins are only reachable when SOME of a joined pair is present.
 */
function halfAuthored(type: string): SectionProps {
  const full = authored(type);
  const out: SectionProps = {};
  Object.keys(full).forEach((key, i) => {
    if (i % 2 === 0) out[key] = full[key];
  });
  return out;
}

function section(p: Pair, props: SectionProps): PageSection {
  return {
    id: `s-${p.type}-${p.variant}`,
    type: p.type,
    enabled: true,
    variant: p.variant,
    props,
  };
}

let mounted: ReturnType<typeof mount> | undefined;

function renderFrame(
  p: Pair,
  props: SectionProps,
  over: Partial<JourneySalesContext> = {},
  titleFallback?: string
): HTMLElement {
  const sec = section(p, props);
  const Component = resolveSectionComponent(sec.type);
  expect(Component, `${label(p)} resolves a component`).not.toBeNull();
  mounted = mount(SectionFrame, {
    target: document.body,
    props: {
      renderable: {
        section: sec,
        Component: Component as NonNullable<typeof Component>,
        anchorId: sec.type,
      },
      context: context(over),
      titleFallback,
    },
  });
  flushSync();
  const el = document.body.querySelector<HTMLElement>('[data-section-type]');
  expect(el, `${label(p)} emits a section wrapper`).not.toBeNull();
  return el as HTMLElement;
}

function teardown() {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = '';
}

/**
 * `sellPreview` is consumed through `{#await}`, so the resolved branch only
 * exists after a microtask flush. Every media assertion below runs after this.
 */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared probes
// ─────────────────────────────────────────────────────────────────────────────

/** Text that a screen reader would announce — `aria-hidden` subtrees removed. */
function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => {
    node.remove();
  });
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The same text, but with the NON-BREAKING SPACES LEFT IN.
 *
 * `visibleText` collapses `/\s+/` — and in JavaScript `\s` MATCHES U+00A0 — so it
 * silently ate the leading non-breaking space that {@link danglingHeadings}
 * exists to find, and that function was VACUOUS with respect to the entire
 * `{a}&nbsp;{b}` join defect. The probes' own self-tests are the only reason that
 * was noticed. So this collapses and trims only ORDINARY whitespace and leaves an
 * NBSP exactly where the template put it.
 */
function rawText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => {
    node.remove();
  });
  // `.trim()` is NOT usable here either: ECMAScript's WhiteSpace includes the
  // Unicode space separators, so `'\u00A0x'.trim() === 'x'` — the standard trim
  // eats the NBSP just as `/\s+/` does. Both ends are trimmed by an explicit
  // ordinary-whitespace class instead.
  return (clone.textContent ?? '')
    .replace(/[ \t\n\r\f\v]+/g, ' ')
    .replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '');
}

/**
 * A leaf element whose entire text is join punctuation — the shape of the
 * `&nbsp;`-only heading half. ` ` is deliberately in the class: a
 * non-breaking space is exactly what a `{a}&nbsp;{b}` template emits when `b` is
 * absent, and it is invisible to a `.trim()`-based check.
 */
const JOIN_ONLY = /^[\s ·—–|/,:;.→←]+$/;

function joinJunkLeaves(root: Element): string[] {
  const bad: string[] = [];
  for (const el of root.querySelectorAll('*')) {
    if (el.children.length > 0) continue;
    const text = el.textContent ?? '';
    if (text.length === 0) continue;
    if (JOIN_ONLY.test(text)) bad.push(`<${el.tagName.toLowerCase()}>${text}`);
  }
  return bad;
}

/**
 * AN EMPTY LANDMARK — a grouping element that rendered with nothing in it.
 *
 * This is the defect the sweep found twice, and it is a distinct failure from the
 * hollow shell below: the section as a whole announces plenty, but one of its
 * boxes is empty, and an empty box is not free. `map`'s `.descent__head` carries
 * `margin-block-end: calc(var(--space-12) * var(--jp-rhythm))`, and `invite`'s
 * `.invite__head` sits in a flex column with `gap: var(--invite-block-gap)` — and
 * on `invite: banner` in a `1fr auto` grid, where the empty header takes the
 * whole copy column. So the reader sees a band of nothing, and a screen-reader
 * user is told there is a `header` region that contains nothing at all.
 *
 * `header`/`footer`/`nav`/`aside` are the elements that carry an implicit ARIA
 * role; the list also covers the containers whose emptiness is itself invalid
 * (`ul`/`ol`/`dl` require a child, `figure`/`table` are meaningless without one).
 * `aria-hidden` subtrees are exempt — a decorative empty `<span>` layer is how
 * every atmosphere in this tree is built.
 */
const LANDMARKS = 'header, footer, nav, aside, main, ul, ol, dl, figure, table';

function emptyLandmarks(root: Element): string[] {
  const bad: string[] = [];
  for (const el of root.querySelectorAll(LANDMARKS)) {
    if (el.closest('[aria-hidden="true"]') !== null) continue;
    if (visibleText(el).length > 0) continue;
    const carriers = el.querySelectorAll(
      'img, video, audio, canvas, iframe, svg'
    );
    if ([...carriers].some((c) => c.closest('[aria-hidden="true"]') === null)) {
      continue;
    }
    bad.push(
      `<${el.tagName.toLowerCase()} class=${JSON.stringify(el.className)}> is empty`
    );
  }
  return bad;
}

/**
 * WHETHER THE COMPOSITION REACHED THE COMPONENT'S OWN MARKUP.
 *
 * `SectionFrame` mirrors the resolved variant onto the wrapper as
 * `data-jp-variant`, but that proves only that the FRAME resolved it — until
 * `Codex-qcgo3` the prop was not passed at all and all 37 declared variants were
 * unreachable while the wrapper attribute would have looked perfectly correct. So
 * this reads the SECTION's own root instead, and finds the value without a
 * per-type table of attribute names: ten sections declare it as some
 * `data-*={composition}` and `guide` as a `guide--<composition>` modifier class,
 * and a check that hardcoded either shape would quietly pass for the other.
 */
function declaredComposition(root: Element): string | null {
  const el = root.firstElementChild;
  if (el === null) return null;
  const found = new Set<string>();
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-') && attr.value !== '')
      found.add(attr.value);
  }
  for (const cls of el.classList) {
    const i = cls.indexOf('--');
    if (i > 0) found.add(cls.slice(i + 2));
  }
  return found.size > 0 ? [...found].join(' ') : null;
}

/** A heading whose own text opens or closes on a join glyph. */
function danglingHeadings(root: Element): string[] {
  const bad: string[] = [];
  for (const h of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    // NOT `visibleText` — see `rawText`, which explains the vacuity this fixes.
    const text = rawText(h);
    if (text.length === 0) continue;
    if (/^[ ·—–|/,:;]/.test(text) || /[ ·|/,:;]$/.test(text)) {
      bad.push(`<${h.tagName.toLowerCase()}>${JSON.stringify(text)}`);
    }
  }
  return bad;
}

/**
 * A HOLLOW SHELL: the section drew a subtree and it announces nothing — no text,
 * no media, no control. Two sections used to publish exactly this (a bordered
 * 16:9 letterbox with a decorative play glyph in it) whenever the course had no
 * preview clip.
 */
function isHollow(el: Element): boolean {
  if (el.children.length === 0) return false;
  if (visibleText(el).length > 0) return false;
  const carriers = el.querySelectorAll(
    'img, video, audio, canvas, iframe, a[href], button, input, [role="img"]'
  );
  for (const c of carriers) {
    if (c.closest('[aria-hidden="true"]') === null) return false;
  }
  return true;
}

/** The name a screen reader would give an interactive element. */
function accName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria !== null && aria.trim() !== '') return aria.trim();
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => n !== null)
      .map((n) => visibleText(n));
    if (parts.join(' ').trim() !== '') return parts.join(' ').trim();
  }
  const title = el.getAttribute('title');
  if (title !== null && title.trim() !== '') return title.trim();
  return visibleText(el);
}

/**
 * Glyphs that are DECORATION, never a word. A screen reader announces "right
 * arrow" or "middle dot" for these, so one inside an accessible name is a defect
 * — the fix is an `aria-hidden` wrapper around the glyph, which every CTA on this
 * surface already uses.
 */
const DECORATIVE_GLYPHS = /[←-⇿•·✓✗✕▶▸●★☆↶↷]/u;

const INTERACTIVE = 'a[href], button, [role="button"], summary';

function interactiveDefects(root: Element): string[] {
  const bad: string[] = [];
  for (const el of root.querySelectorAll(INTERACTIVE)) {
    if (el.closest('[aria-hidden="true"]') !== null) continue;
    const tag = el.tagName.toLowerCase();
    const name = accName(el);
    if (name === '') {
      bad.push(`<${tag}> has no accessible name`);
      continue;
    }
    const glyph = name.match(DECORATIVE_GLYPHS);
    if (glyph) {
      bad.push(
        `<${tag}> name ${JSON.stringify(name)} contains decorative glyph U+${glyph[0]
          .codePointAt(0)
          ?.toString(16)
          .toUpperCase()}`
      );
    }
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      if (href === '' || href === '#') {
        bad.push(
          `<a> name ${JSON.stringify(name)} has a dead href ${JSON.stringify(href)}`
        );
      }
    }
  }
  return bad;
}

function imageDefects(root: Element): string[] {
  const bad: string[] = [];
  for (const img of root.querySelectorAll('img')) {
    if (!img.hasAttribute('alt')) {
      bad.push(
        `<img src=${JSON.stringify(img.getAttribute('src'))}> has no alt attribute`
      );
    }
  }
  return bad;
}

/**
 * A media element must either carry its own `controls`, or be decorative — muted
 * AND removed from the accessibility tree. A `<video>` that is neither is a
 * player a keyboard user cannot operate.
 */
function mediaDefects(root: Element): string[] {
  const bad: string[] = [];
  for (const el of root.querySelectorAll('video, audio')) {
    if (el.hasAttribute('controls')) continue;
    const decorative =
      el.hasAttribute('muted') ||
      (el as HTMLMediaElement).muted ||
      el.getAttribute('aria-hidden') === 'true' ||
      el.closest('[aria-hidden="true"]') !== null;
    if (!decorative) {
      bad.push(
        `<${el.tagName.toLowerCase()}> has neither controls nor a decorative marking`
      );
    }
  }
  return bad;
}

/**
 * Heading defects INSIDE one section. Three rules, and the third is the one that
 * needs stating: a section's FIRST heading must be its own top level (`h1` for
 * `hero`, `h2` for the other ten), because a section that opens on an `h3` has
 * orphaned it — `<h1>` → `<h3>` with nothing between. That is reachable here, and
 * DELIBERATELY ACCEPTED on two sections; see the `documented heading trade-off`
 * test, which pins it rather than letting this probe pretend it does not happen.
 */
function headingDefects(root: Element, type: string): string[] {
  const bad: string[] = [];
  const levels = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) =>
    Number(h.tagName.slice(1))
  );
  const h1s = levels.filter((n) => n === 1).length;
  if (type !== 'hero' && h1s > 0) {
    bad.push(`${type} emits ${h1s} <h1> — only hero may`);
  }
  if (type === 'hero' && h1s > 1) {
    bad.push(`hero emits ${h1s} <h1>`);
  }
  const top = type === 'hero' ? 1 : 2;
  if (levels.length > 0 && levels[0] > top) {
    bad.push(`${type} opens on h${levels[0]}, orphaned under h${top}`);
  }
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] - levels[i - 1] > 1) {
      bad.push(`heading level jumps h${levels[i - 1]} → h${levels[i]}`);
    }
  }
  return bad;
}

// ─────────────────────────────────────────────────────────────────────────────
// 0a. THE PROBES THEMSELVES — a sweep that cannot fail proves nothing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every assertion in this file is a NEGATIVE one (`toEqual([])`), and a negative
 * assertion over a probe that has quietly stopped matching is unfailable. All 775
 * of them are green, so nothing downstream would tell you if `accName` started
 * returning `''` for everything or `emptyLandmarks` stopped selecting.
 *
 * These cases are the standing proof that each probe FIRES, on a synthetic DOM
 * rather than by breaking a component — a component flip proves it once, for the
 * agent who did it; this proves it on every run, and it costs no source edit in a
 * tree six other writers are editing at the same time.
 */
describe('the probes fire', () => {
  function frag(html: string): Element {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
  }

  it('emptyLandmarks catches an empty header and spares a decorative one', () => {
    expect(emptyLandmarks(frag('<header>  </header>'))).toHaveLength(1);
    expect(emptyLandmarks(frag('<header><p>Words</p></header>'))).toEqual([]);
    expect(
      emptyLandmarks(frag('<div aria-hidden="true"><header></header></div>'))
    ).toEqual([]);
    expect(
      emptyLandmarks(frag('<figure><img alt="" src="x"></figure>'))
    ).toEqual([]);
  });

  it('joinJunkLeaves catches an nbsp-only leaf', () => {
    expect(joinJunkLeaves(frag('<h2><span>&nbsp;</span></h2>'))).toHaveLength(
      1
    );
    expect(joinJunkLeaves(frag('<h2><span>Bone Deep</span></h2>'))).toEqual([]);
  });

  it('danglingHeadings catches a heading opening on a separator', () => {
    expect(danglingHeadings(frag('<h2>&nbsp;is waiting.</h2>'))).toHaveLength(
      1
    );
    expect(danglingHeadings(frag('<h2>The ground is waiting.</h2>'))).toEqual(
      []
    );
  });

  it('isHollow catches a bordered box with nothing in it', () => {
    expect(
      isHollow(
        frag('<div class="iv__media"><div aria-hidden="true"></div></div>')
      )
    ).toBe(true);
    expect(isHollow(frag('<div><p>Words</p></div>'))).toBe(false);
    expect(isHollow(frag('<div><img alt="A still" src="x"></div>'))).toBe(
      false
    );
  });

  it('interactiveDefects catches a nameless control, a dead href and a glyph name', () => {
    expect(interactiveDefects(frag('<button></button>'))).toHaveLength(1);
    expect(interactiveDefects(frag('<a href="#">Begin</a>'))).toHaveLength(1);
    expect(interactiveDefects(frag('<a href="/x">Begin →</a>'))).toHaveLength(
      1
    );
    expect(
      interactiveDefects(
        frag('<a href="/x">Begin<span aria-hidden="true"> →</span></a>')
      )
    ).toEqual([]);
  });

  it('imageDefects catches a missing alt and accepts an empty one', () => {
    expect(imageDefects(frag('<img src="x">'))).toHaveLength(1);
    expect(imageDefects(frag('<img src="x" alt="">'))).toEqual([]);
  });

  it('mediaDefects catches an uncontrolled, undecorated player', () => {
    expect(mediaDefects(frag('<video src="x"></video>'))).toHaveLength(1);
    expect(mediaDefects(frag('<video src="x" controls></video>'))).toEqual([]);
    expect(
      mediaDefects(frag('<video src="x" muted aria-hidden="true"></video>'))
    ).toEqual([]);
  });

  it('headingDefects catches a stray h1 and an orphaned opening h3', () => {
    expect(headingDefects(frag('<h1>x</h1>'), 'ache')).toHaveLength(1);
    expect(headingDefects(frag('<h3>x</h3>'), 'ache')).toHaveLength(1);
    expect(headingDefects(frag('<h2>x</h2><h3>y</h3>'), 'ache')).toEqual([]);
    expect(headingDefects(frag('<h1>x</h1><h2>y</h2>'), 'hero')).toEqual([]);
    expect(headingDefects(frag('<h2>x</h2><h4>y</h4>'), 'ache')).toHaveLength(
      1
    );
  });

  it('declaredComposition reads both the data-attribute and the modifier-class form', () => {
    expect(declaredComposition(frag('<div data-map="table"></div>'))).toContain(
      'table'
    );
    expect(
      declaredComposition(frag('<div class="guide guide--letter"></div>'))
    ).toContain('letter');
    expect(declaredComposition(frag('<div class="plain"></div>'))).toBeNull();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 0. THE INVENTORY ITSELF
// ─────────────────────────────────────────────────────────────────────────────

describe('the inventory', () => {
  it('is 11 section types and 62 declared (section, variant) pairs', () => {
    expect(TYPES).toHaveLength(11);
    expect(PAIRS).toHaveLength(62);
  });

  it('declares exactly one unbuilt composition, and names its reason', () => {
    const unbuilt = PAIRS.filter((p) => p.unavailable !== undefined);
    expect(unbuilt.map(label)).toEqual(['reel · strip']);
    expect(unbuilt[0].unavailable).toBeTruthy();
  });

  it('resolves every declared variant to itself — no pair is silently remapped', () => {
    for (const p of PAIRS) {
      expect(
        resolveVariant({ type: p.type, variant: p.variant }),
        label(p)
      ).toBe(p.variant);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. RENDERS AT ALL — authored, empty, half-authored
// ─────────────────────────────────────────────────────────────────────────────

describe.each(
  PAIRS.map((p) => [label(p), p] as const)
)('%s', (_name, p: Pair) => {
  it('renders its authored state, and says which composition it drew', async () => {
    try {
      const el = renderFrame(p, authored(p.type));
      await settle();
      expect(el.getAttribute('data-section-type')).toBe(p.type);
      expect(el.getAttribute('data-jp-variant')).toBe(p.variant);
      expect(visibleText(el).length).toBeGreaterThan(0);
      expect(joinJunkLeaves(el)).toEqual([]);
      expect(danglingHeadings(el)).toEqual([]);
      expect(emptyLandmarks(el)).toEqual([]);
    } finally {
      teardown();
    }
  });

  it('draws the composition it was asked for, in its own markup', async () => {
    try {
      const el = renderFrame(p, authored(p.type));
      await settle();
      // `strip` is DECLARED and NOT BUILT: `ReelSection`'s own `COMPOSITIONS`
      // excludes it and clamps to `theatre`. That clamp is the contract the
      // catalogue's `unavailable` field documents, so it is asserted here
      // rather than exempted — a `strip` that started drawing `strip` would
      // mean the picker's disabled state had gone stale.
      const expected = p.unavailable !== undefined ? 'theatre' : p.variant;
      const declared = declaredComposition(el);
      expect(
        declared,
        `${label(p)} declares no composition anywhere`
      ).not.toBeNull();
      expect(
        (declared as string).split(' '),
        `${label(p)} must draw ${expected}`
      ).toContain(expected);
    } finally {
      teardown();
    }
  });

  it('degrades to nothing rather than to a hollow frame when unauthored', async () => {
    try {
      const el = renderFrame(p, {}, { sellPreview: Promise.resolve(NO_MEDIA) });
      await settle();
      expect(isHollow(el), `${label(p)} rendered a hollow shell`).toBe(false);
      expect(joinJunkLeaves(el)).toEqual([]);
      expect(emptyLandmarks(el)).toEqual([]);
    } finally {
      teardown();
    }
  });

  it('joins cleanly when only half its copy is authored', async () => {
    try {
      const el = renderFrame(p, halfAuthored(p.type));
      await settle();
      expect(joinJunkLeaves(el)).toEqual([]);
      expect(danglingHeadings(el)).toEqual([]);
      expect(emptyLandmarks(el)).toEqual([]);
      expect(isHollow(el)).toBe(false);
    } finally {
      teardown();
    }
  });

  it('sends an ENROLLED member to their dashboard, never to checkout', async () => {
    try {
      const el = renderFrame(p, authored(p.type), { enrolled: true });
      await settle();
      const hrefs = [...el.querySelectorAll('a[href]')].map(
        (a) => a.getAttribute('href') ?? ''
      );
      expect(
        hrefs.filter((h) => h.includes('/checkout')),
        `${label(p)} sends an enrolled member to checkout`
      ).toEqual([]);
    } finally {
      teardown();
    }
  });

  it('never renders a media shell when the sell preview resolves empty', async () => {
    try {
      const el = renderFrame(p, authored(p.type), {
        sellPreview: Promise.resolve(NO_MEDIA),
      });
      await settle();
      // No source-less media element, and no "play" affordance with nothing
      // behind it: a `<video>`/`<audio>` with no `src` and no `<source>` child
      // is the hollow player this sweep exists to catch.
      for (const media of el.querySelectorAll('video, audio')) {
        const hasSource =
          (media.getAttribute('src') ?? '') !== '' ||
          media.querySelector('source[src]') !== null;
        expect(
          hasSource,
          `${label(p)} emitted a source-less <${media.tagName.toLowerCase()}>`
        ).toBe(true);
      }
      expect(isHollow(el)).toBe(false);
    } finally {
      teardown();
    }
  });

  // ─── 2. NO DEAD-END AFFORDANCE ───────────────────────────────────────────

  it('offers no purchase when the course cannot be sold', async () => {
    try {
      const el = renderFrame(p, authored(p.type), {
        purchasable: false,
        offer: {
          courseId: 'course-1',
          organizationId: 'org-1',
          paths: [],
          purchase: null,
          subscription: null,
          tiers: [],
          entitled: false,
        },
      });
      await settle();
      const toCheckout = [...el.querySelectorAll('a[href]')].filter((a) =>
        (a.getAttribute('href') ?? '').includes('/checkout')
      );
      expect(
        toCheckout.map((a) => accName(a)),
        `${label(p)} still links to checkout on an unpurchasable course`
      ).toEqual([]);
      // AND NO PRICE. A course with no offer path has no price to state, so a
      // `£` anywhere in this render could only come from authored copy being
      // treated as a price — the defect `InviteOffer.priceLabel` was deleted
      // for (a page advertising "£12 a month" for a path that did not exist).
      expect(
        visibleText(el).includes('£'),
        `${label(p)} states a price on an unpurchasable course`
      ).toBe(false);
    } finally {
      teardown();
    }
  });

  /**
   * THE POSITIVE CONTROL for the two negatives above. `toEqual([])` over a
   * checkout-link filter is unfailable if no section ever links to checkout —
   * and only `hero` and `invite` do, so without this the other nine pairs'
   * "offers no purchase" and "sends an enrolled member to their dashboard"
   * assertions are vacuously true and would stay green if the CTA disappeared
   * entirely. This states which pairs MUST carry the affordance.
   */
  it('carries the purchase affordance when there IS one to carry', async () => {
    const offers = p.type === 'hero' || p.type === 'invite';
    try {
      const el = renderFrame(p, authored(p.type));
      await settle();
      const toCheckout = [...el.querySelectorAll('a[href]')].filter((a) =>
        (a.getAttribute('href') ?? '').includes('/checkout')
      );
      if (offers) {
        expect(
          toCheckout.length,
          `${label(p)} must offer a purchase on a purchasable course`
        ).toBeGreaterThan(0);
        for (const a of toCheckout) expect(accName(a)).not.toBe('');
      } else {
        expect(toCheckout).toEqual([]);
      }
    } finally {
      teardown();
    }
  });

  it('never affects the page SHAPE — the codes are variant-blind', () => {
    const codes = validatePageShape([
      {
        id: 'only',
        type: p.type,
        enabled: true,
        variant: p.variant,
        props: {},
      },
    ])
      .map((i) => i.code)
      .sort();
    const expected =
      p.type === 'hero'
        ? []
        : p.type === 'invite'
          ? ['no-hero']
          : ['no-cta', 'no-hero'];
    expect(codes, label(p)).toEqual(expected);
  });

  it('has no present-and-inert affordance', async () => {
    try {
      const el = renderFrame(p, authored(p.type));
      await settle();
      expect(interactiveDefects(el)).toEqual([]);
    } finally {
      teardown();
    }
  });

  // ─── 3. ACCESSIBLE ───────────────────────────────────────────────────────

  it('is accessible in markup — headings, alt text, media controls', async () => {
    try {
      const el = renderFrame(p, authored(p.type));
      await settle();
      expect(headingDefects(el, p.type)).toEqual([]);
      expect(imageDefects(el)).toEqual([]);
      expect(mediaDefects(el)).toEqual([]);
      expect(emptyLandmarks(el)).toEqual([]);
    } finally {
      teardown();
    }
  });

  it('is accessible in markup with media resolved and with none', async () => {
    for (const preview of [PREVIEW, NO_MEDIA, null]) {
      try {
        const el = renderFrame(p, authored(p.type), {
          sellPreview: Promise.resolve(preview),
        });
        await settle();
        expect(headingDefects(el, p.type)).toEqual([]);
        expect(imageDefects(el)).toEqual([]);
        expect(mediaDefects(el)).toEqual([]);
        expect(interactiveDefects(el)).toEqual([]);
      } finally {
        teardown();
      }
    }
  });

  // ─── 4. TITLE-CLAIM, per pair ────────────────────────────────────────────

  it('prints the course title only when the page hands it the claim', async () => {
    const claimant = ['hero', 'introVideo', 'reel', 'map', 'invite'].includes(
      p.type
    );
    try {
      const el = renderFrame(p, {}, { sellPreview: Promise.resolve(NO_MEDIA) });
      await settle();
      const headings = [...el.querySelectorAll('h1, h2')].map((h) =>
        visibleText(h)
      );
      if (claimant && p.type !== 'hero') {
        // Not the claimant ⇒ the heading element self-hides entirely rather
        // than printing a title another section is already printing.
        expect(
          headings.filter((h) => h === COURSE_TITLE),
          `${label(p)} printed the title without the claim`
        ).toEqual([]);
      } else if (!claimant) {
        expect(headings.filter((h) => h === COURSE_TITLE)).toEqual([]);
      }
    } finally {
      teardown();
    }

    if (!claimant) return;

    try {
      const el = renderFrame(
        p,
        {},
        { sellPreview: Promise.resolve(NO_MEDIA) },
        COURSE_TITLE
      );
      await settle();
      const headings = [...el.querySelectorAll('h1, h2')].map((h) =>
        visibleText(h)
      );
      expect(
        headings.filter((h) => h === COURSE_TITLE).length,
        `${label(p)} holds the claim and must print the title exactly once`
      ).toBe(1);
    } finally {
      teardown();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4b. TITLE-CLAIM, at the PAGE level — the property no section can see
// ─────────────────────────────────────────────────────────────────────────────

describe('the title fallback, across a whole page', () => {
  const CLAIMANTS = ['hero', 'introVideo', 'reel', 'map', 'invite'] as const;

  function page(sections: PageSection[]) {
    mounted = mount(SectionRenderer, {
      target: document.body,
      props: { sections, context: context() },
    });
    flushSync();
    return document.body;
  }

  function titlePrints(root: Element): number {
    return [...root.querySelectorAll('h1, h2')].filter(
      (h) => visibleText(h) === COURSE_TITLE
    ).length;
  }

  const blank = (type: string, id = type): PageSection => ({
    id,
    type,
    enabled: true,
    props: {},
  });

  it('prints the title once on a page where all five claimants are blank', async () => {
    try {
      const root = page(CLAIMANTS.map((t) => blank(t)));
      await settle();
      expect(titlePrints(root)).toBe(1);
    } finally {
      teardown();
    }
  });

  it('gives the claim to the hero wherever it sits', async () => {
    try {
      const root = page([blank('map'), blank('hero'), blank('invite')]);
      await settle();
      expect(titlePrints(root)).toBe(1);
      expect(visibleText(root.querySelector('h1') as Element)).toBe(
        COURSE_TITLE
      );
    } finally {
      teardown();
    }
  });

  it('prints it once when the first claimant is DISABLED — not zero', async () => {
    const sections: PageSection[] = [
      { id: 'map', type: 'map', enabled: false, props: {} },
      blank('invite'),
    ];
    expect(claimTitleFallback(selectRenderableSections(sections))).toBe(
      'invite'
    );
    try {
      const root = page(sections);
      await settle();
      expect(titlePrints(root)).toBe(1);
    } finally {
      teardown();
    }
  });

  it('prints it once when the first claimant is an UNKNOWN type — not zero', async () => {
    const sections: PageSection[] = [
      { id: 'x', type: 'someFutureSection', enabled: true, props: {} },
      blank('map'),
    ];
    expect(claimTitleFallback(selectRenderableSections(sections))).toBe('map');
    try {
      const root = page(sections);
      await settle();
      expect(titlePrints(root)).toBe(1);
    } finally {
      teardown();
    }
  });

  it('prints it zero times when every claimant authored its own heading', async () => {
    const sections: PageSection[] = CLAIMANTS.map((t) => ({
      id: t,
      type: t,
      enabled: true,
      props: { heading: 'Authored', headline: 'Authored', title: 'Authored' },
    }));
    expect(claimTitleFallback(selectRenderableSections(sections))).toBeNull();
    try {
      const root = page(sections);
      await settle();
      expect(titlePrints(root)).toBe(0);
    } finally {
      teardown();
    }
  });

  it('prints it once per page for every claimant paired with an authored hero', async () => {
    for (const t of CLAIMANTS.filter((c) => c !== 'hero')) {
      try {
        const root = page([
          {
            id: 'hero',
            type: 'hero',
            enabled: true,
            props: { headline: 'Mine' },
          },
          blank(t),
        ]);
        await settle();
        expect(titlePrints(root), `hero + blank ${t}`).toBe(1);
      } finally {
        teardown();
      }
    }
  });

  it('serves exactly one <h1> even when the page holds two heroes', async () => {
    try {
      const root = page([
        { id: 'h1', type: 'hero', enabled: true, props: { headline: 'First' } },
        {
          id: 'h2',
          type: 'hero',
          enabled: true,
          props: { headline: 'Second' },
        },
      ]);
      await settle();
      expect(root.querySelectorAll('h1')).toHaveLength(1);
      expect([
        ...root.querySelectorAll('[data-section-type="hero"]'),
      ]).toHaveLength(2);
      expect(
        [...root.querySelectorAll('section[id]')].map((s) => s.id)
      ).toEqual(['hero', 'hero-2']);
    } finally {
      teardown();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3a. THE ONE ACCEPTED ACCESSIBILITY TRADE-OFF, PINNED RATHER THAN HIDDEN
// ─────────────────────────────────────────────────────────────────────────────

describe('the documented heading trade-off', () => {
  /**
   * WHAT THIS PINS, AND WHY IT IS NOT A BUG REPORT.
   *
   * Two sections render headings from CONTEXT data rather than from authored copy
   * — `map`'s `<h3>` stage names come from `context.stages`, `invite`'s `<h3>`
   * path names from `context.offer` — so both still emit an `<h3>` after their own
   * `<h2>` has self-hidden for want of the title claim. On an under-authored page
   * the outline is therefore `<h1>` … `<h3>` with nothing between.
   *
   * BOTH FILES ALREADY ARGUE FOR THIS, EXPLICITLY, AND THE ARGUMENT IS SOUND.
   * `MapSection` preserves its original "the heading is NOT allowed to self-hide"
   * rule verbatim and then overrules it in writing: "A skipped heading LEVEL
   * (h1 → h3 inside this section) is valid HTML and an advisory `heading-order`
   * finding. A heading that repeats the page title four times is neither valid
   * information architecture nor advisory." `InviteSection` reaches the same
   * conclusion from the other side: "An EMPTY `<h2>` would be worse than none:
   * this is the only `<h2>` in the tree carrying `--text-display` (80px on the
   * seeded pages), so a blank one is a screenful of nothing."
   *
   * So this sweep does NOT change either file. It pins the trade-off in a test, so
   * that (a) the accepted set stays EXACTLY these two sections — a third one
   * joining it fails here — and (b) the reachability stays what the comments claim:
   * unreachable on any page whose heading is authored, which is all seven seeded
   * pages and every page the builder creates, since `defaultProps` seeds the
   * heading.
   */
  const ACCEPTED = new Set(['map', 'invite']);

  it('is reachable on exactly two sections, and only when the heading is cleared', async () => {
    const offenders = new Set<string>();
    for (const p of PAIRS) {
      try {
        const el = renderFrame(
          p,
          {},
          { sellPreview: Promise.resolve(NO_MEDIA) }
        );
        await settle();
        if (headingDefects(el, p.type).length > 0) offenders.add(p.type);
      } finally {
        teardown();
      }
    }
    expect([...offenders].sort()).toEqual([...ACCEPTED].sort());
  });

  it('is not reachable once the heading is authored, on any pair', async () => {
    for (const p of PAIRS) {
      try {
        const el = renderFrame(p, authored(p.type));
        await settle();
        expect(headingDefects(el, p.type), label(p)).toEqual([]);
      } finally {
        teardown();
      }
    }
  });

  it('is not reachable when the page hands the section the title claim', async () => {
    for (const type of ACCEPTED) {
      const p = PAIRS.find((x) => x.type === type) as Pair;
      try {
        const el = renderFrame(
          p,
          {},
          { sellPreview: Promise.resolve(NO_MEDIA) },
          COURSE_TITLE
        );
        await settle();
        expect(headingDefects(el, p.type), type).toEqual([]);
      } finally {
        teardown();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3b. ACCESSIBLE ACROSS A WHOLE PAGE — the property no single section can hold
// ─────────────────────────────────────────────────────────────────────────────

describe('a whole page, assembled from every section type', () => {
  /**
   * The catalogue in ship order, every section authored from its own
   * `defaultProps` — i.e. what a creator gets by adding all eleven and typing
   * nothing. Every composition is swept per-pair above; the page-level properties
   * only need ONE composition each, so the type's own default is used.
   */
  function wholePage(
    variantOf: (type: string) => string | undefined = () => undefined
  ) {
    const sections: PageSection[] = SECTION_CATALOG.map((def) => ({
      id: def.type,
      type: def.type,
      enabled: true,
      variant: variantOf(def.type),
      props: authored(def.type),
    }));
    mounted = mount(SectionRenderer, {
      target: document.body,
      props: { sections, context: context() },
    });
    flushSync();
    return document.body;
  }

  it('serves exactly one <h1>, and it is the hero', async () => {
    try {
      const root = wholePage();
      await settle();
      const h1s = [...root.querySelectorAll('h1')];
      expect(h1s).toHaveLength(1);
      expect(
        h1s[0].closest('[data-section-type]')?.getAttribute('data-section-type')
      ).toBe('hero');
    } finally {
      teardown();
    }
  });

  it('never skips a heading level, in document order', async () => {
    try {
      const root = wholePage();
      await settle();
      const levels = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(
        (h) => ({ level: Number(h.tagName.slice(1)), text: visibleText(h) })
      );
      expect(levels.length).toBeGreaterThan(1);
      const skips: string[] = [];
      for (let i = 1; i < levels.length; i += 1) {
        if (levels[i].level - levels[i - 1].level > 1) {
          skips.push(
            `h${levels[i - 1].level} ${JSON.stringify(levels[i - 1].text)} → h${levels[i].level} ${JSON.stringify(levels[i].text)}`
          );
        }
      }
      expect(skips).toEqual([]);
    } finally {
      teardown();
    }
  });

  it('gives every section a unique anchor id, in ship order', async () => {
    try {
      const root = wholePage();
      await settle();
      const ids = [...root.querySelectorAll('section[id]')].map((s) => s.id);
      expect(ids).toEqual(TYPES);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      teardown();
    }
  });

  it('has no dead-end affordance and no empty landmark anywhere on it', async () => {
    try {
      const root = wholePage();
      await settle();
      expect(interactiveDefects(root)).toEqual([]);
      expect(imageDefects(root)).toEqual([]);
      expect(mediaDefects(root)).toEqual([]);
      expect(emptyLandmarks(root)).toEqual([]);
      expect(joinJunkLeaves(root)).toEqual([]);
      expect(danglingHeadings(root)).toEqual([]);
    } finally {
      teardown();
    }
  });

  it('prints the course title at most once across all eleven sections', async () => {
    try {
      const root = wholePage();
      await settle();
      const prints = [...root.querySelectorAll('h1, h2, h3')].filter(
        (h) => visibleText(h) === COURSE_TITLE
      );
      // Every section is authored here, so no claim is spent at all.
      expect(prints).toHaveLength(0);
    } finally {
      teardown();
    }
  });

  it('holds all of it together at the OTHER pole of every composition', async () => {
    // The LAST declared variant of each type rather than the default — so the
    // page-level assertions are not only ever exercised against the eleven
    // default compositions.
    const last = new Map<string, string | undefined>(
      SECTION_CATALOG.map((d) => [
        d.type as string,
        d.variants[d.variants.length - 1]?.id,
      ])
    );
    try {
      const root = wholePage((t) => last.get(t));
      await settle();
      expect(root.querySelectorAll('h1')).toHaveLength(1);
      expect(interactiveDefects(root)).toEqual([]);
      expect(imageDefects(root)).toEqual([]);
      expect(mediaDefects(root)).toEqual([]);
      expect(emptyLandmarks(root)).toEqual([]);
    } finally {
      teardown();
    }
  });

  it('serves a page with NOTHING authored anywhere without a single defect', async () => {
    const sections: PageSection[] = SECTION_CATALOG.map((def) => ({
      id: def.type,
      type: def.type,
      enabled: true,
      props: {},
    }));
    try {
      mounted = mount(SectionRenderer, {
        target: document.body,
        props: {
          sections,
          context: context({ sellPreview: Promise.resolve(NO_MEDIA) }),
        },
      });
      flushSync();
      await settle();
      const root = document.body;
      expect(root.querySelectorAll('h1')).toHaveLength(1);
      expect(interactiveDefects(root)).toEqual([]);
      expect(emptyLandmarks(root)).toEqual([]);
      expect(joinJunkLeaves(root)).toEqual([]);
      for (const sec of root.querySelectorAll('[data-section-type]')) {
        expect(
          isHollow(sec),
          `${sec.getAttribute('data-section-type')} is a hollow shell on a blank page`
        ).toBe(false);
      }
      // The claim is spent exactly once, by the heading-less hero.
      const prints = [...root.querySelectorAll('h1, h2, h3')].filter(
        (h) => visibleText(h) === COURSE_TITLE
      );
      expect(prints).toHaveLength(1);
      expect(prints[0].tagName).toBe('H1');
    } finally {
      teardown();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SHAPE VALIDITY — every combination buildable from these types
// ─────────────────────────────────────────────────────────────────────────────

describe('validatePageShape, over the whole catalogue', () => {
  const on = (type: string, id = type): PageSection => ({
    id,
    type,
    enabled: true,
    props: {},
  });
  const codes = (sections: PageSection[]) =>
    validatePageShape(sections)
      .map((i) => i.code)
      .sort();

  it('calls an empty page empty', () => {
    expect(codes([])).toEqual(['empty-page']);
  });

  it('calls an all-disabled page empty, for every type', () => {
    for (const t of TYPES) {
      expect(codes([{ ...on(t), enabled: false }]), t).toEqual(['empty-page']);
    }
  });

  it('calls an all-unknown page empty', () => {
    expect(codes([on('someFutureSection')])).toEqual(['empty-page']);
  });

  it('passes a lone hero', () => {
    expect(codes([on('hero')])).toEqual([]);
  });

  it('passes the catalogue in its ship order', () => {
    expect(codes(TYPES.map((t) => on(t)))).toEqual([]);
  });

  it('flags two heroes wherever the duplicate sits', () => {
    expect(codes([on('hero', 'a'), on('hero', 'b')])).toEqual([
      'multiple-hero',
    ]);
    expect(codes([on('hero', 'a'), on('ache'), on('hero', 'b')])).toEqual([
      'multiple-hero',
    ]);
  });

  it('flags a hero that is not first, and only warns', () => {
    expect(codes([on('ache'), on('hero')])).toEqual(['hero-not-first']);
    expect(
      validatePageShape([on('ache'), on('hero')]).map((i) => i.severity)
    ).toEqual(['warn']);
  });

  it('does not flag hero-not-first when a DISABLED section precedes the hero', () => {
    expect(codes([{ ...on('ache'), enabled: false }, on('hero')])).toEqual([]);
  });

  it('names both defects of a page with no hero and no invite, for every type', () => {
    for (const t of TYPES.filter((x) => x !== 'hero' && x !== 'invite')) {
      expect(codes([on(t)]), t).toEqual(['no-cta', 'no-hero']);
    }
  });

  it('accepts an invite-only page as a warn, never an error', () => {
    expect(codes([on('ache'), on('invite')])).toEqual(['no-hero']);
    expect(
      validatePageShape([on('ache'), on('invite')]).every(
        (i) => i.severity === 'warn'
      )
    ).toBe(true);
  });

  it('keeps exactly two error codes and three severities stable', () => {
    const all = [
      ...validatePageShape([]),
      ...validatePageShape([on('hero', 'a'), on('hero', 'b')]),
      ...validatePageShape([on('ache')]),
      ...validatePageShape([on('ache'), on('hero')]),
    ];
    const bySeverity = new Map<string, string[]>();
    for (const issue of all) {
      const list = bySeverity.get(issue.severity) ?? [];
      list.push(issue.code);
      bySeverity.set(issue.severity, list);
    }
    expect([...(bySeverity.get('error') ?? [])].sort()).toEqual([
      'empty-page',
      'multiple-hero',
      'no-cta',
    ]);
    expect([...(bySeverity.get('warn') ?? [])].sort()).toEqual([
      'hero-not-first',
      'no-hero',
    ]);
  });
});
