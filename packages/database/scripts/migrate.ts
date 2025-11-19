import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import ws from 'ws';
import { DbEnvConfig } from '../src/config/env.config';

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

const main = async () => {
  try {
    const dbUrl = DbEnvConfig.getDbUrl();
    if (!dbUrl) {
      throw new Error('DATABASE_URL not found');
    }

    const pool = new Pool({ connectionString: dbUrl });
    const db = drizzle(pool);

    console.log('Applying migrations...');
    await migrate(db, {
      migrationsFolder: path.resolve(__dirname, '../src/migrations'),
    });
    console.log('Migrations applied successfully.');

    await pool.end();
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

main();
