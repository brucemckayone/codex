/**
 * Refuse to wipe a database that is not disposable (Codex-bsbf8).
 *
 * ## The hazard
 *
 * `cleanupDatabase`, `cleanupDatabaseComplete` and `cleanupTables` issue
 * UNCONDITIONAL deletes across ~14 tables including `organizations` and
 * `users`. Locally, `.env.test` has pointed `DATABASE_URL_LOCAL_PROXY` at
 * `db.localtest.me:5432/main` — **the developer's own dev database**. So
 * `pnpm test` from the repo root, which fans out to every package whose suite
 * calls these helpers, deletes the local dev orgs, content, purchases and
 * entitlements out from under a running session.
 *
 * That is not a test-isolation problem, it is a data-loss problem, and it has
 * cost multiple sessions. This module turns a silent wipe into a loud refusal.
 *
 * ## Why the verdict is keyed on `current_database()`, not on the URL
 *
 * The connection URL is NOT authoritative for what the connection attaches to.
 * Under `DB_METHOD=LOCAL_PROXY` the driver is reconfigured to tunnel through a
 * local Neon HTTP proxy — `neonConfig.fetchEndpoint` and `neonConfig.wsProxy`
 * REWRITE the host and port — and that proxy container carries its own
 * hardcoded connection string (`PG_CONNECTION_STRING=…/main` in
 * `infrastructure/neon/docker-compose.dev.local.yml`).
 *
 * So there are two connection strings, and the one in the environment is not
 * the one that reaches Postgres. A guard that parsed the database name out of
 * `DATABASE_URL_LOCAL_PROXY` would therefore be worse than none: the moment
 * someone "fixed" the footgun by editing only that URL to say `main_test`, the
 * guard would read `main_test`, permit the deletes, and they would land on
 * `main` anyway. It would license precisely the wipe it exists to prevent.
 *
 * `SELECT current_database()` is asked of the live session, so it reports what
 * the deletes will actually hit, through any number of rewriting layers.
 *
 * Measured since (Codex-1ggzd, 2026-09-23): the proxy's `PG_CONNECTION_STRING`
 * is only its auth/control-plane endpoint, and it routes each client to the
 * database named in the CLIENT'S URL — `…/main_test` over both `/sql` (HTTP)
 * and `/v1` (WebSocket) reported `current_database() = main_test`. So editing
 * `.env.test` IS enough today, and `pnpm db:test:setup` re-checks that routing
 * every run. That makes the URL correct in practice, not authoritative: the
 * proxy is a third-party image whose behaviour this repo does not control, so
 * the verdict stays keyed on the live session.
 *
 * ## Shape
 *
 * The decision is a PURE function ({@link evaluateDestructiveTarget}) so it is
 * unit-testable without a database — which matters here, because the suites
 * that exercise the guarded helpers are exactly the ones that cannot be run
 * locally until this footgun is fixed. {@link assertDestructiveTargetAllowed}
 * is the thin shim that asks the connection and throws.
 */

import { sql } from 'drizzle-orm';

/**
 * Database names a destructive test helper is allowed to wipe.
 *
 * - `main_test` — the local test database, separate from the dev `main`, on
 *   the same local Postgres container. `pnpm db:test:setup` creates and
 *   migrates it (Codex-1ggzd); `.env.test` points at it.
 * - `neondb` — Neon's default database name, which is what a CI test branch
 *   created by `neondatabase/create-branch-action` is called. Every CI branch
 *   is per-run and deleted afterwards, so it is disposable by construction.
 *
 * Deliberately NOT a host check. A Neon HOST would also match the production
 * database, and "is this host Neon" is not the question — "is this database
 * disposable" is.
 */
const DISPOSABLE_DATABASE_NAMES: ReadonlySet<string> = new Set([
  'main_test',
  'neondb',
]);

/**
 * Names that are NEVER wipeable, checked ahead of every allow rule.
 *
 * `main` is this repo's dev database — the one `pnpm dev` seeds and serves,
 * and the one this whole module exists to protect. Listing it explicitly means
 * even a misconfigured `DB_METHOD=NEON_BRANCH` pointed at something called
 * `main` is refused, so the broad CI allowance below cannot become a loophole.
 */
const PROTECTED_DATABASE_NAMES: ReadonlySet<string> = new Set(['main']);

/**
 * `DB_METHOD` values that denote a throwaway test branch.
 *
 * `NEON_BRANCH` is, by construction in this repo, the ephemeral-test-branch
 * mode — `neondatabase/create-branch-action` provisions a per-run branch named
 * `<domain>-<run_id>-<attempt>` and the workflow deletes it afterwards
 * (`packages/database/src/config/env.config.ts` calls it "Neon ephemeral
 * branch for testing"); production uses `PRODUCTION`.
 *
 * This rule exists so the guard does NOT depend on knowing what the Neon
 * project's default database is called. That name is not visible from the
 * repository — the create-branch step passes no `database` input, so the
 * branch inherits whatever the parent has — and guessing it wrong would make
 * every database-backed CI job refuse to run. An unverifiable assumption is
 * not a safe thing to put underneath a gate, so it is not underneath this one.
 *
 * The value itself IS verified, just not from a file in the repo: the job that
 * runs the package suites declares `environment: test`, and that GitHub
 * environment sets `DB_METHOD=NEON_BRANCH` and `NODE_ENV=test` (read
 * 2026-09-22 via `gh variable list --env test`; the `CI` environment matches).
 * `vars.DB_METHOD` is therefore NOT empty despite being absent from the
 * repository-scoped variables, which is what `gh variable list` alone shows.
 */
const DISPOSABLE_DB_METHODS: ReadonlySet<string> = new Set(['NEON_BRANCH']);

/** What the guard needs to know, with nothing to resolve for itself. */
export interface DestructiveTargetContext {
  /**
   * The result of `SELECT current_database()` on the LIVE connection, or
   * `null` when it could not be determined.
   */
  currentDatabase: string | null | undefined;
  /** `process.env.DB_METHOD`. */
  dbMethod?: string | undefined;
  /** `process.env.NODE_ENV`. */
  nodeEnv?: string | undefined;
}

export interface DestructiveTargetVerdict {
  allowed: boolean;
  /** Why — phrased for a developer reading a failed test, not for a log. */
  reason: string;
}

/**
 * Decide whether destructive test cleanup may run against this target.
 *
 * Fails CLOSED: anything this function cannot positively identify as
 * disposable is refused. A guard that defaults to "allow" on an unrecognised
 * input is a guard that disappears exactly when the configuration is strange,
 * which is when it is most needed.
 */
export function evaluateDestructiveTarget(
  context: DestructiveTargetContext
): DestructiveTargetVerdict {
  const { currentDatabase, dbMethod, nodeEnv } = context;

  // Checked before the name, and independently of it, so that a production
  // database which happens to be called `neondb` can never be allowed by the
  // allowlist below.
  if (nodeEnv === 'production' || dbMethod === 'PRODUCTION') {
    return {
      allowed: false,
      reason:
        `refusing destructive test cleanup in a production context ` +
        `(NODE_ENV=${nodeEnv ?? 'unset'}, DB_METHOD=${dbMethod ?? 'unset'})`,
    };
  }

  if (!currentDatabase) {
    return {
      allowed: false,
      reason:
        'could not determine the current database, so the target cannot be ' +
        'confirmed disposable',
    };
  }

  // Ahead of every allow rule, so no later allowance can reach the dev
  // database by another route.
  if (PROTECTED_DATABASE_NAMES.has(currentDatabase)) {
    // Names the alternatives even though this branch is a hard refusal: this
    // is the branch a developer actually lands on, so it is the one that has
    // to say what to point at instead.
    const allowed = [...DISPOSABLE_DATABASE_NAMES].sort().join(', ');
    return {
      allowed: false,
      reason:
        `database "${currentDatabase}" is protected — it is the database ` +
        `"pnpm dev" uses, not a test database (allowed: ${allowed})`,
    };
  }

  if (dbMethod && DISPOSABLE_DB_METHODS.has(dbMethod)) {
    return {
      allowed: true,
      reason: `DB_METHOD=${dbMethod} is an ephemeral test branch`,
    };
  }

  if (!DISPOSABLE_DATABASE_NAMES.has(currentDatabase)) {
    const allowed = [...DISPOSABLE_DATABASE_NAMES].sort().join(', ');
    return {
      allowed: false,
      reason:
        `the connection is attached to database "${currentDatabase}", which ` +
        `is not a disposable test database (allowed: ${allowed}, or ` +
        `DB_METHOD=NEON_BRANCH)`,
    };
  }

  return {
    allowed: true,
    reason: `database "${currentDatabase}" is disposable`,
  };
}

/** The minimum of a drizzle client this guard needs. */
interface ExecutableDb {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

/**
 * Read `current_database()` from the live connection.
 *
 * Returns `null` rather than throwing, so the caller's fail-closed refusal
 * (which names the guarded operation and the remedy) is what the developer
 * sees, instead of a driver error from inside an `afterAll`.
 */
async function readCurrentDatabase(db: ExecutableDb): Promise<string | null> {
  try {
    const result = await db.execute(sql`select current_database() as name`);
    // drizzle's `execute` return shape differs between the HTTP and WebSocket
    // drivers — `{ rows: [...] }` for one, a bare array for the other — so
    // normalise instead of indexing one of them and hoping.
    const rows = Array.isArray(result)
      ? result
      : ((result as { rows?: unknown[] } | null)?.rows ?? []);
    const first = rows[0] as { name?: unknown } | undefined;
    return typeof first?.name === 'string' ? first.name : null;
  } catch {
    return null;
  }
}

/**
 * Throw unless destructive test cleanup may run against the live connection.
 *
 * @param db - The client the deletes are about to be issued on. The guard asks
 *   THIS connection what it is attached to; passing a different client would
 *   reintroduce the indirection this module exists to close.
 * @param operation - Name of the guarded helper, for the error message.
 * @param env - Overrides the ambient environment. Exists so this function's
 *   own tests are hermetic: reading `process.env` directly would make them
 *   pass or fail according to how the runner was invoked, which is the last
 *   property a data-loss guard's tests should have.
 */
export async function assertDestructiveTargetAllowed(
  db: ExecutableDb,
  operation: string,
  // Read field-by-field below rather than defaulting to `process.env`.
  // `NodeJS.ProcessEnv` declares nothing but an index signature, so it shares
  // no property NAME with this all-optional shape — which trips TypeScript's
  // weak-type rule (TS2559), and `Pick<ProcessEnv, …>` fails differently
  // (TS2739) by synthesising both keys as required.
  env?: { DB_METHOD?: string; NODE_ENV?: string }
): Promise<void> {
  const currentDatabase = await readCurrentDatabase(db);
  const verdict = evaluateDestructiveTarget({
    currentDatabase,
    dbMethod: env ? env.DB_METHOD : process.env.DB_METHOD,
    nodeEnv: env ? env.NODE_ENV : process.env.NODE_ENV,
  });

  if (verdict.allowed) {
    return;
  }

  throw new Error(
    `${operation}() refused to run: ${verdict.reason}.\n` +
      `\n` +
      `This is a data-loss guard (Codex-bsbf8), not a flaky test. These ` +
      `helpers issue unconditional DELETEs across ~14 tables including ` +
      `organizations and users.\n` +
      `\n` +
      `To run database-backed tests locally, point the test database at a ` +
      `disposable one — NOT the dev database that "pnpm dev" uses. See ` +
      `packages/test-utils/CLAUDE.md.`
  );
}
