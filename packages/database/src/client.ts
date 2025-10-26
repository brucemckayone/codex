/**
 * Database client factory
 * Uses Neon HTTP driver which works with:
 * - Neon serverless databases (production)
 * - Local Neon HTTP Proxy (development)
 */

import {
  neon,
  neonConfig,
  type NeonQueryFunction,
} from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// Lazy initialization to avoid throwing errors on import when testing
let _sql: NeonQueryFunction<boolean, boolean> | null = null;
let _db: NeonHttpDatabase<typeof schema> | null = null;

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
  if (_sql && _db) {
    return { sql: _sql, db: _db };
  }

  const connectionString = getConnectionString();

  // Configure Neon for local development with HTTP proxy
  // For local development: postgresql://postgres:postgres@localhost:5432/main
  // The Neon HTTP proxy runs on http://localhost:4444/sql
  const isLocalDev =
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1') ||
    connectionString.includes('db.localtest.me');

  if (isLocalDev) {
    // Configure custom HTTP endpoint for local Neon HTTP proxy
    neonConfig.fetchEndpoint = (host) => {
      // For local development, always use the Neon HTTP proxy on port 4444
      const isLocal =
        host.includes('localhost') ||
        host.includes('127.0.0.1') ||
        host.includes('db.localtest.me');

      if (isLocal) {
        return 'http://localhost:4444/sql';
      }
      // For production Neon databases, use default HTTPS endpoint
      return `https://${host}/sql`;
    };
  }

  // Create Neon SQL client (uses HTTP fetch)
  _sql = neon(connectionString);

  // Create Drizzle instance with schema
  _db = drizzle(_sql, { schema });

  return { sql: _sql, db: _db };
}

// Lazy-loaded db instance - only initializes when actually used
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop) {
    const { db: actualDb } = initializeClient();
    return actualDb[prop as keyof typeof actualDb];
  },
});

// Test connection function
export const testConnection = async (): Promise<boolean> => {
  try {
    const { sql } = initializeClient();
    const result = await sql`SELECT 1 as connected`;
    return (
      Array.isArray(result) &&
      result.length > 0 &&
      'connected' in result[0] &&
      result[0].connected === 1
    );
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
};
