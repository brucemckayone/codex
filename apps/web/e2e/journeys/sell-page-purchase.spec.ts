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
 * HTTP status is never used as evidence: a load-thrown 404 on this surface
 * returns 200 (Codex-nqop3, an upstream SvelteKit bug root-caused in round 3).
 * `expectSellPageRendered` asserts the rendered sections instead.
 */

import { expect, test } from '@playwright/test';
import {
  expectSellPageRendered,
  forceRevealsIn,
  journeyFixture,
  journeyUrl,
} from '../helpers/journeys';

const PURCHASABLE = journeyFixture('of-blood-and-bones', 'ancestral-threads');
const NOT_PURCHASABLE = journeyFixture('studio-alpha', 'bone-deep');

/** The dead-end the whole fix exists to stop reaching. */
const DEAD_END = /isn't open for enrolment just now/i;

test.describe('journey sell page · a purchasable course', () => {
  test('renders its stored sections and keeps all three purchase affordances', async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(journeyUrl(baseURL as string, PURCHASABLE));
    await expectSellPageRendered(page, PURCHASABLE);
    await forceRevealsIn(page);

    const affordances = await page.evaluate(() => {
      const hrefs = (selector: string) =>
        [...document.querySelectorAll(selector)].map(
          (element) => element.getAttribute('href') ?? ''
        );
      return {
        hero: hrefs('.hero__actions a[href*="/checkout"]'),
        pill: hrefs('.floatcta a[href*="/checkout"]'),
        invite: hrefs('[data-section-type="invite"] a[href*="/checkout"]'),
      };
    });

    expect(
      affordances.hero,
      'the hero lost its primary CTA on a course that CAN be bought'
    ).toHaveLength(1);
    expect(
      affordances.pill,
      'the floating pill vanished on a course that CAN be bought'
    ).toHaveLength(1);
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
    for (const href of [
      ...affordances.hero,
      ...affordances.pill,
      ...affordances.invite,
    ]) {
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
    await forceRevealsIn(page);

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
    await forceRevealsIn(page);

    // Counted in the DOM rather than asserted `toBeHidden`: the pill is rendered
    // parked off-screen and `inert` on a page that DOES sell, so "not visible"
    // would pass for the wrong reason. The fix removes the element.
    const counts = await page.evaluate(() => ({
      heroActions: document.querySelectorAll('.hero__actions').length,
      pill: document.querySelectorAll('.floatcta').length,
    }));
    expect(
      counts.heroActions,
      'the hero is selling a course the checkout cannot sell'
    ).toBe(0);
    expect(
      counts.pill,
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
   * Un-`fixme` this test with that change; it must go green without weakening
   * the assertion below.
   */
  test.fixme(
    'offers no purchase affordance at all — the invite CTA is still a dead end',
    async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(journeyUrl(baseURL as string, NOT_PURCHASABLE));
      await expectSellPageRendered(page, NOT_PURCHASABLE);
      await forceRevealsIn(page);

      const checkoutLinks = await page.evaluate(() =>
        [...document.querySelectorAll('a[href*="/checkout"]')].map(
          (element) => ({
            href: element.getAttribute('href'),
            section:
              element
                .closest('[data-section-type]')
                ?.getAttribute('data-section-type') ?? 'page',
            text: (element.textContent ?? '').trim(),
          })
        )
      );
      expect(
        checkoutLinks,
        'a course with no way in still offers a route to the checkout'
      ).toEqual([]);
    }
  );

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
