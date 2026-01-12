/**
 * Root layout server load
 * Provides user context to all pages
 */
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    user: locals.user,
  };
};
