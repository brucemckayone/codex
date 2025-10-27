/**
 * Database client factory
 * Supports multiple database drivers:
 * - Neon HTTP (local development with proxy)
 * - Neon serverless (production)
 * - Postgres driver (CI/testing with direct connection)
 */

import {
  neon,
  neonConfig,
  type NeonQueryFunction,
} from '@neondatabase/serverless';
import {
  drizzle as drizzleHttp,
  type NeonHttpDatabase,
} from 'drizzle-orm/neon-http';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import * as schema from './schema';
import { SQL } from 'drizzle-orm';

// Lazy initialization to avoid throwing errors on import when testing
let _sql: NeonQueryFunction<boolean, boolean> | null = null;
let _postgresClient: postgres.Sql | null = null;
let _db: any = null;
let _driverType: 'http' | 'postgres' = 'http';

function getConnectionString(): string {
  const connectionString =
    process.env.PG_CONNECTION_STRING || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'Database connection string not found. Set PG_CONNECTION_STRING or DATABASE_URL'
    );
  }

  return connectionString;
}

function initializeClient() {
  if (_db) {
    return {
      sql: _sql,
      postgresClient: _postgresClient,
      db: _db,
      driverType: _driverType,
    };
  }

  const connectionString = getConnectionString();

  // Determine which driver to use:
  // - PG_CONNECTION_STRING with db.localtest.me = Neon HTTP proxy (local dev)
  // - DATABASE_URL with localhost = Direct Postgres driver (CI)
  // - Otherwise = Neon serverless (production)
  const useHttpProxy =
    !!process.env.PG_CONNECTION_STRING &&
    connectionString.includes('db.localtest.me');
  const useDirectPostgres =
    !!process.env.DATABASE_URL &&
    (connectionString.includes('localhost') ||
      connectionString.includes('127.0.0.1'));

  if (useHttpProxy) {
    // HTTP mode: Use Neon HTTP proxy for local development
    _driverType = 'http';
    neonConfig.fetchEndpoint = () => 'http://localhost:4444/sql';
    _sql = neon(connectionString);
    _db = drizzleHttp(_sql, { schema });
  } else if (useDirectPostgres) {
    // Direct Postgres mode: Use standard postgres driver for CI/testing
    _driverType = 'postgres';
    // Dynamic import to avoid loading postgres in production
    const postgresLib = require('postgres') as typeof postgres;
    _postgresClient = postgresLib(connectionString);
    _db = drizzlePostgres(_postgresClient, { schema });
  } else {
    // Production mode: Use Neon serverless (HTTP)
    _driverType = 'http';
    _sql = neon(connectionString);
    _db = drizzleHttp(_sql, { schema });
  }

  return {
    sql: _sql,
    postgresClient: _postgresClient,
    db: _db,
    driverType: _driverType,
  };
}

// Lazy-loaded db instance - only initializes when actually used
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop) {
    const { db: actualDb, driverType } = initializeClient();

    if (prop === 'execute') {
      if (driverType === 'postgres') {
        // postgres-js driver returns an array of rows directly
        return (query: SQL) => (actualDb as any).execute(query);
      } else {
        // neon-http driver returns an object with a rows property
        return async (query: SQL) => {
          const result = await (actualDb as any).run(query);
          return result.rows;
        };
      }
    }

    return actualDb[prop as keyof typeof actualDb];
  },
});

// Test connection function
export const testConnection = async (): Promise<boolean> => {
  try {
    const { sql, postgresClient, driverType } = initializeClient();

    if (driverType === 'http' && sql) {
      // HTTP mode: use neon() query function
      const result = await sql`SELECT 1 as connected`;
      return (
        Array.isArray(result) &&
        result.length > 0 &&
        'connected' in result[0] &&
        result[0].connected === 1
      );
    } else if (driverType === 'postgres' && postgresClient) {
      // Direct Postgres mode: use postgres.js client
      const result = await postgresClient`SELECT 1 as connected`;
      return result.length > 0 && result[0].connected === 1;
    }

    return false;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
};
