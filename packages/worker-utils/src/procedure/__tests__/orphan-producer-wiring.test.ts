/**
 * Codex-r85jo.3 — the orphan-record PRODUCER is connected.
 *
 * `withDbUpdateOrphanCleanup` and the two `delete*` methods record failed R2
 * deletes through an `OrphanedFileService`, for media-api's
 * `OrphanedFileCleanupDO` to sweep. Until this bead no production
 * ImageProcessingService was ever handed one, so the recording branch could
 * only take its warn path and the DO drained a table nothing wrote. Neither
 * side looked wrong alone; only counting producers against consumers showed
 * the channel was dead.
 *
 * Both registry paths that build an ImageProcessingService are pinned:
 *   - `imageProcessing` — content-api thumbnails, category covers, course
 *     stills;
 *   - `identity` — identity-api avatars, whose `uploadAvatar` builds its own
 *     ImageProcessingService from the config it was given.
 *
 * DATABASE-FREE: the DB client is constructed, never queried (same env shape
 * as stripe-not-configured.test.ts).
 */
import { OrphanedFileService } from '@codex/image-processing';
import type { Bindings } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import { createServiceRegistry } from '../service-registry';

function imageEnv(): Bindings {
  return {
    DB_METHOD: 'NEON_BRANCH',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/never-connected',
    ENVIRONMENT: 'production',
    ASSETS_BUCKET: {} as R2Bucket,
    R2_PUBLIC_URL_BASE: 'https://cdn.example.test',
  } as unknown as Bindings;
}

/** Read a private field without widening the production type. */
function orphanServiceOf(service: object): unknown {
  return (service as { orphanedFileService?: unknown }).orphanedFileService;
}

describe('orphan producer wiring (Codex-r85jo.3)', () => {
  it('registry imageProcessing is built WITH an OrphanedFileService', async () => {
    const { registry, cleanup } = await createServiceRegistry(imageEnv());
    try {
      expect(orphanServiceOf(registry.imageProcessing)).toBeInstanceOf(
        OrphanedFileService
      );
    } finally {
      await cleanup();
    }
  });

  it('registry identity carries one through to the avatar pipeline', async () => {
    const { registry, cleanup } = await createServiceRegistry(imageEnv());
    try {
      expect(orphanServiceOf(registry.identity)).toBeInstanceOf(
        OrphanedFileService
      );
    } finally {
      await cleanup();
    }
  });

  it('both share ONE memoised instance', async () => {
    const { registry, cleanup } = await createServiceRegistry(imageEnv());
    try {
      const shared = orphanServiceOf(registry.imageProcessing);
      expect(shared).toBeInstanceOf(OrphanedFileService);
      expect(orphanServiceOf(registry.identity)).toBe(shared);
    } finally {
      await cleanup();
    }
  });
});
