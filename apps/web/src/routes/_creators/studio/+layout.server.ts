/**
 * Creator Studio layout - server load
 *
 * Access control guard for the personal creator studio.
 * Redirects unauthenticated users to login and non-creators to homepage.
 */
import { AUTH_ROLES } from '@codex/constants';
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** Roles permitted to access the creator studio */
const STUDIO_ROLES = new Set([AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN, AUTH_ROLES.PLATFORM_OWNER]);

export const load: LayoutServerLoad = async ({ locals }) => {
	// Auth gate: must be logged in
	if (!locals.user) {
		redirect(302, '/login?redirect=/studio');
	}

	// Role gate: must be a creator, admin, or platform_owner
	if (!STUDIO_ROLES.has(locals.user.role)) {
		redirect(302, '/?error=access_denied');
	}

	return {};
};
