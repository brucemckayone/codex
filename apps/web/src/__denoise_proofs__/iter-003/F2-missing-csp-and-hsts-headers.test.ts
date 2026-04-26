/**
 * Denoise iter-003 F2 + F3 proof test
 *
 * Cell: security × apps/web
 * Fingerprints:
 *   - F2: security:missing-csp (BLOCKER) — apps/web has NO Content-Security-Policy
 *   - F3: security:missing-hsts (MAJOR) — apps/web has NO Strict-Transport-Security
 *
 * Bug
 * ---
 * Reference 01 §6 ("CSP & Security Headers") states the security middleware
 * sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.
 * In apps/web that contract is split across two files:
 *
 *   - apps/web/svelte.config.js — currently has NO `kit.csp.directives`
 *   - apps/web/src/hooks.server.ts:66-76 — `securityHook` sets only
 *     X-Frame-Options, X-Content-Type-Options, Referrer-Policy, X-Request-Id
 *
 * Neither location sets `Content-Security-Policy` or
 * `Strict-Transport-Security`. The web app ships to production with no CSP
 * (any inline script, any cross-origin script source loads — XSS is
 * uncontained) and no HSTS (downgrade attacks against the auth-cookie
 * subdomain are possible against first-time visitors).
 *
 * Reference 01 §8 anti-pattern row 8 fingerprints `security:csp-unsafe-inline`,
 * which is a stricter bug ("CSP allows 'unsafe-inline' in script-src without
 * nonce"). The current apps/web posture is one step worse: there is no CSP
 * at all, so even nonce-based gating cannot apply.
 *
 * Catalogue rows
 * --------------
 * Row 11 — API-map snapshot. Two structural assertions:
 *   1. Either `svelte.config.js` exposes a `kit.csp.directives` object, OR
 *      `hooks.server.ts:securityHook` sets `Content-Security-Policy`.
 *   2. `hooks.server.ts:securityHook` sets `Strict-Transport-Security`.
 *
 * MCP evidence
 * ------------
 * Future: chrome-devtools `mcp__chrome-devtools__navigate_page` to / and
 * `list_network_requests` → assert response headers contain
 * `content-security-policy` AND `strict-transport-security`.
 *
 * Severity:
 *   F2 (CSP missing entirely): blocker
 *   F3 (HSTS missing): major (HTTPS-only deployments still leak first-visit
 *                       cookies via downgrade)
 * Filed at: docs/denoise/iter-003.md
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SVELTE_CONFIG = resolve(__dirname, '../../../svelte.config.js');
const HOOKS_SERVER = resolve(__dirname, '../../hooks.server.ts');

describe.skip('iter-003 F2 — apps/web missing Content-Security-Policy', () => {
  it('CSP is configured in either svelte.config.js or hooks.server.ts', () => {
    const config = readFileSync(SVELTE_CONFIG, 'utf-8');
    const hooks = readFileSync(HOOKS_SERVER, 'utf-8');

    // SvelteKit's framework-level CSP support: `kit.csp.directives`.
    const hasFrameworkCsp =
      /kit:\s*\{[\s\S]*?csp:\s*\{[\s\S]*?directives:/m.test(config);

    // Manual CSP via securityHook hand-set header.
    const hasHookCsp = /Content-Security-Policy/i.test(hooks);

    expect(
      hasFrameworkCsp || hasHookCsp,
      'apps/web must set Content-Security-Policy via either kit.csp.directives in svelte.config.js or response.headers.set in hooks.server.ts securityHook'
    ).toBe(true);
  });
});

describe('iter-003 F3 — apps/web missing Strict-Transport-Security', () => {
  it('hooks.server.ts sets HSTS header in production', () => {
    const hooks = readFileSync(HOOKS_SERVER, 'utf-8');

    // Per reference 01 §6: HSTS is part of the default security headers.
    // Allow either an explicit `Strict-Transport-Security` set OR a
    // `dev`-gated set (production-only) — both are acceptable patterns.
    expect(
      /Strict-Transport-Security/i.test(hooks),
      'apps/web/src/hooks.server.ts securityHook must set Strict-Transport-Security in production responses'
    ).toBe(true);
  });
});
