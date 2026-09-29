import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { PageLoad } from './$types';

/**
 * The page kit's style gallery is a development tool — every Style, layout
 * and colour scheme from sample content, with an edit mode that writes
 * nowhere — not a page for creators, so outside development it does not
 * exist.
 */
export const load: PageLoad = () => {
  if (!dev) error(404, 'Not found');
};
