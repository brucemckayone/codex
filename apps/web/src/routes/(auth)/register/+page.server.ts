import {
  COOKIES,
  getCookieConfig,
  getServiceUrl,
  HEADERS,
  MIME_TYPES,
} from '@codex/constants';
import { authRegisterSchema } from '@codex/validation';
import { fail, redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
  if (locals.user) {
    throw redirect(303, '/library');
  }

  return {
    redirect: url.searchParams.get('redirect'),
  };
};

export const actions: Actions = {
  default: async ({ request, cookies, platform }) => {
    const data = await request.formData();
    const name = data.get('name') ?? undefined;
    const email = data.get('email');
    const password = data.get('password');
    const confirmPassword = data.get('confirmPassword');

    // 1. Validate Input
    const result = authRegisterSchema.safeParse({
      name,
      email,
      password,
      confirmPassword,
    });

    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      return fail(400, {
        name,
        email,
        errors: {
          name: errors.name?.[0],
          email: errors.email?.[0],
          password: errors.password?.[0],
          confirmPassword: errors.confirmPassword?.[0],
        },
      });
    }

    try {
      // 2. Call Auth Worker
      const authUrl = getServiceUrl('auth', platform?.env);
      const res = await fetch(`${authUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: {
          [HEADERS.CONTENT_TYPE]: MIME_TYPES.APPLICATION.JSON,
        },
        body: JSON.stringify({
          name: result.data.name,
          email: result.data.email,
          password: result.data.password,
        }),
      });

      if (!res.ok) {
        const error = (await res.json().catch(() => ({}))) as {
          message?: string;
        };

        if (res.status === 409) {
          return fail(409, {
            name,
            email,
            error: 'An account with this email already exists.',
          });
        }

        return fail(res.status, {
          name,
          email,
          error: error.message || 'Registration failed. Please try again.',
        });
      }

      // 3. Set Session Cookie (Auto-login)
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const sessionMatch = setCookie.match(
          new RegExp(`${COOKIES.SESSION_NAME}=([^;]+)`)
        );
        if (sessionMatch) {
          const cookieConfig = getCookieConfig(platform?.env, {
            maxAge: COOKIES.SESSION_MAX_AGE,
          });
          cookies.set(COOKIES.SESSION_NAME, sessionMatch[1], cookieConfig);
        }
      }

      // 4. Redirect to verify email page (or library if no verification)
      throw redirect(303, '/verify-email');
    } catch (err) {
      if (err instanceof Response) throw err;

      logger.error('Registration error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return fail(500, {
        name,
        email,
        error: 'An unexpected error occurred. Please try again.',
      });
    }
  },
};
