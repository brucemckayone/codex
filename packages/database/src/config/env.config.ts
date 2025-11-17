import type { NeonConfig } from '@neondatabase/serverless';

type DbMethod = 'LOCAL_PROXY' | 'NEON_BRANCH' | 'PRODUCTION';

interface DbMethodConfig {
  getUrl: () => string;
  applyNeonConfig: (neonConfigInstance: NeonConfig) => void;
}

// Consolidated database configuration by method
const DB_METHOD_CONFIGS: Record<DbMethod, DbMethodConfig> = {
  LOCAL_PROXY: {
    getUrl: () => {
      // Local PostgreSQL instance (Docker Compose)
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          `Attempting to use Local Database in production environment: ${process.env.NODE_ENV ?? 'unknown'}`
        );
      }

      const dbUrl = process.env.DATABASE_URL_LOCAL_PROXY;
      if (!dbUrl) {
        throw new Error(
          'DATABASE_URL_LOCAL_PROXY environment variable is required for LOCAL_PROXY method'
        );
      }
      return dbUrl;
    },
    applyNeonConfig: (neonConfigInstance: NeonConfig) => {
      if (process.env.NODE_ENV === 'production') return;

      // Configure Neon HTTP proxy for local development
      // The local Neon proxy runs on HTTP (not HTTPS) at port 4444
      neonConfigInstance.fetchEndpoint = (host: string): string => {
        const [protocol, port] =
          host === 'db.localtest.me' ? ['http', 4444] : ['https', 443];
        return `${protocol}://${host}:${port}/sql`;
      };

      // Do NOT use poolQueryViaFetch for LOCAL_PROXY because it breaks transactions
      // Transactions require WebSocket support which we configure below
      // neonConfigInstance.poolQueryViaFetch = false; // Default is false

      // Local PostgreSQL doesn't support secure WebSocket connections
      // Use standard ws:// protocol instead of wss://
      neonConfigInstance.useSecureWebSocket = false;

      // WebSocket proxy configuration for local development
      // The local proxy expects WebSocket connections on the same port (4444)
      const dbUrl = DB_METHOD_CONFIGS.LOCAL_PROXY.getUrl();
      if (new URL(dbUrl).hostname === 'db.localtest.me') {
        neonConfigInstance.wsProxy = (host: string) => `${host}:4444/v1`;
      }
    },
  },
  NEON_BRANCH: {
    getUrl: () => {
      // Neon ephemeral branch for testing (CI or local)
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) {
        throw new Error(
          'DATABASE_URL environment variable is required for NEON_BRANCH method'
        );
      }
      return dbUrl;
    },
    applyNeonConfig: (neonConfigInstance: NeonConfig) => {
      // Configuration for ephemeral branches
      // DO NOT set poolQueryViaFetch = true - it breaks transaction support!
      // Tests use dbWs (Pool) which requires WebSocket for transactions
      // When poolQueryViaFetch is true, Pool.query() uses HTTP and transactions fail
      neonConfigInstance.poolQueryViaFetch = false;
      neonConfigInstance.useSecureWebSocket = true;
      // pipelineConnect is for HTTP connections only, not compatible with WebSocket Pool
      // neonConfigInstance.pipelineConnect = 'password';

      // Enable connection caching for read-your-writes consistency
      neonConfigInstance.fetchConnectionCache = true;
    },
  },
  PRODUCTION: {
    getUrl: () => {
      // Production database connection
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) {
        throw new Error(
          'DATABASE_URL environment variable is required for PRODUCTION method'
        );
      }
      return dbUrl;
    },
    applyNeonConfig: (neonConfigInstance: NeonConfig) => {
      // Standard production configuration
      neonConfigInstance.poolQueryViaFetch = true;
      neonConfigInstance.useSecureWebSocket = true;
    },
  },
};

// Get current database method from environment
function getCurrentDbMethod(): DbMethod {
  const method = process.env.DB_METHOD;
  if (!method || !(method in DB_METHOD_CONFIGS)) {
    throw new Error(
      `Invalid DB_METHOD: ${method}. Must be one of: LOCAL_PROXY, NEON_BRANCH, PRODUCTION`
    );
  }
  return method as DbMethod;
}

// Public API functions
function getDbUrl(): string {
  const method = getCurrentDbMethod();
  return DB_METHOD_CONFIGS[method].getUrl();
}

function applyNeonConfig(neonConfigInstance: NeonConfig): void {
  const method = process.env.DB_METHOD;
  // Skip configuration if DB_METHOD is not set (e.g., in web app)
  if (!method || !(method in DB_METHOD_CONFIGS)) {
    return;
  }
  DB_METHOD_CONFIGS[method as DbMethod].applyNeonConfig(neonConfigInstance);
}

// Main exported value for config/env logic
export const DbEnvConfig = {
  rootEnvPath: '../../../../env.dev',
  getDbUrl,
  method: process.env.DB_METHOD ?? '',
  out: './src/migrations',
  schema: './src/schema/index.ts',
  dialect: 'postgresql' as
    | 'postgresql'
    | 'mysql'
    | 'sqlite'
    | 'turso'
    | 'singlestore',
  applyNeonConfig,
};
