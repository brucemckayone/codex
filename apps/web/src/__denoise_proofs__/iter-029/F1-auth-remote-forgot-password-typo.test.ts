/**
 * Denoise iter-029 F1 proof test
 *
 * Cell: security × apps/web
 * Fingerprint: web:auth-remote-broken-endpoint
 * Severity: BLOCKER (feature-availability — silently broken reset flow)
 * Recurrence: 2nd hit (iter-003 F4, now iter-029 F1) — Codex-ttavz.12 still open.
 *
 * Bug
 * ---
 * `apps/web/src/lib/remote/auth.remote.ts:146` POSTs the forgot-password
 * form to `/api/auth/forgot-password` (with the "forgot" typo). The
 * canonical BetterAuth endpoint is `/api/auth/forget-password` —
 *
 *   - `packages/constants/src/security.ts:79-84`
 *     `BETTERAUTH_RATE_LIMITED_PATHS` lists `/api/auth/forget-password`.
 *   - `apps/web/src/routes/(auth)/forgot-password/+page.server.ts:29`
 *     POSTs to the correct `/api/auth/forget-password`.
 *   - `workers/auth/CLAUDE.md` documents the endpoint as
 *     `POST /api/auth/send-reset-password-email` (BetterAuth v1 alias)
 *     mounted under the same path-prefix.
 *
 * The remote function endpoint is therefore silently broken — every call
 * to `forgotPasswordForm` would 404 at the auth worker. The function's
 * "always return success to prevent email enumeration" pattern hides the
 * failure from the user, so the bug is invisible at the UI layer.
 *
 * Codex-ttavz.15 (sibling finding, same recurrence cycle) flags that all
 * three exports in this file (`registerForm`, `forgotPasswordForm`,
 * `resetPasswordForm`) currently have zero consumers in `apps/web/src/routes`.
 * The live forgot-password flow goes through the form action in
 * `routes/(auth)/forgot-password/+page.server.ts`, which uses the correct
 * endpoint. So Codex-ttavz.12's blast radius is contained today by 0
 * consumers — but if anyone wires `forgotPasswordForm` up tomorrow without
 * fixing the typo, password reset breaks platform-wide.
 *
 * Fix is one line: change `forgot-password` → `forget-password`. The
 * structural test below would then go green.
 *
 * Catalogue rows
 * --------------
 * Row 11 — API-map snapshot. Structural assertion: the literal endpoint
 * path used by `forgotPasswordForm` matches the canonical
 * `BETTERAUTH_RATE_LIMITED_PATHS` constant.
 *
 * MCP evidence
 * ------------
 * Future: Playwright `browser_navigate` to `/forgot-password`, fill form,
 * submit, capture network request — assert URL ends in
 * `/api/auth/forget-password`. Also playwright fetch directly with curl
 * equivalent to confirm 404 on `forgot-password`.
 *
 * Filed at: docs/denoise/iter-029.md
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const AUTH_REMOTE = resolve(__dirname, '../../lib/remote/auth.remote.ts');

describe('iter-029 F1 — auth.remote.ts forgot-password typo', () => {
  it('forgotPasswordForm POSTs to canonical /api/auth/forget-password (not /forgot-password)', () => {
    const source = readFileSync(AUTH_REMOTE, 'utf-8');

    // Extract the literal fetch path used by the forgotPasswordForm.
    // This matches the entire fetch URL template — both correct and typo.
    const fetchUrlMatch = source.match(
      /fetch\(`\$\{authUrl\}\/api\/auth\/(forget|forgot)-password`/
    );

    expect(
      fetchUrlMatch,
      'auth.remote.ts must POST to either /api/auth/forget-password or /forgot-password — could not locate the call'
    ).not.toBeNull();

    const variant = fetchUrlMatch?.[1] ?? '';

    expect(
      variant,
      'auth.remote.ts forgotPasswordForm must POST to /api/auth/forget-password (BetterAuth canonical name); /forgot-password (with the "forgot" typo) returns 404 at the auth worker'
    ).toBe('forget');
  });
});
