/**
 * THE ARRANGEMENT FINGERPRINT (Codex-sf7t6's browser half).
 *
 * WHAT IT IS FOR. The studio canvas and the published sales page render the same
 * sections through the same `SectionFrame`, so they cannot disagree about WHICH
 * sections render or WHICH composition each resolves to — that is
 * single-sourced. What they CAN disagree about is GEOMETRY, and they did: the
 * canvas used to give `.jp-sec` a 674px container while labelling it "Desktop",
 * so 8 of the journey CSS's 19 `@container` rules resolved to the opposite
 * branch and two of the six hero compositions were authored as one composition
 * and published as another. jsdom cannot see any of that (it implements neither
 * `container-type`/`cqw` nor `color-mix()`), which is why the structural half of
 * this guard lives in a `.svelte.test.ts` and the geometric half has to be a
 * browser spec.
 *
 * WHY IT IS VOCABULARY-INDEPENDENT. Every field is counted off computed geometry
 * and element names — never a class name, a token, an axis attribute or a string
 * of copy. A class rename, a token rename or a copy edit cannot move it; a
 * composition collapsing from two columns to one moves it immediately.
 *
 * ── WHY "TEXT BLOCKS" AND NOT "TEXT LEAVES" ───────────────────────────────────
 * The bead asks for a text-bearing LEAF count. Measured, that field is
 * over-sensitive and reports a divergence that does not exist: the public hero
 * splits its headline into one `<span class="hero__word">` per word for the
 * kinetic stagger, and the canvas deliberately does not — "a contenteditable
 * node cannot be a bag of spans without the caret fighting the re-render"
 * (`HeroSection.svelte`). So `Ancestral Threads` is 2 leaves on the page and 1 in
 * the canvas, at the same x, the same y, the same font, looking identical. Naive
 * leaf counting called that a hero divergence.
 *
 * Collapsing each text-bearing leaf to its nearest NON-INLINE-LEVEL ancestor
 * fixes it exactly: the word spans and the single editable span both resolve to
 * the same `<h1>`. `inline-block` and `inline-flex` count as inline-level for
 * this walk, because `.hero--enhanced .hero__word` is `inline-block` and the
 * enhancement class is applied from JS — i.e. it can differ between two trees
 * for reasons that have nothing to do with the composition.
 *
 * ── WHY THE COARSE TOLERANCES ─────────────────────────────────────────────────
 * Both x-clustering and side-by-side detection were knife-edge at fine
 * tolerances, and both flipped on differences of ONE TO TWO PIXELS caused by the
 * trailing space in the word split. A 1% cluster tolerance reported 4 columns on
 * the page and 3 in the canvas for the same centred stack; an
 * edges-do-not-overlap side-by-side test reported 17 pairs against 14 for a
 * layout whose column count and aspect ratio agreed exactly. The tolerances
 * below are sized to the thing being detected — a composition change moves a
 * block by tens of percent of the section width, never by one pixel — and were
 * then verified to be reproducible: two consecutive runs on both trees produced
 * byte-identical fingerprints for all four sections.
 */

import type { Page } from '@playwright/test';

export interface SectionFingerprint {
  /** `data-section-type` — the section's identity in DOM order. */
  readonly type: string;
  /** `data-jp-variant` — the RESOLVED composition, not the stored one. */
  readonly variant: string;
  /**
   * The section's own layout inline size — the width every `@container` rule in
   * the journey CSS resolves against, because `.jp-sec` is the container root.
   *
   * `offsetWidth`, NOT `getBoundingClientRect().width`. The canvas renders at a
   * real device width and is `transform: scale()`d to fit its column: the same
   * element reports 1440 (layout) and ~676 (painted). Container queries resolve
   * against the layout width, so that is the number that has to match.
   */
  readonly containerWidth: number;
  /** Distinct blocks of text the section paints (see the note on leaves above). */
  readonly textBlocks: number;
  /** Those blocks' element names in DOM order — structure without vocabulary. */
  readonly blockTags: string;
  /** How many distinct x positions those blocks start at (3% of section width). */
  readonly columns: number;
  /**
   * How many blocks sit shoulder-to-shoulder with a distant neighbour: vertical
   * overlap over half the shorter box AND horizontal centres more than a quarter
   * of the section apart. This is the "media beside copy" signal — the term that
   * moves when a `@container` rule stacks a split composition.
   */
  readonly shoulders: number;
  /** The section's aspect ratio, to 2dp. Scale-invariant, so the canvas transform cancels. */
  readonly aspect: number;
}

/**
 * Collect one fingerprint per `.jp-sec` inside `rootSelector`, in DOM order.
 *
 * The caller is responsible for having settled the tree and forced the reveals
 * first (see `helpers/journeys.ts` — `settleSubtree`, `forceRevealsIn`). This
 * function deliberately does no waiting of its own: a helper that waits inside a
 * measurement is a helper that hides which wait was the necessary one.
 */
export async function collectFingerprints(
  page: Page,
  rootSelector: string
): Promise<SectionFingerprint[]> {
  return page.evaluate((selector) => {
    const root =
      selector === ':root'
        ? document.documentElement
        : document.querySelector(selector);
    if (!root) return [];

    // Inline-LEVEL displays. `contents` is here because an element with
    // `display: contents` has no box of its own, so it can never be the block a
    // run of text belongs to.
    const INLINE_LEVEL = new Set([
      'inline',
      'inline-block',
      'inline-flex',
      'inline-grid',
      'inline-table',
      'contents',
      'ruby',
      'ruby-text',
      'ruby-base',
    ]);

    return [...root.querySelectorAll('.jp-sec')].map((section) => {
      const sectionBox = section.getBoundingClientRect();
      const sectionEl = section as HTMLElement;

      const leaves = [...section.querySelectorAll('*')].filter(
        (node) =>
          node.children.length === 0 &&
          (node.textContent ?? '').trim().length > 0
      );

      const blocks: Element[] = [];
      for (const leaf of leaves) {
        let element: Element = leaf;
        while (
          element !== section &&
          element.parentElement &&
          INLINE_LEVEL.has(getComputedStyle(element).display)
        ) {
          element = element.parentElement;
        }
        if (!blocks.includes(element)) blocks.push(element);
      }

      const boxes = blocks.map((block) => block.getBoundingClientRect());

      // Columns: normalised left edges, chained into clusters at a 3% tolerance.
      // Normalising by the SECTION's own width is what makes this survive the
      // canvas's scale transform without knowing the scale factor.
      const lefts = boxes
        .map((box) => (box.left - sectionBox.left) / sectionBox.width)
        .sort((a, b) => a - b);
      const clusters: number[] = [];
      for (const left of lefts) {
        if (
          clusters.length === 0 ||
          left - clusters[clusters.length - 1] > 0.03
        ) {
          clusters.push(left);
        }
      }

      // Shoulders: counted PER BLOCK (does this block have any distant peer in
      // its own horizontal band?) rather than per pair. A per-block boolean is
      // far less sensitive to one box on a boundary than an O(n^2) pair count,
      // which was measured flipping by 3 on identical layouts.
      let shoulders = 0;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = 0; j < boxes.length; j++) {
          if (i === j) continue;
          const a = boxes[i];
          const b = boxes[j];
          const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          const shorter = Math.min(a.height, b.height);
          const centreGap =
            Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2) /
            sectionBox.width;
          if (shorter > 0 && overlap > 0.5 * shorter && centreGap > 0.25) {
            shoulders++;
            break;
          }
        }
      }

      return {
        type: sectionEl.dataset.sectionType ?? '',
        variant: sectionEl.dataset.jpVariant ?? '',
        containerWidth: sectionEl.offsetWidth,
        textBlocks: blocks.length,
        blockTags: blocks.map((block) => block.tagName).join(','),
        columns: clusters.length,
        shoulders,
        aspect:
          sectionBox.height > 0
            ? Math.round((sectionBox.width / sectionBox.height) * 100) / 100
            : 0,
      };
    });
  }, rootSelector);
}

/**
 * Human-readable, per-section diff of two fingerprint arrays.
 *
 * Returned as lines rather than thrown, so a spec can attach the whole thing to
 * one assertion message and NAME THE SECTION that diverged — which is what the
 * bead asks for and what a bare `toEqual` on two arrays does not give you.
 */
export function diffFingerprints(
  canvas: readonly SectionFingerprint[],
  published: readonly SectionFingerprint[]
): string[] {
  const lines: string[] = [];
  if (canvas.length !== published.length) {
    lines.push(
      `section count: canvas ${canvas.length} vs published ${published.length}`
    );
  }
  const length = Math.max(canvas.length, published.length);
  for (let index = 0; index < length; index++) {
    const a = canvas[index];
    const b = published[index];
    if (!a || !b) {
      lines.push(
        `[${index}] present only in ${a ? 'canvas' : 'published'}: ` +
          JSON.stringify(a ?? b)
      );
      continue;
    }
    const label = `${a.type === b.type ? a.type : `${a.type}/${b.type}`}[${index}]`;
    for (const key of [
      'type',
      'variant',
      'containerWidth',
      'textBlocks',
      'blockTags',
      'columns',
      'shoulders',
      'aspect',
    ] as const) {
      if (a[key] !== b[key]) {
        lines.push(`${label} ${key}: canvas ${a[key]} vs published ${b[key]}`);
      }
    }
  }
  return lines;
}
