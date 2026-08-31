/**
 * THE CANVAS SHOWS THE PAGE IT WILL ACTUALLY PUBLISH — the browser half of
 * Codex-sf7t6.
 *
 * The structural half already exists in
 * `src/lib/components/page-builder/canvas-public-parity.svelte.test.ts` and
 * cannot be extended to cover this: jsdom implements neither
 * `container-type`/`cqw` nor `color-mix()`, so it can say nothing true about
 * geometry. That file's own header says so. This is the half that found the
 * divergence, and until now it did not exist.
 *
 * WHAT WAS ACTUALLY WRONG. The canvas used to be `width: 100%; max-width: 1080px`
 * inside a 708px studio column, so at a 1440 viewport `.jp-sec` measured 674px
 * while the published page's measured 1376px — and the device toggle still
 * reported `aria-pressed="true"` on "Desktop". `.jp-sec` is the
 * container-query root, so of the journey CSS's 19 `@container` rules, 8
 * resolved to the OPPOSITE branch, including the one that stacks
 * `hero.split-media` into a single column and lifts the media above the copy.
 * Two of the six hero compositions an author picks from in LAYOUT · OPTIONS were
 * authored as one composition and published as another. It survived four rounds
 * of review because the INNER copy column is capped at 768px on both sides, so
 * the text measure looks about right either way; it is the compositions that
 * place media BESIDE copy that switch.
 *
 * ── THE TWO TRAPS THE BEAD NAMES, AND WHERE THEY ARE HANDLED ──────────────────
 * 1. THE CANVAS LOADS ASYNCHRONOUSLY, from SEVEN remote reads of which the two
 *    the canvas renders from land LAST: the curriculum at ~10.6s and the offer at
 *    ~12.6s. Measured on one section: 0 descendants at 5.1s, 82 at 7.2s. A
 *    stability-only wait converges in the GAP between two feeds — it returned
 *    after ~2.5s with the invite section still drawing its price-less branch (5
 *    text blocks against the published page's 10), and an 8s floor still lost the
 *    race on a second run. `settleBuilderCanvas` therefore waits for NETWORK IDLE
 *    (deterministic: every read has answered) and only then for the DOM to
 *    settle. A fixed timeout here makes this spec PASS while broken.
 * 2. THE TWO TREES MUST BE MEASURED AT THE SAME INLINE SIZE. The original audit
 *    compared a 834px canvas column against a 770px viewport and concluded
 *    nothing. `matchInlineSize` resizes the public viewport until `.jp-sec`'s own
 *    `offsetWidth` equals the canvas's — the container-query width, which is
 *    `offsetWidth` and NOT `getBoundingClientRect().width`: the canvas renders at
 *    a real 1440 and is `transform: scale()`d, so the same element reports 1440
 *    (layout, what the container query uses) and ~676 (painted).
 *
 * ── ONE KNOWN, DELIBERATE DIVERGENCE, AND WHY THIS FIXTURE AVOIDS IT ──────────
 * `builderSalesContext` pins `purchasable: true` unconditionally, with a comment
 * explaining the trade: an author must not lose sight of the button they are
 * designing around, and the studio commonly has no offer read at all. So on a
 * NON-purchasable page the canvas shows a hero CTA the published page withholds.
 * This spec therefore runs on `of-blood-and-bones/ancestral-threads`
 * (price_cents 4900), where both trees agree that the course sells — which
 * removes the documented divergence from the measurement instead of tolerating
 * it, and keeps the fingerprint's equality assertion exact.
 */

import { expect, test } from '@playwright/test';
import {
  collectFingerprints,
  diffFingerprints,
} from '../helpers/journey-fingerprint';
import {
  expectSellPageRendered,
  forceRevealsIn,
  journeyFixture,
  journeyUrl,
  matchInlineSize,
  orgUrl,
  resolveBuilderPageId,
  settleBuilderCanvas,
  settleSubtree,
  signInAsSeededUser,
} from '../helpers/journeys';

const FIXTURE = journeyFixture('of-blood-and-bones', 'ancestral-threads');

/**
 * ONE height for both trees. The desktop preset carries `height: null`
 * deliberately — "there the studio window IS a desktop viewport, so the real
 * `svh` is the honest answer" — which means the hero's
 * `min-height: min(100svh, …)` resolves against the WINDOW. Two windows of
 * different heights would give the two trees different hero aspect ratios for a
 * reason that has nothing to do with the composition.
 */
const VIEWPORT_HEIGHT = 900;

/** The desktop preset's real width, from `JOURNEY_PREVIEW_DEVICES`. */
const DESKTOP_WIDTH = 1440;

test.beforeAll(async ({ request }) => {
  try {
    const response = await request.get('http://localhost:42069/health');
    if (!response.ok()) {
      test.skip(true, 'Auth worker not running on port 42069');
    }
  } catch {
    test.skip(true, 'Auth worker not running on port 42069');
  }
});

/**
 * Longer than the suite's 90s default, and the budget is spent on ONE thing: the
 * builder's seven sequential remote reads take ~13s to quiesce against the local
 * stack (see `settleBuilderCanvas`), and the parity test drives the builder AND a
 * second signed-out context. Cutting the wait is the one change that would make
 * this spec pass while measuring a half-loaded canvas.
 */
test.describe.configure({ timeout: 180_000 });

test.describe('journey builder canvas · fidelity to the published page', () => {
  test('the device presets give .jp-sec a real device inline size', async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({
      width: DESKTOP_WIDTH,
      height: VIEWPORT_HEIGHT,
    });
    await signInAsSeededUser(page, FIXTURE.owner);
    const pageId = await resolveBuilderPageId(page, FIXTURE, baseURL as string);
    await page.goto(
      orgUrl(baseURL as string, FIXTURE.org, `/studio/journeys/${pageId}/page`)
    );
    await settleBuilderCanvas(page);

    /**
     * `offsetWidth` on the SECTION, not on the canvas wrapper and not the
     * painted rect. This is the exact number every `@container` rule in the
     * journey CSS resolves against, and it is the number that was 674 while the
     * toggle said "Desktop".
     *
     * Read through `expect.poll` rather than a bare `evaluate`, so a Vite HMR
     * reload landing between the settle and the read retries instead of failing:
     * the studio sub-tree is `ssr = false`, so a reload remounts the whole canvas
     * and destroys the execution context mid-call. Measured — it happens while
     * anyone is editing the studio's module graph.
     */
    const readContainerWidth = () =>
      page.evaluate(
        () =>
          (document.querySelector('.jbc-page .jp-sec') as HTMLElement)
            ?.offsetWidth ?? -1
      );

    await expect
      .poll(readContainerWidth, {
        message:
          'the canvas is not giving the section a real desktop container width',
        timeout: 20_000,
      })
      .toBe(DESKTOP_WIDTH);
    // The scale is STATED on the control, because a silently-scaled canvas is
    // its own kind of lie: an author who reads "47%" understands why the type
    // looks small, one who reads "Desktop" concludes the page is wrong.
    await expect(page.locator('.jbc__scale')).toContainText('1440px');
    await expect(page.locator('.jbc__scale')).toContainText('%');

    for (const [label, width] of [
      ['Tablet', 834],
      ['Mobile', 390],
    ] as const) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect
        .poll(readContainerWidth, {
          message: `the ${label} preset is not a real ${width}px container`,
          timeout: 15_000,
        })
        .toBe(width);
      await expect(page.locator('.jbc__scale')).toContainText(`${width}px`);
    }
  });

  test('every section has the same arrangement in the canvas and on the published page', async ({
    page,
    browser,
    baseURL,
  }) => {
    // The offer witness below reads "price-less branch ⇒ failed read", which is
    // only true for a course that HAS a way in. Pinned so that swapping the
    // fixture for a non-purchasable page fails here rather than turning the
    // witness into a tautology.
    expect(
      FIXTURE.purchasable,
      'this spec needs a PURCHASABLE fixture — see the header on the one known, ' +
        'deliberate canvas↔public divergence'
    ).toBe(true);

    // ── THE CANVAS, in its own context because it must be SIGNED IN ──────────
    const studioContext = await browser.newContext({
      viewport: { width: DESKTOP_WIDTH, height: VIEWPORT_HEIGHT },
    });
    const studio = await studioContext.newPage();
    let canvasWidth = 0;
    let canvasFingerprints: Awaited<ReturnType<typeof collectFingerprints>>;
    try {
      await signInAsSeededUser(studio, FIXTURE.owner);
      const pageId = await resolveBuilderPageId(
        studio,
        FIXTURE,
        baseURL as string
      );
      await studio.goto(
        orgUrl(
          baseURL as string,
          FIXTURE.org,
          `/studio/journeys/${pageId}/page`
        )
      );
      // TRAP 1 — every remote read answered, THEN the DOM settled. See
      // `settleBuilderCanvas`: the offer read lands at ~12.6s and a
      // stability-only wait returns before it with the invite section still
      // drawing its price-less branch.
      const settled = await settleBuilderCanvas(studio);
      expect(
        settled,
        'the canvas settled at zero descendants — nothing rendered'
      ).toBeGreaterThan(0);

      /**
       * A POSITIVE WITNESS THAT THE OFFER READ LANDED, and it is not belt and
       * braces — it is the difference between a fidelity defect and a failed
       * read, which the fingerprint alone cannot tell apart.
       *
       * `.invite__single` is the invite section's PRICE-LESS branch, reached when
       * `deriveOfferPaths` returns nothing. In the canvas `enrolled` is hard
       * `false`, so on a purchasable fixture that branch can only mean the offer
       * read has not answered (or answered with an error). Observed at
       * `workers: 2`: the canvas drew 5 text blocks against the published page's
       * 10 and the diff blamed `invite`, when the real story was a read that lost
       * a race with the other worker's traffic.
       *
       * Polled rather than asserted once, so a LATE offer is waited for instead
       * of failing — and when it genuinely never arrives, the message says which
       * of the two things went wrong.
       */
      await expect
        .poll(
          () =>
            studio
              .locator('.jbc-page [data-section-type="invite"] .invite__single')
              .count(),
          {
            message:
              'the builder’s offer read never landed — the canvas is drawing ' +
              'the invite section’s PRICE-LESS branch for a course that has a ' +
              'way in. That is a failed read, not a fidelity defect; do not ' +
              'compare the two trees on it',
            timeout: 30_000,
          }
        )
        .toBe(0);

      await forceRevealsIn(studio, '.jbc-page');

      canvasWidth = await studio.evaluate(
        () =>
          (document.querySelector('.jbc-page .jp-sec') as HTMLElement)
            .offsetWidth
      );
      canvasFingerprints = await collectFingerprints(studio, '.jbc-page');
    } finally {
      await studioContext.close();
    }

    expect(canvasWidth).toBe(DESKTOP_WIDTH);
    expect(
      canvasFingerprints.map((f) => f.type),
      'the canvas rendered a different set of sections than the page stores'
    ).toEqual([...FIXTURE.sections]);

    // ── THE PUBLISHED PAGE, signed out (the owner would be redirected) ───────
    await page.setViewportSize({
      width: DESKTOP_WIDTH,
      height: VIEWPORT_HEIGHT,
    });
    await page.goto(journeyUrl(baseURL as string, FIXTURE));
    await expectSellPageRendered(page, FIXTURE);

    // TRAP 2 — same inline size, or the comparison means nothing.
    const publishedWidth = await matchInlineSize(page, canvasWidth);
    expect(
      publishedWidth,
      'could not match the published section to the canvas container width — ' +
        'do NOT compare the two trees at different inline sizes'
    ).toBe(canvasWidth);

    await settleSubtree(page, '.journey-page', { floorMs: 4000 });
    await forceRevealsIn(page);
    const publishedFingerprints = await collectFingerprints(page, ':root');

    const differences = diffFingerprints(
      canvasFingerprints,
      publishedFingerprints
    );
    expect(
      differences,
      'the canvas is showing an arrangement the published page does not:\n' +
        `${differences.join('\n')}\n` +
        `canvas:    ${JSON.stringify(canvasFingerprints)}\n` +
        `published: ${JSON.stringify(publishedFingerprints)}`
    ).toEqual([]);
  });

  /**
   * NEGATIVE CONTROL — proves the fingerprint has teeth, and does it without the
   * builder or a product change, so it stays honest for free on every run.
   *
   * Two directions, because the two failure modes of this guard are opposite:
   * a fingerprint too COARSE to notice a real arrangement change, and a spec that
   * silently compares two different inline sizes and calls the difference a
   * regression.
   *
   * ON THE TOLERANCES, and the accidental passes the bead warns about: `turn` and
   * `feel` both default to a `column` composition, so their base look is a
   * stacked centred column — the same shape the fingerprint reports for most
   * sections. A section type whose canvas and published trees agree therefore
   * does NOT prove the canvas is faithful for that type, only that its default
   * composition is stack-shaped in both. The fields that discriminate are
   * `columns` and `shoulders`, and those only move for compositions that place
   * media beside copy — `hero.split-media`, `hero.banner`, `reel.split`,
   * `invite.tiers`, `map.cards`. None of the seven seeded pages stores one of
   * those, so extending this spec to a fixture that does is the highest-value
   * next step, not adding more section types at their defaults.
   */
  test('the fingerprint detects an injected arrangement change, and a width mismatch', async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({
      width: DESKTOP_WIDTH,
      height: VIEWPORT_HEIGHT,
    });
    await page.goto(journeyUrl(baseURL as string, FIXTURE));
    await expectSellPageRendered(page, FIXTURE);
    await forceRevealsIn(page);

    const baseline = await collectFingerprints(page, ':root');
    expect(baseline.length).toBeGreaterThan(0);
    expect(
      diffFingerprints(baseline, await collectFingerprints(page, ':root')),
      'the fingerprint is not stable against itself — nothing below means anything'
    ).toEqual([]);

    // DIRECTION 1 · comparing at different inline sizes must surface as a
    // `containerWidth` difference rather than as a mystery layout divergence.
    // This is the term that made the original audit inconclusive.
    //
    // Done by resizing rather than reloading: `page.reload()` on this surface
    // never resolves its `load` event (the sell page's streamed response keeps
    // the connection open), which is a trap of its own for anyone writing a spec
    // here — navigate again instead.
    await page.setViewportSize({ width: 900, height: VIEWPORT_HEIGHT });
    await page.waitForTimeout(400);
    await forceRevealsIn(page);
    const narrow = await collectFingerprints(page, ':root');
    expect(
      diffFingerprints(baseline, narrow).join('\n'),
      'two different inline sizes did not report a containerWidth difference'
    ).toMatch(/containerWidth/);

    // And back: the measurement must be a function of the width alone, or the
    // parity assertion above could go red for the order the specs happened to
    // run in.
    await page.setViewportSize({
      width: DESKTOP_WIDTH,
      height: VIEWPORT_HEIGHT,
    });
    await page.waitForTimeout(400);
    await forceRevealsIn(page);
    expect(
      diffFingerprints(baseline, await collectFingerprints(page, ':root')),
      'the fingerprint did not return to its baseline at the baseline width'
    ).toEqual([]);

    // DIRECTION 2 · a real arrangement change must be named, and named on the
    // right section. A block placed beside the hero headline is the shape of the
    // divergence this whole guard exists to catch.
    await page.evaluate(() => {
      const hero = document.querySelector(
        '.jp-sec[data-section-type="hero"] .hero__inner'
      );
      const probe = document.createElement('p');
      probe.textContent = 'injected divergence';
      probe.setAttribute(
        'style',
        'position:absolute;left:4%;top:40%;width:20%'
      );
      hero?.appendChild(probe);
    });
    const mutationDiff = diffFingerprints(
      baseline,
      await collectFingerprints(page, ':root')
    );
    expect(
      mutationDiff,
      'the fingerprint did not notice an extra text block in the hero'
    ).not.toEqual([]);
    expect(mutationDiff.join('\n')).toMatch(/^hero\[0\]/m);
    expect(mutationDiff.join('\n')).toMatch(/textBlocks/);
  });
});
