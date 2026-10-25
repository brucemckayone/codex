/** /admin opens on the queue: what is waiting for a person comes first. */
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
  redirect(307, '/admin/queue');
};
