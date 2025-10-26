import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { resolve } from 'path';

// Load env.dev from project root (2 levels up from packages/database)
config({ path: resolve(__dirname, '../../env.dev') });

// For production, use DATABASE_URL instead of PG_CONNECTION_STRING
const connectionString =
  process.env.PG_CONNECTION_STRING || process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    '⚠️  No connection string found. Make sure env.dev exists or DATABASE_URL is set.'
  );
}

export default defineConfig({
  out: './src/migrations',
  schema: './src/schema/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      connectionString || 'postgresql://postgres:postgres@localhost:5432/main',
  },
  verbose: true,
  strict: true,
});
