/**
 * Test endpoint to inspect cookie encoding
 *
 * Call this with: curl -v http://localhost:5173/api/test-cookie
 * This will set a cookie with special characters, then read it back
 * to see what SvelteKit's cookies.get() returns.
 */

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
  const results = {
    testCookie: null as string | null,
    codexSession: null as string | null,
    betterAuthSession: null as string | null,
  };

  // Read test cookie if set
  const testCookie = cookies.get('test-encoding');
  results.testCookie = testCookie;

  // Read session cookies
  results.codexSession = cookies.get('codex-session');
  results.betterAuthSession = cookies.get('better-auth.session_token');

  // Also test writing a cookie with special characters
  const testValue = 'abc+def=ghi/jkl%mno';
  cookies.set('test-encoding', testValue, {
    path: '/',
    httpOnly: false, // Make it readable via JS
  });

  return new Response(
    JSON.stringify(
      {
        ...results,
        note: 'If you see the test-encoding cookie value, it shows what cookies.get() returns',
        testValueSet: testValue,
      },
      null,
      2
    ),
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
};
