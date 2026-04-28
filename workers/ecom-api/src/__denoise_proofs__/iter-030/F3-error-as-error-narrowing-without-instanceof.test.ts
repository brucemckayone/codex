/**
 * Denoise iter-030 F3 — `err as Error` / `error as Error` narrowing in
 * catch handlers without runtime guard.
 *
 * Fingerprint: types:as-cast-without-guard (R15 violation)
 * Severity: minor (the cast accesses `.message` only; if the thrown
 *   value is NOT an Error instance — e.g., a string from a third-party
 *   library, a plain object from `Promise.reject({...})`, or `undefined`
 *   from a malformed throw — the cast silently produces `undefined`
 *   for `.message` rather than throwing. This degrades observability
 *   without breaking the request, so the impact is observability gap,
 *   not service crash.)
 *
 * Site inventory (3 catch sites):
 *
 *   workers/ecom-api/src/middleware/verify-signature.ts:131
 *     } catch (err) {
 *       const error = err as Error;
 *       obs?.error('Webhook signature verification failed', {
 *         error: error.message,
 *
 *   workers/ecom-api/src/utils/webhook-handler.ts:63
 *     } catch (error) {
 *       const err = error as Error;
 *       if (isTransientError(error)) {
 *         obs?.error(`${eventType} webhook transient error (will retry)`, {
 *           error: err.message,
 *
 *   workers/ecom-api/src/handlers/connect-webhook.ts:87
 *     .catch((err) => {
 *       obs?.error('Failed to resolve pending payouts', {
 *         accountId: account.id,
 *         organizationId: orgId,
 *         error: (err as Error).message,
 *       });
 *     })
 *
 * Description:
 *
 *   Per ES2022, `catch (err)` is typed `unknown` (the
 *   default with `useUnknownInCatchVariables: true` in
 *   strict tsconfigs). All three sites narrow `unknown` →
 *   `Error` via a bare cast. R15's permitted-exceptions
 *   list does not include "catch parameter narrowing":
 *
 *   - drizzle-infinite-recursion: NO.
 *   - framework-default-init: NO.
 *   - proxy-target: NO.
 *   - type-test: NO (these are production handler code).
 *
 *   Canonical Codex pattern (used elsewhere in the same
 *   worker — e.g. `media-api/src/routes/transcoding.ts:64`
 *   AND `connect-webhook.ts:87` itself, which uses both
 *   patterns within 50 lines of each other):
 *
 *     err instanceof Error ? err.message : String(err)
 *
 *   This handles three cases the cast doesn't:
 *   - Real Error instance → `.message` (same as cast)
 *   - Non-Error throw (string, plain object, undefined)
 *     → `String(err)` produces a debuggable representation
 *   - In tests, fakes can throw plain objects without
 *     extending Error — observability still survives
 *
 *   The fact that `connect-webhook.ts` itself uses
 *   `error instanceof Error ? error.message : String(error)`
 *   on line 298 (visible in the prior 200-line file scan)
 *   shows the codebase knows the better pattern; the 3
 *   cited sites just haven't been migrated. This is the
 *   classic "good pattern in repo, drift in 3 sites" that
 *   denoise is designed to catch.
 *
 *   Suggested fix (3 one-liners):
 *
 *   verify-signature.ts:131:
 *     -      const error = err as Error;
 *     -      obs?.error('Webhook signature verification failed', {
 *     -        error: error.message,
 *     +      obs?.error('Webhook signature verification failed', {
 *     +        error: err instanceof Error ? err.message : String(err),
 *
 *   webhook-handler.ts:63:
 *     -      const err = error as Error;
 *     +      const errMsg =
 *     +        error instanceof Error ? error.message : String(error);
 *     ...replace `err.message` with `errMsg` in the 4 obs.* calls
 *     in the surrounding 30 lines.
 *
 *   connect-webhook.ts:87:
 *     -        error: (err as Error).message,
 *     +        error: err instanceof Error ? err.message : String(err),
 *
 * Proof shape: Catalogue row 11 (custom lint rule + structural grep).
 *   Three assertions (one per site):
 *   - Static analysis on each catch block: assert the cast
 *     `<param> as Error` does NOT appear in the catch body.
 *   - The fix replaces the cast with the canonical
 *     instanceof guard.
 */
import { describe, it } from 'vitest';

describe.skip('iter-030 F3 — err as Error narrowing (R15)', () => {
  it('verify-signature.ts:131 catch block uses instanceof guard', () => {
    // After fix:
    //   const src = readFileSync(
    //     'workers/ecom-api/src/middleware/verify-signature.ts',
    //     'utf-8'
    //   );
    //   expect(src).not.toMatch(/err as Error/);
    //   expect(src).toMatch(/err instanceof Error \? err\.message/);
  });

  it('webhook-handler.ts:63 catch block uses instanceof guard', () => {
    // After fix:
    //   const src = readFileSync(
    //     'workers/ecom-api/src/utils/webhook-handler.ts',
    //     'utf-8'
    //   );
    //   expect(src).not.toMatch(/error as Error/);
    //   expect(src).toMatch(/error instanceof Error \? error\.message/);
  });

  it('connect-webhook.ts:87 catch arm uses instanceof guard', () => {
    // After fix:
    //   const src = readFileSync(
    //     'workers/ecom-api/src/handlers/connect-webhook.ts',
    //     'utf-8'
    //   );
    //   expect(src).not.toMatch(/\(err as Error\)\.message/);
    //   // Note: the file ALREADY uses
    //   // `err instanceof Error ? err.message : String(err)`
    //   // on line 298, so the canonical pattern is in-repo.
  });
});
