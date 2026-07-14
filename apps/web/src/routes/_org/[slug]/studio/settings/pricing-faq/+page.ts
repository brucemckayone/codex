import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Pricing FAQ relocated to the Monetisation hub (Codex-eb00a.17) — it
// configures the public pricing page, a monetisation concern rather than a
// settings one. Permanent 308 redirect; preserve any query so stale bookmarks
// and deep-links land correctly. Mirrors the revenue-share relocation
// (Codex-4zmw7).
export const load: PageLoad = ({ url }) => {
  throw redirect(308, `/studio/monetisation/pricing-faq${url.search}`);
};
