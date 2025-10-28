// Don't import '@neondatabase/serverless' (fix TS2307)
// Type all function params explicitly (fix TS7006)
// Keep rest of API the same

import type { NeonConfig } from '@neondatabase/serverless';
import { URL } from 'url';

// Utility function to check for production environment
function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

// Utility function to determine DB URL based on environment
function getDbUrl(): string {
  switch (process.env.DB_METHOD) {
    case 'LOCAL_PROXY': {
      if (!isProd()) {
        return process.env.DATABASE_URL_LOCAL_PROXY!;
      } else {
        throw new Error(
          `Attempting to use Local Database in production environment: ${process.env.NODE_ENV!}`
        );
      }
    }
    case 'EPHEMERAL': {
      if (!isProd()) {
        return process.env.DATABASE_URL_PROXY!;
      } else {
        throw new Error(
          `Attempting to use Ephemeral Database in production environment: ${process.env.NODE_ENV!}`
        );
      }
    }
    case 'BRANCH': {
      return process.env.DATABASE_URL_BRANCH!;
    }
    default:
      throw new Error('Invalid Environment Variable database setup');
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
    case 'EPHEMERAL': {
      if (!isProd()) {
        // HTTP Mode (recommended for most applications)
        neonConfigInstance.fetchEndpoint = 'http://localhost:5432/sql'; // Routes HTTP requests to local proxy
        neonConfigInstance.poolQueryViaFetch = true; // Enables HTTP connection pooling

        // WebSocket Mode (for real-time applications)
        neonConfigInstance.useSecureWebSocket = false; // Local proxy doesn't use SSL
        neonConfigInstance.wsProxy = (
          _host: string,
          _port: string | number
        ): string => 'localhost:5432'; // Routes WebSocket connections to local proxy
        neonConfigInstance.pipelineConnect = false; // Required for authentication to work
      } else {
        throw new Error(
          'Ephemeral Database can only be run during test or development'
        );
      }
      break;
    }
    case 'BRANCH':
    default:
      // No specific neonConfig modifications for BRANCH
      break;
  }
}

// Main exported value for config/env logic
export const DbEnvConfig = {
  rootEnvPath: '../../.env.dev',
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
