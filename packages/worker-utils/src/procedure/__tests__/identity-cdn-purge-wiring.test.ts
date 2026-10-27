/**
 * `registry.identity` hands account deletion's CDN purge to this request's
 * plain `waitUntil`, and builds a purger only when both of its secrets are set
 * (Codex-kk9nv.15).
 *
 * identity-service.test.ts proves deleteAccount hands the purge to a
 * `waitUntil` it is given. Nothing proved the registry gives it one: without
 * it, deleteAccount awaits the purge (up to the purger's 5s timeout) before it
 * returns the session tokens, and every other suite still passes. Plain
 * `waitUntil`, not the tracker: the purge is a fetch and touches no DB pool.
 *
 * DATABASE-FREE: the DB client is constructed, never queried (same env shape
 * as db-background-wiring.test.ts).
 */
import { CdnCachePurger } from '@codex/cloudflare-clients';
import type { Bindings } from '@codex/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { createServiceRegistry } from '../service-registry';
import { createBackgroundTracker } from '../upload-shared';

function testEnv(purge: { CF_ZONE_ID?: string; CF_API_TOKEN?: string }) {
  return {
    DB_METHOD: 'NEON_BRANCH',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/never-connected',
    ENVIRONMENT: 'production',
    WEB_APP_URL: 'https://app.example.test',
    ASSETS_BUCKET: {},
    R2_PUBLIC_URL_BASE: 'https://cdn.example.test',
    ...purge,
  } as unknown as Bindings;
}

/** Read a private field without widening the production type. */
function field(service: object, name: 'waitUntil' | 'cdnPurger'): unknown {
  return (service as Record<string, unknown>)[name];
}

async function identityFrom(env: Bindings) {
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext & { waitUntil: ReturnType<typeof vi.fn> };
  const tracker = createBackgroundTracker();
  const background = vi.spyOn(tracker, 'background');
  const { registry, cleanup } = await createServiceRegistry(
    env,
    undefined,
    undefined,
    ctx,
    undefined,
    tracker.background
  );
  return { identity: registry.identity, ctx, background, cleanup };
}

describe('registry.identity wires the avatar CDN purge (Codex-kk9nv.15)', () => {
  it("hands the purge to the request's plain waitUntil, not the DB tracker", async () => {
    const { identity, ctx, background, cleanup } = await identityFrom(
      testEnv({})
    );
    try {
      const hook = field(identity, 'waitUntil');
      expect(hook).toBeTypeOf('function');
      const purge = Promise.resolve('purged');
      (hook as (promise: Promise<unknown>) => void)(purge);
      expect(ctx.waitUntil).toHaveBeenCalledWith(purge);
      expect(background).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it('builds a purger when both the zone and the token are set', async () => {
    const { identity, cleanup } = await identityFrom(
      testEnv({ CF_ZONE_ID: 'zone-1', CF_API_TOKEN: 'token-1' })
    );
    try {
      expect(field(identity, 'cdnPurger')).toBeInstanceOf(CdnCachePurger);
    } finally {
      await cleanup();
    }
  });

  for (const [missing, purge] of [
    ['token', { CF_ZONE_ID: 'zone-1' }],
    ['zone', { CF_API_TOKEN: 'token-1' }],
  ] as const) {
    it(`builds none when the ${missing} is missing`, async () => {
      const { identity, cleanup } = await identityFrom(testEnv(purge));
      try {
        expect(field(identity, 'cdnPurger')).toBeUndefined();
      } finally {
        await cleanup();
      }
    });
  }
});
