/**
 * cleanupContentThumbnailOnDelete — Unit Tests (Codex-ko8ko)
 *
 * Locks the leak-prevention contract for content deletion:
 *  - deleting content triggers deletion of the thumbnail's R2 objects,
 *    scoped to the owning creator;
 *  - a cleanup failure is swallowed + logged, NEVER propagated — the content
 *    soft-delete is the primary op and must not 500 because R2 hiccuped.
 *
 * These assert the helper directly, trusting the one-line route wiring in
 * content-api's and admin-api's delete handlers.
 */

import type { Logger } from '@codex/observability';
import { describe, expect, it, vi } from 'vitest';
import {
  cleanupContentThumbnailOnDelete,
  type ThumbnailCleaner,
} from '../content-cleanup';

/** The service getter a route passes (`() => ctx.services.imageProcessing`). */
const serve = (cleaner: ThumbnailCleaner) => () => cleaner;

/** The logger the helper takes: a warn, and an error it must be able to reach. */
function createObs(): Pick<Logger, 'warn'> & Required<Pick<Logger, 'error'>> {
  return { warn: vi.fn(), error: vi.fn() };
}

describe('cleanupContentThumbnailOnDelete', () => {
  it('deletes the thumbnail R2 objects for the content, scoped to the creator', async () => {
    const deleteContentThumbnail = vi.fn().mockResolvedValue(undefined);
    const imageProcessing: ThumbnailCleaner = { deleteContentThumbnail };

    await cleanupContentThumbnailOnDelete(
      serve(imageProcessing),
      'content-1',
      'user-1',
      createObs()
    );

    expect(deleteContentThumbnail).toHaveBeenCalledTimes(1);
    expect(deleteContentThumbnail).toHaveBeenCalledWith('content-1', 'user-1');
  });

  it('swallows and logs cleanup errors so content delete is never rolled back', async () => {
    const deleteContentThumbnail = vi
      .fn()
      .mockRejectedValue(new Error('R2 unavailable'));
    const imageProcessing: ThumbnailCleaner = { deleteContentThumbnail };
    const obs = createObs();

    // MUST resolve (not reject): the delete route awaits this, so a throw here
    // would surface a 500 on an otherwise-successful soft-delete.
    await expect(
      cleanupContentThumbnailOnDelete(
        serve(imageProcessing),
        'content-1',
        'user-1',
        obs
      )
    ).resolves.toBeUndefined();

    expect(obs.warn).toHaveBeenCalledWith(
      'Thumbnail R2 cleanup failed on content delete',
      expect.objectContaining({
        context: 'content-delete-thumbnail',
        contentId: 'content-1',
        error: 'R2 unavailable',
      })
    );
  });

  it('resolves without throwing when no observability logger is provided', async () => {
    const deleteContentThumbnail = vi.fn().mockRejectedValue(new Error('nope'));
    const imageProcessing: ThumbnailCleaner = { deleteContentThumbnail };

    await expect(
      cleanupContentThumbnailOnDelete(
        serve(imageProcessing),
        'content-1',
        'user-1'
      )
    ).resolves.toBeUndefined();
  });

  it('logs an image service that cannot be built as an error, never throwing it (Codex-a6ofh.6)', async () => {
    const obs = createObs();
    const unbuildable = () => {
      throw new Error('R2_PUBLIC_URL_BASE not configured');
    };

    await expect(
      cleanupContentThumbnailOnDelete(unbuildable, 'content-1', 'user-1', obs)
    ).resolves.toBeUndefined();

    // No orphan is recorded for the sweep, so the files leak: an error, not
    // the warn of an R2 failure the sweep will retry.
    expect(obs.error).toHaveBeenCalledWith(
      'Thumbnail cleanup could not start; its files are left in R2',
      expect.objectContaining({
        contentId: 'content-1',
        error: 'R2_PUBLIC_URL_BASE not configured',
      })
    );
    expect(obs.warn).not.toHaveBeenCalled();
  });
});
