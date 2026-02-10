import {
  COOKIES,
  getCookieConfig,
  HEADERS,
  MIME_TYPES,
} from '@codex/constants';
import { authLoginSchema } from '@codex/validation';
import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { serverApiUrl } from '$lib/server/api';
import { extractSessionToken } from '$lib/server/auth-utils';
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
    const email = data.get('email');
    const password = data.get('password');

    // 1. Validate Input
    const result = authLoginSchema.safeParse({ email, password });

    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      return fail(400, {
        email,
        errors: {
          email: errors.email?.[0],
          password: errors.password?.[0],
        },
      });
    }

    try {
      // 2. Call Auth Worker
      // We use raw fetch here because we need access to the Set-Cookie header
      const authUrl = serverApiUrl(platform, 'auth');
      const res = await fetch(`${authUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          [HEADERS.CONTENT_TYPE]: MIME_TYPES.APPLICATION.JSON,
        },
        body: JSON.stringify({
          email: result.data.email,
          password: result.data.password,
        }),
      });

      if (!res.ok) {
        const error = (await res.json().catch(() => ({}))) as {
          message?: string;
        };

        if (res.status === 403) {
          return fail(403, {
            email,
            emailUnverified: true,
            error:
              "Your email hasn't been verified yet. We've sent a new verification link to your inbox.",
          });
        }

        if (res.status === 401) {
          return fail(401, {
            email,
            error: 'Invalid email or password',
          });
        }

        if (res.status === 429) {
          return fail(429, {
            email,
            error: 'Too many login attempts. Please try again later.',
          });
        }

        return fail(res.status, {
          email,
          error: error.message || 'Login failed. Please try again.',
        });
      }

      // 3. Set Session Cookie
      // BetterAuth uses 'better-auth.session_token' as cookie name internally,
      // regardless of cookie.name config. Extract the token and set our own cookie.
      const sessionToken = extractSessionToken(res);
      if (sessionToken) {
        const cookieConfig = getCookieConfig(
          platform?.env,
          request.headers.get('host') ?? undefined,
          {
            maxAge: COOKIES.SESSION_MAX_AGE,
          }
        );
        cookies.set(COOKIES.SESSION_NAME, sessionToken, cookieConfig);
      }

      // 4. Redirect
      const redirectTo = (data.get('redirect') as string) || '/library';
      // Validate redirect to prevent open redirect
      if (redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
        throw redirect(303, redirectTo);
      }
      throw redirect(303, '/library');
    } catch (err) {
      if (isRedirect(err)) throw err;

      logger.error('Login error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return fail(500, {
        email,
        error: 'An unexpected error occurred. Please try again.',
      });
    }
  },
};
