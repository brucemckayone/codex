/**
 * Auth fixture for e2e tests
 * Handles user registration, login, and session management via REAL auth worker
 */

import type { APIRequestContext } from '@playwright/test';

import { extractSessionCookie } from '../helpers/cookies';
import type { RegisteredUser } from '../helpers/types';
import { WORKER_URLS } from '../helpers/worker-urls';

export const authFixture = {
  /**
   * Register a new user via auth worker
   *
   * Note: Better-auth requires email verification before creating session.
   * This fixture handles the verification flow automatically by:
   * 1. Registering user via HTTP POST
   * 2. Extracting verification token from response
   * 3. Verifying email via HTTP GET
   * 4. Logging in to get session
   */
  async registerUser(
    request: APIRequestContext,
    data: {
      email: string;
      password: string;
      name?: string;
      role?: string;
    }
  ): Promise<RegisteredUser> {
    // Step 1: Register via HTTP POST to /api/auth/sign-up/email
    const registerResponse = await request.post(
      `${WORKER_URLS.auth}/api/auth/sign-up/email`,
      {
        headers: {
          Origin: WORKER_URLS.auth, // Better Auth requires Origin header
        },
        data: {
          email: data.email,
          password: data.password,
          name: data.name ?? data.email.split('@')[0],
          role: data.role ?? 'customer',
        },
      }
    );

    if (!registerResponse.ok()) {
      const error = await registerResponse.json();
      throw new Error(`Registration failed: ${JSON.stringify(error)}`);
    }

    // Step 2: Get verification token from test endpoint
    // BetterAuth doesn't persist tokens to DB, so we capture them in KV
    const tokenResponse = await request.get(
      `${WORKER_URLS.auth}/api/test/verification-token/${encodeURIComponent(data.email)}`
    );

    if (!tokenResponse.ok()) {
      const error = await tokenResponse.text();
      throw new Error(`Verification token not found: ${error}`);
    }

    const { token } = await tokenResponse.json();

    // Step 3: Verify email via HTTP GET to /api/auth/verify-email
    // BetterAuth with autoSignInAfterVerification will create session and redirect
    const verifyResponse = await request.get(
      `${WORKER_URLS.auth}/api/auth/verify-email?token=${token}&callbackURL=/`,
      { maxRedirects: 0 } // Don't follow redirects - we want to capture the cookie
    );

    // Verification returns 302 redirect with Set-Cookie header
    if (verifyResponse.status() !== 302 && !verifyResponse.ok()) {
      const error = await verifyResponse.json();
      throw new Error(`Email verification failed: ${JSON.stringify(error)}`);
    }

    // Session cookie is set in verify-email response (autoSignInAfterVerification: true)
    const verifyCookie = verifyResponse.headers()['set-cookie'];

    // If no cookie from verification, we need to explicitly sign in
    if (!verifyCookie || !verifyCookie.includes('codex-session')) {
      // Fallback: explicit sign-in
      const loginResponse = await request.post(
        `${WORKER_URLS.auth}/api/auth/sign-in/email`,
        {
          data: {
            email: data.email,
            password: data.password,
          },
          headers: {
            Origin: WORKER_URLS.auth,
          },
        }
      );

      if (!loginResponse.ok()) {
        const error = await loginResponse.json();
        throw new Error(
          `Login after verification failed: ${JSON.stringify(error)}`
        );
      }

      const loginCookie = loginResponse.headers()['set-cookie'];
      const cookieToSend = extractSessionCookie(loginCookie);

      // Get session from get-session endpoint
      const sessionResponse = await request.get(
        `${WORKER_URLS.auth}/api/auth/get-session`,
        {
          headers: {
            Cookie: cookieToSend,
          },
        }
      );

      console.log('[DEBUG] Session response status:', sessionResponse.status());
      if (!sessionResponse.ok()) {
        const errorBody = await sessionResponse.text();
        console.log('[DEBUG] Session error response:', errorBody);
        throw new Error(
          `Failed to get session after login: ${sessionResponse.status()} - ${errorBody}`
        );
      }

      const sessionData = await sessionResponse.json();

      return {
        user: sessionData.user,
        session: sessionData.session,
        cookie: extractSessionCookie(loginCookie),
      };
    }

    // Get user info from get-session endpoint using the cookie from verification
    const sessionResponse = await request.get(
      `${WORKER_URLS.auth}/api/auth/get-session`,
      {
        headers: {
          Cookie: extractSessionCookie(verifyCookie),
        },
      }
    );

    if (!sessionResponse.ok()) {
      throw new Error(
        `Failed to get session after verification: ${sessionResponse.status()}`
      );
    }

    const sessionData = await sessionResponse.json();

    return {
      user: sessionData.user,
      session: sessionData.session,
      cookie: extractSessionCookie(verifyCookie),
    };
  },

  /**
   * Login existing user via auth worker
   */
  async loginUser(
    request: APIRequestContext,
    credentials: {
      email: string;
      password: string;
    }
  ): Promise<RegisteredUser> {
    const response = await request.post(
      `${WORKER_URLS.auth}/api/auth/sign-in/email`,
      {
        data: credentials,
        headers: {
          Origin: WORKER_URLS.auth,
        },
      }
    );

    if (!response.ok()) {
      const error = await response.json();
      throw new Error(`Login failed: ${JSON.stringify(error)}`);
    }

    const setCookie = response.headers()['set-cookie'];

    // Get session from get-session endpoint
    const sessionResponse = await request.get(
      `${WORKER_URLS.auth}/api/auth/get-session`,
      {
        headers: {
          Cookie: extractSessionCookie(setCookie),
        },
      }
    );

    if (!sessionResponse.ok()) {
      throw new Error(
        `Failed to get session after login: ${sessionResponse.status()}`
      );
    }

    const sessionData = await sessionResponse.json();

    return {
      user: sessionData.user,
      session: sessionData.session,
      cookie: extractSessionCookie(setCookie),
    };
  },

  /**
   * Get current session from auth worker
   */
  async getSession(request: APIRequestContext, sessionCookie: string) {
    const response = await request.get(
      `${WORKER_URLS.auth}/api/auth/get-session`,
      {
        headers: { Cookie: sessionCookie },
      }
    );

    if (!response.ok()) {
      return null;
    }

    return response.json();
  },

  /**
   * Logout (invalidate session) via auth worker
   */
  async logout(
    request: APIRequestContext,
    sessionCookie: string
  ): Promise<void> {
    await request.post(`${WORKER_URLS.auth}/api/auth/signout`, {
      headers: { Cookie: sessionCookie },
    });
  },
};
