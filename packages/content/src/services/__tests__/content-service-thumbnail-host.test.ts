/**
 * ContentService thumbnail-host gate (Codex-8so68)
 *
 * NO DATABASE. The external-host check runs immediately after Zod and
 * BEFORE `db.transaction()` opens, which is exactly what makes it testable
 * with a stub whose `transaction` throws a sentinel:
 *   - REJECT case  → ValidationError, sentinel never reached.
 *   - ACCEPT case  → sentinel surfaces, proving the gate let the value past.
 *
 * `handleError()` re-throws a `ServiceError` unchanged, so a `NotFoundError`
 * sentinel arrives at the caller verbatim.
 *
 * The base literals mirror the `R2_PUBLIC_URL_BASE` binding values in
 * `workers/content-api/wrangler.jsonc`.
 */

import { NotFoundError, ValidationError } from '@codex/service-errors';
import type { CreateContentInput, UpdateContentInput } from '@codex/validation';
import { describe, expect, it } from 'vitest';
import type { ContentServiceConfig } from '../content-service';
import { ContentService } from '../content-service';

const PROD_BASE = 'https://cdn-assets.revelations.studio';
const SENTINEL = 'DB_STUB_REACHED';

/**
 * Minimal db stand-in: any attempt to open a transaction throws the sentinel.
 * Cast at the boundary because only `.transaction` is ever touched here.
 */
function makeService(r2PublicUrlBase?: string): ContentService {
  const db = {
    transaction: () => {
      throw new NotFoundError(SENTINEL);
    },
  };
  return new ContentService({
    db: db as unknown as ContentServiceConfig['db'],
    environment: 'test',
    r2PublicUrlBase,
  });
}

const baseInput: CreateContentInput = {
  title: 'Test Content',
  slug: 'test-content',
  contentType: 'written',
  // Required by createContentSchema's written-content refine.
  contentBody: 'Body text',
  tags: [],
};

describe('ContentService thumbnail host gate', () => {
  describe('create', () => {
    it('rejects an externally-hosted thumbnail', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.create(
          { ...baseInput, thumbnailUrl: 'https://evil.example.com/track.png' },
          'creator-1'
        )
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a lookalike host that has the CDN as a prefix', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.create(
          {
            ...baseInput,
            thumbnailUrl:
              'https://cdn-assets.revelations.studio.evil.example.com/x.png',
          },
          'creator-1'
        )
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('accepts an ImageProcessingService thumbnail URL', async () => {
      const service = makeService(PROD_BASE);

      // Reaching the sentinel means the gate passed the value through.
      await expect(
        service.create(
          {
            ...baseInput,
            thumbnailUrl: `${PROD_BASE}/creator-1/content-thumbnails/content-1/lg.webp`,
          },
          'creator-1'
        )
      ).rejects.toThrow(SENTINEL);
    });

    it('accepts a transcoding media-thumbnail poster URL', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.create(
          {
            ...baseInput,
            thumbnailUrl: `${PROD_BASE}/creator-1/media-thumbnails/media-1/lg.webp`,
          },
          'creator-1'
        )
      ).rejects.toThrow(SENTINEL);
    });

    it('accepts null and undefined thumbnails', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.create({ ...baseInput, thumbnailUrl: null }, 'creator-1')
      ).rejects.toThrow(SENTINEL);
      await expect(service.create(baseInput, 'creator-1')).rejects.toThrow(
        SENTINEL
      );
    });

    it('fails closed when no asset base is configured', async () => {
      const service = makeService(undefined);

      await expect(
        service.create(
          {
            ...baseInput,
            thumbnailUrl: `${PROD_BASE}/creator-1/content-thumbnails/content-1/lg.webp`,
          },
          'creator-1'
        )
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('update', () => {
    // A previous bug on this exact file fixed create() and missed update().
    it('rejects an externally-hosted thumbnail', async () => {
      const service = makeService(PROD_BASE);
      const input: UpdateContentInput = {
        thumbnailUrl: 'https://evil.example.com/track.png',
      };

      await expect(
        service.update('content-1', input, 'creator-1')
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('accepts a platform thumbnail URL', async () => {
      const service = makeService(PROD_BASE);
      const input: UpdateContentInput = {
        thumbnailUrl: `${PROD_BASE}/creator-1/content-thumbnails/content-1/lg.webp`,
      };

      await expect(
        service.update('content-1', input, 'creator-1')
      ).rejects.toThrow(SENTINEL);
    });

    it('leaves an absent thumbnail alone and allows an explicit null', async () => {
      const service = makeService(PROD_BASE);

      await expect(
        service.update('content-1', { title: 'New Title' }, 'creator-1')
      ).rejects.toThrow(SENTINEL);
      await expect(
        service.update('content-1', { thumbnailUrl: null }, 'creator-1')
      ).rejects.toThrow(SENTINEL);
    });
  });
});
