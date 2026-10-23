/**
 * An error page under an org subdomain carries its real HTTP status
 * (Codex-nqop3).
 *
 * The org layout returns a bare promise (`subscriptionContext`), so every page
 * under it is rendered by SvelteKit's streaming arm, and in 2.x that arm built
 * the Response without the status. A load-thrown 404 rendered the "not found"
 * page with HTTP 200: a soft 404 on the platform's two public, indexable
 * surfaces, which search engines index and status-keyed monitoring reads as
 * healthy. The fix is `patches/@sveltejs__kit@2.55.0.patch`.
 *
 * Only the status line shows it (the rendered page was always right), so these
 * read the response rather than the page. Each 404 also asserts the body
 * carries a streamed chunk: without one the response came from the
 * non-streaming arm, which always kept its status, and the case would pass
 * whether or not the patch is there.
 */
import { expect, test } from '@playwright/test';
import { journeyFixture, journeyUrl, orgUrl } from './helpers/journeys';

const SEEDED = journeyFixture('studio-alpha', 'bone-deep');

/** A streamed promise resolving into the page: the streaming arm rendered it. */
const STREAMED_CHUNK = /__sveltekit_\w+\.resolve\(/;

test.describe('error status under an org subdomain (Codex-nqop3)', () => {
  for (const [what, path] of [
    ['a journey', '/journeys/this-slug-does-not-exist'],
    ['a piece of content', '/content/no-such-content-slug'],
  ] as const) {
    test(`${what} that does not exist is a 404`, async ({
      request,
      baseURL,
    }) => {
      const res = await request.get(
        orgUrl(baseURL as string, SEEDED.org, path),
        { maxRedirects: 0 }
      );

      expect(res.status()).toBe(404);
      expect(
        await res.text(),
        'no streamed chunk: this 404 did not test the streaming arm'
      ).toMatch(STREAMED_CHUNK);
    });
  }

  test('a journey that exists is still a 200', async ({ request, baseURL }) => {
    const res = await request.get(journeyUrl(baseURL as string, SEEDED), {
      maxRedirects: 0,
    });

    expect(res.status()).toBe(200);
    expect(await res.text()).toMatch(STREAMED_CHUNK);
  });
});
