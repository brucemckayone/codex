/**
 * New Content Page (Creator Studio) - Server Load
 *
 * Personal content: no organization. The media picker reads the creator's
 * library itself, on open, searched and paged on the server
 * (Codex-a6ofh.1.8), so no media list is loaded here.
 */
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
  organizationId: null,
  orgSlug: null,
});
