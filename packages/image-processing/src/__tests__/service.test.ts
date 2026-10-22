import type { R2Service } from '@codex/cloudflare-clients';
import { type Database, schema } from '@codex/database';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrphanedFileService } from '../orphaned-file-service';
import * as processor from '../processor';
import { ImageProcessingService } from '../service';

/** Lightweight mock shape for db.query table objects used in tests */
interface MockQueryTable {
  findFirst: Mock;
}
interface MockDbQuery {
  users: MockQueryTable;
  content: MockQueryTable;
}
/**
 * Creates a File object with proper ArrayBuffer content for testing
 */
function createTestImageFile(mimeType: string, filename: string): File {
  if (mimeType === 'image/png') {
    const pngBuffer = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG signature (8 bytes)
      ...new Array(100).fill(0), // Padding to make file realistic
    ]).buffer;
    return new File([new Uint8Array(pngBuffer)], filename, { type: mimeType });
  }

  if (mimeType === 'image/svg+xml') {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const encoder = new TextEncoder();
    return new File([encoder.encode(svgContent)], filename, { type: mimeType });
  }

  if (mimeType === 'image/gif') {
    const gifBuffer = new Uint8Array([
      0x47,
      0x49,
      0x46,
      0x38,
      0x39,
      0x61, // GIF89a signature
      ...new Array(100).fill(0), // Padding
    ]).buffer;
    return new File([new Uint8Array(gifBuffer)], filename, { type: mimeType });
  }

  if (mimeType === 'image/webp') {
    const webpBuffer = new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46, // RIFF
      0x00,
      0x00,
      0x00,
      0x00, // File size placeholder
      0x57,
      0x45,
      0x42,
      0x50, // WEBP
      ...new Array(100).fill(0), // Padding
    ]).buffer;
    return new File([new Uint8Array(webpBuffer)], filename, { type: mimeType });
  }

  // Fallback JPEG signature (must be at least 4 bytes)
  const jpegBuffer = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0, // JPEG signature (4 bytes minimum)
    ...new Array(100).fill(0), // Padding to make file realistic
  ]).buffer;
  return new File([new Uint8Array(jpegBuffer)], filename, { type: mimeType });
}

/**
 * Whether a drizzle SQL tree names `column` anywhere: how a test proves a
 * WHERE carries a predicate without a dialect to render it.
 */
function sqlReferences(node: unknown, column: unknown): boolean {
  if (node === column) return true;
  const chunks = (node as { queryChunks?: unknown[] } | null)?.queryChunks;
  return (
    Array.isArray(chunks) &&
    chunks.some((chunk) => sqlReferences(chunk, column))
  );
}

/**
 * What `update().set().where()` returns: awaited, the matched rows, and with
 * `.returning()` on it the same rows, as drizzle's builder does.
 */
function whereResult(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    returning: vi.fn().mockResolvedValue(rows),
  });
}

// Base mock implementations (will be recreated in beforeEach)
const createMockDb = () =>
  ({
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn(() => whereResult([{ id: 'content-1' }])),
      }),
    }),
  }) as unknown as Database;

// Mock processor. Every still goes through the page-image pipeline
// (Codex-kk9nv.5).
vi.mock('../processor', () => ({
  processStillVariants: vi.fn(),
}));

/**
 * A still's four sizes and its source's size, as `processStillVariants`
 * returns them — for every still, not only page images (Codex-kk9nv.5).
 */
function pageVariants(
  sizes: { sm?: number[]; md?: number[]; lg?: number[]; xl?: number[] } = {},
  width = 2400,
  height = 1600
) {
  return {
    variants: {
      sm: new Uint8Array(sizes.sm ?? [1]),
      md: new Uint8Array(sizes.md ?? [2]),
      lg: new Uint8Array(sizes.lg ?? [3]),
      xl: new Uint8Array(sizes.xl ?? [4]),
    },
    width,
    height,
  };
}

/** The `.set()` mock behind the n-th `db.update()` call on a `createMockDb()`. */
function setMockOf(db: Database, call = 0): Mock {
  const update = vi.mocked(db.update) as unknown as Mock;
  return (update.mock.results[call]?.value as { set: Mock }).set;
}

/** The keys `R2Service.put` received, in call order. */
function putKeys(r2: R2Service): string[] {
  return vi.mocked(r2.put).mock.calls.map((call) => call[0] as string);
}

/** The keys `R2Service.delete` received, in call order. */
function deleteKeys(r2: R2Service): string[] {
  return vi.mocked(r2.delete).mock.calls.map((call) => call[0] as string);
}

/** A still folder's four files, in put order. */
function folderFiles(folder: string): string[] {
  return ['sm', 'md', 'lg', 'xl'].map((size) => `${folder}/${size}.webp`);
}

/**
 * The one new folder an upload wrote under `base`: every put is sm/md/lg/xl
 * in `{base}/{width}x{height}-{8 hex}` (Codex-kk9nv.5).
 */
function newFolderOf(
  r2: R2Service,
  base: string,
  size: { width: number; height: number }
): string {
  const keys = putKeys(r2);
  const folder = keys[0]?.replace(/\/sm\.webp$/, '') ?? '';
  expect(folder).toMatch(
    new RegExp(`^${base}/${size.width}x${size.height}-[0-9a-f]{8}$`)
  );
  expect(keys).toEqual(folderFiles(folder));
  return folder;
}

describe('ImageProcessingService', () => {
  let service: ImageProcessingService;
  let mockDbQuery: MockDbQuery;
  let testMockR2Service: R2Service;
  let testMockDb: Database;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset R2Service mock to default implementation
    testMockR2Service = {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Service;

    // Reset database mock to default implementation
    testMockDb = createMockDb();

    // Mock for delete methods that query database
    mockDbQuery = {
      users: {
        findFirst: vi.fn().mockResolvedValue({
          avatarUrl: 'https://test.r2.dev/avatars/user-1/lg.webp',
        }),
      },
      content: {
        findFirst: vi.fn().mockResolvedValue({
          thumbnailUrl:
            'https://test.r2.dev/user-1/content-thumbnails/content-1/lg.webp',
        }),
      },
    };

    service = new ImageProcessingService({
      db: { ...testMockDb, query: mockDbQuery } as unknown as Database,
      environment: 'test',
      r2Service: testMockR2Service,
      r2PublicUrlBase: 'https://test.r2.dev',
    });
  });

  describe('processContentThumbnail', () => {
    it('should process raster image and upload four sizes', async () => {
      const file = createTestImageFile('image/png', 'test.png');

      // Mock processing success
      vi.mocked(processor.processStillVariants).mockReturnValueOnce(
        pageVariants({}, 1200, 900)
      );

      const result = await service.processContentThumbnail(
        'content-1',
        'user-1',
        file
      );

      expect(processor.processStillVariants).toHaveBeenCalled();

      // sm, md, lg, xl in a new folder named for the source's upright size
      // (Codex-kk9nv.5), and the URL is that folder's lg.
      const folder = newFolderOf(
        testMockR2Service,
        'user-1/content-thumbnails/content-1',
        { width: 1200, height: 900 }
      );
      expect(result.url).toBe(`https://test.r2.dev/${folder}/lg.webp`);
      expect(result.size).toBe(1); // lg variant is Uint8Array([3]), byteLength is 1
      expect(result.mimeType).toBe('image/webp'); // Stored as WebP after processing

      // Verify one of the calls includes cache headers
      // R2Service.put signature: (key, body, metadata, httpMetadata)
      expect(testMockR2Service.put).toHaveBeenCalledWith(
        expect.stringContaining('/sm.webp'),
        expect.any(Uint8Array),
        {}, // Empty metadata object (not undefined)
        {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        }
      );
    });

    it("should update database with the new folder's lg URL", async () => {
      const file = createTestImageFile('image/jpeg', 'test.jpg');

      vi.mocked(processor.processStillVariants).mockReturnValueOnce(
        pageVariants({}, 1200, 900)
      );

      await service.processContentThumbnail('content-1', 'user-1', file);

      expect(testMockDb.update).toHaveBeenCalled();
      // The size travels IN the URL (Codex-kk9nv.5), so a row can never carry
      // one image's URL with another's size: there is no column to drift.
      expect(setMockOf(testMockDb)).toHaveBeenCalledWith({
        thumbnailUrl: expect.stringMatching(
          /^https:\/\/test\.r2\.dev\/user-1\/content-thumbnails\/content-1\/1200x900-[0-9a-f]{8}\/lg\.webp$/
        ),
      });
    });

    it('deletes the thumbnail it replaced once the row points at the new one', async () => {
      // The row holds a thumbnail from before kk9nv.5 (fixed keys at the base).
      vi.mocked(processor.processStillVariants).mockReturnValueOnce(
        pageVariants()
      );

      await service.processContentThumbnail(
        'content-1',
        'user-1',
        createTestImageFile('image/png', 'new.png')
      );

      expect(deleteKeys(testMockR2Service)).toEqual(
        folderFiles('user-1/content-thumbnails/content-1')
      );
      // Inline and AFTER the write ("Inline, same request"): a delete before
      // it would leave the row pointing at nothing if the write then failed.
      const writeOrder = vi.mocked(testMockDb.update).mock
        .invocationCallOrder[0];
      const firstDelete = vi.mocked(testMockR2Service.delete).mock
        .invocationCallOrder[0];
      expect(firstDelete).toBeGreaterThan(writeOrder ?? Infinity);
    });

    it("never deletes a poster frame the row points at — it is the transcoding pipeline's", async () => {
      mockDbQuery.content.findFirst.mockResolvedValueOnce({
        thumbnailUrl: 'https://test.r2.dev/user-1/media-thumbnails/m-1/lg.webp',
      });
      vi.mocked(processor.processStillVariants).mockReturnValueOnce(
        pageVariants()
      );

      await service.processContentThumbnail(
        'content-1',
        'user-1',
        createTestImageFile('image/png', 'new.png')
      );

      expect(testMockR2Service.delete).not.toHaveBeenCalled();
    });

    it('a re-upload writes a NEW folder and deletes the first — no orphan on replace [Codex-ko8ko]', async () => {
      // Each upload gets its own folder (Codex-kk9nv.5), so a replacement
      // never overwrites in place: no cache can serve the old bytes at the new
      // URL. The no-orphan half of Codex-ko8ko is kept by the inline delete of
      // the folder the row pointed at. The second upload is a WebP where the
      // first was a PNG: every size is re-encoded to WebP, so no key follows
      // the upload's type.
      const put = vi.mocked(testMockR2Service.put);
      vi.mocked(processor.processStillVariants).mockReturnValue(pageVariants());

      const first = await service.processContentThumbnail(
        'content-1',
        'user-1',
        createTestImageFile('image/png', 'first.png')
      );
      const firstKeys = putKeys(testMockR2Service);

      put.mockClear();
      vi.mocked(testMockR2Service.delete).mockClear();
      // The row now holds the first upload.
      mockDbQuery.content.findFirst.mockResolvedValueOnce({
        thumbnailUrl: first.url,
      });

      await service.processContentThumbnail(
        'content-1',
        'user-1',
        createTestImageFile('image/webp', 'second.webp')
      );
      const secondKeys = putKeys(testMockR2Service);

      expect(firstKeys).toHaveLength(4);
      expect(secondKeys.filter((key) => firstKeys.includes(key))).toEqual([]);
      expect(deleteKeys(testMockR2Service)).toEqual(firstKeys);
    });
  });

  describe('processCategoryCover', () => {
    it('uploads four sizes under the category-namespaced base key and returns it', async () => {
      const file = createTestImageFile('image/png', 'cover.png');

      vi.mocked(processor.processStillVariants).mockReturnValueOnce(
        pageVariants({ lg: [3, 4, 5] }, 1600, 1000)
      );

      const result = await service.processCategoryCover('cat-1', file);

      expect(processor.processStillVariants).toHaveBeenCalled();
      // Returns the new FOLDER's key (no variant suffix) for the caller to
      // persist, named for the picture's size (Codex-kk9nv.5).
      const folder = newFolderOf(testMockR2Service, 'categories/cat-1/cover', {
        width: 1600,
        height: 1000,
      });
      expect(result.coverImageKey).toBe(folder);
      // md variant drives the returned URL + size (matches the public list,
      // which serves `${coverImageKey}/md.webp`). md = Uint8Array([2]) → len 1.
      expect(result.url).toBe(`https://test.r2.dev/${folder}/md.webp`);
      expect(result.size).toBe(1);
      expect(result.mimeType).toBe('image/webp');
      for (const key of folderFiles(folder)) {
        expect(testMockR2Service.put).toHaveBeenCalledWith(
          key,
          expect.any(Uint8Array),
          {},
          {
            contentType: 'image/webp',
            cacheControl: 'public, max-age=31536000, immutable',
          }
        );
      }
    });

    it('does NOT write to the database — the caller persists the key via the service', async () => {
      const file = createTestImageFile('image/jpeg', 'cover.jpg');

      vi.mocked(processor.processStillVariants).mockReturnValueOnce(
        pageVariants()
      );

      await service.processCategoryCover('cat-1', file);

      // Category ownership (space) lives in CategoriesService, so this method
      // must stay DB-free — a stray write here would bypass space scoping.
      expect(testMockDb.update).not.toHaveBeenCalled();
    });

    it("each upload is a NEW folder — the caller's write deletes the old one", async () => {
      const put = vi.mocked(testMockR2Service.put);
      vi.mocked(processor.processStillVariants).mockReturnValue(pageVariants());

      await service.processCategoryCover(
        'cat-1',
        createTestImageFile('image/png', 'first.png')
      );
      const firstKeys = put.mock.calls.map((call) => call[0]);

      put.mockClear();

      await service.processCategoryCover(
        'cat-1',
        createTestImageFile('image/webp', 'second.webp')
      );
      const secondKeys = put.mock.calls.map((call) => call[0]);

      expect(firstKeys).toHaveLength(4);
      expect(secondKeys.filter((key) => firstKeys.includes(key))).toEqual([]);
      // Uploading deletes nothing: the row is the caller's, so only
      // `persistStillWithOrphanCleanup` knows which folder it replaced.
      expect(testMockR2Service.delete).not.toHaveBeenCalled();
    });
  });

  describe('processPageImage', () => {
    it('uploads four sizes, xl included, under the (pageId, imageId)-namespaced base key and returns it', async () => {
      const file = createTestImageFile('image/png', 'section.png');

      vi.mocked(processor.processStillVariants).mockReturnValueOnce(
        pageVariants(
          { md: [2, 2], lg: [3, 3, 3], xl: [4, 4, 4, 4] },
          3000,
          2000
        )
      );

      const result = await service.processPageImage('page-1', 'image-1', file);

      expect(processor.processStillVariants).toHaveBeenCalled();
      // Returns the BASE key (no variant suffix) — contract amendment A3's
      // `landing-pages/{pageId}/images/{imageId}` convention.
      expect(result.key).toBe('landing-pages/page-1/images/image-1');
      // md variant drives the returned URL + size, matching every other
      // still's "immediately-usable preview" convention. md = len 2.
      expect(result.url).toBe(
        'https://test.r2.dev/landing-pages/page-1/images/image-1/md.webp'
      );
      expect(result.size).toBe(2);
      expect(result.mimeType).toBe('image/webp');
      // The picture's own size, which the page stores on its ImageRef.
      expect(result.width).toBe(3000);
      expect(result.height).toBe(2000);
      expect(testMockR2Service.put).toHaveBeenCalledTimes(4);
      for (const size of ['sm', 'md', 'lg', 'xl']) {
        expect(testMockR2Service.put).toHaveBeenCalledWith(
          `landing-pages/page-1/images/image-1/${size}.webp`,
          expect.any(Uint8Array),
          {},
          {
            contentType: 'image/webp',
            cacheControl: 'public, max-age=31536000, immutable',
          }
        );
      }
    });

    it('does NOT write to the database — there is no column, only a jsonb reference the save path owns', async () => {
      const file = createTestImageFile('image/jpeg', 'section.jpg');

      vi.mocked(processor.processStillVariants).mockReturnValueOnce(
        pageVariants()
      );

      await service.processPageImage('page-1', 'image-1', file);

      expect(testMockDb.update).not.toHaveBeenCalled();
    });

    it('two uploads to the SAME page get DIFFERENT keys — nothing is ever overwritten', async () => {
      // `imageId` is caller-minted per upload, so this method has no
      // overwrite-in-place behavior at all. A test asserting the keys DIFFER
      // is what would catch an accidental switch to a deterministic
      // `(pageId)`-only key, which would silently start overwriting one
      // page's images at random.
      const put = vi.mocked(testMockR2Service.put);
      vi.mocked(processor.processStillVariants).mockReturnValue(pageVariants());

      await service.processPageImage(
        'page-1',
        'image-1',
        createTestImageFile('image/png', 'first.png')
      );
      const firstKeys = put.mock.calls.map((call) => call[0]);

      put.mockClear();

      await service.processPageImage(
        'page-1',
        'image-2',
        createTestImageFile('image/webp', 'second.webp')
      );
      const secondKeys = put.mock.calls.map((call) => call[0]);

      expect(firstKeys).toHaveLength(4);
      expect(secondKeys).toHaveLength(4);
      for (const key of secondKeys) {
        expect(firstKeys).not.toContain(key);
      }
    });

    describe('cleanup tracking (Codex-61zsk.10)', () => {
      const base = 'landing-pages/page-1/images/image-1';
      const objects = [
        `${base}/sm.webp`,
        `${base}/md.webp`,
        `${base}/lg.webp`,
        `${base}/xl.webp`,
      ];

      function trackedService(r2: Partial<Record<'put' | 'delete', unknown>>) {
        const orphans = { recordOrphanedFiles: vi.fn().mockResolvedValue([]) };
        const tracked = new ImageProcessingService({
          db: testMockDb,
          environment: 'test',
          r2Service: {
            put: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
            ...r2,
          } as unknown as R2Service,
          r2PublicUrlBase: 'https://test.r2.dev',
          orphanedFileService: orphans as unknown as OrphanedFileService,
        });
        return { tracked, orphans };
      }

      /** A put that fails for the md variant only (sm, md, lg, xl). */
      function putFailingOnMd() {
        return vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('R2 unavailable'))
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined);
      }

      beforeEach(() => {
        vi.mocked(processor.processStillVariants).mockReturnValue(
          pageVariants()
        );
      });

      it('queues its four OBJECTS at upload, xl included, so an image no page uses is reclaimed', async () => {
        const { tracked, orphans } = trackedService({});

        await tracked.processPageImage(
          'page-1',
          'image-1',
          createTestImageFile('image/png', 'section.png')
        );

        // The objects, never the base key: nothing lives at the base key, so
        // a sweep given it deletes nothing and marks the row done.
        expect(orphans.recordOrphanedFiles).toHaveBeenCalledWith(
          objects.map((r2Key) => ({
            r2Key,
            imageType: 'page_image',
            entityId: 'page-1',
            entityType: 'landing_page',
          }))
        );
      });

      it('removes a partial upload instead of leaving objects nothing can name', async () => {
        const remove = vi.fn().mockResolvedValue(undefined);
        const { tracked, orphans } = trackedService({
          put: putFailingOnMd(),
          delete: remove,
        });

        await expect(
          tracked.processPageImage(
            'page-1',
            'image-1',
            createTestImageFile('image/png', 'section.png')
          )
        ).rejects.toThrow(/Page image upload failed/);

        expect(remove.mock.calls.map((call) => call[0])).toEqual(objects);
        // Every object was removed, so there is nothing left to queue.
        expect(orphans.recordOrphanedFiles).not.toHaveBeenCalled();
      });

      it('queues whatever part of a failed upload it cannot remove', async () => {
        const remove = vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('R2 still unavailable'));
        const { tracked, orphans } = trackedService({
          put: putFailingOnMd(),
          delete: remove,
        });

        await expect(
          tracked.processPageImage(
            'page-1',
            'image-1',
            createTestImageFile('image/png', 'section.png')
          )
        ).rejects.toThrow(/Page image upload failed/);

        expect(orphans.recordOrphanedFiles).toHaveBeenCalledWith([
          {
            r2Key: `${base}/lg.webp`,
            imageType: 'page_image',
            entityId: 'page-1',
            entityType: 'landing_page',
          },
        ]);
      });
    });
  });

  describe('processUserAvatar', () => {
    it('should process raster avatar and upload four sizes', async () => {
      const file = createTestImageFile('image/jpeg', 'avatar.jpg');

      vi.mocked(processor.processStillVariants).mockReturnValueOnce(
        pageVariants({ sm: [1, 2], md: [3, 4], lg: [5, 6] }, 640, 640)
      );

      const result = await service.processUserAvatar('user-1', file);

      expect(processor.processStillVariants).toHaveBeenCalled();
      // sm, md, lg, xl in a new folder named for the source's size.
      const folder = newFolderOf(testMockR2Service, 'avatars/user-1', {
        width: 640,
        height: 640,
      });
      // Large variant used as primary
      expect(result.url).toBe(`https://test.r2.dev/${folder}/lg.webp`);
      expect(result.mimeType).toBe('image/webp'); // Stored as WebP after processing
      // The avatar it replaced (fixed keys from before kk9nv.5) is deleted.
      expect(deleteKeys(testMockR2Service)).toEqual(
        folderFiles('avatars/user-1')
      );
    });

    it('should update user avatarUrl with the new folder URL', async () => {
      const file = createTestImageFile('image/png', 'avatar.png');

      vi.mocked(processor.processStillVariants).mockReturnValueOnce(
        pageVariants({}, 640, 480)
      );

      await service.processUserAvatar('user-1', file);

      expect(testMockDb.update).toHaveBeenCalled();
      // The size travels in the URL (Codex-kk9nv.5).
      expect(setMockOf(testMockDb)).toHaveBeenCalledWith({
        avatarUrl: expect.stringMatching(
          /^https:\/\/test\.r2\.dev\/avatars\/user-1\/640x480-[0-9a-f]{8}\/lg\.webp$/
        ),
      });
    });

    it('writes only onto a live account: the WHERE excludes a deleted user (Codex-kk9nv.14)', async () => {
      // An upload still in flight when the account is deleted must not put
      // the photo back on the scrubbed row.
      const file = createTestImageFile('image/jpeg', 'avatar.jpg');
      vi.mocked(processor.processStillVariants).mockReturnValueOnce(
        pageVariants({}, 640, 640)
      );
      const where = vi.fn((_condition: unknown) =>
        whereResult([{ id: 'user-1' }])
      );
      vi.mocked(testMockDb.update).mockReturnValueOnce({
        set: vi.fn().mockReturnValue({ where }),
      } as never);

      await service.processUserAvatar('user-1', file);

      expect(
        sqlReferences(where.mock.calls[0]?.[0], schema.users.deletedAt)
      ).toBe(true);
    });

    it('discards the new folder when no live row matched', async () => {
      const file = createTestImageFile('image/jpeg', 'avatar.jpg');
      vi.mocked(processor.processStillVariants).mockReturnValueOnce(
        pageVariants({}, 640, 640)
      );
      vi.mocked(testMockDb.update).mockReturnValueOnce({
        set: vi.fn().mockReturnValue({ where: vi.fn(() => whereResult([])) }),
      } as never);

      await expect(service.processUserAvatar('user-1', file)).rejects.toThrow(
        'User not found'
      );
      const folder = newFolderOf(testMockR2Service, 'avatars/user-1', {
        width: 640,
        height: 640,
      });
      expect(deleteKeys(testMockR2Service)).toEqual(folderFiles(folder));
    });
  });

  describe('deleteContentThumbnail', () => {
    it('should delete all four sizes from R2', async () => {
      await service.deleteContentThumbnail('content-1', 'user-1');

      expect(testMockR2Service.delete).toHaveBeenCalledTimes(4);
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('/sm.webp')
      );
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('/md.webp')
      );
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('/lg.webp')
      );
      // xl too, or every delete leaks it (Codex-kk9nv.5).
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        'user-1/content-thumbnails/content-1/xl.webp'
      );
    });

    it('should clear thumbnailUrl in database before deleting the files', async () => {
      await service.deleteContentThumbnail('content-1', 'user-1');

      expect(testMockDb.update).toHaveBeenCalled();
      expect(setMockOf(testMockDb)).toHaveBeenCalledWith({
        thumbnailUrl: null,
      });
      // A failed clear must leave the row pointing at files that still exist.
      const clearOrder = vi.mocked(testMockDb.update).mock
        .invocationCallOrder[0];
      const firstDelete = vi.mocked(testMockR2Service.delete).mock
        .invocationCallOrder[0];
      expect(firstDelete).toBeGreaterThan(clearOrder ?? Infinity);
    });

    it('deletes the sized folder the URL names (Codex-kk9nv.5)', async () => {
      const folder = 'user-1/content-thumbnails/content-1/1200x800-0a1b2c3d';
      mockDbQuery.content.findFirst.mockResolvedValueOnce({
        thumbnailUrl: `https://test.r2.dev/${folder}/lg.webp`,
      });

      await service.deleteContentThumbnail('content-1', 'user-1');

      expect(deleteKeys(testMockR2Service)).toEqual(folderFiles(folder));
    });

    it('clears a poster-frame URL without deleting the poster', async () => {
      mockDbQuery.content.findFirst.mockResolvedValueOnce({
        thumbnailUrl: 'https://test.r2.dev/user-1/media-thumbnails/m-1/lg.webp',
      });

      await service.deleteContentThumbnail('content-1', 'user-1');

      expect(setMockOf(testMockDb)).toHaveBeenCalledWith({
        thumbnailUrl: null,
      });
      expect(testMockR2Service.delete).not.toHaveBeenCalled();
    });
  });

  describe('deleteUserAvatar', () => {
    it('should delete all four sizes from R2', async () => {
      await service.deleteUserAvatar('user-1');

      expect(testMockR2Service.delete).toHaveBeenCalledTimes(4);
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('avatars/user-1')
      );
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('sm.webp')
      );
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('lg.webp')
      );
      // xl too, or every delete leaks it (Codex-kk9nv.5).
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        'avatars/user-1/xl.webp'
      );
    });

    it('should clear avatarUrl in database', async () => {
      await service.deleteUserAvatar('user-1');

      expect(testMockDb.update).toHaveBeenCalled();
      expect(setMockOf(testMockDb)).toHaveBeenCalledWith({
        avatarUrl: null,
        updatedAt: expect.any(Date),
      });
    });

    it('should handle missing avatar gracefully', async () => {
      mockDbQuery.users.findFirst.mockResolvedValueOnce({ avatarUrl: null });

      await service.deleteUserAvatar('user-1');

      expect(testMockR2Service.delete).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    describe('File Size Validation', () => {
      it('should reject files larger than 5MB', async () => {
        // Create a file larger than 5MB (5 * 1024 * 1024 bytes)
        const largeBuffer = new ArrayBuffer(5 * 1024 * 1024 + 1);
        const largeFile = new File([new Uint8Array(largeBuffer)], 'large.jpg', {
          type: 'image/jpeg',
        });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', largeFile)
        ).rejects.toThrow(/exceeds maximum.*5MB/i);
      });

      it('should accept files exactly at 5MB limit', async () => {
        // Create file exactly at limit with valid JPEG magic bytes
        const jpegSignature = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
        const padding = new Uint8Array(5 * 1024 * 1024 - jpegSignature.length);
        const combinedBuffer = new Uint8Array(5 * 1024 * 1024);
        combinedBuffer.set(jpegSignature, 0);
        combinedBuffer.set(padding, jpegSignature.length);

        const file = new File(
          [new Uint8Array(combinedBuffer)],
          'exactly5mb.jpg',
          {
            type: 'image/jpeg',
          }
        );

        vi.mocked(processor.processStillVariants).mockReturnValueOnce(
          pageVariants()
        );

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).resolves.not.toThrow();
      });
    });

    describe('MIME Type Validation', () => {
      it('should reject unsupported MIME types', async () => {
        const file = new File([new Uint8Array(100)], 'test.bmp', {
          type: 'image/bmp',
        });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(/unsupported.*mime/i);
      });

      it('should reject non-image MIME types', async () => {
        const file = new File([new Uint8Array(100)], 'test.pdf', {
          type: 'application/pdf',
        });

        await expect(service.processUserAvatar('user-1', file)).rejects.toThrow(
          /unsupported.*mime/i
        );
      });
    });

    describe('Magic Byte Validation', () => {
      it('should reject files with invalid PNG magic bytes', async () => {
        const invalidPngBuffer = new Uint8Array([
          0x00,
          0x00,
          0x00,
          0x00, // Invalid signature
        ]).buffer;
        const file = new File([new Uint8Array(invalidPngBuffer)], 'fake.png', {
          type: 'image/png',
        });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(/invalid.*signature|magic byte/i);
      });

      it('should reject files with invalid JPEG magic bytes', async () => {
        const invalidJpegBuffer = new Uint8Array([
          0x00,
          0x00,
          0x00,
          0x00, // Invalid signature (needs at least 4 bytes)
          ...new Array(100).fill(0), // Padding
        ]).buffer;
        const file = new File([new Uint8Array(invalidJpegBuffer)], 'fake.jpg', {
          type: 'image/jpeg',
        });

        await expect(service.processUserAvatar('user-1', file)).rejects.toThrow(
          /invalid.*signature|magic byte|content does not match/i
        );
      });

      it('should reject files with MIME type mismatch (JPEG claiming to be PNG)', async () => {
        const jpegBuffer = new Uint8Array([
          0xff,
          0xd8,
          0xff,
          0xe0, // JPEG magic bytes
          ...new Array(100).fill(0), // Padding
        ]).buffer;
        const file = new File([new Uint8Array(jpegBuffer)], 'fake.png', {
          type: 'image/png', // Claims PNG but has JPEG magic bytes
        });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(
          /invalid.*signature|magic byte|content does not match/i
        );
      });
    });

    describe('R2 Upload Failures', () => {
      it('should propagate R2Service.put errors', async () => {
        const file = createTestImageFile('image/jpeg', 'test.jpg');

        vi.mocked(processor.processStillVariants).mockReturnValueOnce(
          pageVariants()
        );

        testMockR2Service.put = vi
          .fn()
          .mockRejectedValue(new Error('R2 service unavailable'));

        // With Promise.allSettled, we get a cleaner error about upload failure
        // rather than the raw R2 error, and cleanup is guaranteed
        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(/upload failed.*variant.*failed/i);
      });

      it('should handle R2Service.delete errors gracefully (log warning, clear DB)', async () => {
        testMockR2Service.delete = vi
          .fn()
          .mockRejectedValue(new Error('R2 delete failed'));

        // Should NOT throw - resilient delete pattern
        await expect(
          service.deleteContentThumbnail('content-1', 'user-1')
        ).resolves.toBeUndefined();

        // Database should still be updated (cleared) despite R2 failure
        expect(testMockDb.update).toHaveBeenCalled();
      });
    });

    describe('Database Failures', () => {
      it('should propagate database update errors', async () => {
        const file = createTestImageFile('image/png', 'test.png');

        vi.mocked(processor.processStillVariants).mockReturnValueOnce(
          pageVariants()
        );

        // Create a new mock DB with error
        const errorMockDb = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockRejectedValue(new Error('Database error')),
            }),
          }),
        } as unknown as Database;

        // Create a new service instance with the error mock
        const errorService = new ImageProcessingService({
          db: { ...errorMockDb, query: mockDbQuery } as unknown as Database,
          environment: 'test',
          r2Service: testMockR2Service,
          r2PublicUrlBase: 'https://test.r2.dev',
        });

        await expect(
          errorService.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(/Database error/i);
      });

      it('should propagate database query errors in delete operations', async () => {
        mockDbQuery.users.findFirst.mockRejectedValue(
          new Error('Database query failed')
        );

        await expect(service.deleteUserAvatar('user-1')).rejects.toThrow(
          /Database query failed/i
        );
      });
    });

    describe('Image Processing Failures', () => {
      it('should handle corrupt image data that processor cannot process', async () => {
        const file = createTestImageFile('image/jpeg', 'corrupt.jpg');

        vi.mocked(processor.processStillVariants).mockImplementationOnce(() => {
          throw new Error('Failed to decode image');
        });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(/Failed to decode image/i);
      });
    });

    /**
     * These two cases have flipped twice. They first asserted "cleanup all
     * variants" while the keys were deterministic, which deleted the image the
     * row still addressed (Codex-r85jo.2), so they were inverted to "delete
     * nothing". Since Codex-kk9nv.5 every upload writes a NEW folder nothing
     * references yet, so cleaning up that folder is correct again, and the
     * previous image, in another folder, is never touched.
     *
     * The property version of this — a Map-backed bucket proving every prior
     * key stays READABLE — lives in
     * `__tests__/regression/r85jo2-partial-upload-preserves-prior-image.test.ts`.
     */
    describe('Partial Upload Failures', () => {
      it("should delete the new folder's files when one R2 upload fails", async () => {
        const file = createTestImageFile('image/jpeg', 'test.jpg');

        vi.mocked(processor.processStillVariants).mockReturnValueOnce(
          pageVariants()
        );

        // The second upload fails; the other three succeed
        testMockR2Service.put = vi
          .fn()
          .mockResolvedValueOnce(undefined) // sm succeeds
          .mockRejectedValueOnce(new Error('R2 timeout')) // md fails
          .mockResolvedValueOnce(undefined) // lg succeeds
          .mockResolvedValueOnce(undefined); // xl succeeds

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(/upload failed.*1 of 4 variant.*\(md\)/i);

        // The three files that landed are in a folder nothing references, so
        // all four keys are deleted; the row was never written, so it still
        // points at the previous image, which lives elsewhere.
        const folder = newFolderOf(
          testMockR2Service,
          'user-1/content-thumbnails/content-1',
          { width: 2400, height: 1600 }
        );
        expect(deleteKeys(testMockR2Service)).toEqual(folderFiles(folder));
        expect(testMockDb.update).not.toHaveBeenCalled();
      });

      it("should delete the new folder's files when two R2 uploads fail", async () => {
        const file = createTestImageFile('image/png', 'test.png');

        vi.mocked(processor.processStillVariants).mockReturnValueOnce(
          pageVariants()
        );

        // The second and third uploads fail; the other two succeed
        testMockR2Service.put = vi
          .fn()
          .mockResolvedValueOnce(undefined) // sm succeeds
          .mockRejectedValueOnce(new Error('R2 timeout')) // md fails
          .mockRejectedValueOnce(new Error('R2 quota exceeded')) // lg fails
          .mockResolvedValueOnce(undefined); // xl succeeds

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(/upload failed.*2 of 4 variant.*\(md, lg\)/i);

        const folder = newFolderOf(
          testMockR2Service,
          'user-1/content-thumbnails/content-1',
          { width: 2400, height: 1600 }
        );
        expect(deleteKeys(testMockR2Service)).toEqual(folderFiles(folder));
      });

      it('should report an R2 put failure as a 500, not a 400', async () => {
        const file = createTestImageFile('image/jpeg', 'test.jpg');

        vi.mocked(processor.processStillVariants).mockReturnValueOnce(
          pageVariants()
        );

        testMockR2Service.put = vi
          .fn()
          .mockRejectedValue(new Error('R2 quota exceeded'));

        // By `statusCode`, not class name — names minify in the worker bundle.
        // A ValidationError here tells the creator their IMAGE was bad and
        // keeps the R2 outage out of 5xx-rate alerting.
        const error = await service
          .processContentThumbnail('content-1', 'user-1', file)
          .then(() => null)
          .catch((e: unknown) => e as { statusCode?: number });

        expect(error?.statusCode).toBe(500);
      });
    });

    describe('Orphan Recording on Cleanup Failure', () => {
      /**
       * Both cases below fail the row write after the puts landed, so the new
       * folder is unreferenced and its cleanup runs. Since Codex-kk9nv.5 that
       * holds for a replacement too: the new folder is never the one the row
       * addresses. Covered with a Map-backed bucket in
       * `__tests__/regression/r85jo2-partial-upload-preserves-prior-image.test.ts`.
       */
      it('should record orphans when R2 cleanup fails after DB error', async () => {
        const file = createTestImageFile('image/png', 'test.png');
        mockDbQuery.content.findFirst.mockResolvedValue({
          thumbnailUrl: null,
        });

        vi.mocked(processor.processStillVariants).mockReturnValueOnce(
          pageVariants()
        );

        // Create mock orphaned file service
        const mockOrphanedFileService = {
          recordOrphanedFiles: vi
            .fn()
            .mockResolvedValue(['orphan-1', 'orphan-2']),
        };

        // Create a mock DB that fails on update
        const errorMockDb = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi
                .fn()
                .mockRejectedValue(new Error('Database connection lost')),
            }),
          }),
        } as unknown as Database;

        // R2 put succeeds, but delete fails during cleanup
        const mockR2Service = {
          put: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockRejectedValue(new Error('R2 cleanup failed')),
        } as unknown as R2Service;

        const serviceWithOrphanTracking = new ImageProcessingService({
          db: { ...errorMockDb, query: mockDbQuery } as unknown as Database,
          environment: 'test',
          r2Service: mockR2Service,
          r2PublicUrlBase: 'https://test.r2.dev',
          orphanedFileService:
            mockOrphanedFileService as unknown as OrphanedFileService,
        });

        await expect(
          serviceWithOrphanTracking.processContentThumbnail(
            'content-1',
            'user-1',
            file
          )
        ).rejects.toThrow(/Database connection lost/i);

        // Should have recorded orphaned files
        expect(
          mockOrphanedFileService.recordOrphanedFiles
        ).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              imageType: 'content_thumbnail',
              entityId: 'content-1',
              entityType: 'content',
            }),
          ])
        );
      });

      it('should log warning when orphanedFileService not provided and cleanup fails', async () => {
        const file = createTestImageFile('image/jpeg', 'test.jpg');
        mockDbQuery.content.findFirst.mockResolvedValue({
          thumbnailUrl: null,
        });

        vi.mocked(processor.processStillVariants).mockReturnValueOnce(
          pageVariants()
        );

        // Create a mock DB that fails on update
        const errorMockDb = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockRejectedValue(new Error('Database error')),
            }),
          }),
        } as unknown as Database;

        // R2 put succeeds, but delete fails during cleanup
        const mockR2Service = {
          put: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockRejectedValue(new Error('R2 cleanup failed')),
        } as unknown as R2Service;

        // Service WITHOUT orphanedFileService
        const serviceWithoutOrphanTracking = new ImageProcessingService({
          db: { ...errorMockDb, query: mockDbQuery } as unknown as Database,
          environment: 'test',
          r2Service: mockR2Service,
          r2PublicUrlBase: 'https://test.r2.dev',
          // No orphanedFileService provided
        });

        await expect(
          serviceWithoutOrphanTracking.processContentThumbnail(
            'content-1',
            'user-1',
            file
          )
        ).rejects.toThrow(/Database error/i);

        // Warning would be logged via obs.warn, but we can verify the operation completed
        // The key assertion is that it doesn't throw a different error or hang
      });
    });
  });

  describe('Edge Cases', () => {
    describe('Empty and Minimal Files', () => {
      it('should reject empty files', async () => {
        const emptyFile = new File([], 'empty.jpg', { type: 'image/jpeg' });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', emptyFile)
        ).rejects.toThrow(/empty|size|invalid/i);
      });

      it('should reject files smaller than minimum magic byte length', async () => {
        const tinyBuffer = new Uint8Array([0xff]).buffer; // Only 1 byte
        const tinyFile = new File([new Uint8Array(tinyBuffer)], 'tiny.jpg', {
          type: 'image/jpeg',
        });

        await expect(
          service.processUserAvatar('user-1', tinyFile)
        ).rejects.toThrow(/invalid.*signature|too small/i);
      });
    });

    describe('Unusual Filenames', () => {
      it('should handle files with special characters in names', async () => {
        const file = createTestImageFile('image/png', 'my file (copy) [2].png');

        vi.mocked(processor.processStillVariants).mockReturnValueOnce(
          pageVariants()
        );

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).resolves.not.toThrow();
      });

      it('should handle files with Unicode characters in names', async () => {
        const file = createTestImageFile('image/jpeg', '图片-测试.jpg');

        vi.mocked(processor.processStillVariants).mockReturnValueOnce(
          pageVariants()
        );

        await expect(
          service.processUserAvatar('user-1', file)
        ).resolves.not.toThrow();
      });
    });

    describe('GIF and WebP Format Handling', () => {
      it('should process GIF files correctly', async () => {
        // GIF89a magic bytes
        const gifBuffer = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
          .buffer;
        const file = new File([new Uint8Array(gifBuffer)], 'animated.gif', {
          type: 'image/gif',
        });

        vi.mocked(processor.processStillVariants).mockReturnValueOnce(
          pageVariants()
        );

        const result = await service.processContentThumbnail(
          'content-1',
          'user-1',
          file
        );

        expect(result.mimeType).toBe('image/webp');
        expect(testMockR2Service.put).toHaveBeenCalledTimes(4);
        // Every object is WebP: none keeps the GIF's own type (Codex-kk9nv.5).
        for (const call of vi.mocked(testMockR2Service.put).mock.calls) {
          expect(call[3]).toEqual({
            contentType: 'image/webp',
            cacheControl: 'public, max-age=31536000, immutable',
          });
        }
      });

      it('should process WebP files correctly', async () => {
        // WebP magic bytes (RIFF____WEBP)
        const webpBuffer = new Uint8Array([
          0x52,
          0x49,
          0x46,
          0x46, // RIFF
          0x00,
          0x00,
          0x00,
          0x00, // Size placeholder
          0x57,
          0x45,
          0x42,
          0x50, // WEBP
        ]).buffer;
        const file = new File([new Uint8Array(webpBuffer)], 'image.webp', {
          type: 'image/webp',
        });

        vi.mocked(processor.processStillVariants).mockReturnValueOnce(
          pageVariants()
        );

        const result = await service.processUserAvatar('user-1', file);

        expect(result.mimeType).toBe('image/webp');
        expect(processor.processStillVariants).toHaveBeenCalled();
      });
    });
  });
});
