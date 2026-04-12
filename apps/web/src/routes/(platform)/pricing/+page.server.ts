/**
 * Pricing page - server load
 *
 * Platform-level pricing is a static placeholder. Real pricing lives on
 * each org's subdomain (/pricing). Redirect visitors to /discover.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  throw redirect(301, '/discover');
};
