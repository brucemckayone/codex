import { ObservabilityClient } from '@codex/observability';
import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import { DbEnvConfig, type DbEnvVars } from './config/env.config';
import * as schema from './schema';

const dbObs = new ObservabilityClient('database');

/**
 * Environment Variable Loading Strategy:
 *
 * This package NO LONGER loads .env files directly. Instead:
 *
 * - Tests: Environment variables are loaded by root vitest.setup.ts
 * - Local Dev: Set DB_METHOD and DATABASE_URL in your shell or .env.dev
 * - CI/CD: GitHub Actions sets environment variables
 * - Production: Wrangler secrets provide environment variables
 *
 * The database client expects these environment variables to be already set:
 * - DB_METHOD: Connection strategy (LOCAL_PROXY, NEON_BRANCH, PRODUCTION)
 * - DATABASE_URL: Connection string (for NEON_BRANCH and PRODUCTION)
 * - DATABASE_URL_LOCAL_PROXY: Connection string (for LOCAL_PROXY mode)
 */

/**
 * WebSocket Configuration for Neon Pool Client
 *
 * Neon's Pool client (used for database transactions) requires explicit WebSocket
 * configuration in Node.js environments. While Node.js v22+ has native WebSocket
 * support, the 'ws' package provides better compatibility with Neon's implementation.
 *
 * Runtime Detection:
 * - Node.js (local dev, CI/CD): Uses 'ws' package ✓
 * - Cloudflare Workers: Uses native WebSocket ✓ (process.versions.node is undefined)
 * - Edge runtimes: Uses native WebSocket ✓
 *
 * Why this is needed:
 * - CI environments (GitHub Actions) may have a global WebSocket defined, but it's
 *   not compatible with Neon's Pool client implementation
 * - The 'ws' package provides a consistent, battle-tested WebSocket implementation
 * - This fixes: "All attempts to open a WebSocket to connect to the database failed"
 *
 * Detection Strategy:
 * - We check for process.versions.node (only defined in actual Node.js runtime)
 * - Cloudflare Workers with nodejs_compat have 'process' but NOT process.versions.node
 * - This prevents the ws package from being used in Workers where it would fail
 *
 * Type Assertion:
 * The 'as unknown as typeof WebSocket' is required because the 'ws' package types
 * are structurally different from DOM WebSocket types, even though they're API-compatible.
 *
 * References:
 * - https://github.com/neondatabase/serverless/blob/main/CONFIG.md
 * - https://neon.com/docs/serverless/serverless-driver
 *
 * @see https://github.com/neondatabase/serverless#pool-and-client
 */
const isNodeRuntime =
  typeof process !== 'undefined' &&
  typeof process.versions !== 'undefined' &&
  typeof process.versions.node !== 'undefined';

if (isNodeRuntime) {
  neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
}

// Note: Neon HTTP configuration is applied per-request in getDbHttp()
// to support Cloudflare Workers where process.env is not available

// ============================================================================
// HTTP Client - Stateless, for one-off queries
// ============================================================================

/**
 * HTTP Database Client (neon function)
 *
 * Use for:
 * - Production Cloudflare Workers (stateless, optimized for edge)
 * - One-off queries
 * - Simple CRUD operations
 *
 * Limitations:
 * - Does NOT support db.transaction()
 * - Cannot use interactive transactions
 *
 * @example
 * const users = await dbHttp.select().from(usersTable);
 */
let _dbHttp: ReturnType<typeof drizzleHttp<typeof schema>> | null = null;

function getDbHttp(
  env?: DbEnvVars
): ReturnType<typeof drizzleHttp<typeof schema>> {
  if (!_dbHttp) {
    // Apply Neon configuration with environment variables
    // This must happen before creating the neon client
    DbEnvConfig.applyNeonConfig(neonConfig, env);

    const dbUrl = DbEnvConfig.getDbUrl(env);
    const sqlHttp = neon(dbUrl);
    _dbHttp = drizzleHttp({ client: sqlHttp, schema });
  }
  return _dbHttp;
}

export const dbHttp = new Proxy(
  {} as ReturnType<typeof drizzleHttp<typeof schema>>,
  {
    get(_target, prop) {
      const db = getDbHttp();
      return Reflect.get(db, prop, db);
    },
  }
);

/**
 * Create a new HTTP database client with explicit environment
 *
 * Use this factory when you need to create a database client with
 * explicit environment variables (e.g., in Better-auth configuration).
 *
 * @param env - Database environment variables
 * @returns Fresh database client instance with schema
 *
 * @example
 * const db = createDbClient(c.env);
 */
export function createDbClient(
  env: DbEnvVars
): ReturnType<typeof drizzleHttp<typeof schema>> {
  // Apply Neon configuration with environment variables
  DbEnvConfig.applyNeonConfig(neonConfig, env);

  const dbUrl = DbEnvConfig.getDbUrl(env);
  const sqlHttp = neon(dbUrl);
  return drizzleHttp({ client: sqlHttp, schema });
}

// ============================================================================
// WebSocket Client - Stateful, for transactions
// ============================================================================

let _pool: Pool | null = null;
let _dbWs: ReturnType<typeof drizzleWs<typeof schema>> | null = null;

/**
 * Initialize the WebSocket database client
 */
function initializeDbWs(): ReturnType<typeof drizzleWs<typeof schema>> {
  if (!_dbWs) {
    // Apply Neon configuration (WebSocket proxy settings for local dev)
    // This must happen before creating the Pool
    DbEnvConfig.applyNeonConfig(neonConfig);

    const dbUrl = DbEnvConfig.getDbUrl();
    if (!dbUrl) {
      throw new Error(
        'DATABASE_URL not configured. Check DB_METHOD and environment variables.'
      );
    }

    if (!_pool) {
      _pool = new Pool({ connectionString: dbUrl });
      _pool.on('error', (err) =>
        dbObs.error('Pool error', { error: err.message })
      );
    }

    // Create Drizzle instance using Pool with WebSocket support
    // This provides full transaction support automatically
    _dbWs = drizzleWs(_pool, { schema });

    if (!_dbWs) {
      throw new Error('Failed to initialize WebSocket database client');
    }
  }
  return _dbWs;
}

/**
 * WebSocket Database Client (Pool)
 *
 * Use for:
 * - Tests (full transaction support)
 * - Local development
 * - Operations requiring db.transaction()
 * - Multi-step operations requiring atomicity
 *
 * Features:
 * - Full transaction support
 * - Interactive sessions with BEGIN/COMMIT/ROLLBACK
 * - Works in Node.js and Cloudflare Workers
 *
 * @example
 * await dbWs.transaction(async (tx) => {
 *   await tx.insert(users).values({ name: 'John' });
 *   await tx.insert(posts).values({ userId: 1 });
 * });
 */
function createDbWsProxy() {
  return new Proxy({} as ReturnType<typeof drizzleWs<typeof schema>>, {
    get(_target, prop) {
      const db = initializeDbWs();
      return Reflect.get(db, prop, db);
    },
  });
}

export const dbWs = createDbWsProxy();

/**
 * Create a per-request WebSocket database client for Cloudflare Workers
 *
 * IMPORTANT: In Cloudflare Workers, WebSocket connections cannot outlive a single request.
 * This factory creates a fresh Pool instance that MUST be closed before the request completes.
 *
 * @param env - Environment variables containing DATABASE_URL
 * Hyperdrive callers use {@link createHyperdriveDbClient} instead — a
 *   Hyperdrive `connectionString` cannot ride the Neon driver at all.
 * @returns Object with db client and cleanup function
 *
 * @example
 * // In Cloudflare Worker route handler:
 * const { db, cleanup } = createPerRequestDbClient(c.env);
 * try {
 *   await db.transaction(async (tx) => {
 *     // Your database operations
 *   });
 * } finally {
 *   await cleanup(); // MUST close pool before request ends
 * }
 *
 * // Or with ctx.waitUntil for async cleanup:
 * const { db, cleanup } = createPerRequestDbClient(c.env);
 * const result = await db.transaction(async (tx) => {
 *   // Your operations
 * });
 * ctx.waitUntil(cleanup()); // Cleanup happens after response sent
 * return result;
 */
export function createPerRequestDbClient(env: DbEnvVars): {
  db: ReturnType<typeof drizzleWs<typeof schema>>;
  cleanup: () => Promise<void>;
} {
  // NEON ONLY. The Hyperdrive path lives in createHyperdriveDbClient below,
  // and the split is not cosmetic — see that factory's first comment block.
  //
  // Apply Neon configuration (WebSocket proxy settings for local dev)
  // This must happen before creating the Pool
  DbEnvConfig.applyNeonConfig(neonConfig, env);

  const dbUrl = DbEnvConfig.getDbUrl(env);
  if (!dbUrl) {
    throw new Error(
      'DATABASE_URL not configured. Check DB_METHOD and environment variables.'
    );
  }

  // Create a fresh Pool for this request
  const pool = new Pool({ connectionString: dbUrl });
  pool.on('error', (err) =>
    dbObs.error('Per-request pool error', { error: err.message })
  );

  // Create Drizzle instance with the pool
  const db = drizzleWs(pool, { schema });

  // Cleanup function that MUST be called before request ends
  const cleanup = async () => {
    await pool.end();
  };

  return { db, cleanup };
}

/**
 * Per-request database client through a Hyperdrive binding (Codex-s1i7h).
 *
 * ASYNC on purpose, and so is the dynamic import inside — those two facts are
 * the whole design:
 *
 * HYPERDRIVE REQUIRES A DIFFERENT DRIVER, NOT A DIFFERENT URL.
 * `@neondatabase/serverless` reaches Neon BY HOSTNAME: the HTTP driver POSTs
 * to `https://<host>/sql` and the Pool opens a WebSocket to Neon's proxy. A
 * Hyperdrive `connectionString` names a workerd-internal TCP socket speaking
 * the raw PostgreSQL wire protocol, which neither transport can use. An
 * earlier comment here claimed Hyperdrive was "a URL swap and not a
 * client-construction change"; that was wrong, and this factory exists
 * because of it. Cloudflare's own Hyperdrive guide installs `pg` and
 * documents no serverless-driver path.
 *
 * THE IMPORT IS DYNAMIC BECAUSE A STATIC ONE BREAKS EVERY OTHER ENVIRONMENT.
 * This package's vite library build externalizes `pg`, so a static
 * `import 'pg'` (or a static import of `drizzle-orm/node-postgres`, which
 * imports pg) lands in the built dist and is evaluated by EVERY consumer at
 * module load — including workers under `env.test` and packages under
 * vitest, which have no Hyperdrive binding and never asked for this driver.
 * Under both loaders pg's CJS `require('events')` resolves to a stub whose
 * `EventEmitter` is undefined, and `class Query extends EventEmitter` throws
 * `Class extends value undefined is not a constructor or null`. That is
 * exactly how PR #487's first CI run failed: organization-service.test.ts
 * and the e2e auth worker both died at import time, with `nodejs_compat`
 * enabled, in environments that never touch Hyperdrive. Dynamic import
 * confines pg's evaluation to the one code path that needs it.
 *
 * RETURNS THE NEON-ADAPTER TYPE for the same reason
 * `createPerRequestDbClient` does: consumers name no driver. The cast is
 * sound for that surface — `NodePgDatabase` and `NeonDatabase` are both
 * `PgDatabase`, the query builders are identical, `.transaction()` is a real
 * BEGIN/COMMIT on both, and both return pg-shaped `{ rows }` from
 * `.execute()` (checked: no production code reads a raw execute result). It
 * is NOT sound for the neon-HTTP adapter, whose `.execute()` returns a bare
 * array — which is why this factory, not `getDbHttp`, is the entry point.
 *
 * THIS IS INVISIBLE IN LOCAL DEV. `wrangler dev` resolves a Hyperdrive
 * binding by handing back a DIRECT connection string to the origin database,
 * so neither pooling nor query caching runs locally. A green local suite is
 * not evidence here (Codex-s1i7h) — verify with `wrangler dev --remote` or a
 * deployment, via the `cacheStatus` metric (hit/miss/disabled/uncacheable).
 */
export async function createHyperdriveDbClient(
  connectionString: string
): Promise<{
  db: ReturnType<typeof drizzleWs<typeof schema>>;
  cleanup: () => Promise<void>;
}> {
  // DELEGATES to ./hyperdrive-client, loaded dynamically. Both halves of that
  // indirection are load-bearing and documented at the top of that file: the
  // DYNAMIC boundary keeps `pg` out of every consumer without a Hyperdrive
  // binding (a static import here broke organization-service.test.ts and the
  // e2e auth worker at module load — PR #487 run 33893639869), while the
  // STATIC imports INSIDE that file are what make wrangler inject the `net`
  // polyfill into the built worker (with inline dynamic imports the bundle
  // contains pg's protocol code but no transport and cannot connect).
  // Guarded by client-pg-socket-import.test.ts.
  const { buildHyperdriveDbClient } = await import('./hyperdrive-client');
  return buildHyperdriveDbClient(connectionString);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Test database connection
 *
 * @param env - Optional environment variables (for Cloudflare Workers use c.env)
 */
export async function testDbConnection(env?: DbEnvVars): Promise<boolean> {
  try {
    const db = getDbHttp(env);
    const result = await db.execute(sql`SELECT 1 as value`);
    if (
      result &&
      Array.isArray(result.rows) &&
      result.rows.length > 0 &&
      (result.rows[0] as { value: number }).value === 1
    ) {
      return true;
    }
    throw new Error('Test query did not return expected result');
  } catch (err) {
    throw new Error(
      `Database connection test failed: ${(err as Error).message}`
    );
  }
}

/**
 * Close database Pool connection
 *
 * This should be called in test cleanup (afterAll) to ensure the Pool
 * connection is properly closed and the test process can exit cleanly.
 *
 * @example
 * afterAll(async () => {
 *   await closeDbPool();
 * });
 */
export async function closeDbPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _dbWs = null;
  }
}

// ============================================================================
// Type Exports
// ============================================================================

/**
 * HTTP Database client type (for production workers)
 *
 * Use this when a consumer is HTTP-only (no transactions). Most worker
 * route handlers and read-only services match this shape.
 */
export type Database = ReturnType<typeof drizzleHttp<typeof schema>>;

/**
 * WebSocket Database client type (for tests and transactions)
 *
 * Use this for callers that *require* `db.transaction()` (e.g. test
 * harnesses, multi-step writes via `createPerRequestDbClient`).
 */
export type DatabaseWs = ReturnType<typeof drizzleWs<typeof schema>>;

/**
 * Canonical "either" database client type — accepts HTTP or WS clients.
 *
 * Use this for service constructors and repository signatures that must
 * work with BOTH transports (e.g. read paths that run under HTTP in
 * production and WS in tests, or services that mix queries and
 * transactions). `BaseService.ServiceConfig['db']` matches this shape.
 *
 * Prefer the narrower `Database` (HTTP-only) or `DatabaseWs` (WS-only)
 * when the caller's transport is known and fixed — they document the
 * requirement honestly. Reach for `DatabaseClient` only when both
 * transports must be accepted at the same call-site.
 */
export type DatabaseClient = Database | DatabaseWs;
