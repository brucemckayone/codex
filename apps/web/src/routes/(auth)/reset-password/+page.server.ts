import { getServiceUrl } from '@codex/constants';
import { authResetPasswordSchema } from '@codex/validation';
import { fail } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, platform }) => {
    const data = await request.formData();
    const token = data.get('token');
    const password = data.get('password');
    const confirmPassword = data.get('confirmPassword');

    // 1. Validate Input
    const result = authResetPasswordSchema.safeParse({
      token,
      password,
      confirmPassword,
    });

    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      return fail(400, {
        errors: {
          password: errors.password?.[0],
          confirmPassword: errors.confirmPassword?.[0],
        },
      });
    }

    try {
      // 2. Call Auth Worker
      const authUrl = getServiceUrl('auth', platform?.env);

      const res = await fetch(`${authUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: result.data.token,
          password: result.data.password,
        }),
      });

      if (!res.ok) {
        const error = (await res.json().catch(() => ({}))) as {
          message?: string;
        };

        return fail(res.status, {
          error:
            error.message ||
            'Password reset failed. Token may be invalid or expired.',
        });
      }

      return { success: true };
    } catch (err) {
      logger.error('Reset password error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return fail(500, {
        error: 'An unexpected error occurred. Please try again.',
      });
    }
  },
};
