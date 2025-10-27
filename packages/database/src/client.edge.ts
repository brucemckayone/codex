console.log('--- LOADING EDGE CLIENT ---');
import { drizzle } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';
import * as schema from './schema';

const connectionString =
  process.env.PG_CONNECTION_STRING || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('Database connection string not found');
}

// For local development with the Neon proxy
if (connectionString.includes('db.localtest.me')) {
  neonConfig.fetchEndpoint = () => 'http://localhost:4444/sql';
}

const sql = neon(connectionString);
export const db = drizzle(sql, { schema });
