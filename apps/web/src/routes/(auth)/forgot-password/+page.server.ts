import { getServiceUrl, HEADERS, MIME_TYPES } from '@codex/constants';
import { authForgotPasswordSchema } from '@codex/validation';
import { fail } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, platform }) => {
    const data = await request.formData();
    const email = data.get('email');

    // 1. Validate Input
    const result = authForgotPasswordSchema.safeParse({ email });

    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      return fail(400, {
        email,
        errors: {
          email: errors.email?.[0],
        },
      });
    }

    try {
      // 2. Call Auth Worker
      const authUrl = getServiceUrl('auth', platform?.env);

      const res = await fetch(`${authUrl}/api/auth/forget-password`, {
        method: 'POST',
        headers: {
          [HEADERS.CONTENT_TYPE]: MIME_TYPES.APPLICATION.JSON,
        },
        body: JSON.stringify({
          email: result.data.email,
          redirectTo: '/reset-password',
        }),
      });

      if (res.status >= 500) {
        return fail(500, {
          email,
          error: 'An unexpected error occurred. Please try again.',
        });
      }

      return { success: true };
    } catch (err) {
      logger.error('Forgot password error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return fail(500, {
        email,
        error: 'An unexpected error occurred. Please try again.',
      });
    }
  },
};
