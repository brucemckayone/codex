/**
 * THE SELL PAGE RENDERS, AND IT ONLY SELLS WHAT THE CHECKOUT CAN DELIVER.
 *
 * This is the pair round 1 fixed and nothing guarded in a browser. Before that
 * fix, a course with no purchasable path — FIVE of the seven seeded courses,
 * i.e. the majority case — still published a full-viewport hero CTA, a floating
 * pill that followed the reader down the whole page, and an invite CTA, all
 * three landing on `/checkout` and the sentence "<Course> isn't open for
 * enrolment just now. Back to the journey →". The conversion funnel of most real
 * pages terminated in a bounce back to where the visitor started.
 *
 * Both directions are asserted here, because a suppression fix that also
 * suppresses the REAL buy button is the same bug with the sign flipped:
 *   · `of-blood-and-bones/ancestral-threads` (price_cents 4900) must keep every
 *     affordance and reach a checkout that can actually take the money;
 *   · `studio-alpha/bone-deep` (price_cents NULL) must offer none.
 *
 * SIGNED OUT THROUGHOUT, deliberately. An entitled viewer — and the org owner
 * always is one — is redirected off this page to `/journeys/<slug>/dashboard`,
 * and with `?preview=1` the redirect is bypassed but the CTA still resolves
 * against the CREATOR's entitlement and reads "Go to your dashboard". A spec
 * that signed in to set something up and then measured the CTA would be
 * measuring the wrong page and the wrong button.
 *
 * A 200 is not evidence the sell page rendered (the entitlement redirect ends
 * on one too), so `expectSellPageRendered` asserts the rendered sections. A
 * missing page's status is held by `org-error-status.spec.ts` (Codex-nqop3).
 */

import { expect, type Page, test } from '@playwright/test';
import {
  expectSellPageRendered,
  journeyFixture,
  journeyUrl,
} from '../helpers/journeys';

const PURCHASABLE = journeyFixture('of-blood-and-bones', 'ancestral-threads');
const NOT_PURCHASABLE = journeyFixture('studio-alpha', 'bone-deep');

/** The dead-end the whole fix exists to stop reaching. */
const DEAD_END = /isn't open for enrolment just now/i;

/**
 * The floating pill. The kit's `StickyCta` offers it to the dock's banner
 * slot once the hero has left the screen (and withdraws it while an offer
 * section is on screen); at this width `DockBannerHost` draws it. It exists
 * only while offered, so the page is scrolled past the hero before it is
 * read. The phone dock stays mounted, hidden, and draws its own copy of the
 * same banner, so only the visible one is the pill.
 */
const PILL = '[role="region"][aria-label="Join this course"]';

/** Scroll the hero just off the top, then let the observers report. */
async function scrollPastHero(page: Page) {
  await page.evaluate(async () => {
    const hero = document.querySelector('[data-lp-type="hero"]');
    if (!hero) throw new Error('no hero section');
    window.scrollTo({
      top: window.scrollY + hero.getBoundingClientRect().bottom + 1,
      behavior: 'instant',
    });
    // An IntersectionObserver reports at the next rendering opportunity.
    for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
  });
}

test.describe('journey sell page · a purchasable course', () => {
  test('renders its stored sections and keeps all three purchase affordances', async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(journeyUrl(baseURL as string, PURCHASABLE));
    await expectSellPageRendered(page, PURCHASABLE);

    const affordances = await page.evaluate(() => {
      const hrefs = (selector: string) =>
        [...document.querySelectorAll(selector)].map(
          (element) => element.getAttribute('href') ?? ''
        );
      return {
        hero: hrefs('.hero__actions a[href*="/checkout"]'),
        // `invite` renamed to `pricing` in the v2 kit (contract §2); the kit's
        // `SectionShell` publishes the resolved type as `data-lp-type`, not
        // the legacy renderer's `data-section-type`.
        invite: hrefs('[data-lp-type="pricing"] a[href*="/checkout"]'),
      };
    });

    await scrollPastHero(page);
    const pillLinks = page
      .locator(PILL)
      .filter({ visible: true })
      .locator('a[href*="/checkout"]');

    expect(
      affordances.hero,
      'the hero lost its primary CTA on a course that CAN be bought'
    ).toHaveLength(1);
    await expect(
      pillLinks,
      'the floating pill vanished on a course that CAN be bought'
    ).toHaveCount(1);
    const pill = await pillLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute('href') ?? '')
    );
    expect(
      affordances.invite.length,
      'the invite section offers no way in on a course that CAN be bought'
    ).toBeGreaterThan(0);

    // EVERY checkout link must address the PAGE slug. `checkoutUrl` used to be
    // built from `courses.slug` while the checkout route resolves
    // `landing_pages.slug` — two independently authored columns. They agree on
    // all seven seeded pages, so the bug was latent, and the moment a creator
    // renames a course every primary CTA 404s with "This portal could not be
    // found." This assertion is the cheap standing guard for that drift.
    for (const href of [...affordances.hero, ...pill, ...affordances.invite]) {
      expect(
        href,
        'a checkout link is not addressed by the LANDING PAGE slug'
      ).toMatch(
        new RegExp(`^/journeys/${PURCHASABLE.pageSlug}/checkout(\\?|$)`)
      );
    }
  });

  test('the hero CTA reaches a checkout that can actually take the money', async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(journeyUrl(baseURL as string, PURCHASABLE));
    await expectSellPageRendered(page, PURCHASABLE);

    await page.locator('.hero__actions a[href*="/checkout"]').first().click();
    // 30s, not the 5s `expect` default: the checkout is a separate route with its
    // own load, and against a cold dev server the first compile of it took longer
    // than the default — a red test that says "the CTA does not navigate" when
    // the CTA navigates fine is worse than a slow one.
    await expect(page).toHaveURL(
      new RegExp(`/journeys/${PURCHASABLE.pageSlug}/checkout`),
      { timeout: 30_000 }
    );

    // A REAL way in: the offer form, at least one priced path, and a submit.
    // `.co-form` only renders in the `offers.length > 0` branch, so its presence
    // is the structural proof — asserted before the copy check so a failure says
    // "no offer form" rather than "some string was missing".
    await expect(page.locator('.co-form')).toBeVisible();
    await expect(page.locator('.co-form .offer')).not.toHaveCount(0);
    await expect(page.locator('.co-form button[type="submit"]')).toBeVisible();

    const prices = await page.locator('.offer__price-amount').allInnerTexts();
    expect(prices.length, 'the offer card quotes no amount').toBeGreaterThan(0);
    // GBP, never USD — the platform's default currency.
    expect(prices.join(' ')).toMatch(/£\s?\d/);
    expect(prices.join(' ')).not.toContain('$');

    await expect(
      page.locator('body'),
      'the checkout for a PURCHASABLE course served the dead-end copy'
    ).not.toContainText(DEAD_END);
  });
});

test.describe('journey sell page · a course with no way in', () => {
  test('offers no hero CTA and no floating pill', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(journeyUrl(baseURL as string, NOT_PURCHASABLE));
    await expectSellPageRendered(page, NOT_PURCHASABLE);

    // The kit's `HeroBlock` renders `.hero__actions` UNCONDITIONALLY (it also
    // holds the secondary link / watch button, neither gated on purchasability)
    // — unlike the legacy `HeroSection`, which omitted the whole wrapper when it
    // had nothing to hold. So the affordance under test is the checkout ANCHOR
    // inside it, not the wrapper's mere existence. The pill exists only while
    // `StickyCta` offers it, and it offers one only with a way in, so it is
    // counted where it would show: past the hero, which on this page is
    // followed by its gallery and text, not an offer. The purchasable test
    // above proves that same scroll brings the pill on a page that sells.
    const heroCta = await page
      .locator('.hero__actions a[href*="/checkout"]')
      .count();
    await scrollPastHero(page);
    const pill = await page.locator(PILL).count();
    expect(
      heroCta,
      'the hero is selling a course the checkout cannot sell'
    ).toBe(0);
    expect(
      pill,
      'the floating pill is selling a course the checkout cannot sell'
    ).toBe(0);
  });

  /**
   * THE RESIDUAL DEFECT, and it is the reason this test is `fixme` rather than
   * absent: round 1 owned the hero and the pill and correctly handed the invite
   * section off to whoever owns it. Measured live on all five non-purchasable
   * fixtures: exactly ONE checkout affordance survives, the invite's, and it
   * leads to "isn't open for enrolment just now".
   *
   * The one-line shape of the fix, for whoever picks it up:
   * `InviteSection.svelte`'s price-less branch renders
   * `<CtaLink href={hrefFor(null)}>` unconditionally. Its own comment explains
   * that this branch covers TWO states — "the offer read was unavailable OR the
   * course has no purchasable path" — and only the second is a dead end.
   * `context.purchasable` already distinguishes them (a FAILED offer read
   * answers `true`, deliberately, so a hiccuping read cannot strip the buy
   * button off a page that sells). So the CTA belongs behind
   * `context.enrolled || context.purchasable !== false`, which is exactly the
   * predicate `HeroSection.svelte` uses.
   *
   * UN-FIXME'D 2026-08-30. That change landed in 760119a9 — `InviteSection.svelte`
   * now guards its doorway on `context.enrolled || context.purchasable !== false`,
   * the same predicate `HeroSection` uses. The assertion below is UNCHANGED from
   * when it was written: it still demands ZERO checkout links anywhere on a page
   * that cannot sell, so it is the original bar, not a lowered one.
   *
   * The title's old parenthetical ("the invite CTA is still a dead end") described
   * the defect this test was pinning. It no longer is one, so the title now says
   * what the test enforces instead of what used to be broken.
   */
  test('offers no purchase affordance at all — including the invite CTA', async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(journeyUrl(baseURL as string, NOT_PURCHASABLE));
    await expectSellPageRendered(page, NOT_PURCHASABLE);

    const checkoutLinks = await page.evaluate(() =>
      [...document.querySelectorAll('a[href*="/checkout"]')].map((element) => ({
        href: element.getAttribute('href'),
        // `data-lp-type` (kit `SectionShell`), not the legacy `data-section-type`.
        section:
          element.closest('[data-lp-type]')?.getAttribute('data-lp-type') ??
          'page',
        text: (element.textContent ?? '').trim(),
      }))
    );
    expect(
      checkoutLinks,
      'a course with no way in still offers a route to the checkout'
    ).toEqual([]);
  });

  /**
   * NEGATIVE CONTROL for the two `DEAD_END` assertions above.
   *
   * Without this, "the purchasable checkout does not contain the dead-end copy"
   * would also pass if the string had been deleted from the app, or renamed, or
   * if `.co-form` had stopped rendering for everyone. This proves the state is
   * still reachable and the matcher still matches something real — and it
   * doubles as the standing record of the defect the `fixme` above describes:
   * this is where the invite CTA lands.
   */
  test('the dead-end checkout state is real and reachable', async ({
    page,
    baseURL,
  }) => {
    await page.goto(
      journeyUrl(baseURL as string, NOT_PURCHASABLE, '/checkout')
    );
    await expect(page.locator('body')).toContainText(DEAD_END);
    await expect(
      page.locator('.co-form'),
      'a course with no way in rendered an offer form'
    ).toHaveCount(0);
  });
});
