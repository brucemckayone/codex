/**
 * Auth Flow Debug Tests
 *
 * These tests validate our assumptions about how cookies flow between:
 * 1. Browser → SvelteKit server (cookies.get())
 * 2. SvelteKit → Auth Worker (Cookie header forwarding)
 * 3. Auth Worker → BetterAuth (session validation)
 *
 * Run with: npx playwright test e2e/auth-flow.debug.spec.ts --grep "cookies"
 */

import { expect } from '@playwright/test';
import { test } from './fixtures/auth';

const AUTH_WORKER_URL = 'http://localhost:42069';

test.describe
  .serial('Auth Flow Debug', () => {
    test.beforeAll(async ({ request }) => {
      try {
        const res = await request.get('http://localhost:42069/health');
        if (!res.ok()) test.skip(true, 'Auth worker not running on port 42069');
      } catch {
        test.skip(true, 'Auth worker not running on port 42069');
      }
    });

    test('debug: what cookies does BetterAuth actually set?', async ({
      request,
    }) => {
      // Register a test user
      const email = `cookie-debug-${Date.now()}@test.com`;
      console.log('\n=== Registering user ===', email);

      const registerRes = await request.post(
        `${AUTH_WORKER_URL}/api/auth/sign-up/email`,
        {
          headers: { Origin: AUTH_WORKER_URL },
          data: {
            name: 'Cookie Inspector',
            email,
            password: 'CookiePass123!',
          },
        }
      );

      console.log('Registration status:', registerRes.status());
      if (!registerRes.ok()) {
        const text = await registerRes.text();
        console.log('Registration error:', text);
      }
      expect(registerRes.ok()).toBeTruthy();

      // Get verification token
      const tokenRes = await request.get(
        `${AUTH_WORKER_URL}/api/test/verification-token/${encodeURIComponent(email)}`
      );

      if (!tokenRes.ok()) {
        console.log('Token error:', await tokenRes.text());
      }
      expect(tokenRes.ok()).toBeTruthy();

      const { token } = (await tokenRes.json()) as { token: string };

      // Verify - check what cookies are set
      console.log('\n=== Checking Set-Cookie headers after verification ===');
      const verifyRes = await request.get(
        `${AUTH_WORKER_URL}/api/auth/verify-email?token=${token}`,
        { redirect: 'manual' } // Don't follow redirects
      );

      const setCookieHeaders = verifyRes.headers()['set-cookie'];
      console.log(
        'Set-Cookie headers count:',
        Array.isArray(setCookieHeaders) ? setCookieHeaders.length : 1
      );
      console.log(
        'Set-Cookie headers:',
        JSON.stringify(setCookieHeaders, null, 2)
      );

      // Parse each Set-Cookie header
      if (setCookieHeaders) {
        const cookies = Array.isArray(setCookieHeaders)
          ? setCookieHeaders
          : [setCookieHeaders];
        for (const cookie of cookies) {
          console.log('\n--- Cookie Header ---');
          console.log(cookie);

          const match = cookie.match(/^([^=]+)=([^;]+)/);
          if (match) {
            console.log('  Name:', match[1]);
            console.log('  Value (first 50 chars):', match[2].substring(0, 50));
            console.log('  Value length:', match[2].length);

            // Check if value contains special characters that would be affected by encoding
            const hasSpecialChars = /[+/=%]/.test(match[2]);
            console.log('  Has special chars (+/=/%):', hasSpecialChars);

            // Check if it looks already URL-encoded (contains %XX sequences)
            const hasPercentEncoding = /%[0-9A-Fa-f]{2}/.test(match[2]);
            console.log('  Has % encoding:', hasPercentEncoding);

            // Try decoding to see if it changes
            try {
              const decoded = decodeURIComponent(match[2]);
              const isDifferent = decoded !== match[2];
              console.log('  Decodes differently:', isDifferent);
              if (isDifferent) {
                console.log(
                  '  Decoded value (first 50 chars):',
                  decoded.substring(0, 50)
                );
              }
            } catch (e) {
              console.log('  Error decoding:', e);
            }
          }
        }
      }
    });

    test('debug: test API call with different cookie encodings', async ({
      page: _page,
      request,
    }) => {
      // Use the auth fixture approach which we know works
      const email = `encoding-test-${Date.now()}@test.com`;

      // Register via auth worker
      console.log('\n=== Registering user ===', email);
      const registerRes = await request.post(
        `${AUTH_WORKER_URL}/api/auth/sign-up/email`,
        {
          headers: { Origin: AUTH_WORKER_URL },
          data: { name: 'Encoding Test', email, password: 'TestPass123!' },
        }
      );
      if (!registerRes.ok()) {
        console.log(
          'Registration failed:',
          registerRes.status,
          await registerRes.text()
        );
      }
      expect(registerRes.ok()).toBeTruthy();

      // Get token and verify
      const tokenRes = await request.get(
        `${AUTH_WORKER_URL}/api/test/verification-token/${encodeURIComponent(email)}`
      );
      expect(tokenRes.ok()).toBeTruthy();
      const { token } = (await tokenRes.json()) as { token: string };

      const verifyRes = await request.get(
        `${AUTH_WORKER_URL}/api/auth/verify-email?token=${token}`,
        { redirect: 'manual' }
      );

      // Extract the raw session token from Set-Cookie
      const setCookie = verifyRes.headers()['set-cookie'];
      const tokenMatch = String(setCookie).match(
        /better-auth\.session_token=([^;]+)/
      );

      if (!tokenMatch) {
        console.log('No session_token in Set-Cookie:', setCookie);
        throw new Error('No session cookie set after verification');
      }

      const rawSessionToken = tokenMatch[1];
      console.log('\n=== Raw session token ===');
      console.log('Length:', rawSessionToken.length);
      console.log('First 50 chars:', rawSessionToken.substring(0, 50));

      // Check for special characters
      const specialChars = rawSessionToken.match(/[+/=%]/g);
      console.log(
        'Special chars found:',
        specialChars ? [...new Set(specialChars)] : 'none'
      );

      // Now test different encodings with the get-session endpoint
      console.log(
        '\n=== Testing get-session with different cookie formats ===\n'
      );

      // Test 1: Raw token with better-auth.session_token
      console.log('Test 1: Raw token, better-auth.session_token');
      const test1 = await request.get(
        `${AUTH_WORKER_URL}/api/auth/get-session`,
        {
          headers: { Cookie: `better-auth.session_token=${rawSessionToken}` },
        }
      );
      console.log('  Status:', test1.status);
      const body1 = test1.ok() ? await test1.json() : null;
      console.log(
        '  Response:',
        body1 ? JSON.stringify(body1).substring(0, 200) : await test1.text()
      );

      // Test 2: URL-encoded token with better-auth.session_token
      console.log('\nTest 2: URL-encoded token, better-auth.session_token');
      const encodedToken = encodeURIComponent(rawSessionToken);
      console.log('  Encoded length:', encodedToken.length);
      console.log('  Encoded first 50 chars:', encodedToken.substring(0, 50));
      const test2 = await request.get(
        `${AUTH_WORKER_URL}/api/auth/get-session`,
        {
          headers: { Cookie: `better-auth.session_token=${encodedToken}` },
        }
      );
      console.log('  Status:', test2.status);
      const body2 = test2.ok() ? await test2.json() : null;
      console.log(
        '  Response:',
        body2 ? JSON.stringify(body2).substring(0, 200) : await test2.text()
      );

      // Test 3: Raw token with codex-session
      console.log('\nTest 3: Raw token, codex-session');
      const test3 = await request.get(
        `${AUTH_WORKER_URL}/api/auth/get-session`,
        {
          headers: { Cookie: `codex-session=${rawSessionToken}` },
        }
      );
      console.log('  Status:', test3.status);
      const body3 = test3.ok() ? await test3.json() : null;
      console.log(
        '  Response:',
        body3 ? JSON.stringify(body3).substring(0, 200) : await test3.text()
      );

      // Test 4: URL-encoded token with codex-session
      console.log('\nTest 4: URL-encoded token, codex-session');
      const test4 = await request.get(
        `${AUTH_WORKER_URL}/api/auth/get-session`,
        {
          headers: { Cookie: `codex-session=${encodedToken}` },
        }
      );
      console.log('  Status:', test4.status);
      const body4 = test4.ok() ? await test4.json() : null;
      console.log(
        '  Response:',
        body4 ? JSON.stringify(body4).substring(0, 200) : await test4.text()
      );

      // Test 5: Both cookie names with raw token (what api.ts should do)
      console.log('\nTest 5: Both cookie names, raw token');
      const test5 = await request.get(
        `${AUTH_WORKER_URL}/api/auth/get-session`,
        {
          headers: {
            Cookie: `codex-session=${rawSessionToken}; better-auth.session_token=${rawSessionToken}`,
          },
        }
      );
      console.log('  Status:', test5.status);
      const body5 = await test5.json();
      console.log('  Response:', JSON.stringify(body5).substring(0, 200));

      // Test 6: Both cookie names with URL-encoded token (what api.ts currently does)
      console.log(
        '\nTest 6: Both cookie names, URL-encoded token (current api.ts behavior)'
      );
      const test6 = await request.get(
        `${AUTH_WORKER_URL}/api/auth/get-session`,
        {
          headers: {
            Cookie: `codex-session=${encodedToken}; better-auth.session_token=${encodedToken}`,
          },
        }
      );
      console.log('  Status:', test6.status);
      const body6 = test6.ok() ? await test6.json() : null;
      console.log(
        '  Response:',
        body6 ? JSON.stringify(body6).substring(0, 200) : await test6.text()
      );

      // Summary
      console.log('\n=== SUMMARY ===');
      console.log(
        'Test 1 (raw, session_token):',
        test1.ok() && body1?.user ? '✅ PASS' : '❌ FAIL'
      );
      console.log(
        'Test 2 (encoded, session_token):',
        test2.ok() && body2?.user ? '✅ PASS' : '❌ FAIL'
      );
      console.log(
        'Test 3 (raw, codex-session):',
        test3.ok() && body3?.user ? '✅ PASS' : '❌ FAIL'
      );
      console.log(
        'Test 4 (encoded, codex-session):',
        test4.ok() && body4?.user ? '✅ PASS' : '❌ FAIL'
      );
      console.log(
        'Test 5 (both, raw):',
        test5.ok() && body5.user ? '✅ PASS' : '❌ FAIL'
      );
      console.log(
        'Test 6 (both, encoded):',
        test6.ok() && body6?.user ? '✅ PASS' : '❌ FAIL'
      );

      // Test 5 should be the winner
      expect(test5.ok()).toBeTruthy();
      expect(body5).toHaveProperty('user');
    });

    test('debug: SvelteKit cookies.get() behavior with special chars', async ({
      page,
    }) => {
      // This test confirms that browser cookies are already decoded when read via JS
      console.log('\n=== Testing JavaScript cookie handling ===');

      // Navigate to a page first so we have a document context
      await page.goto('/');

      const cookieTest = await page.evaluate(() => {
        // Set a test cookie with characters that would be URL-encoded
        const testValue = 'abc+def=ghi/jkl%mno';
        // biome-ignore lint/suspicious/noDocumentCookie: Intentional test of document.cookie behavior
        document.cookie = `test-cookie=${testValue}; path=/`;

        // Read it back via document.cookie
        const match = document.cookie.match(/test-cookie=([^;]+)/);
        return {
          originalValue: testValue,
          readBackValue: match ? match[1] : null,
        };
      });

      console.log('Cookie test results:', JSON.stringify(cookieTest, null, 2));

      // This confirms that document.cookie returns the DECODED value
      expect(cookieTest.readBackValue).toBe(cookieTest.originalValue);

      console.log('\n✅ JavaScript document.cookie returns DECODED values');
      console.log(
        'This means SvelteKit cookies.get() also returns DECODED values'
      );
    });

    test('debug: form login session persistence', async ({ page, request }) => {
      // This test replicates the original failing test but with detailed logging
      const email = `form-login-${Date.now()}@test.com`;

      // Step 1: Register via API (not form)
      console.log('\n=== Step 1: Registering user ===');
      const registerRes = await request.post(
        `${AUTH_WORKER_URL}/api/auth/sign-up/email`,
        {
          headers: { Origin: AUTH_WORKER_URL },
          data: { name: 'Form Login Test', email, password: 'FormPass123!' },
        }
      );
      expect(registerRes.ok()).toBeTruthy();

      // Step 2: Verify email
      console.log('=== Step 2: Verifying email ===');
      const tokenRes = await request.get(
        `${AUTH_WORKER_URL}/api/test/verification-token/${encodeURIComponent(email)}`
      );
      expect(tokenRes.ok()).toBeTruthy();
      const { token } = (await tokenRes.json()) as { token: string };

      const verifyRes = await request.get(
        `${AUTH_WORKER_URL}/api/auth/verify-email?token=${token}`
      );
      expect(verifyRes.ok()).toBeTruthy();

      // Step 3: Log in via the BROWSER FORM
      console.log('\n=== Step 3: Logging in via browser form ===');
      await page.goto('/login');

      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', 'FormPass123!');
      await page.click('button[type="submit"]');

      // Wait for redirect
      await expect(page).toHaveURL(/\/library/, { timeout: 10_000 });
      console.log('✅ Redirected to /library');

      // Step 4: Inspect cookies in the browser
      console.log('\n=== Step 4: Browser Cookies After Login ===');
      const browserCookies = await page.context().cookies();
      const sessionCookie = browserCookies.find(
        (c) =>
          c.name === 'codex-session' || c.name === 'better-auth.session_token'
      );

      if (sessionCookie) {
        console.log('Session cookie found:', {
          name: sessionCookie.name,
          valueLength: sessionCookie.value.length,
          valuePreview: `${sessionCookie.value.substring(0, 30)}...`,
        });
      } else {
        console.error('❌ No session cookie found in browser!');
      }
      expect(sessionCookie).toBeDefined();

      // Step 5: Check if browser can access protected route
      console.log('\n=== Step 5: Accessing protected route ===');
      await page.goto('/account');
      const accountUrl = page.url();
      console.log('After navigating to /account, URL is:', accountUrl);

      // If redirected to login, session didn't persist
      const isRedirectedToLogin = accountUrl.includes('/login');

      if (isRedirectedToLogin) {
        console.error('\n❌ SESSION DID NOT PERSIST FROM FORM LOGIN');
        console.error('This is the bug we need to fix!');
      } else {
        console.log('\n✅ Session persisted - form login works correctly!');
      }

      expect(isRedirectedToLogin).toBeFalsy();
    });
  });
