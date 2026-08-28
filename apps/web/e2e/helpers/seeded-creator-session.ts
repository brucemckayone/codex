/**
 * Run-scoped session cache for the seeded creator (Codex-ty7ly).
 *
 * `/api/auth/sign-in/email` is limited to 5 requests / 15 minutes keyed on
 * the CREDENTIAL (`combineSubjects(credentialSubject(), trustedIpSubject())`
 * in workers/auth/src/middleware/rate-limiter.ts). The subscription specs
 * sign in as `creator@test.com` in `beforeAll`, and CI retries re-run
 * `beforeAll` — 2 specs × 3 attempts = 6 charges against a 5-slot bucket,
 * so retry #2 dies with a 429 that then poisons the credential for the
 * remaining window. Playwright's `workers: 2` makes it worse: the studio
 * specs interleave with that sign-in storm in wall-clock and their session
 * lookups stall behind it (branch-only `.studio-layout` timeouts).
 *
 * The owner's decision: fix the suite, not the limiter. One sign-in per run,
 * reused everywhere. The cache lives in `os.tmpdir()` so CI gets a per-job
 * cache for free, and local runs reuse a still-valid session across runs
 * (each reuse is one fewer charge against the bucket).
 *
 * Cache validation is deliberately cheap and unthrottled:
 * `GET /api/auth/get-session` is exempt from the auth limiter (only the four
 * canonical POST surfaces are gated), so proving the cached session is alive
 * costs zero budget. A dead or missing cache falls back to exactly one live
 * sign-in, which then re-primes the cache.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserCookie } from './auth-cookies';

/**
 * Hard upper bound on cache age. BetterAuth sessions live far longer than
 * this, but the bound keeps a tmpdir leftover from an ancient run (possibly
 * before a password rotation) from being trusted indefinitely.
 */
const MAX_CACHE_AGE_MS = 12 * 60 * 60 * 1000;

interface CreatorSessionCache {
  savedAt: number;
  cookies: BrowserCookie[];
}

function cachePath(): string {
  return join(tmpdir(), 'codex-e2e-seeded-creator-session.json');
}

/** Build a Cookie request header from a Playwright-shaped cookie set. */
function toCookieHeader(cookies: BrowserCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Confirm a cookie set still resolves to the expected user's session.
 *
 * BetterAuth returns 200 with a `null` body for a missing/expired session,
 * so a 200 alone proves nothing — the email check is the actual gate.
 */
async function isSessionAlive(
  cookies: BrowserCookie[],
  expectedEmail: string
): Promise<boolean> {
  try {
    const response = await fetch('http://lvh.me:42069/api/auth/get-session', {
      headers: { Cookie: toCookieHeader(cookies) },
    });
    if (!response.ok) return false;
    const body = (await response.json()) as {
      user?: { email?: string } | null;
    } | null;
    return body?.user?.email === expectedEmail;
  } catch {
    // Auth worker not up yet (or request failed) — do not trust the cache.
    return false;
  }
}

/**
 * Load the cached cookie set if it exists, is fresh enough, and still
 * resolves to a live session for `expectedEmail`. Returns null when a fresh
 * sign-in is needed.
 */
export async function loadValidatedSeededCreatorCookies(
  expectedEmail: string
): Promise<BrowserCookie[] | null> {
  let cache: CreatorSessionCache;
  try {
    cache = JSON.parse(
      await readFile(cachePath(), 'utf8')
    ) as CreatorSessionCache;
  } catch {
    return null; // No cache yet (first run) or unreadable.
  }
  if (
    !Array.isArray(cache.cookies) ||
    cache.cookies.length === 0 ||
    typeof cache.savedAt !== 'number' ||
    Date.now() - cache.savedAt > MAX_CACHE_AGE_MS
  ) {
    return null;
  }
  return (await isSessionAlive(cache.cookies, expectedEmail))
    ? cache.cookies
    : null;
}

/** Persist a freshly captured cookie set for the rest of the run. */
export async function saveSeededCreatorCookies(
  cookies: BrowserCookie[]
): Promise<void> {
  const cache: CreatorSessionCache = { savedAt: Date.now(), cookies };
  await writeFile(cachePath(), JSON.stringify(cache), 'utf8');
}
