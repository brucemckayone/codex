import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';
import { DbEnvConfig } from '../src/config/env.config';

const { Pool } = pg;

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.dev
config({ path: path.resolve(__dirname, '../../../.env.dev') });

const convertNeonUrlToPostgres = (neonUrl: string): string => {
  const url = new URL(neonUrl);
  // For local proxy pointing to postgres, we connect directly to localhost
  if (url.hostname === 'db.localtest.me') {
    // Connect to the local PostgreSQL instance (Docker exposed on localhost)
    return `postgres://postgres:postgres@localhost:5432/main`;
  }
  // For real Neon connections, use the original URL
  return neonUrl;
};

const main = async () => {
  let pool: pg.Pool | null = null;
  try {
    let dbUrl = DbEnvConfig.getDbUrl();
    if (!dbUrl) {
      throw new Error('DATABASE_URL not found');
    }

    // For LOCAL_PROXY, convert to direct PostgreSQL connection
    if (process.env.DB_METHOD === 'LOCAL_PROXY') {
      console.log('🔄 Using direct PostgreSQL connection for LOCAL_PROXY...');
      dbUrl = convertNeonUrlToPostgres(dbUrl);
    }

    pool = new Pool({ connectionString: dbUrl });

    console.log('🔄 Resetting database...\n');

    // Get the database name from the connection string
    const dbName = new URL(dbUrl).pathname.slice(1) || 'main';

    // Step 1: Terminate all active connections
    console.log('📋 Step 1: Terminating active connections...');
    try {
      await pool.query(
        `
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = $1
          AND pid <> pg_backend_pid()
      `,
        [dbName]
      );
      console.log('✓ Active connections terminated\n');
    } catch (error) {
      console.warn(
        '⚠ Warning: Could not terminate connections (continuing anyway)\n'
      );
    }

    // Step 2: Drop all schemas except public and system schemas
    console.log('📋 Step 2: Dropping custom schemas...');
    try {
      const schemas = await pool.query(`
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name NOT IN ('public', 'information_schema', 'pg_catalog', 'pg_toast')
      `);

      for (const schema of schemas.rows) {
        try {
          await pool.query(
            `DROP SCHEMA IF EXISTS "${schema.schema_name}" CASCADE`
          );
          console.log(`  ✓ Dropped schema: ${schema.schema_name}`);
        } catch (dropError) {
          console.warn(
            `  ⚠ Could not drop schema ${schema.schema_name} (continuing)`
          );
        }
      }
      console.log('');
    } catch (error) {
      console.warn('⚠ Warning: Could not drop schemas (continuing anyway)\n');
    }

    // Step 3: Drop all tables and sequences in public schema
    console.log('📋 Step 3: Clearing public schema...');
    try {
      await pool.query(`
        DO $$
        DECLARE
          r RECORD;
        BEGIN
          -- Drop all sequences
          FOR r IN (SELECT sequence_schema, sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') LOOP
            EXECUTE 'DROP SEQUENCE IF EXISTS public."' || r.sequence_name || '" CASCADE';
          END LOOP;

          -- Drop all tables
          FOR r IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') LOOP
            EXECUTE 'DROP TABLE IF EXISTS public."' || r.table_name || '" CASCADE';
          END LOOP;

          -- Drop all views
          FOR r IN (SELECT table_name FROM information_schema.views WHERE table_schema = 'public') LOOP
            EXECUTE 'DROP VIEW IF EXISTS public."' || r.table_name || '" CASCADE';
          END LOOP;
        END $$;
      `);
      console.log('✓ Public schema cleared\n');
    } catch (error) {
      console.error('✗ Failed to clear public schema:', error);
      throw error;
    }

    // Step 4: Drop and recreate __drizzle_migrations table
    console.log('📋 Step 4: Resetting migration tracker...');
    try {
      await pool.query(`DROP TABLE IF EXISTS "__drizzle_migrations" CASCADE`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL UNIQUE,
          created_at bigint
        )
      `);
      console.log('✓ Migration tracker reset\n');
    } catch (error) {
      console.error('✗ Failed to reset migration tracker:', error);
      throw error;
    }

    console.log('✅ Database reset complete!');
    console.log('\nNext steps:');
    console.log('  1. Run: pnpm db:local:migrate');
    console.log('  2. Or run: pnpm dev:full (to start fresh with seed data)\n');

    if (pool) {
      await pool.end();
    }
  } catch (error) {
    console.error(
      '\n❌ Database reset failed:',
      error instanceof Error ? error.message : error
    );
    if (pool) {
      try {
        await pool.end();
      } catch (closeError) {
        // Ignore close errors
      }
    }
    process.exit(1);
  }
};

main();
