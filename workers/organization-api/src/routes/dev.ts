/**
 * Dev-only utilities exposed by the organization-api worker.
 *
 * These endpoints MUST never be reachable in production. Each handler
 * gates strictly on `env.ENVIRONMENT === 'development'` — any other value
 * (including missing, 'staging', 'production') returns 404 so the
 * endpoint is indistinguishable from "not registered" in deployed
 * environments.
 *
 * Why organization-api hosts this: every worker binds the same CACHE_KV
 * and AUTH_SESSION_KV namespace IDs, so flushing from any single worker
 * flushes the cache visible to all of them. organization-api was chosen
 * because the seed scripts already need it for tier reads.
 */

import type { HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

const DEV_ENVIRONMENT = 'development';

async function deleteAllKeys(kv: KVNamespace | undefined): Promise<number> {
  if (!kv) return 0;
  let count = 0;
  let cursor: string | undefined;
  do {
    const result: KVNamespaceListResult<unknown, string> = await kv.list({
      cursor,
    });
    if (result.keys.length > 0) {
      await Promise.all(result.keys.map((k) => kv.delete(k.name)));
      count += result.keys.length;
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  return count;
}

/**
 * POST /__dev__/flush-kv
 *
 * Wipes all entries from CACHE_KV and AUTH_SESSION_KV. Used by the seed
 * scripts so a fresh DB doesn't get served against stale Miniflare KV
 * (versioned tier lists, cached sessions for users that no longer exist).
 *
 * Returns 404 unless ENVIRONMENT is exactly 'development'.
 */
app.post('/flush-kv', async (c) => {
  if (c.env.ENVIRONMENT !== DEV_ENVIRONMENT) {
    return c.notFound();
  }

  const [cache, session] = await Promise.all([
    deleteAllKeys(c.env.CACHE_KV as KVNamespace | undefined),
    deleteAllKeys(c.env.AUTH_SESSION_KV as KVNamespace | undefined),
  ]);

  return c.json({ flushed: { cache, session } }, 200);
});

export default app;
