/**
 * Codex-r85jo.3 F7: a failed orphan INSERT must never replace the outcome of
 * the path that called it.
 *
 * Every `recordOrphanedFiles` call in this package runs on a failure path:
 *
 *   1. `withDbUpdateOrphanCleanup` — a DB write just rejected. The orphan
 *      insert is ALSO a DB write, so the two failures are correlated (any Neon
 *      incident). Unguarded, the insert's rejection replaced the original error
 *      and `throw error` never ran: the caller saw the bookkeeping fault, not
 *      the cause.
 *   2. `deleteContentThumbnail` / `deleteUserAvatar` — R2 deletes just
 *      rejected. Unguarded, the insert's rejection skipped the DB clear, so the
 *      row kept pointing at objects the call had just tried to remove.
 *
 * All three were latent only because no production ImageProcessingService was
 * ever given an `orphanedFileService`. Wiring it (the rest of this bead) makes
 * them live, so each is pinned here with the insert REJECTING.
 */

import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import { ObservabilityClient } from '@codex/observability';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrphanedFileService } from '../../orphaned-file-service';
import * as processor from '../../processor';
import { ImageProcessingService } from '../../service';

vi.mock('../../processor', () => ({
  processImageVariants: vi.fn(),
}));

const ORIGINAL_DB_ERROR = 'Database connection lost';
const INSERT_ERROR = 'orphan insert failed: connection lost';

function jpegFile(): File {
  const bytes = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...new Array(100).fill(0),
  ]);
  return new File([bytes], 'x.jpg', { type: 'image/jpeg' });
}

/** An orphan service whose insert rejects — the correlated-failure case. */
function rejectingOrphanService() {
  const recordOrphanedFiles = vi
    .fn()
    .mockRejectedValue(new Error(INSERT_ERROR));
  return {
    recordOrphanedFiles,
    svc: { recordOrphanedFiles } as unknown as OrphanedFileService,
  };
}

/** R2 whose puts succeed and whose deletes all reject. */
function r2DeletesReject(): R2Service {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockRejectedValue(new Error('R2 delete failed')),
  } as unknown as R2Service;
}

function dbWithUpdate(where: ReturnType<typeof vi.fn>): Database {
  return {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    }),
    query: {
      // FIRST uploads: nothing referenced the keys, so cleanup (and therefore
      // orphan recording) is the path that runs.
      content: { findFirst: vi.fn().mockResolvedValue({ thumbnailUrl: null }) },
      users: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ avatarUrl: 'https://test.r2.dev/a.webp' }),
      },
    },
  } as unknown as Database;
}

describe('Codex-r85jo.3 F7: orphan-record failure keeps the original outcome', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(processor.processImageVariants).mockReturnValue({
      sm: new Uint8Array([1]),
      md: new Uint8Array([2]),
      lg: new Uint8Array([3]),
    });
    errorSpy = vi.spyOn(ObservabilityClient.prototype, 'error');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('withDbUpdateOrphanCleanup rethrows the ORIGINAL DB error, not the insert error', async () => {
    const orphans = rejectingOrphanService();
    const service = new ImageProcessingService({
      db: dbWithUpdate(vi.fn().mockRejectedValue(new Error(ORIGINAL_DB_ERROR))),
      environment: 'test',
      r2Service: r2DeletesReject(),
      r2PublicUrlBase: 'https://test.r2.dev',
      orphanedFileService: orphans.svc,
    });

    const outcome = service.processContentThumbnail(
      'content-1',
      'user-1',
      jpegFile()
    );

    await expect(outcome).rejects.toThrow(ORIGINAL_DB_ERROR);
    await expect(outcome).rejects.not.toThrow(INSERT_ERROR);
    // The insert really was attempted, so the guard — not a skipped branch — is
    // what kept the cause.
    expect(orphans.recordOrphanedFiles).toHaveBeenCalledTimes(1);
    // And the keys survive in the error log, the only remaining record of them.
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to record orphaned R2 files; keys are untracked',
      expect.objectContaining({
        context: 'content-thumbnail',
        r2Keys: expect.arrayContaining([
          'user-1/content-thumbnails/content-1/lg.webp',
        ]),
      })
    );
  });

  it('deleteContentThumbnail still clears the DB field when the insert rejects', async () => {
    const orphans = rejectingOrphanService();
    const where = vi.fn().mockResolvedValue(undefined);
    const service = new ImageProcessingService({
      db: dbWithUpdate(where),
      environment: 'test',
      r2Service: r2DeletesReject(),
      r2PublicUrlBase: 'https://test.r2.dev',
      orphanedFileService: orphans.svc,
    });

    await expect(
      service.deleteContentThumbnail('content-1', 'user-1')
    ).resolves.toBeUndefined();
    expect(orphans.recordOrphanedFiles).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to record orphaned R2 files; keys are untracked',
      expect.objectContaining({ context: 'content-thumbnail-delete' })
    );
  });

  it('deleteUserAvatar still clears the DB field when the insert rejects', async () => {
    const orphans = rejectingOrphanService();
    const where = vi.fn().mockResolvedValue(undefined);
    const service = new ImageProcessingService({
      db: dbWithUpdate(where),
      environment: 'test',
      r2Service: r2DeletesReject(),
      r2PublicUrlBase: 'https://test.r2.dev',
      orphanedFileService: orphans.svc,
    });

    await expect(service.deleteUserAvatar('user-1')).resolves.toBeUndefined();
    expect(orphans.recordOrphanedFiles).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to record orphaned R2 files; keys are untracked',
      expect.objectContaining({ context: 'user-avatar-delete' })
    );
  });
});
