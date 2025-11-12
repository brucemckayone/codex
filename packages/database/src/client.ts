import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless';
import { neon, Pool, neonConfig } from '@neondatabase/serverless';
import { DbEnvConfig } from './config/env.config';
import * as schema from './schema';
import ws from 'ws';

// Load .env for local development only
// Skip in Cloudflare Workers where import.meta.url is undefined and DB_METHOD is always set
if (!DbEnvConfig.method && typeof import.meta.url !== 'undefined') {
  const { config } = await import('dotenv');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  config({ path: resolve(__dirname, '../../../../.env.dev') });
}

// Configure WebSocket for Node.js environments (v21 and below)
// This is required for the Pool client to work in Node.js
if (typeof process !== 'undefined' && typeof WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws as typeof WebSocket;
}

// Apply Neon configuration
DbEnvConfig.applyNeonConfig(neonConfig);

// ============================================================================
// HTTP Client - Stateless, for one-off queries
// ============================================================================

let _sqlHttp: ReturnType<typeof neon> | null = null;
let _dbHttp: ReturnType<typeof drizzleHttp<typeof schema>> | null = null;

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
export const dbHttp = new Proxy(
  {} as ReturnType<typeof drizzleHttp<typeof schema>>,
  {
    get(_target, prop) {
      if (!_dbHttp) {
        if (!_sqlHttp) {
          _sqlHttp = neon(DbEnvConfig.getDbUrl()!);
        }
        _dbHttp = drizzleHttp({ client: _sqlHttp, schema }) as any;
      }
      return Reflect.get(_dbHttp as object, prop, _dbHttp);
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
// Default Export (HTTP for backward compatibility)
// ============================================================================

/**
 * Default database client (HTTP)
 * Alias for dbHttp
 */
export const db = dbHttp;

/**
 * SQL client for HTTP queries
 */
export const sql = new Proxy({} as ReturnType<typeof neon>, {
  get(_target, prop) {
    if (!_sqlHttp) {
      _sqlHttp = neon(DbEnvConfig.getDbUrl()!);
    }
    return Reflect.get(_sqlHttp, prop, _sqlHttp);
  },
  apply(_target, thisArg, args) {
    if (!_sqlHttp) {
      _sqlHttp = neon(DbEnvConfig.getDbUrl()!);
    }
    return Reflect.apply(_sqlHttp!, thisArg, args);
  },
});

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
