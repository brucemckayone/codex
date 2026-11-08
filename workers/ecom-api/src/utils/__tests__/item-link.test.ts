/**
 * An email's link to the item a purchase bought (Codex-0u7kb).
 *
 * The receipt's "Access Content" button opened a 404 for every buyer: it
 * linked `/content/{id}` (or `/courses/{id}`) on the platform host, where no
 * route matches. These pin the item's own page for each kind of item, built on
 * each `WEB_APP_URL` this worker is deployed with (wrangler.jsonc: production
 * `https://revelations.studio`; development and test `http://lvh.me:3000`),
 * and the library fallback when there is no page.
 *
 * "Routable" is read as the web app's reroute hook reads a URL: `parseHost`
 * gives the subdomain it routes on (an org's slug → `_org/[slug]`, `creators`
 * → `_creators`, none → the platform), and the path is the route below it.
 */

import type { ObservabilityClient } from '@codex/observability';
import type { PurchaseItemLink } from '@codex/purchase';
import { wrapError } from '@codex/service-errors';
import { createMockObservability } from '@codex/test-utils';
import { parseHost } from '@codex/urls';
import { describe, expect, it, vi } from 'vitest';
import { purchaseItemUrl, webAppOrigin } from '../item-link';

const CONTENT_ID = '6f1c2a9e-1f7b-4c35-9a0e-2b8d4c1e7f30';
const COURSE_ID = '0b9e3d54-7c1a-4e2f-8b6d-5a4c3e2f1d0c';
const PURCHASE_ID = '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const ORG_CONTENT: PurchaseItemLink = {
  kind: 'org_content',
  contentId: CONTENT_ID,
  slug: 'breathwork-basics',
  organizationSlug: 'studio-alpha',
};
const PERSONAL_CONTENT: PurchaseItemLink = {
  kind: 'personal_content',
  contentId: CONTENT_ID,
  slug: 'field-notes',
  creatorUsername: 'alex-creator',
};
const COURSE: PurchaseItemLink = {
  kind: 'course',
  courseId: COURSE_ID,
  slug: 'rootwork',
  organizationSlug: 'studio-alpha',
};

/** Each WEB_APP_URL ecom-api has, with the env and base domain it parses to. */
const DEPLOYED = [
  {
    env: 'production',
    webAppUrl: 'https://revelations.studio',
    org: 'https://studio-alpha.revelations.studio',
    creators: 'https://creators.revelations.studio',
  },
  {
    env: 'development',
    webAppUrl: 'http://lvh.me:3000',
    org: 'http://studio-alpha.lvh.me:3000',
    creators: 'http://creators.lvh.me:3000',
  },
] as const;

function origin(webAppUrl: string): URL {
  const webApp = webAppOrigin(webAppUrl);
  expect(webApp).not.toBeNull();
  return webApp as URL;
}

/** The link for a purchase whose item lives at `item`. */
function linkTo(webAppUrl: string, item: PurchaseItemLink): Promise<string> {
  return purchaseItemUrl(
    { findItemLink: async () => item },
    PURCHASE_ID,
    origin(webAppUrl),
    undefined
  );
}

describe.each(DEPLOYED)('the item page on $webAppUrl', ({
  env,
  webAppUrl,
  org,
  creators,
}) => {
  it("org content: its org's subdomain, by its real slug", async () => {
    const url = await linkTo(webAppUrl, ORG_CONTENT);

    expect(url).toBe(`${org}/content/breathwork-basics`);
    const { hostname, pathname } = new URL(url);
    expect(parseHost(hostname)).toMatchObject({
      env,
      subdomain: 'studio-alpha',
    });
    expect(pathname).toBe('/content/breathwork-basics');
  });

  it("personal content: the creator's page on the creators host", async () => {
    const url = await linkTo(webAppUrl, PERSONAL_CONTENT);

    expect(url).toBe(`${creators}/@alex-creator/content/field-notes`);
    expect(parseHost(new URL(url).hostname)).toMatchObject({
      env,
      subdomain: 'creators',
    });
  });

  it("a course: its journey dashboard, the buyer's own surface", async () => {
    const url = await linkTo(webAppUrl, COURSE);

    expect(url).toBe(`${org}/journeys/rootwork/dashboard`);
    expect(parseHost(new URL(url).hostname)).toMatchObject({
      env,
      subdomain: 'studio-alpha',
    });
  });

  // The old link, pinned as WRONG so it cannot come back: the item's id on
  // the platform host, which has no /content or /courses route at all.
  it.each([
    ['content', ORG_CONTENT, `${webAppUrl}/content/${CONTENT_ID}`],
    [
      'personal content',
      PERSONAL_CONTENT,
      `${webAppUrl}/content/${CONTENT_ID}`,
    ],
    ['course', COURSE, `${webAppUrl}/courses/${COURSE_ID}`],
  ])('%s is never the old 404, the id on the platform host', async (_kind, item, old) => {
    const url = await linkTo(webAppUrl, item);

    expect(url).not.toBe(old);
    expect(new URL(url).host).not.toBe(new URL(webAppUrl).host);
    expect(url).not.toContain(CONTENT_ID);
    expect(url).not.toContain(COURSE_ID);
  });
});

describe('purchaseItemUrl', () => {
  function obsMock() {
    const { obs } = createMockObservability();
    return { obs, client: obs as unknown as ObservabilityClient };
  }

  it("asks for the purchase's own item, and links its page", async () => {
    const findItemLink = vi.fn(async () => ORG_CONTENT);
    const { obs, client } = obsMock();

    const url = await purchaseItemUrl(
      { findItemLink },
      PURCHASE_ID,
      origin('https://revelations.studio'),
      client
    );

    expect(findItemLink).toHaveBeenCalledWith(PURCHASE_ID);
    expect(url).toBe(
      'https://studio-alpha.revelations.studio/content/breathwork-basics'
    );
    expect(obs.warn).not.toHaveBeenCalled();
  });

  it.each(
    DEPLOYED
  )('no page to link to ($webAppUrl): the library on the platform, with a warn of ids', async ({
    webAppUrl,
  }) => {
    const { obs, client } = obsMock();

    const url = await purchaseItemUrl(
      { findItemLink: async () => null },
      PURCHASE_ID,
      origin(webAppUrl),
      client
    );

    expect(url).toBe(`${webAppUrl}/library`);
    expect(parseHost(new URL(url).hostname).subdomain).toBeNull();
    expect(obs.warn).toHaveBeenCalledWith(
      "A purchase's item has no page to link to, so its email links the library",
      { purchaseId: PURCHASE_ID }
    );
  });

  it('a failed lookup: the library, with a warn of ids and the root cause; it never rejects', async () => {
    const { obs, client } = obsMock();
    const outage = Object.assign(new Error('Connection terminated'), {
      code: 'ECONNRESET',
    });

    const url = await purchaseItemUrl(
      {
        // As the service's handleError rejects: wrapped, the driver's error
        // its cause.
        findItemLink: async () => {
          throw wrapError(outage);
        },
      },
      PURCHASE_ID,
      origin('https://revelations.studio'),
      client
    );

    expect(url).toBe('https://revelations.studio/library');
    expect(obs.warn).toHaveBeenCalledWith(
      "A purchase's item page could not be looked up, so its email links the library",
      expect.objectContaining({
        purchaseId: PURCHASE_ID,
        cause: expect.objectContaining({ code: 'ECONNRESET' }),
      })
    );
  });
});

describe('webAppOrigin', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not a URL', 'revelations.studio'],
  ])('%s: null, so no link is built on it', (_case, value) => {
    expect(webAppOrigin(value)).toBeNull();
  });

  it('a URL: parsed', () => {
    expect(webAppOrigin('https://revelations.studio')?.host).toBe(
      'revelations.studio'
    );
  });
});
