/**
 * cleanupContentThumbnailOnDelete — Unit Tests (Codex-ko8ko)
 *
 * Locks the leak-prevention contract for content deletion:
 *  - deleting content triggers deletion of the thumbnail's R2 objects,
 *    scoped to the owning creator;
 *  - a cleanup failure is swallowed + logged, NEVER propagated — the content
 *    soft-delete is the primary op and must not 500 because R2 hiccuped.
 *
 * These assert the extracted helper directly (mirrors public-cache.test.ts),
 * trusting the one-line route wiring in content.ts — the same approach the
 * existing cache-invalidation calls in that delete handler take.
 */

import type { Logger } from '@codex/observability';
import { describe, expect, it, vi } from 'vitest';
import {
  cleanupContentThumbnailOnDelete,
  type ThumbnailCleaner,
} from '../content-cleanup';

function createObs(): Logger {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe('cleanupContentThumbnailOnDelete', () => {
  it('deletes the thumbnail R2 objects for the content, scoped to the creator', async () => {
    const deleteContentThumbnail = vi.fn().mockResolvedValue(undefined);
    const imageProcessing: ThumbnailCleaner = { deleteContentThumbnail };

    await cleanupContentThumbnailOnDelete(
      imageProcessing,
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
        imageProcessing,
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
      cleanupContentThumbnailOnDelete(imageProcessing, 'content-1', 'user-1')
    ).resolves.toBeUndefined();
  });
});
