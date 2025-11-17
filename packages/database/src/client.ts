import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import { DbEnvConfig } from './config/env.config';
import * as schema from './schema';

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

// Apply Neon configuration
DbEnvConfig.applyNeonConfig(neonConfig);

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

function getDbHttp(): ReturnType<typeof drizzleHttp<typeof schema>> {
  if (!_dbHttp) {
    const dbUrl = DbEnvConfig.getDbUrl();
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
    const dbUrl = DbEnvConfig.getDbUrl();
    if (!dbUrl) {
      throw new Error(
        'DATABASE_URL not configured. Check DB_METHOD and environment variables.'
      );
    }

    if (!_pool) {
      _pool = new Pool({ connectionString: dbUrl });
      _pool.on('error', (err) => console.error('Pool error:', err));
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

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Test database connection
 */
export async function testDbConnection(): Promise<boolean> {
  try {
    const result = await dbHttp.execute('SELECT 1 as value');
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
 */
export type Database = ReturnType<typeof drizzleHttp<typeof schema>>;

/**
 * WebSocket Database client type (for tests and transactions)
 */
export type DatabaseWs = ReturnType<typeof drizzleWs<typeof schema>>;
