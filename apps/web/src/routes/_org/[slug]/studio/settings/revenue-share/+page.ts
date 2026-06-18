import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Revenue-share relocated to the Monetisation hub (Codex-4zmw7).
// Permanent 308 redirect; preserve any `?focus=<creatorId>` query so
// dashboard focus-rail deep-links and stale bookmarks land correctly.
export const load: PageLoad = ({ url }) => {
  throw redirect(308, `/studio/monetisation/revenue-share${url.search}`);
};
