/**
 * Root layout server load
 * Provides user context to all pages.
 *
 * depends('app:auth') allows client-side code to trigger re-validation
 * of the user session (e.g., on tab return after login/logout on another subdomain).
 */
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
  depends('app:auth');
  return {
    user: locals.user,
  };
};
