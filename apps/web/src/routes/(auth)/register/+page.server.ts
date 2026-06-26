import { COOKIES, HEADERS, MIME_TYPES } from '@codex/constants';
import { getCookieConfig } from '@codex/urls';
import { authRegisterSchema } from '@codex/validation';
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
      // Forward the browser Origin so BetterAuth's trustedOrigins check
      // accepts the server-side fetch. Without this header, BetterAuth
      // rejects the request with "Missing or null Origin" because the
      // server-side fetch from SvelteKit has no Origin by default — the
      // app-server then bubbles a 500 "An unexpected error occurred." back
      // to the register form and the test (and any real user) never
      // reaches /verify-email.
      const authUrl = serverApiUrl(platform, 'auth');
      const incomingOrigin = request.headers.get('origin');
      const incomingHost = request.headers.get('host');
      const forwardedOrigin =
        incomingOrigin ??
        (incomingHost ? `http://${incomingHost}` : 'http://lvh.me:5173');
      const res = await fetch(`${authUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: {
          [HEADERS.CONTENT_TYPE]: MIME_TYPES.APPLICATION.JSON,
          Origin: forwardedOrigin,
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
      // BetterAuth uses 'better-auth.session_token' as cookie name internally.
      // Registration with email verification may not return a session.
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

      // 4. Stash the email (httpOnly, short-lived) so /verify-email can
      // pre-fill the "resend verification" form without leaking the address
      // into the URL/referer. Same cookie config as the session (correct
      // cross-subdomain domain + secure flag), just a shorter lifetime.
      cookies.set(
        COOKIES.PENDING_VERIFICATION_EMAIL,
        result.data.email,
        getCookieConfig(
          platform?.env,
          request.headers.get('host') ?? undefined,
          {
            maxAge: 60 * 30,
          }
        )
      );

      // 5. Redirect to verify email page (or library if no verification)
      throw redirect(303, '/verify-email');
    } catch (err) {
      if (isRedirect(err)) throw err;

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
