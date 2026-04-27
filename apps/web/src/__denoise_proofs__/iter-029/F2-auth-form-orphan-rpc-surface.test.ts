/**
 * Denoise iter-029 F2 proof test
 *
 * Cell: security × apps/web
 * Fingerprint: web:auth-form-orphan-rpc-surface
 * Severity: major (orphan public RPC surface — supply-chain attack surface)
 * Recurrence: 2nd hit (iter-003 F5, now iter-029 F2) — Codex-ttavz.15 still open.
 *
 * Bug
 * ---
 * `apps/web/src/lib/remote/auth.remote.ts` exports three SvelteKit
 * `form()`-shaped remote functions:
 *
 *   - `registerForm`
 *   - `forgotPasswordForm`
 *   - `resetPasswordForm`
 *
 * SvelteKit's compiler-registered remote functions become public-facing
 * RPC endpoints. Their handlers POST to BetterAuth using cookies that
 * the framework forwards on every request. They are NOT statically
 * imported by anything in `apps/web/src/routes/**` — only their own
 * `auth.remote.test.ts` smoke test references them.
 *
 * The live auth flow uses traditional SvelteKit form actions:
 *   - `apps/web/src/routes/(auth)/login/+page.server.ts`
 *   - `apps/web/src/routes/(auth)/register/+page.server.ts`
 *   - `apps/web/src/routes/(auth)/forgot-password/+page.server.ts`
 *   - `apps/web/src/routes/(auth)/reset-password/+page.server.ts`
 *
 * So the remote function exports are an orphan public RPC surface — they
 * accept POST requests, validate input, call the auth worker, and set
 * session cookies, but no UI surface uses them. Either:
 *   (a) Wire them up (preferred for the SPA-style flows the rest of the
 *       app uses) — and FIRST fix Codex-ttavz.12's `forgot-password`
 *       typo, otherwise password reset is broken from day one.
 *   (b) Delete them. Smaller attack surface, smaller bundle, no orphan
 *       endpoints exposed to scanners.
 *
 * The decision is "wire OR delete" (see /fallow-audit escalation rules).
 * This test enforces that whichever happens, the orphan state doesn't
 * silently persist — at least one consumer must exist beyond the smoke
 * test, OR the file must be deleted.
 *
 * Note: the False-Positive Taxonomy row #1 covers `.remote.ts` exports
 * being framework-dispatched (the compiler transforms them into
 * endpoints, so they look unused to fallow). That FP rule applies when
 * the surface is genuinely live — i.e., reachable from a UI submission
 * or programmatic caller. The exports here meet none of those criteria,
 * so they are not protected by the FP taxonomy.
 *
 * Catalogue rows
 * --------------
 * Row 11 — API-map snapshot. Grep `apps/web/src/routes/**` for any
 * import that names one of the three exports; assert ≥1 hit per export.
 * The smoke test (`auth.remote.test.ts`) is excluded from the search
 * because it's a structural test, not a consumer.
 *
 * Filed at: docs/denoise/iter-029.md
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES_ROOT = resolve(__dirname, '../../routes');

// History (2026-04-27, Codex-ttavz.15 resolution):
//   - registerForm DELETED from auth.remote.ts (page action remains canonical
//     for register because it requires Set-Cookie access). No orphan to assert.
//   - forgotPasswordForm + resetPasswordForm WIRED into their respective
//     +page.svelte files; the page actions were removed. Each must now have
//     ≥1 consumer in routes/.
const ORPHAN_EXPORTS = ['forgotPasswordForm', 'resetPasswordForm'] as const;

describe('iter-029 F2 — auth.remote.ts orphan RPC surface', () => {
  for (const name of ORPHAN_EXPORTS) {
    it(`${name} has at least one consumer in apps/web/src/routes (or the file is deleted)`, () => {
      // Use git grep so we can scope to routes only and exclude test files.
      // `--name-only` is fine here — we only need to know if any source file
      // names the export at all.
      const cmd = `git grep -l ${name} -- '${ROUTES_ROOT}/**/*.ts' '${ROUTES_ROOT}/**/*.svelte' || true`;
      const result = execSync(cmd, { encoding: 'utf-8' }).trim();

      const consumers = result
        ? result.split('\n').filter((p) => !p.endsWith('.test.ts'))
        : [];

      expect(
        consumers.length,
        `${name} is exported from auth.remote.ts but has zero consumers in apps/web/src/routes — wire it up or delete the export. Found: ${result || '(none)'}`
      ).toBeGreaterThan(0);
    });
  }
});
