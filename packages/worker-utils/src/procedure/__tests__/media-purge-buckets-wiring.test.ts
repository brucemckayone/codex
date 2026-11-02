/**
 * `registry.media` gives the daily file purge both buckets (Codex-9seq3): the
 * media bucket, and ASSETS_BUCKET, where the transcoder writes the posters;
 * and the edge-cache purge for those posters, only with both of its secrets.
 *
 * media-usage.integration.test.ts proves the purge deletes each folder from
 * the bucket it is handed. Nothing proved the registry hands it the right
 * ones: given MEDIA_BUCKET as its assets bucket (the fallback every image
 * getter has), the purge lists the poster folder where no poster is, deletes
 * nothing, and stamps the item purged, and every other suite still passes.
 *
 * DATABASE-FREE: the DB client is constructed, never queried (same env shape
 * as identity-cdn-purge-wiring.test.ts).
 */
import { CdnCachePurger } from '@codex/cloudflare-clients';
import type { Bindings } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import { createServiceRegistry } from '../service-registry';

const MEDIA_BUCKET = { name: 'media' };
const ASSETS_BUCKET = { name: 'assets' };

function testEnv(extra: {
  ASSETS_BUCKET?: object;
  CF_ZONE_ID?: string;
  CF_API_TOKEN?: string;
}) {
  return {
    DB_METHOD: 'NEON_BRANCH',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/never-connected',
    ENVIRONMENT: 'production',
    WEB_APP_URL: 'https://app.example.test',
    MEDIA_BUCKET,
    R2_PUBLIC_URL_BASE: 'https://cdn.example.test',
    ...extra,
  } as unknown as Bindings;
}

/** Read a private field of the media service without widening its type. */
function field(
  service: object,
  name: 'cdnPurger' | 'assetsPublicUrlBase'
): unknown {
  return (service as Record<string, unknown>)[name];
}

/** The R2 bucket a private R2Service field of the media service wraps. */
function bucketOf(service: object, name: 'r2' | 'assets'): unknown {
  const r2 = (service as Record<string, unknown>)[name];
  return r2 === undefined ? undefined : (r2 as Record<string, unknown>).bucket;
}

describe('registry.media hands the file purge both buckets (Codex-9seq3)', () => {
  it('the media bucket as r2, and ASSETS_BUCKET for the posters', async () => {
    const { registry, cleanup } = await createServiceRegistry(
      testEnv({ ASSETS_BUCKET })
    );
    try {
      expect(bucketOf(registry.media, 'r2')).toBe(MEDIA_BUCKET);
      expect(bucketOf(registry.media, 'assets')).toBe(ASSETS_BUCKET);
    } finally {
      await cleanup();
    }
  });

  it('no assets bucket without ASSETS_BUCKET: never the media bucket in its place', async () => {
    const { registry, cleanup } = await createServiceRegistry(testEnv({}));
    try {
      expect(bucketOf(registry.media, 'assets')).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('builds the edge purger with both the zone and the token, and gives it the CDN base', async () => {
    const { registry, cleanup } = await createServiceRegistry(
      testEnv({ ASSETS_BUCKET, CF_ZONE_ID: 'zone-1', CF_API_TOKEN: 'token-1' })
    );
    try {
      expect(field(registry.media, 'cdnPurger')).toBeInstanceOf(CdnCachePurger);
      expect(field(registry.media, 'assetsPublicUrlBase')).toBe(
        'https://cdn.example.test'
      );
    } finally {
      await cleanup();
    }
  });

  for (const [missing, purge] of [
    ['token', { CF_ZONE_ID: 'zone-1' }],
    ['zone', { CF_API_TOKEN: 'token-1' }],
  ] as const) {
    it(`builds no edge purger when the ${missing} is missing`, async () => {
      const { registry, cleanup } = await createServiceRegistry(
        testEnv({ ASSETS_BUCKET, ...purge })
      );
      try {
        expect(field(registry.media, 'cdnPurger')).toBeUndefined();
      } finally {
        await cleanup();
      }
    });
  }
});
