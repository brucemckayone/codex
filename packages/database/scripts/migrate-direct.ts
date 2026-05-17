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

/**
 * Detect transient connection-level errors so we can reconnect + retry.
 * Neon's pgbouncer can drop connections mid-script (idle reaping, server
 * suspension, pooler restart). We treat the message + SQLSTATE as evidence.
 */
const isConnectionError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  if (
    msg.includes('connection terminated') ||
    msg.includes('connection ended') ||
    msg.includes('client has been closed') ||
    msg.includes('client was closed') ||
    msg.includes('connection closed')
  ) {
    return true;
  }
  const code = (error as { code?: string }).code;
  // 57P01 admin_shutdown, 57P03 cannot_connect_now, 08006/08001/08004
  // connection failures from the SQLSTATE class 08 family.
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === '57P01' ||
    code === '57P03' ||
    code === '08006' ||
    code === '08001' ||
    code === '08004'
  ) {
    return true;
  }
  return false;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Holder so callers can pass a mutable client reference into safeQuery.
 * On reconnect, safeQuery swaps the .client to point at the new pg.Client.
 */
interface ClientRef {
  client: pg.Client;
}

const connect = async (dbUrl: string): Promise<pg.Client> => {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  return client;
};

const MAX_QUERY_ATTEMPTS = 4;

/**
 * Run a query, retrying with a fresh connection on transient errors.
 * Non-connection errors (e.g. SQL syntax, FK violations) propagate immediately.
 */
const safeQuery = async <Row extends pg.QueryResultRow = pg.QueryResultRow>(
  ref: ClientRef,
  dbUrl: string,
  text: string,
  values?: unknown[]
): Promise<pg.QueryResult<Row>> => {
  for (let attempt = 1; attempt <= MAX_QUERY_ATTEMPTS; attempt++) {
    try {
      return values
        ? await ref.client.query<Row>(text, values)
        : await ref.client.query<Row>(text);
    } catch (error) {
      const isLastAttempt = attempt === MAX_QUERY_ATTEMPTS;
      if (!isConnectionError(error) || isLastAttempt) throw error;
      console.warn(
        `  ⚠ Transient connection error (attempt ${attempt}/${MAX_QUERY_ATTEMPTS}): ${error instanceof Error ? error.message : String(error)}`
      );
      try {
        await ref.client.end();
      } catch {
        // Already closed; nothing to clean up.
      }
      // Exponential backoff: 500ms, 1s, 2s before reconnect.
      await sleep(500 * 2 ** (attempt - 1));
      ref.client = await connect(dbUrl);
      console.warn(`  ↻ Reconnected, retrying...`);
    }
  }
  throw new Error('unreachable: safeQuery exhausted MAX_QUERY_ATTEMPTS');
};

const main = async () => {
  let ref: ClientRef | null = null;
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
    ref = { client: await connect(dbUrl) };
    console.log('✓ Database connection established\n');

    // Create migrations table if it doesn't exist
    console.log('📋 Ensuring migrations table exists...');
    await safeQuery(
      ref,
      dbUrl,
      `
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL UNIQUE,
        created_at bigint
      )
    `
    );
    console.log('✓ Migrations table ready\n');

    // Read migrations
    const migrationsFolder = path.resolve(__dirname, '../src/migrations');
    console.log(`📋 Reading migrations from ${migrationsFolder}...`);
    const migrations = await readMigrations(migrationsFolder);
    console.log(`  Found ${migrations.length} migration files\n`);

    if (migrations.length === 0) {
      console.log('✅ No migrations to apply.');
      await ref.client.end();
      return;
    }

    // Apply migrations
    let appliedCount = 0;
    for (const migration of migrations) {
      // Check if migration has already been applied
      const existing = await safeQuery(
        ref,
        dbUrl,
        'SELECT id FROM "__drizzle_migrations" WHERE hash = $1',
        [migration.name]
      );

      if (existing.rows.length > 0) {
        console.log(`  ⏭ Skipped: ${migration.name} (already applied)`);
        continue;
      }

      try {
        console.log(`  📝 Applying: ${migration.name}`);
        await safeQuery(ref, dbUrl, migration.sql);
        await safeQuery(
          ref,
          dbUrl,
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
    await ref.client.end();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Migration failed:', errorMsg);

    if (ref) {
      try {
        await ref.client.end();
      } catch (_closeError) {
        // Ignore close errors during error handling
      }
    }

    process.exit(1);
  }
};

main();
