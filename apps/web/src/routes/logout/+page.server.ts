import { COOKIES } from '@codex/constants';
import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ cookies }) => {
    cookies.delete(COOKIES.SESSION_NAME, { path: '/' });
    redirect(303, '/login');
  },
};
