#!/usr/bin/env tsx
/**
 * Test database connection
 * Run with: pnpm --filter @codex/database exec tsx test-connection.ts
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env.dev from project root (2 levels up)
const envPath = resolve(__dirname, '../../env.dev');
console.log(`Loading environment from: ${envPath}`);
config({ path: envPath });

// Now import the client after env is loaded
const { testConnection } = await import('./src/client.js');

async function main() {
  console.log('🔌 Testing database connection...\n');

  const connectionString =
    process.env.PG_CONNECTION_STRING || process.env.DATABASE_URL;
  console.log(`Connection string: ${connectionString}\n`);

  try {
    const isConnected = await testConnection();

    if (isConnected) {
      console.log('✅ Database connection successful!');
      console.log('   Postgres is running and accessible via Neon HTTP Proxy');
      process.exit(0);
    } else {
      console.log('❌ Database connection failed');
      console.log('   Make sure Docker is running: pnpm docker:up');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error testing connection:', error);
    console.log('\n💡 Troubleshooting:');
    console.log('   1. Check Docker is running: docker ps');
    console.log('   2. Start services: pnpm docker:up');
    console.log(
      '   3. Check env.dev has PG_CONNECTION_STRING=http://localhost:4444'
    );
    process.exit(1);
  }
}

main();
