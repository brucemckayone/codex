import { drizzle } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';
import * as schema from './schema';
import { DbEnvConfig } from './config/env.config';

// Apply neonConfig modifications using the function from DbEnvConfig
DbEnvConfig.applyNeonConfig(neonConfig);

export const sql = neon(DbEnvConfig.getDbUrl()!);
export const db = drizzle(sql, { schema });

/**
 * Checks if the database connection is working by running a simple query.
 * Resolves to `true` if the query succeeds, otherwise throws an error.
 */
export async function testDbConnection(): Promise<boolean> {
  try {
    const result = await db.execute('SELECT 1 as value');
    if (
      result &&
      Array.isArray(result.rows) &&
      result.rows.length > 0 &&
      (result.rows[0] as { value: number }).value === 1
    ) {
      return true;
    }
    throw new Error('Test query did not return expected result');
  } catch (err) {
    // Rethrow error for caller to handle—connection or query failed
    throw new Error(
      `Database connection test failed: ${(err as Error).message}`
    );
  }
}
