/**
 * Creator profile server load
 * Passes username from params
 */
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  return {
    username: params.username,
    user: locals.user,
  };
};
