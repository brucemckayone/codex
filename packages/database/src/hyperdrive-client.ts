/**
 * The Hyperdrive database client (Codex-s1i7h).
 *
 * THIS FILE IS ONLY EVER LOADED THROUGH A DYNAMIC IMPORT from client.ts, and
 * that indirection is load-bearing twice over. Both facts were paid for on PR
 * #487's first CI run (33893639869):
 *
 * 1. WHY NOT A STATIC IMPORT IN client.ts? This package's vite library build
 *    externalizes `pg`, so a static `import 'pg'` — or a static import of
 *    `drizzle-orm/node-postgres`, which imports pg — lands in the built dist
 *    and is evaluated by EVERY consumer at module load: `env.test` workers,
 *    vitest suites, packages that have no Hyperdrive binding and never asked
 *    for this driver. Under both loaders pg's CJS `require('events')`
 *    resolves to a stub whose EventEmitter is undefined, and
 *    `class Query extends EventEmitter` throws
 *    `Class extends value undefined is not a constructor or null` — with
 *    nodejs_compat enabled. That killed organization-service.test.ts and the
 *    e2e auth worker at import time. Keeping the static imports HERE means
 *    they only evaluate when a Hyperdrive binding actually exists.
 *
 * 2. WHY STATIC IMPORTS *INSIDE* THIS FILE, RATHER THAN DYNAMIC ONES RIGHT
 *    IN client.ts? Because the import SHAPE controls whether the built
 *    worker can connect at all. Measured on workers/organization-api with
 *    `wrangler deploy --env production --dry-run`, grepping the bundle:
 *
 *      static imports in a dynamically-imported file:  cloudflare:sockets 1
 *      `import('pg')` inline in client.ts:              cloudflare:sockets 0
 *
 *    `cloudflare:sockets` is wrangler's injected polyfill for the `net`
 *    builtin — pg's transport. With dynamic `import('pg')`, esbuild still
 *    bundles pg's pool and wire-protocol code (`pg-pool`, `readyForQuery`,
 *    `SASL` are all present) but the polyfill is never injected: the bundle
 *    looks complete and no connection can open. A local file loaded
 *    dynamically carries its static graph into the chunk and triggers the
 *    injection. Guarded by client-pg-socket-import.test.ts.
 *
 * WHY A DIFFERENT DRIVER AT ALL: `@neondatabase/serverless` reaches Neon BY
 * HOSTNAME — the HTTP driver POSTs to `https://<host>/sql`, the Pool opens a
 * WebSocket to Neon's proxy — while a Hyperdrive `connectionString` names a
 * workerd-internal TCP socket speaking the raw PostgreSQL wire protocol. An
 * earlier comment in client.ts claimed Hyperdrive was "a URL swap and not a
 * client-construction change"; that was wrong. Cloudflare's own Hyperdrive
 * guide installs `pg` and documents no serverless-driver path.
 */

import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
// Side-effect import, ON PURPOSE. `drizzle({ connection })` builds the `pg`
// Pool itself, so nothing below names a `pg` symbol — but without a direct
// reference esbuild does not inject the `net` polyfill (see note 2 above).
// A bare import also needs no `@types/pg`: adding that devDependency made
// pnpm re-resolve peers and downgrade vite 7.2.4 -> 6.4.1 for
// vite-plugin-dts and neon-testing.
import 'pg';
import { ObservabilityClient } from '@codex/observability';
import type { DatabaseWs } from './client';
import * as schema from './schema';

const dbObs = new ObservabilityClient('database');

/**
 * Build a per-request drizzle client over a Hyperdrive connection string.
 *
 * Returns the Neon-adapter TYPE (`DatabaseWs`) because consumers name no
 * driver. The cast is sound for that surface: `NodePgDatabase` and
 * `NeonDatabase` are both `PgDatabase`, the query builders are identical,
 * `.transaction()` is a real BEGIN/COMMIT on both, and both return
 * pg-shaped `{ rows }` from `.execute()` (checked: no production code reads
 * a raw execute result). It is NOT sound for the neon-HTTP adapter, whose
 * `.execute()` returns a bare array — which is why this factory, not
 * `getDbHttp`, is the Hyperdrive entry point.
 *
 * No neonConfig here, deliberately: the WebSocket-proxy settings it applies
 * are Neon-transport-only and mean nothing to a TCP socket.
 */
export function buildHyperdriveDbClient(connectionString: string): {
  db: DatabaseWs;
  cleanup: () => Promise<void>;
} {
  const db = drizzleNodePg({ connection: connectionString, schema });

  // Same contract as the Neon per-request pool — an unhandled 'error' event
  // on a pg Pool is an uncaught exception, which would take out the isolate
  // rather than the one request.
  db.$client.on('error', (err: Error) =>
    dbObs.error('Per-request Hyperdrive pool error', { error: err.message })
  );

  return {
    db: db as unknown as DatabaseWs,
    cleanup: async () => {
      await db.$client.end();
    },
  };
}
