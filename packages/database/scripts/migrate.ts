import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import ws from 'ws';
import { DbEnvConfig } from '../src/config/env.config';

// For LOCAL_PROXY, we need to disable SSL since it's a local connection
if (process.env.DB_METHOD === 'LOCAL_PROXY') {
  neonConfig.useSecureWebSocket = false;
  // Disable WebSocket-based pooling to avoid proxy issues
  neonConfig.poolQueryViaFetch = true;
}

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.dev
config({ path: path.resolve(__dirname, '../../../.env.dev') });

// Apply the Neon configuration for local proxy
DbEnvConfig.applyNeonConfig(neonConfig);

// Set WebSocket constructor for Node.js
if (
  typeof process !== 'undefined' &&
  typeof process.versions !== 'undefined' &&
  typeof process.versions.node !== 'undefined'
) {
  neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
}

const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> => {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        console.log(
          `  ⏳ Connection failed (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error('Connection failed');
};

const main = async () => {
  let pool: Pool | null = null;
  try {
    const dbUrl = DbEnvConfig.getDbUrl();
    if (!dbUrl) {
      throw new Error('DATABASE_URL not found');
    }

    console.log('🔄 Connecting to database...');
    pool = new Pool({ connectionString: dbUrl });

    // Test connection with retry logic
    try {
      await retryWithBackoff(() => pool!.query('SELECT 1'), 3, 1000);
      console.log('✓ Database connection established\n');
    } catch (connError) {
      const errorMsg =
        connError instanceof Error ? connError.message : String(connError);
      console.error('\n⚠ Connection troubleshooting:');
      console.error('  - Ensure Docker containers are running: docker ps');
      console.error('  - Check: pnpm docker:up');
      console.error('  - Verify .env.dev DATABASE_URL_LOCAL_PROXY is correct');
      throw new Error(`Failed to connect to database: ${errorMsg}`);
    }

    const db = drizzle(pool);

    console.log('📋 Applying migrations...');
    const migrationsFolder = path.resolve(__dirname, '../src/migrations');

    try {
      await migrate(db, {
        migrationsFolder,
      });
      console.log('✅ Migrations applied successfully.\n');
    } catch (migError) {
      const errorMsg =
        migError instanceof Error ? migError.message : String(migError);
      if (errorMsg.includes('ENOENT') || errorMsg.includes('migrations')) {
        throw new Error(`Migrations folder not found at ${migrationsFolder}`);
      }
      throw new Error(`Migration execution failed: ${errorMsg}`);
    }

    await pool.end();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('❌ Migration failed:', errorMsg);

    if (pool) {
      try {
        await pool.end();
      } catch (closeError) {
        // Ignore close errors during error handling
      }
    }

    process.exit(1);
  }
};

main();
