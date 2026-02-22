/**
 * Account profile page server load
 * Provides user data from the session (locals.user) without calling external APIs
 */
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  return {
    user: locals.user,
  };
};
