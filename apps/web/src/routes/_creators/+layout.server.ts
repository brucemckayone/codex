/**
 * Creators layout - server load
 *
 * Passes user data to children for auth-aware header rendering.
 * `role` is included so useStudioAccess can show the Studio menu entry
 * to creators/admins viewing the creators subdomain.
 */
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    user: locals.user
      ? {
          name: locals.user.name,
          email: locals.user.email,
          image: locals.user.image,
          role: locals.user.role,
        }
      : null,
  };
};
