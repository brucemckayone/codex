import type { NeonConfig } from '@neondatabase/serverless';

// Utility function to check for production environment
function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

// Utility function to determine DB URL based on environment
function getDbUrl(): string {
  switch (process.env.DB_METHOD) {
    case 'LOCAL_PROXY': {
      // Local PostgreSQL instance (Docker Compose)
      if (!isProd()) {
        return process.env.DATABASE_URL_LOCAL_PROXY!;
      }
      throw new Error(
        `Attempting to use Local Database in production environment: ${process.env.NODE_ENV!}`
      );
    }
    case 'NEON_BRANCH': {
      // Neon ephemeral branch for testing (CI or local)
      return process.env.DATABASE_URL!;
    }
    case 'PRODUCTION': {
      // Production database connection
      return process.env.DATABASE_URL!;
    }
    default:
      throw new Error(
        `Invalid DB_METHOD: ${process.env.DB_METHOD}. Must be one of: LOCAL_PROXY, NEON_BRANCH, PRODUCTION`
      );
  }
}

// Function allowing configuration of Neon
function applyNeonConfig(neonConfigInstance: NeonConfig) {
  switch (DbEnvConfig.method) {
    case 'LOCAL_PROXY': {
      if (!isProd()) {
        neonConfigInstance.fetchEndpoint = (host: string): string => {
          const [protocol, port] =
            host === 'db.localtest.me' ? ['http', 4444] : ['https', 443];
          return `${protocol}://${host}:${port}/sql`;
        };
        neonConfigInstance.useSecureWebSocket =
          new URL(DbEnvConfig.getDbUrl()).hostname !== 'db.localtest.me';
        neonConfigInstance.wsProxy = (host: string): string =>
          host === 'db.localtest.me' ? `${host}:4444/v2` : `${host}/v2`;
      }
      break;
    }
    case 'NEON_BRANCH': {
      // Configuration for ephemeral branches
      neonConfigInstance.poolQueryViaFetch = true;
      neonConfigInstance.useSecureWebSocket = true;
      neonConfigInstance.pipelineConnect = 'password'; // Optimized for CI
      break;
    }
    case 'PRODUCTION': {
      // Standard production configuration
      neonConfigInstance.poolQueryViaFetch = true;
      neonConfigInstance.useSecureWebSocket = true;
      break;
    }
    default:
      // No specific neonConfig modifications
      break;
  }
}

// Main exported value for config/env logic
export const DbEnvConfig = {
  rootEnvPath: '../../../../env.dev',
  isProd,
  getDbUrl,
  method: process.env.DB_METHOD!,
  out: './src/migrations',
  schema: './src/schema/index.ts',
  dialetc: 'postgresql' as
    | 'postgresql'
    | 'mysql'
    | 'sqlite'
    | 'turso'
    | 'singlestore',
  applyNeonConfig,
};
