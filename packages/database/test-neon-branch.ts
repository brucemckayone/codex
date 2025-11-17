/**
 * Test script to debug Neon branch WebSocket connections locally
 *
 * This script connects to a real Neon ephemeral branch (like CI does)
 * to reproduce and debug the test failures we're seeing in CI.
 *
 * Usage:
 * 1. Create a Neon branch: neonctl branches create --name test-debug
 * 2. Get the connection string: neonctl connection-string test-debug --pooled
 * 3. Set DATABASE_URL env var and run: tsx test-neon-branch.ts
 */

import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';

// Configure Neon for WebSocket Pool (same as NEON_BRANCH config)
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
neonConfig.poolQueryViaFetch = false;
neonConfig.useSecureWebSocket = true;
neonConfig.fetchConnectionCache = true;

console.log('=== Neon Branch WebSocket Test ===\n');
console.log('Configuration:');
console.log('- poolQueryViaFetch:', neonConfig.poolQueryViaFetch);
console.log('- useSecureWebSocket:', neonConfig.useSecureWebSocket);
console.log('- fetchConnectionCache:', neonConfig.fetchConnectionCache);
console.log(
  '- webSocketConstructor:',
  neonConfig.webSocketConstructor ? 'ws' : 'undefined'
);
console.log();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  console.error('Set it to your Neon branch connection string (pooled)');
  process.exit(1);
}

console.log(
  'Connection string:',
  connectionString.replace(/:[^:@]+@/, ':***@')
);
console.log();

async function testWebSocketConnection() {
  const pool = new Pool({ connectionString });

  try {
    console.log('1. Testing basic query...');
    const result1 = await pool.query('SELECT 1 as value');
    console.log('✓ Basic query successful:', result1.rows[0]);
    console.log();

    console.log('2. Creating test table...');
    await pool.query(`
      DROP TABLE IF EXISTS test_orgs;
      CREATE TABLE test_orgs (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL
      );
    `);
    console.log('✓ Table created');
    console.log();

    console.log('3. Inserting data...');
    const insertResult = await pool.query(
      'INSERT INTO test_orgs (slug, name) VALUES ($1, $2) RETURNING *',
      ['test-slug-1', 'Test Org 1']
    );
    console.log('✓ Insert successful:', insertResult.rows[0]);
    console.log();

    console.log(
      '4. Reading data back immediately (testing read-your-writes)...'
    );
    const readResult = await pool.query(
      'SELECT * FROM test_orgs WHERE slug = $1',
      ['test-slug-1']
    );
    console.log('Read result:', readResult.rows);

    if (readResult.rows.length === 0) {
      console.error('❌ FAILURE: Data not found after insert!');
      console.error('This is the same issue we see in CI');
    } else {
      console.log('✓ Read successful:', readResult.rows[0]);
    }
    console.log();

    console.log('5. Testing transaction...');
    await pool.query('BEGIN');
    try {
      await pool.query('INSERT INTO test_orgs (slug, name) VALUES ($1, $2)', [
        'test-slug-2',
        'Test Org 2',
      ]);
      await pool.query('COMMIT');
      console.log('✓ Transaction committed');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    console.log();

    console.log('6. Reading transaction data...');
    const txReadResult = await pool.query(
      'SELECT * FROM test_orgs WHERE slug = $1',
      ['test-slug-2']
    );
    if (txReadResult.rows.length === 0) {
      console.error('❌ FAILURE: Transaction data not found!');
    } else {
      console.log('✓ Transaction read successful:', txReadResult.rows[0]);
    }
    console.log();

    console.log('7. Testing unique constraint violation...');
    try {
      await pool.query(
        'INSERT INTO test_orgs (slug, name) VALUES ($1, $2)',
        ['test-slug-1', 'Duplicate Org'] // Should fail - slug already exists
      );
      console.error('❌ FAILURE: Unique constraint not enforced!');
    } catch (error) {
      if (
        (error as Error).message.includes('duplicate key') ||
        (error as Error).message.includes('unique constraint')
      ) {
        console.log('✓ Unique constraint enforced correctly');
      } else {
        console.error('❌ Unexpected error:', (error as Error).message);
      }
    }
    console.log();

    console.log('8. Cleanup...');
    await pool.query('DROP TABLE test_orgs');
    console.log('✓ Table dropped');
    console.log();

    console.log('=== All tests passed! ===');
  } catch (error) {
    console.error('ERROR:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

testWebSocketConnection().catch(console.error);
