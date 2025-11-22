import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';
import { DbEnvConfig } from '../src/config/env.config';

const { Client } = pg;

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.dev
config({ path: path.resolve(__dirname, '../../../.env.dev') });

interface Migration {
  name: string;
  sql: string;
}

const parseMigrationName = (filename: string): number => {
  const match = filename.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
};

const readMigrations = async (migrationsDir: string): Promise<Migration[]> => {
  const files = await readdir(migrationsDir);
  const sqlFiles = files
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => parseMigrationName(a) - parseMigrationName(b));

  const migrations: Migration[] = [];
  for (const file of sqlFiles) {
    const content = await readFile(path.join(migrationsDir, file), 'utf-8');
    migrations.push({ name: file, sql: content });
  }

  return migrations;
};

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
  let client: pg.Client | null = null;
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

    console.log('🔄 Connecting to database...');
    client = new Client({ connectionString: dbUrl });
    await client.connect();
    console.log('✓ Database connection established\n');

    // Create migrations table if it doesn't exist
    console.log('📋 Ensuring migrations table exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL UNIQUE,
        created_at bigint
      )
    `);
    console.log('✓ Migrations table ready\n');

    // Read migrations
    const migrationsFolder = path.resolve(__dirname, '../src/migrations');
    console.log(`📋 Reading migrations from ${migrationsFolder}...`);
    const migrations = await readMigrations(migrationsFolder);
    console.log(`  Found ${migrations.length} migration files\n`);

    if (migrations.length === 0) {
      console.log('✅ No migrations to apply.');
      await client.end();
      return;
    }

    // Apply migrations
    let appliedCount = 0;
    for (const migration of migrations) {
      // Check if migration has already been applied
      const existing = await client.query(
        'SELECT id FROM "__drizzle_migrations" WHERE hash = $1',
        [migration.name]
      );

      if (existing.rows.length > 0) {
        console.log(`  ⏭ Skipped: ${migration.name} (already applied)`);
        continue;
      }

      try {
        console.log(`  📝 Applying: ${migration.name}`);
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ($1, $2)',
          [migration.name, Date.now()]
        );
        appliedCount++;
        console.log(`    ✓ Success`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`    ✗ Failed: ${errorMsg}`);
        throw error;
      }
    }

    console.log(
      `\n✅ Migrations applied successfully (${appliedCount} new migrations).`
    );
    await client.end();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Migration failed:', errorMsg);

    if (client) {
      try {
        await client.end();
      } catch (_closeError) {
        // Ignore close errors during error handling
      }
    }

    process.exit(1);
  }
};

main();
