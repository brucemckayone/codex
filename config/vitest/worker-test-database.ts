/**
 * Refuse to start a worker test suite whose database is the dev `main`
 * (Codex-wiz3x).
 *
 * ## The hazard
 *
 * Worker suites run under `@cloudflare/vitest-pool-workers`, which binds the
 * worker's `env` from `wrangler.jsonc` `env.test.vars`, overlaid by the
 * gitignored `.dev.vars.test` next to it. Neither reads `.env.test`, so moving
 * the PACKAGE suites to the disposable `main_test` (Codex-1ggzd) left every
 * WORKER suite still aimed at `main`. On 2026-09-23 two runs of media-api's
 * `transcoding.e2e.test.ts` INSERTED 4 users and 24 media_items into `main`.
 *
 * `assertDestructiveTargetAllowed` in `@codex/test-utils` did not fire because
 * it guards the cleanup DELETES, and these writes never reach a cleanup. So
 * this check runs earlier: when the vitest config loads, before any test.
 *
 * ## Why a URL check is acceptable HERE
 *
 * `destructive-target.ts` keys its verdict on `current_database()` because a
 * URL is not authoritative, and an ALLOW decided from a URL could license a
 * wipe that lands elsewhere. This check only ever REFUSES. A URL naming `main`
 * cannot be made safe by anything behind it, so refusing it cannot license
 * anything; a URL that passes still meets the live-session guard at cleanup.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { unstable_readConfig } from 'wrangler';

/**
 * Kept in step with `PROTECTED_DATABASE_NAMES` in
 * `packages/test-utils/src/destructive-target.ts`. Not imported: that module
 * pulls in drizzle, and a vitest config should not depend on a package build.
 */
const PROTECTED_DATABASE_NAMES: ReadonlySet<string> = new Set(['main']);

const DATABASE_URL_KEYS = ['DATABASE_URL', 'DATABASE_URL_LOCAL_PROXY'] as const;

/**
 * Throws if the `test` environment of the worker in `workerDir` would connect
 * to a protected database. A key that is absent or not a URL is skipped — the
 * worker's own env validation reports those.
 */
export function assertWorkerTestDatabase(workerDir: string): void {
  const { vars } = unstable_readConfig({
    config: join(workerDir, 'wrangler.jsonc'),
    env: 'test',
  });

  // Same precedence wrangler applies: `.dev.vars.test` overrides `vars`.
  const devVarsPath = join(workerDir, '.dev.vars.test');
  const devVars = existsSync(devVarsPath)
    ? parseDotenv(readFileSync(devVarsPath))
    : {};
  const effective: Record<string, unknown> = { ...vars, ...devVars };

  for (const key of DATABASE_URL_KEYS) {
    const value = effective[key];
    if (typeof value !== 'string' || !URL.canParse(value)) continue;

    const database = new URL(value).pathname.replace(/^\//, '');
    if (!PROTECTED_DATABASE_NAMES.has(database)) continue;

    const source = key in devVars ? devVarsPath : 'wrangler.jsonc env.test';
    throw new Error(
      `${key} for the worker test env names the database "${database}", ` +
        `the one "pnpm dev" uses (from ${source}). Point it at /main_test ` +
        `and run "pnpm db:test:setup" to create and migrate it.`
    );
  }
}
