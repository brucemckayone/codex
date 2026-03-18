import { getServiceUrl } from '@codex/constants';
import { httpClient } from '../helpers/http-client';
import type { RegisteredUser } from '../helpers/types';

/**
 * Resolve the Auth Worker URL for E2E tests.
 * E2E always runs in dev mode context (localhost workers).
 */
const AUTH_URL = getServiceUrl('auth', true);

/**
 * Extract session cookies from Set-Cookie header.
 *
 * Better Auth uses both `better-auth.session_token` AND `better-auth.session_data`.
 * Both are required for session validation.
 *
 * @param setCookieHeader - The raw Set-Cookie header string from the response
 * @returns A formatted Cookie string compatible with subsequent fetch requests
 */
export function extractSessionCookie(setCookieHeader: string | null): string {
  if (!setCookieHeader) {
    throw new Error('No Set-Cookie header found in response');
  }

  // Extract better-auth.session_token
  const tokenMatch = setCookieHeader.match(
    /better-auth\.session_token=([^;]+)/
  );

  // Extract better-auth.session_data (the last one, as there may be a deletion cookie first)
  const dataMatches = Array.from(
    setCookieHeader.matchAll(/better-auth\.session_data=([^;]*)/g)
  );
  let sessionData: string | null = null;
  for (const match of dataMatches) {
    if (match[1] && match[1].length > 0) {
      sessionData = match[1];
    }
  }

  if (tokenMatch) {
    // Send both cookies (Better Auth requires both for session validation)
    const cookies = [`better-auth.session_token=${tokenMatch[1]}`];
    if (sessionData) {
      cookies.push(`better-auth.session_data=${sessionData}`);
    }
    return cookies.join('; ');
  }

  // Fallback: try codex-session (configured name)
  const codexMatch = setCookieHeader.match(/codex-session=([^;]+)/);
  if (codexMatch) {
    return `codex-session=${codexMatch[1]}`;
  }

  throw new Error(
    `No session cookie found in Set-Cookie header: ${setCookieHeader}`
  );
}

/**
 * Parse a cookie string ("name=value; name2=value2") into an array of name/value pairs.
 *
 * This utility is used to convert raw cookie strings into objects compatible with
 * Playwright's addCookies() method.
 */
export function parseCookieString(
  cookieString: string
): Array<{ name: string; value: string }> {
  const cookieParts = cookieString.split(/;\s?/);
  const result: Array<{ name: string; value: string }> = [];

  for (const part of cookieParts) {
    const [name, ...rest] = part.trim().split('=');
    const value = rest.join('=');

    if (!name || !value) continue;
    result.push({ name, value });
  }

  return result;
}

export const authFixture = {
  /**
   * Register a new user via auth worker.
   *
   * Tries the fast-register endpoint first (single HTTP call).
   * Falls back to the multi-step flow if fast-register is unavailable.
   */
  async registerUser(data: {
    email: string;
    password: string;
    name?: string;
    role?: string;
  }): Promise<RegisteredUser> {
    // Try fast-register first (1 HTTP call instead of 3-5)
    const fastResult = await this._tryFastRegister(data);
    if (fastResult) return fastResult;

    // Fallback: multi-step registration flow
    return this._legacyRegister(data);
  },

  /**
   * Fast registration via test-only endpoint.
   * Returns null if the endpoint is unavailable (404).
   */
  async _tryFastRegister(data: {
    email: string;
    password: string;
    name?: string;
    role?: string;
  }): Promise<RegisteredUser | null> {
    try {
      const maxRetries = 3;
      let response: Response | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        response = await httpClient.post(`${AUTH_URL}/api/test/fast-register`, {
          headers: { Origin: AUTH_URL },
          data: {
            email: data.email,
            password: data.password,
            name: data.name ?? data.email.split('@')[0],
            role: data.role ?? 'customer',
          },
        });

        // Retry on 503 (worker restart mid-request)
        if (response.status === 503 && attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }

        break;
      }

      if (!response) return null;

      // Endpoint not available (production/staging) — fall back
      if (response.status === 404) return null;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Fast registration failed (${response.status}): ${errorText.slice(0, 200)}`
        );
      }

      const setCookie = response.headers.get('set-cookie');

      // If fast-register succeeded but returned no cookies,
      // the user was created — login directly instead of the slow legacy path.
      if (
        !setCookie ||
        (!setCookie.includes('better-auth.session_token') &&
          !setCookie.includes('codex-session'))
      ) {
        return this._loginFallback(data);
      }

      const cookie = extractSessionCookie(setCookie);

      // Get session data
      const sessionResponse = await httpClient.get(
        `${AUTH_URL}/api/auth/get-session`,
        { headers: { Cookie: cookie } }
      );

      if (!sessionResponse.ok) {
        throw new Error(
          `Failed to get session after fast-register: ${sessionResponse.status}`
        );
      }

      const sessionData = (await sessionResponse.json()) as {
        user: RegisteredUser['user'];
        session: RegisteredUser['session'];
      };

      return {
        user: sessionData.user,
        session: sessionData.session,
        cookie,
      };
    } catch (error) {
      // If fast-register throws (not just 404), log and fall back
      if (
        error instanceof Error &&
        error.message.includes('Fast registration failed')
      ) {
        throw error; // Re-throw actual failures
      }
      console.warn('Fast-register unavailable, falling back:', error);
      return null;
    }
  },

  /**
   * Legacy multi-step registration flow.
   * 1. Register via HTTP POST
   * 2. Capture verification token from KV (test endpoint)
   * 3. Verify email via HTTP GET
   * 4. Return user and session details
   *
   * If the user already exists (e.g. fast-register created them but didn't
   * return cookies), falls back to login instead of throwing.
   */
  async _legacyRegister(data: {
    email: string;
    password: string;
    name?: string;
    role?: string;
  }): Promise<RegisteredUser> {
    // Step 1: Register via HTTP POST to /api/auth/sign-up/email
    const registerResponse = await httpClient.post(
      `${AUTH_URL}/api/auth/sign-up/email`,
      {
        headers: {
          Origin: AUTH_URL, // Better Auth requires Origin header
        },
        data: {
          email: data.email,
          password: data.password,
          name: data.name ?? data.email.split('@')[0],
          role: data.role ?? 'customer',
        },
      }
    );

    if (!registerResponse.ok) {
      const errorText = await registerResponse.text();

      // If user already exists (fast-register created them, or stale from
      // a prior test run), fall back to login instead of failing.
      if (
        registerResponse.status === 422 &&
        errorText.includes('USER_ALREADY_EXISTS')
      ) {
        return this._loginFallback(data);
      }

      let errorMsg = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMsg = JSON.stringify(errorJson);
      } catch {
        errorMsg = errorText.slice(0, 200);
      }
      throw new Error(
        `Registration failed (${registerResponse.status}): ${errorMsg}`
      );
    }

    // Step 2: Get verification token from test endpoint
    const tokenResponse = await httpClient.get(
      `${AUTH_URL}/api/test/verification-token/${encodeURIComponent(data.email)}`
    );

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Verification token not found: ${error}`);
    }

    const { token } = (await tokenResponse.json()) as { token: string };

    // Step 3: Verify email via HTTP GET to /api/auth/verify-email
    const verifyResponse = await httpClient.get(
      `${AUTH_URL}/api/auth/verify-email?token=${token}&callbackURL=/`,
      { maxRedirects: 0 }
    );

    if (verifyResponse.status !== 302 && !verifyResponse.ok) {
      const errorText = await verifyResponse.text();
      let errorMsg = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMsg = JSON.stringify(errorJson);
      } catch {
        errorMsg = errorText.slice(0, 200);
      }
      throw new Error(
        `Email verification failed (${verifyResponse.status}): ${errorMsg}`
      );
    }

    const verifyCookie = verifyResponse.headers.get('set-cookie');
    const hasSessionCookie =
      verifyCookie &&
      (verifyCookie.includes('better-auth.session_token') ||
        verifyCookie.includes('codex-session'));

    if (!hasSessionCookie) {
      // Fallback: explicit sign-in
      let loginResponse: Response | null = null;
      let lastError: Error | null = null;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          loginResponse = await httpClient.post(
            `${AUTH_URL}/api/auth/sign-in/email`,
            {
              data: {
                email: data.email,
                password: data.password,
              },
              headers: {
                Origin: AUTH_URL,
              },
            }
          );

          if (loginResponse.ok || loginResponse.status !== 503) {
            break;
          }

          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          }
        } catch (error) {
          lastError = error as Error;
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          }
        }
      }

      if (!loginResponse) {
        throw lastError || new Error('Sign-in failed: no response received');
      }

      if (!loginResponse.ok) {
        const errorText = await loginResponse.text();
        let errorMsg = errorText;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = JSON.stringify(errorJson);
        } catch {
          errorMsg = errorText.slice(0, 200);
        }
        throw new Error(
          `Login after verification failed (${loginResponse.status}): ${errorMsg}`
        );
      }

      const loginCookie = loginResponse.headers.get('set-cookie');
      const cookieToSend = extractSessionCookie(loginCookie);

      const sessionResponse = await httpClient.get(
        `${AUTH_URL}/api/auth/get-session`,
        {
          headers: {
            Cookie: cookieToSend,
          },
        }
      );

      if (!sessionResponse.ok) {
        const errorBody = await sessionResponse.text();
        throw new Error(
          `Failed to get session after login: ${sessionResponse.status} - ${errorBody}`
        );
      }

      const sessionData = (await sessionResponse.json()) as {
        user: RegisteredUser['user'];
        session: RegisteredUser['session'];
      };

      return {
        user: sessionData.user,
        session: sessionData.session,
        cookie: extractSessionCookie(loginCookie),
      };
    }

    const sessionResponse = await httpClient.get(
      `${AUTH_URL}/api/auth/get-session`,
      {
        headers: {
          Cookie: extractSessionCookie(verifyCookie),
        },
      }
    );

    if (!sessionResponse.ok) {
      throw new Error(
        `Failed to get session after verification: ${sessionResponse.status}`
      );
    }

    const sessionData = (await sessionResponse.json()) as {
      user: RegisteredUser['user'];
      session: RegisteredUser['session'];
    };

    return {
      user: sessionData.user,
      session: sessionData.session,
      cookie: extractSessionCookie(verifyCookie),
    };
  },

  /**
   * Internal fallback: login when registration fails because the user
   * already exists (e.g. created by fast-register without cookies, or
   * left over from a previous test run).
   */
  async _loginFallback(data: {
    email: string;
    password: string;
  }): Promise<RegisteredUser> {
    const loginResponse = await httpClient.post(
      `${AUTH_URL}/api/auth/sign-in/email`,
      {
        data: { email: data.email, password: data.password },
        headers: { Origin: AUTH_URL },
      }
    );

    if (!loginResponse.ok) {
      const errorText = await loginResponse.text();
      throw new Error(
        `Login fallback failed (${loginResponse.status}): ${errorText.slice(0, 200)}`
      );
    }

    const setCookie = loginResponse.headers.get('set-cookie');
    const cookie = extractSessionCookie(setCookie);

    const sessionResponse = await httpClient.get(
      `${AUTH_URL}/api/auth/get-session`,
      { headers: { Cookie: cookie } }
    );

    if (!sessionResponse.ok) {
      throw new Error(
        `Failed to get session after login fallback: ${sessionResponse.status}`
      );
    }

    const sessionData = (await sessionResponse.json()) as {
      user: RegisteredUser['user'];
      session: RegisteredUser['session'];
    };

    return {
      user: sessionData.user,
      session: sessionData.session,
      cookie,
    };
  },

  /**
   * Login existing user via auth worker.
   */
  async loginUser(credentials: {
    email: string;
    password: string;
  }): Promise<RegisteredUser> {
    const response = await httpClient.post(
      `${AUTH_URL}/api/auth/sign-in/email`,
      {
        data: credentials,
        headers: {
          Origin: AUTH_URL,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Login failed: ${JSON.stringify(error)}`);
    }

    const setCookie = response.headers.get('set-cookie');

    const sessionResponse = await httpClient.get(
      `${AUTH_URL}/api/auth/get-session`,
      {
        headers: {
          Cookie: extractSessionCookie(setCookie),
        },
      }
    );

    if (!sessionResponse.ok) {
      throw new Error(
        `Failed to get session after login: ${sessionResponse.status}`
      );
    }

    const sessionData = (await sessionResponse.json()) as {
      user: RegisteredUser['user'];
      session: RegisteredUser['session'];
    };

    return {
      user: sessionData.user,
      session: sessionData.session,
      cookie: extractSessionCookie(setCookie),
    };
  },

  /**
   * Get current session from auth worker.
   */
  async getSession(sessionCookie: string) {
    const response = await httpClient.get(`${AUTH_URL}/api/auth/get-session`, {
      headers: { Cookie: sessionCookie },
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  },

  /**
   * Logout (invalidate session) via auth worker.
   */
  async logout(sessionCookie: string): Promise<void> {
    await httpClient.post(`${AUTH_URL}/api/auth/signout`, {
      headers: { Cookie: sessionCookie },
    });
  },
};
