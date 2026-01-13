import { authLoginSchema } from '@codex/validation';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// TODO: These should ideally be imported from a shared config or env
// Using default loopback for now as per api.ts
const AUTH_WORKER_URL = 'http://localhost:42069';

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
      const authUrl = platform?.env?.AUTH_WORKER_URL ?? AUTH_WORKER_URL;
      const res = await fetch(`${authUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
      // The Auth Worker returns a Set-Cookie header. We need to forward it.
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const sessionMatch = setCookie.match(/codex-session=([^;]+)/);
        if (sessionMatch) {
          cookies.set('codex-session', sessionMatch[1], {
            path: '/',
            httpOnly: true,
            secure: true, // Should be true in prod
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7, // 7 days
            domain: '.revelations.studio', // TODO: Make configurable
          });
        }
      }

      // 4. Redirect
      const redirectTo = (data.get('redirect') as string) || '/library';
      // Validate redirect to prevent open redirect
      if (redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
        throw redirect(303, redirectTo);
      }
      throw redirect(303, '/library');
    } catch (err) {
      if (err instanceof Response) throw err; // Re-throw redirects

      console.error('Login error:', err);
      return fail(500, {
        email,
        error: 'An unexpected error occurred. Please try again.',
      });
    }
  },
};
