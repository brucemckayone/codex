import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';
import { DbEnvConfig } from '../src/config/env.config';
import { runMigrationPreflights } from './migration-preflight';

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
    // Connect to the local PostgreSQL instance (Docker exposed on localhost).
    // The database NAME is taken from the URL, not hardcoded: this used to
    // say `/main` unconditionally, so migrating the disposable test database
    // (`main_test`, Codex-1ggzd) silently migrated the dev database instead.
    const database = url.pathname.replace(/^\//, '') || 'main';
    return `postgres://postgres:postgres@localhost:5432/${database}`;
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
    // A dropped connection also arrives as an 'error' event. Unheard, it
    // crashes the process before the failed file rolls back and is reported.
    client.on('error', (error) => {
      console.warn(`    ⚠ Database connection error: ${error.message}`);
    });
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

    // Which migrations this run will apply
    const pending: Migration[] = [];
    for (const migration of migrations) {
      const existing = await client.query(
        'SELECT id FROM "__drizzle_migrations" WHERE hash = $1',
        [migration.name]
      );
      if (existing.rows.length > 0) {
        console.log(`  ⏭ Skipped: ${migration.name} (already applied)`);
        continue;
      }
      pending.push(migration);
    }

    // Before ANY is applied: a check that fails leaves the database as it
    // was, instead of a run that stops halfway (see migration-preflight.ts).
    const failures = await runMigrationPreflights(
      client,
      pending.map((migration) => migration.name)
    );
    if (failures.length > 0) {
      for (const failure of failures)
        console.error(`  ✗ Preflight: ${failure}`);
      throw new Error(
        `${failures.length} migration preflight check(s) failed; nothing was applied`
      );
    }

    // Apply migrations
    let appliedCount = 0;
    for (const migration of pending) {
      try {
        console.log(`  📝 Applying: ${migration.name}`);
        // One transaction per file: its lock bound, the file and the row that
        // records it commit together or not at all. A lock wait over 5 s fails
        // the file, nothing is half-applied, re-run the deploy once the
        // blocking transaction ends (Codex-vliwn). Every file opens with its
        // own `SET LOCAL`, so a file's own `RESET lock_timeout` (0111,
        // 0122-0125), which outlives its commit, never leaves the next file
        // unbounded. No file may hold its own BEGIN/COMMIT.
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ($1, $2)',
          [migration.name, Date.now()]
        );
        await client.query('COMMIT');
        appliedCount++;
        console.log(`    ✓ Success`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`    ✗ Failed: ${errorMsg}`);
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          // Usually the connection is gone, and the server rolls back with
          // it. Say so, then fail with the file's own error, not this one.
          const rollbackMsg =
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError);
          console.warn(`    ⚠ Rollback failed too: ${rollbackMsg}`);
        }
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
