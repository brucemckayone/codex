/**
 * An email's link to the item a purchase bought (Codex-0u7kb).
 *
 * The receipt linked `${WEB_APP_URL}/content/{id}` (or `/courses/{id}`): the
 * platform host has no such route, so every buyer's "Access Content" button
 * opened a 404. An item's page is on its org's subdomain, or on the creators
 * host for personal content, and the page looks the item up by its slug, so
 * the builders' fallback to an id 404s too. The real slug comes from
 * `PurchaseService.findItemLink`.
 *
 * One function for every email that links a bought item, so they cannot
 * drift: the receipt today, the late win's access-restored email next.
 */

import type { ObservabilityClient } from '@codex/observability';
import type { PurchaseItemLink, PurchaseService } from '@codex/purchase';
import {
  buildContentUrl,
  buildCreatorContentUrl,
  buildJourneyUrl,
  buildPlatformUrl,
} from '@codex/urls';
import { describeRootCause } from './error-classification';

/**
 * The web app's origin, from `WEB_APP_URL`: the platform host every link is
 * built on, so each comes out absolute. Null when it is unset or not a URL;
 * the caller then has no working link to send.
 */
export function webAppOrigin(webAppUrl: string | undefined): URL | null {
  if (!webAppUrl) return null;
  try {
    return new URL(webAppUrl);
  } catch {
    return null;
  }
}

/**
 * The item's own page. Each builder returns a full URL here: `webApp` is the
 * platform host, and the item is always on another one.
 */
function itemPageUrl(webApp: URL, item: PurchaseItemLink): string {
  switch (item.kind) {
    case 'org_content':
      return buildContentUrl(webApp, {
        id: item.contentId,
        slug: item.slug,
        organizationSlug: item.organizationSlug,
      });
    case 'personal_content':
      return buildCreatorContentUrl(webApp, item.creatorUsername, {
        id: item.contentId,
        slug: item.slug,
        organization: null,
      });
    case 'course':
      // The buyer owns it, so the member surface, as the library links it.
      return buildJourneyUrl(
        webApp,
        {
          id: item.courseId,
          slug: item.slug,
          organizationSlug: item.organizationSlug,
        },
        { surface: 'dashboard' }
      );
  }
}

/**
 * The link to a purchase's item: its own page. When there is none, or the
 * lookup fails, the buyer's library on the platform instead (a route that
 * exists). Never rejects: a completed purchase is never failed over its
 * email's link.
 *
 * No page is expected (a deleted item) and is a warn. A failed lookup is an
 * error with an errorId: it may be an outage, or a fault in our own code (a
 * service without `findItemLink` threw a TypeError here and stayed green),
 * and either way every buyer's link would quietly become the library's.
 */
export async function purchaseItemUrl(
  purchaseService: Pick<PurchaseService, 'findItemLink'>,
  purchaseId: string,
  webApp: URL,
  obs: ObservabilityClient | undefined
): Promise<string> {
  try {
    const item = await purchaseService.findItemLink(purchaseId);
    if (item) return itemPageUrl(webApp, item);
    obs?.warn(
      "A purchase's item has no page to link to, so its email links the library",
      { purchaseId }
    );
  } catch (error) {
    obs?.error(
      "A purchase's item page could not be looked up, so its email links the library",
      {
        errorId: crypto.randomUUID(),
        purchaseId,
        error: error instanceof Error ? error.message : String(error),
        cause: describeRootCause(error),
      }
    );
  }
  return buildPlatformUrl(webApp, '/library');
}
