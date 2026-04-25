/**
 * Denoise iter-003 F1 proof test
 *
 * Cell: security × apps/web
 * Fingerprint: web:auth-remote-broken-endpoint
 *
 * Bug
 * ---
 * `apps/web/src/lib/remote/auth.remote.ts:146` posts the forgot-password form
 * to `/api/auth/forgot-password` (with the natural-English "forgot" spelling),
 * but BetterAuth's actual route is `/api/auth/forget-password` (no "o"). See:
 *
 *   - apps/web/src/routes/(auth)/forgot-password/+page.server.ts:29
 *     (the page action — uses the correct `/api/auth/forget-password`)
 *   - workers/auth/CLAUDE.md (canonical BetterAuth POST routes)
 *   - workers/auth/src/__denoise_proofs__/iter-002/F1-auth-rate-limit-stale-paths.test.ts:55
 *     (live BetterAuth route set, derived from BetterAuth's @better-auth/core
 *     `internal_endpoints` map)
 *
 * Result: every call to the `forgotPasswordForm` remote function lands on a
 * 404 at the auth worker. The form short-circuits to its hard-coded
 * "If an account exists, a reset email has been sent." message regardless,
 * so the bug is INVISIBLE to the user — the email is never actually sent.
 *
 * The remote function IS publicly callable as an HTTP endpoint (SvelteKit
 * compiler-registered, per `/fallow-audit` False-Positive Taxonomy #1).
 * Even though no Svelte component consumes it (the (auth)/forgot-password
 * page renders its own native form action), the endpoint stays live and
 * callable by any unauthenticated client.
 *
 * Catalogue row
 * -------------
 * Row 11 — API-map snapshot. Read auth.remote.ts source, assert the
 * forgot-password fetch URL contains the substring `forget-password`
 * (BetterAuth's canonical name) and NOT the typo `forgot-password`.
 *
 * MCP evidence
 * ------------
 * Future: Playwright runs through the (auth)/forgot-password page action
 * AND a direct POST to the remote function endpoint, asserting both reach
 * the same auth-worker route.
 *
 * Severity: blocker
 * Filed at: docs/denoise/iter-003.md
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REMOTE_FILE = resolve(__dirname, '../../lib/remote/auth.remote.ts');

describe.skip('iter-003 F1 — auth.remote.ts forgotPasswordForm broken endpoint', () => {
  it('forgotPasswordForm posts to BetterAuth forget-password route, not the typo', () => {
    const src = readFileSync(REMOTE_FILE, 'utf-8');

    // Locate the forgotPasswordForm body — between its export const and the
    // next blank-line + comment-block that starts the next form export.
    const start = src.indexOf('export const forgotPasswordForm');
    expect(start, 'forgotPasswordForm export not found').toBeGreaterThan(-1);
    const body = src.slice(
      start,
      src.indexOf('export const resetPasswordForm')
    );

    // Bug: the typo `forgot-password` reaches the auth worker as a 404.
    expect(
      body.includes('/api/auth/forgot-password'),
      'forgotPasswordForm posts to non-existent /api/auth/forgot-password — should be /api/auth/forget-password (BetterAuth canonical route)'
    ).toBe(false);

    // Fix: must use BetterAuth's canonical path (verified live via the
    // (auth)/forgot-password/+page.server.ts:29 action which already uses
    // the correct path).
    expect(
      body.includes('/api/auth/forget-password'),
      'forgotPasswordForm should POST to /api/auth/forget-password (BetterAuth canonical route)'
    ).toBe(true);
  });

  it('the page action and the remote function agree on the BetterAuth route', () => {
    const remote = readFileSync(REMOTE_FILE, 'utf-8');
    const pageAction = readFileSync(
      resolve(
        __dirname,
        '../../../src/routes/(auth)/forgot-password/+page.server.ts'
      ),
      'utf-8'
    );

    const REMOTE_PATH = /\/api\/auth\/(forget|forgot)-password/g;
    const remoteHits = remote.match(REMOTE_PATH) ?? [];
    const pageHits = pageAction.match(REMOTE_PATH) ?? [];

    expect(
      remoteHits.length,
      'forgotPasswordForm should reference the BetterAuth path exactly once'
    ).toBeGreaterThanOrEqual(1);
    expect(
      pageHits.length,
      'page action should reference the BetterAuth path exactly once'
    ).toBeGreaterThanOrEqual(1);

    // After the fix, every reference in either file should be the canonical
    // `forget-password` (BetterAuth's actual route), not the typo.
    const allHits = [...remoteHits, ...pageHits];
    const distinctPaths = new Set(allHits);
    expect(
      distinctPaths.size,
      `auth.remote.ts and forgot-password/+page.server.ts disagree on the BetterAuth route — saw ${[...distinctPaths].join(' and ')}`
    ).toBe(1);
  });
});
