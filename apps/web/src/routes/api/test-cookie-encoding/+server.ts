/**
 * Test endpoint to understand cookie encoding behavior
 *
 * This helps us understand:
 * 1. What cookies.get() returns (decoded or raw?)
 * 2. What format BetterAuth expects in Cookie headers
 */

import { createServerApi } from '$lib/server/api';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ cookies, platform }) => {
  const results = {
    testCookie: null as string | null,
    codexSession: null as string | null,
    betterAuthSession: null as string | null,
    codexSessionLength: 0,
    betterAuthSessionLength: 0,
    hasSpecialChars: false,
    specialCharsFound: [] as string[],
    test: null as string | null,
  };

  // Read test cookie if set
  const testCookie = cookies.get('test-encoding');
  results.testCookie = testCookie;

  // Read session cookies
  const codexSession = cookies.get('codex-session');
  const betterAuthSession = cookies.get('better-auth.session_token');

  results.codexSession = `${codexSession?.substring(0, 20)}...` || null;
  results.betterAuthSession =
    `${betterAuthSession?.substring(0, 20)}...` || null;
  results.codexSessionLength = codexSession?.length || 0;
  results.betterAuthSessionLength = betterAuthSession?.length || 0;

  if (codexSession) {
    const specialChars = codexSession.match(/[+/=%_-]/g);
    if (specialChars) {
      results.hasSpecialChars = true;
      results.specialCharsFound = [...new Set(specialChars)];
    }
  }

  // Test calling auth worker with current api.ts implementation
  let testResult = 'skipped';
  if (codexSession) {
    try {
      const api = createServerApi(platform, cookies);
      const session = await api.auth.getSession();
      testResult = session?.user
        ? 'SUCCESS: api.auth.getSession() returned user'
        : 'FAIL: api.auth.getSession() returned null';
    } catch (error) {
      testResult = `ERROR: ${error}`;
    }
  }
  results.test = testResult;

  return new Response(JSON.stringify(results, null, 2), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
};
