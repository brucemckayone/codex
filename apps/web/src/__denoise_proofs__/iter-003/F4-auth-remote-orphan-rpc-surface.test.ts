/**
 * Denoise iter-003 F4 proof test
 *
 * Cell: security × apps/web
 * Fingerprint: web:auth-form-orphan-rpc-surface
 *
 * Bug
 * ---
 * `apps/web/src/lib/remote/auth.remote.ts` exports three remote forms:
 *   - registerForm        (line 100)
 *   - forgotPasswordForm  (line 140)  ← also has the F1 endpoint typo
 *   - resetPasswordForm   (line 175)
 *
 * None of these are consumed by any Svelte component. The actual auth UI
 * lives at:
 *   - routes/(auth)/login/+page.svelte         → login/+page.server.ts action
 *   - routes/(auth)/register/+page.svelte      → register/+page.server.ts action
 *   - routes/(auth)/forgot-password/+page.svelte → forgot-password/+page.server.ts action
 *   - routes/(auth)/reset-password/+page.svelte  → reset-password/+page.server.ts action
 *
 * Each route uses a native `<form method="POST">` submitting to its own
 * `+page.server.ts` action. The remote functions are never wired up via
 * `{...registerForm}` or `command()` calls.
 *
 * BUT — per `/fallow-audit` False-Positive Taxonomy #1 (`SvelteKit remote
 * functions`) — every export from a `.remote.ts` file becomes a publicly
 * callable HTTP endpoint at compile time, regardless of whether any
 * client-side code references it. So the codebase is shipping THREE
 * additional, unmonitored auth-related RPC endpoints that:
 *
 *   1. Bypass the page-action's open-redirect protection
 *      (login/+page.server.ts:111 validates `redirectTo.startsWith('/')`,
 *      the orphan registerForm has no equivalent).
 *   2. Bypass the page-action's structured error mapping (the orphan
 *      flows return a single `success: false, error: <message>` shape,
 *      while page actions return `fail(401, { ... })` with field-level
 *      errors).
 *   3. Are NOT covered by iter-002 F1's BetterAuth path-set rate-limit
 *      fix. The fix targets `/api/auth/sign-in/email`, `/api/auth/sign-up/email`,
 *      `/api/auth/forget-password`, `/api/auth/reset-password` at the
 *      auth worker. The remote-function wrappers ALSO call those paths,
 *      but they sit one layer up (apps/web SvelteKit RPC) — abuse
 *      patterns that go through the remote function get the SAME backend
 *      rate-limit, but each remote function's own RPC endpoint has no
 *      separate per-IP throttle.
 *
 * Decision-quality note: the orphan exports either need to be DELETED
 * (preferred — page actions are the canonical surface) OR wired into the
 * Svelte components (so they get progressive enhancement and become the
 * single source of truth). Leaving them as orphan exports is the worst
 * of both: dead-but-callable code.
 *
 * Catalogue row
 * -------------
 * Row 2 — Consumer-count assertion. Assert `consumersOf('registerForm')`,
 * `consumersOf('forgotPasswordForm')`, `consumersOf('resetPasswordForm')`
 * each have at least one Svelte component consumer (i.e. a `.svelte` file
 * imports them or the corresponding form spread is found). Test fails
 * (vindicating) when no consumer is found.
 *
 * MCP evidence
 * ------------
 * Future: Playwright posts directly to the SvelteKit RPC endpoint of
 * `forgotPasswordForm` (no UI involvement) and asserts a 4xx response.
 * Today the response is 200 with `success: true` — confirming the orphan
 * is callable.
 *
 * Severity: major
 * Filed at: docs/denoise/iter-003.md
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');

function countConsumers(symbol: string): number {
  // Count .svelte / .ts consumers of the named export, excluding the
  // declaration file itself, test files, and worktree pollution.
  try {
    const out = execSync(
      `cd ${REPO_ROOT} && rg --no-heading -l "\\b${symbol}\\b" apps/web/src ` +
        `--glob '!apps/web/src/lib/remote/auth.remote.ts' ` +
        `--glob '!apps/web/src/lib/remote/auth.remote.test.ts' ` +
        `--glob '!apps/web/src/__denoise_proofs__/**' ` +
        `--glob '!**/*.test.ts' ` +
        `--glob '!**/*.spec.ts'`,
      { encoding: 'utf-8' }
    );
    return out
      .trim()
      .split('\n')
      .filter((l) => l.length > 0).length;
  } catch {
    // ripgrep returns exit code 1 when no matches — that's the "0 consumers" case.
    return 0;
  }
}

describe.skip('iter-003 F4 — auth.remote.ts orphan auth-form RPC surface', () => {
  it('registerForm has at least one Svelte component consumer', () => {
    const consumers = countConsumers('registerForm');
    expect(
      consumers,
      'registerForm is exported from auth.remote.ts but no Svelte component consumes it — orphan RPC endpoint with auth surface'
    ).toBeGreaterThan(0);
  });

  it('forgotPasswordForm has at least one Svelte component consumer', () => {
    const consumers = countConsumers('forgotPasswordForm');
    expect(
      consumers,
      'forgotPasswordForm is exported from auth.remote.ts but no Svelte component consumes it — orphan RPC endpoint with auth surface (also has F1 endpoint typo)'
    ).toBeGreaterThan(0);
  });

  it('resetPasswordForm has at least one Svelte component consumer', () => {
    const consumers = countConsumers('resetPasswordForm');
    expect(
      consumers,
      'resetPasswordForm is exported from auth.remote.ts but no Svelte component consumes it — orphan RPC endpoint with auth surface'
    ).toBeGreaterThan(0);
  });
});
