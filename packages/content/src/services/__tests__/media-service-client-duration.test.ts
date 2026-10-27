/**
 * The client's runtime measurement is advisory (Codex-l2c48.9 review):
 * upload-complete records it before the `uploaded` step, so a fault writing
 * it must be logged, never thrown, or the creator is told a finished upload
 * failed. Its guard (WHERE duration_seconds IS NULL) is proven against a real
 * row in media-service.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { MediaItemService } from '../media-service';

describe('MediaItemService.recordClientDuration', () => {
  it('logs a failed write and does not throw', async () => {
    const db = {
      update: () => ({
        set: () => ({
          where: async () => {
            throw new Error('connection reset');
          },
        }),
      }),
    };
    const service = new MediaItemService({
      db: db as unknown as ConstructorParameters<
        typeof MediaItemService
      >[0]['db'],
      environment: 'test',
    });
    const logged = vi.spyOn(
      (service as unknown as { obs: { error: (...args: unknown[]) => void } })
        .obs,
      'error'
    );

    await expect(
      service.recordClientDuration(
        '4d000000-0000-4000-8000-000000000001',
        'creator1',
        137
      )
    ).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(
      'media.client_duration_not_recorded',
      expect.objectContaining({
        mediaId: '4d000000-0000-4000-8000-000000000001',
      })
    );
  });
});
