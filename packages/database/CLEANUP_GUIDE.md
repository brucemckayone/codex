# Guide to Cleaning Up the Database Client (`client.ts`)

This guide explains the current state of the database client, why it became complex, and provides a step-by-step guide to refactor it to a cleaner, more maintainable structure.

## The Problem: A Messy `client.ts`

The `packages/database/src/client.ts` file has become complex because it needs to support three different database connection environments:

1.  **Local Development**: Using a Neon HTTP proxy (`db.localtest.me`).
2.  **CI/Testing**: Using a direct connection to a standard Postgres database (`localhost`).
3.  **Production**: Using Neon's serverless driver to connect to the production database.

To handle these different environments, the current implementation uses a combination of lazy initialization, environment variable checks, and a Proxy object to wrap the database client. This has led to code that is difficult to understand and maintain.

## The Goal: A Cleaner, Simpler `client.ts`

The goal of this refactoring is to simplify the database client by:

1.  **Removing the complexity**: Get rid of the proxy and complex initialization logic.
2.  **Leveraging build tools**: Use conditional exports and environment variables to provide the correct database client for each environment at build time.
3.  **Improving type safety**: Ensure the database client is fully type-safe in all environments.

## The Solution: Conditional Exports

We can use a feature of modern JavaScript bundlers called "conditional exports" to solve this problem elegantly. This allows us to define different entry points for our package based on the environment.

Here's how it will work:

1.  We will create three separate client files:
    *   `client.node.ts`: For direct Postgres connections (used in CI/testing).
    *   `client.edge.ts`: For Neon's serverless driver (used in production and local dev with the proxy).
    *   `client.ts`: A barrel file that re-exports the correct client.

2.  We will update `packages/database/package.json` to use conditional exports to select the correct file based on the environment.

3.  The test and build configurations will be updated to use these conditional exports.

## Step-by-Step Refactoring Guide

### Step 1: Create `client.node.ts`

This file will contain the client for direct Postgres connections.

**`packages/database/src/client.node.ts`**
```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
```

### Step 2: Create `client.edge.ts`

This file will contain the client for Neon's serverless driver.

**`packages/database/src/client.edge.ts`**
```typescript
import { drizzle } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';
import * as schema from './schema';

const connectionString = process.env.PG_CONNECTION_STRING || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('Database connection string not found');
}

// For local development with the Neon proxy
if (connectionString.includes('db.localtest.me')) {
  neonConfig.fetchEndpoint = () => 'http://localhost:4444/sql';
}

const sql = neon(connectionString);
export const db = drizzle(sql, { schema });
```

### Step 3: Update `client.ts`

This file will now be a simple barrel file that exports the `db` object. The build system will handle which file is actually imported.

**`packages/database/src/client.ts`**
```typescript
export { db } from './client.edge';
```

### Step 4: Update `package.json`

This is the key step. We will add an `exports` field to `packages/database/package.json`.

```json
{
  "name": "@codex/database",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "edge": "./src/client.edge.ts",
      "node": "./src/client.node.ts",
      "default": "./src/client.ts"
    },
    "./schema": "./src/schema/index.ts"
  },
  "scripts": {
    // ...
  },
  "dependencies": {
    // ...
  },
  "devDependencies": {
    // ...
  }
}
```

### Step 5: Update `vitest.config.ts`

We need to tell Vitest to use the `node` condition when running tests.

**`packages/database/vitest.config.ts`**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ...
  },
  resolve: {
    conditions: ['node'],
  },
});
```

### Step 6: Update `client.test.ts`

The test file can now be simplified, as it will only ever run in the `node` environment with the `postgres-js` client.

```typescript
import { describe, it, expect } from 'vitest';
import { db } from './client';
import { sql } from 'drizzle-orm';

describe('Database Client', () => {
  it('should connect and execute a query', async () => {
    const result = await db.execute(sql`SELECT 1 as value`);
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].value).toBe(1);
  });
});
```

### Step 7: Clean Up

- Remove the old `client.ts` logic.
- Remove the `testConnection` function as it's no longer needed.

## How it Works

- **In Production/Local Dev (Edge environment)**: The SvelteKit/Cloudflare Workers build system will see the `edge` condition in the `exports` map and import `client.edge.ts`.
- **In CI/Testing (Node.js environment)**: Vitest will see the `node` condition and import `client.node.ts`.

This approach is much cleaner, more maintainable, and leverages the power of modern JavaScript tooling.
