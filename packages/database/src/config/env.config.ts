import { neonConfig } from '@neondatabase/serverless';
import { URL } from 'url';

function isProd(): boolean {
  return process.env.NODE_ENV! === 'production';
}

function getDbUrl(): string {
  switch (process.env.DB_METHOD!) {
    case 'LOCAL': {
      if (!isProd()) {
        return process.env.DATABASE_URL_LOCAL!;
      } else {
        throw new Error(
          `Attempting set use Local Database in production enviroment: ${process.env.NODE_ENV!}`
        );
      }
    }

    case 'LOCAL_PROXY': {
      if (!isProd()) {
        return process.env.DATABASE_URL_LOCAL_PROXY!;
      } else {
        throw new Error(
          `Attempting set use Local Database in production enviroment: ${process.env.NODE_ENV!}`
        );
      }
    }

    case 'EPHEMERAL': {
      if (!isProd()) {
        return process.env.DATABASE_URL_PROXY!;
      } else {
        throw new Error(
          `Attempting set use Ephemeral Database in production enviroment: ${process.env.NODE_ENV!}`
        );
      }
    }

    case 'BRANCH': {
      return process.env.DATABASE_URL_BRANCH!;
    }
  }

  throw new Error('Invalid Enviroment Variable database set up');
}

// New function to apply neonConfig
function applyNeonConfig(neonConfigInstance: typeof neonConfig) {
  switch (DbEnvConfig.method) {
    case 'LOCAL_PROXY': {
      if (!isProd()) {
        neonConfigInstance.fetchEndpoint = (host) => {
          const [protocol, port] =
            host === 'db.localtest.me' ? ['http', 4444] : ['https', 443];
          return `${protocol}://${host}:${port}/sql`;
        };

        neonConfigInstance.useSecureWebSocket =
          new URL(DbEnvConfig.getDbUrl()).hostname !== 'db.localtest.me';
        neonConfigInstance.wsProxy = (host) =>
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
        neonConfigInstance.wsProxy = (_host, _port) => 'localhost:5432'; // Routes WebSocket connections to local proxy
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
      // No specific neonConfig modifications for BRANCH in client.ts, so nothing to do here.
      break;
  }
}

export const DbEnvConfig = {
  rootEnvPath: '../../.env.dev',
  isProd: isProd,
  getDbUrl: getDbUrl,
  method: process.env.DB_METHOD!,
  out: './src/migrations',
  schema: './src/schema/index.ts',
  dialetc: 'postgresql' as
    | 'postgresql'
    | 'mysql'
    | 'sqlite'
    | 'turso'
    | 'singlestore',
  applyNeonConfig: applyNeonConfig,
};
