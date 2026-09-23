/**
 * Create and migrate the disposable local test database (Codex-1ggzd).
 *
 * Run from the repo root with `pnpm db:test:setup`. Idempotent: safe to run
 * any number of times, and after every new migration.
 *
 * ## Why this exists
 *
 * `cleanupDatabase()` and the other destructive test helpers refuse any
 * database that is not on an allowlist (`packages/test-utils/src/
 * destructive-target.ts`, Codex-bsbf8). `main` — the database `pnpm dev`
 * serves — is refused by name, so a DB-backed package suite pointed at it
 * cannot run. This script provides the allowed alternative, `main_test`, on
 * the SAME local Postgres container (`infrastructure/neon/
 * docker-compose.dev.local.yml`), then brings it to schema.
 *
 * ## What it does, in order
 *
 * 1. Connects DIRECTLY to Postgres (`localhost:5432`, maintenance db
 *    `postgres`) and runs `CREATE DATABASE main_test` if it does not exist.
 *    Nothing is dropped, truncated or deleted — anywhere.
 * 2. Runs `scripts/migrate-direct.ts` with the environment pointed at
 *    `main_test`, so the dev database is never the migration target.
 * 3. Asks the Neon HTTP proxy (`db.localtest.me:4444`) — the path the tests
 *    actually use — which database a `…/main_test` URL lands on, and fails
 *    unless it answers `main_test`. The proxy routes by the database name in
 *    the client's URL (verified 2026-09-23 over both HTTP and WebSocket), but
 *    it is a third-party image, and this is the one property the whole setup
 *    rests on, so it is checked every run rather than assumed.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon, neonConfig } from '@neondatabase/serverless';
import pg from 'pg';
import { NEON_CONFIG } from '../src/constants';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Must stay on the guard's allowlist (`DISPOSABLE_DATABASE_NAMES`). */
const TEST_DATABASE = 'main_test';

/** The database `pnpm dev` serves. Never a target of this script. */
const DEV_DATABASE = 'main';

// Credentials and port match the local compose file; this script is for the
// local Docker stack only and has no meaning against a real Neon project.
const ADMIN_URL = 'postgres://postgres:postgres@localhost:5432/postgres';
const TEST_URL_VIA_PROXY = `postgres://postgres:postgres@${NEON_CONFIG.LOCAL_HOST}:5432/${TEST_DATABASE}`;

function fail(message: string): never {
  console.error(`\n❌ db:test:setup failed: ${message}`);
  process.exit(1);
}

async function ensureDatabaseExists(): Promise<void> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await client.connect();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(
      `cannot reach local Postgres at localhost:5432 (${detail}). ` +
        'Start the local stack first: pnpm docker:up'
    );
  }

  try {
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [TEST_DATABASE]
    );
    if (existing.rows.length > 0) {
      console.log(`✓ Database "${TEST_DATABASE}" already exists`);
      return;
    }
    // Identifier is a compile-time constant, not input, so interpolation is
    // safe — CREATE DATABASE does not accept a bind parameter for the name.
    await client.query(`CREATE DATABASE "${TEST_DATABASE}"`);
    console.log(`✓ Created database "${TEST_DATABASE}"`);
  } finally {
    await client.end();
  }
}

function migrateTestDatabase(): void {
  console.log(`\n🔄 Migrating "${TEST_DATABASE}"...\n`);
  // migrate-direct.ts loads .env.dev, but dotenv never overrides a variable
  // that is already set, so these win over the dev database URL.
  const result = spawnSync(
    'pnpm',
    ['exec', 'tsx', path.join(__dirname, 'migrate-direct.ts')],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        DB_METHOD: 'LOCAL_PROXY',
        NODE_ENV: 'test',
        DATABASE_URL: TEST_URL_VIA_PROXY,
        DATABASE_URL_LOCAL_PROXY: TEST_URL_VIA_PROXY,
      },
    }
  );
  if (result.status !== 0) {
    fail(`migrations did not apply cleanly to "${TEST_DATABASE}"`);
  }
}

async function assertProxyRoutesToTestDatabase(): Promise<void> {
  neonConfig.fetchEndpoint = (host: string): string =>
    `http://${host}:${NEON_CONFIG.PROXY_PORT}/sql`;
  let attached: unknown;
  try {
    const sql = neon(TEST_URL_VIA_PROXY);
    const rows = (await sql`select current_database() as name`) as Array<{
      name?: unknown;
    }>;
    attached = rows[0]?.name;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(
      `cannot reach the Neon HTTP proxy at ${NEON_CONFIG.LOCAL_HOST}:` +
        `${NEON_CONFIG.PROXY_PORT} (${detail}). Start the local stack: pnpm docker:up`
    );
  }
  if (attached !== TEST_DATABASE) {
    fail(
      `the Neon proxy routed a "${TEST_DATABASE}" URL to "${String(attached)}". ` +
        `Tests would not reach the test database${
          attached === DEV_DATABASE
            ? ' — they would reach the DEV database'
            : ''
        }. (The cleanup guard would still refuse, so nothing is at risk.)`
    );
  }
  console.log(
    `\n✓ Neon proxy routes "${TEST_DATABASE}" URLs to current_database() = ${TEST_DATABASE}`
  );
}

async function main(): Promise<void> {
  await ensureDatabaseExists();
  migrateTestDatabase();
  await assertProxyRoutesToTestDatabase();
  console.log(
    `\n✅ "${TEST_DATABASE}" is ready. In .env.test, set BOTH\n` +
      `   DATABASE_URL_LOCAL_PROXY and DATABASE_URL to end in /${TEST_DATABASE}\n` +
      '   (see packages/test-utils/CLAUDE.md).'
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
