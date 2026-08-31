/**
 * THE HEAD IS RIGHT — EXACTLY ONE OF EACH, AND THE VALUE IS THE PAGE'S OWN.
 *
 * "Exactly one" is the whole assertion, and only a browser can make it:
 * `<svelte:head>` dedupes `<title>` and NOTHING else, so a page that set its own
 * `description` or `og:type` APPENDED a second tag after the root layout's.
 * Measured on a journey page before the fix, in document order:
 *
 *     meta[property="og:type"]   ["website", "product"]
 *     meta[name="description"]   ["Discover transformative content from
 *                                  independent creators", "<the course lede>"]
 *
 * A parser takes the FIRST value of a repeated Open Graph property, so
 * `og:type=product` was dead on arrival, and every journey page's search snippet
 * was shadowed by the generic platform tagline. The fix made the ROOT layout emit
 * exactly one of each FROM the page's `pageMeta`, so a page overrides instead of
 * duplicating — which means the regression this guards against is invisible to
 * any test that only looks at the page component.
 *
 * HOW IT AVOIDS HARDCODING COPY. The surviving description is compared against
 * the page's own JSON-LD `Course.description`. Both derive from one
 * `pageMeta.description`, so they agree only when the PAGE's tag is the one that
 * survived — the root layout's generic fallback would not match. So the spec
 * needs no fixture lede and cannot rot when a creator rewrites their copy.
 *
 * Run over all three orgs: `studio-alpha` / `studio-beta` are the
 * brand-neutrality pair and `of-blood-and-bones` is the fully-branded case, and
 * `pageMeta` is derived per page — a head regression could easily land on one org
 * and not another.
 */

import { expect, test } from '@playwright/test';
import {
  expectSellPageRendered,
  JOURNEY_FIXTURES,
  journeyUrl,
  PLATFORM_META_DESCRIPTION,
  readJourneyHead,
} from '../helpers/journeys';

/** One page per org — the three brand cases, not all seven pages. */
const ONE_PER_ORG = ['of-blood-and-bones', 'studio-alpha', 'studio-beta'].map(
  (org) => JOURNEY_FIXTURES.find((fixture) => fixture.org === org)
);

for (const fixture of ONE_PER_ORG) {
  if (!fixture) continue;

  test.describe(`journey head · ${fixture.org}/${fixture.pageSlug}`, () => {
    test('emits exactly one description, canonical and og:type, all the page’s own', async ({
      page,
      baseURL,
    }) => {
      const url = journeyUrl(baseURL as string, fixture);
      await page.goto(url);
      await expectSellPageRendered(page, fixture);

      const head = await readJourneyHead(page);

      expect(
        head.descriptions,
        'the root layout and the page are BOTH emitting a description again — ' +
          'a parser takes the first, which is the generic platform tagline'
      ).toHaveLength(1);
      expect(head.descriptions[0]).not.toBe(PLATFORM_META_DESCRIPTION);
      expect(head.descriptions[0].length).toBeGreaterThan(0);
      expect(
        head.jsonLdDescription,
        'the page publishes no Course JSON-LD, so the description cannot be ' +
          'cross-checked against the page’s own data'
      ).toBeTruthy();
      expect(
        head.descriptions[0],
        'the surviving description is not the one this page derived — the ' +
          'layout’s fallback won'
      ).toBe(head.jsonLdDescription);

      expect(head.canonicals, 'not exactly one rel=canonical').toHaveLength(1);
      // Query-free, and equal to the address being viewed. `?preview=1` is a
      // second address for the same page that the builder itself hands the
      // creator, so a canonical carrying the query would rank a duplicate.
      expect(head.canonicals[0]).toBe(
        new URL(url).origin + new URL(url).pathname
      );
      expect(head.canonicals[0]).not.toContain('?');

      // 'website' is the ROOT layout's fallback; 'product' is this page's value.
      // One tag reading 'product' therefore proves both halves at once: the
      // duplication is gone AND the page's value is the one that survived.
      expect(head.ogTypes, 'not exactly one og:type').toHaveLength(1);
      expect(head.ogTypes[0]).toBe('product');

      expect(
        head.robots,
        'the canonical sell page must be indexable'
      ).toHaveLength(0);
    });

    test('a ?preview URL is noindex and still points at the query-free canonical', async ({
      page,
      baseURL,
    }) => {
      const url = journeyUrl(baseURL as string, fixture, '', '?preview=1');
      await page.goto(url);
      await expectSellPageRendered(page, fixture);

      const head = await readJourneyHead(page);

      expect(head.robots, 'not exactly one robots tag').toHaveLength(1);
      expect(head.robots[0]).toBe('noindex, nofollow');
      // The builder's "View live ↗" opens exactly this URL, so without the pair
      // of assertions below every creator preview is an indexable duplicate of
      // the page it previews.
      expect(head.canonicals).toHaveLength(1);
      expect(head.canonicals[0]).not.toContain('?');
      expect(head.canonicals[0]).toBe(
        new URL(url).origin + new URL(url).pathname
      );
      // Still exactly one of each — the preview branch adds a tag, and adding a
      // tag is how the duplication got in last time.
      expect(head.descriptions).toHaveLength(1);
      expect(head.ogTypes).toHaveLength(1);
    });
  });
}
