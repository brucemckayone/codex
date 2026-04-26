/**
 * Webhook DB-client helper.
 *
 * R-denoise (iter-011 F3 / Codex-mqyql.9): the Stripe webhook handlers in
 * `workers/ecom-api` bypass `procedure()` (HMAC + raw-body verification
 * happens before any service-registry construction), so they each need to
 * manage their own per-request DB lifecycle. Five call sites all lifted the
 * IDENTICAL `{ DATABASE_URL, DATABASE_URL_LOCAL_PROXY, DB_METHOD }` triple
 * off `c.env`, which made an env-binding rename (e.g. `DB_METHOD` →
 * `DB_DRIVER`) silently miss any one of the five.
 *
 * `createWebhookDbClient(env)` collapses that triple-field boilerplate to a
 * single import. The returned object is exactly what
 * `createPerRequestDbClient` returns — `{ db, cleanup }` — so existing
 * `try { ... } finally { await cleanup(); }` and `waitUntil(cleanup())`
 * patterns at call sites carry over unchanged.
 *
 * Lives here (rather than in `@codex/database`) for parity with the other
 * R14 cache-fanout helper (`invalidateOrgSlugCache`): worker plumbing that
 * stitches `c.env → @codex/database` belongs in `@codex/worker-utils`,
 * keeping `@codex/database` a thin foundation.
 */
import { createPerRequestDbClient, type DbEnvVars } from '@codex/database';

/**
 * Subset of `c.env` consumed by `createPerRequestDbClient`. Structural —
 * any worker `Bindings` type with these three optional fields satisfies it.
 */
export type WebhookDbEnv = Pick<
  DbEnvVars,
  'DATABASE_URL' | 'DATABASE_URL_LOCAL_PROXY' | 'DB_METHOD'
>;

/**
 * Create a per-request WebSocket DB client suitable for use inside Stripe
 * (or other) webhook handlers that bypass `procedure()`.
 *
 * The caller MUST close the pool via the returned `cleanup()` — typically
 * `await cleanup()` inside a `finally` block, or
 * `executionCtx.waitUntil(cleanup())` to defer until after the response
 * has been written. This is the same lifecycle contract as
 * `createPerRequestDbClient` — only the call shape differs.
 *
 * @example
 * ```ts
 * const { db, cleanup } = createWebhookDbClient(c.env);
 * try {
 *   const service = new PurchaseService({ db, environment: c.env.ENVIRONMENT }, stripe);
 *   await service.completePurchase(...);
 * } finally {
 *   await cleanup();
 * }
 * ```
 */
export function createWebhookDbClient(
  env: WebhookDbEnv
): ReturnType<typeof createPerRequestDbClient> {
  return createPerRequestDbClient({
    DATABASE_URL: env.DATABASE_URL,
    DATABASE_URL_LOCAL_PROXY: env.DATABASE_URL_LOCAL_PROXY,
    DB_METHOD: env.DB_METHOD,
  });
}
