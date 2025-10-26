/**
 * Database client factory
 * Uses Neon HTTP driver which works with:
 * - Neon serverless databases (production)
 * - Local Neon HTTP Proxy (development)
 */

import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// Get connection string from environment
const connectionString =
  process.env.PG_CONNECTION_STRING || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'Database connection string not found. Set PG_CONNECTION_STRING or DATABASE_URL'
  );
}

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
const sql = neon(connectionString);

// Create Drizzle instance with schema
export const db = drizzle(sql, { schema });

// Test connection function
export const testConnection = async (): Promise<boolean> => {
  try {
    const result = await sql`SELECT 1 as connected`;
    return result.length > 0 && result[0].connected === 1;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
};
