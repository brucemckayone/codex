import type { PageServerLoad } from './$types';

const AUTH_WORKER_URL = 'http://localhost:42069';

export const load: PageServerLoad = async ({ url, platform, cookies }) => {
  const token = url.searchParams.get('token');

  if (!token) {
    return {
      success: false,
      error: 'Missing verification token.',
    };
  }

  try {
    const authUrl = platform?.env?.AUTH_WORKER_URL ?? AUTH_WORKER_URL;

    // Attempt verification via API
    // Assuming POST for mutation, or GET if BetterAuth follows generic link pattern
    // Let's try POST with JSON body for API consistency
    const res = await fetch(`${authUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) {
      // If 404/400, token invalid
      return {
        success: false,
        error: 'Invalid or expired verification link.',
      };
    }

    // Capture session if returned
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const sessionMatch = setCookie.match(/codex-session=([^;]+)/);
      if (sessionMatch) {
        cookies.set('codex-session', sessionMatch[1], {
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 7,
          domain: '.revelations.studio',
        });
      }
    }

    return {
      success: true,
    };
  } catch (err) {
    console.error('Verify email error:', err);
    return {
      success: false,
      error: 'An unexpected error occurred.',
    };
  }
};
