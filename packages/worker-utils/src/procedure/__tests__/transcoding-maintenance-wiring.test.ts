/**
 * Codex-l2c48.5 — the hourly maintenance run is wired to the right R2 bucket
 * and the right worker count.
 *
 * The maintenance suite builds TranscodingMaintenance itself, with a mocked
 * `originalExists`, so only this file sees the registry's adapter. A wrong
 * HEAD-to-boolean mapping would fail creators' uploads as UPLOAD_INCOMPLETE.
 *
 * DATABASE-FREE: the DB client is constructed, never queried (same env shape
 * as orphan-producer-wiring.test.ts).
 */
import type { Bindings } from '@codex/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { createServiceRegistry } from '../service-registry';

function mediaEnv(overrides: Partial<Record<string, unknown>> = {}): Bindings {
  return {
    DB_METHOD: 'NEON_BRANCH',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/never-connected',
    ENVIRONMENT: 'production',
    API_URL: 'https://media-api.example.test',
    RUNPOD_API_KEY: 'key',
    RUNPOD_ENDPOINT_ID: 'endpoint',
    ...overrides,
  } as unknown as Bindings;
}

/** Read a private field without widening the production type. */
function privateField<T>(service: object, field: string): T {
  return (service as Record<string, unknown>)[field] as T;
}

async function withRegistry<T>(
  env: Bindings,
  use: (
    registry: Awaited<ReturnType<typeof createServiceRegistry>>['registry']
  ) => Promise<T>
): Promise<T> {
  const { registry, cleanup } = await createServiceRegistry(env);
  try {
    return await use(registry);
  } finally {
    await cleanup();
  }
}

describe('transcoding maintenance wiring (Codex-l2c48.5)', () => {
  it('asks MEDIA_BUCKET whether an original is there', async () => {
    const head = vi.fn(async (key: string) =>
      key === 'creator/originals/there/video.mp4' ? ({} as R2Object) : null
    );

    await withRegistry(
      mediaEnv({ MEDIA_BUCKET: { head } as unknown as R2Bucket }),
      async (registry) => {
        const originalExists = privateField<
          ((key: string) => Promise<boolean>) | undefined
        >(registry.transcodingMaintenance, 'originalExists');

        expect(
          await originalExists?.('creator/originals/there/video.mp4')
        ).toBe(true);
        expect(
          await originalExists?.('creator/originals/absent/video.mp4')
        ).toBe(false);
      }
    );
  });

  it('lets an R2 failure through: only a definite "not there" may fail an upload', async () => {
    const head = vi.fn(async () => {
      throw new Error('R2 unavailable');
    });

    await withRegistry(
      mediaEnv({ MEDIA_BUCKET: { head } as unknown as R2Bucket }),
      async (registry) => {
        const originalExists = privateField<
          ((key: string) => Promise<boolean>) | undefined
        >(registry.transcodingMaintenance, 'originalExists');

        await expect(originalExists?.('any/key')).rejects.toThrow(
          'R2 unavailable'
        );
      }
    );
  });

  it('builds no R2 check without MEDIA_BUCKET', async () => {
    await withRegistry(mediaEnv(), async (registry) => {
      expect(
        privateField(registry.transcodingMaintenance, 'originalExists')
      ).toBeUndefined();
    });
  });

  it.each([
    ['unset', undefined, 5],
    ['a sane value', '7', 7],
    ['a typo', 'ten', 5],
    ['zero', '0', 5],
  ])('reads RUNPOD_WORKERS_MAX %s as %s → %i', async (_case, value, expected) => {
    await withRegistry(
      mediaEnv({ RUNPOD_WORKERS_MAX: value }),
      async (registry) => {
        expect(privateField(registry.transcoding, 'runpodWorkersMax')).toBe(
          expected
        );
      }
    );
  });
});
