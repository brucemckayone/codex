import type { Database } from '@codex/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrphanedFileService } from '../orphaned-file-service';

/**
 * Mock database factory for OrphanedFileService tests
 *
 * Creates a mock that simulates Drizzle ORM's chainable API:
 * - insert().values().returning() for inserts
 * - select().from().where().orderBy().limit() for queries
 * - update().set().where().returning() for updates
 *
 * Note: We maintain separate returning mocks for insert vs update chains
 * because they need independent mock configurations in tests.
 */
function createMockDb() {
  // Insert chain: insert().values().returning()
  const mockInsertReturning = vi.fn();
  const mockValues = vi
    .fn()
    .mockReturnValue({ returning: mockInsertReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  // Update chain: update().set().where().returning()
  // Note: where() can return with or without returning() depending on usage
  const mockUpdateReturning = vi.fn();
  const mockUpdateWhere = vi
    .fn()
    .mockReturnValue({ returning: mockUpdateReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

  // Select chain: select().from().where().orderBy().limit()
  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  return {
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
    // Expose internals for assertions
    _mocks: {
      // Insert chain
      insertReturning: mockInsertReturning,
      values: mockValues,
      // Update chain
      updateReturning: mockUpdateReturning,
      updateWhere: mockUpdateWhere,
      set: mockSet,
      // Select chain
      limit: mockLimit,
      orderBy: mockOrderBy,
      selectWhere: mockSelectWhere,
      from: mockFrom,
    },
  };
}

describe('OrphanedFileService', () => {
  let service: OrphanedFileService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    service = new OrphanedFileService({
      db: mockDb as unknown as Database,
      environment: 'test',
    });
  });

  describe('recordOrphanedFile()', () => {
    it('should create orphan record with all fields', async () => {
      const mockRecord = {
        id: 'orphan-123',
        r2Key: 'user-1/content-thumbnails/content-1/sm.webp',
        imageType: 'content_thumbnail',
        originalEntityId: 'content-1',
        originalEntityType: 'content',
        status: 'pending',
        orphanedAt: new Date(),
      };
      mockDb._mocks.insertReturning.mockResolvedValueOnce([mockRecord]);

      const result = await service.recordOrphanedFile({
        r2Key: 'user-1/content-thumbnails/content-1/sm.webp',
        imageType: 'content_thumbnail',
        entityId: 'content-1',
        entityType: 'content',
        fileSizeBytes: 1024,
      });

      expect(result).toBe('orphan-123');
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb._mocks.values).toHaveBeenCalledWith(
        expect.objectContaining({
          r2Key: 'user-1/content-thumbnails/content-1/sm.webp',
          imageType: 'content_thumbnail',
          originalEntityId: 'content-1',
          originalEntityType: 'content',
          fileSizeBytes: 1024,
          status: 'pending',
        })
      );
    });

    it('should throw if insert returns empty array', async () => {
      mockDb._mocks.insertReturning.mockResolvedValueOnce([]);

      await expect(
        service.recordOrphanedFile({
          r2Key: 'some/key.webp',
          imageType: 'avatar',
        })
      ).rejects.toThrow('Failed to insert orphaned file record');
    });
  });

  describe('recordOrphanedFiles()', () => {
    it('should batch insert multiple records', async () => {
      const mockRecords = [
        { id: 'orphan-1', r2Key: 'key1.webp' },
        { id: 'orphan-2', r2Key: 'key2.webp' },
        { id: 'orphan-3', r2Key: 'key3.webp' },
      ];
      mockDb._mocks.insertReturning.mockResolvedValueOnce(mockRecords);

      const inputs = [
        { r2Key: 'key1.webp', imageType: 'content_thumbnail' as const },
        { r2Key: 'key2.webp', imageType: 'content_thumbnail' as const },
        { r2Key: 'key3.webp', imageType: 'content_thumbnail' as const },
      ];

      const result = await service.recordOrphanedFiles(inputs);

      expect(result).toEqual(['orphan-1', 'orphan-2', 'orphan-3']);
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(mockDb._mocks.values).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ r2Key: 'key1.webp', status: 'pending' }),
          expect.objectContaining({ r2Key: 'key2.webp', status: 'pending' }),
          expect.objectContaining({ r2Key: 'key3.webp', status: 'pending' }),
        ])
      );
    });

    it('should return empty array for empty input', async () => {
      const result = await service.recordOrphanedFiles([]);

      expect(result).toEqual([]);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe('getPendingOrphans()', () => {
    it('should return pending orphans ordered by orphanedAt', async () => {
      const mockOrphans = [
        {
          id: 'orphan-1',
          r2Key: 'old.webp',
          status: 'pending',
          cleanupAttempts: 0,
          orphanedAt: new Date('2024-01-01'),
        },
        {
          id: 'orphan-2',
          r2Key: 'newer.webp',
          status: 'pending',
          cleanupAttempts: 1,
          orphanedAt: new Date('2024-01-02'),
        },
      ];
      mockDb._mocks.limit.mockResolvedValueOnce(mockOrphans);

      const result = await service.getPendingOrphans();

      expect(result).toEqual(mockOrphans);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb._mocks.orderBy).toHaveBeenCalled();
    });

    it('should respect limit parameter', async () => {
      mockDb._mocks.limit.mockResolvedValueOnce([]);

      await service.getPendingOrphans(10);

      expect(mockDb._mocks.limit).toHaveBeenCalledWith(10);
    });

    it('should use default batch size of 50', async () => {
      mockDb._mocks.limit.mockResolvedValueOnce([]);

      await service.getPendingOrphans();

      expect(mockDb._mocks.limit).toHaveBeenCalledWith(50);
    });
  });

  describe('markDeleted()', () => {
    it('should update status to deleted and set lastAttemptAt', async () => {
      mockDb._mocks.updateWhere.mockResolvedValueOnce([{ id: 'orphan-1' }]);

      await service.markDeleted('orphan-1');

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb._mocks.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'deleted',
          lastAttemptAt: expect.any(Date),
        })
      );
    });
  });

  describe('recordFailedAttempt()', () => {
    it('should increment cleanupAttempts and record error', async () => {
      // First update returns record with attempts < MAX
      mockDb._mocks.updateReturning.mockResolvedValueOnce([
        { id: 'orphan-1', cleanupAttempts: 1 },
      ]);

      await service.recordFailedAttempt('orphan-1', 'R2 connection timeout');

      expect(mockDb.update).toHaveBeenCalledTimes(1);
      expect(mockDb._mocks.set).toHaveBeenCalledWith(
        expect.objectContaining({
          lastAttemptAt: expect.any(Date),
          errorMessage: 'R2 connection timeout',
        })
      );
    });

    it('should mark status as failed at MAX_CLEANUP_ATTEMPTS (3)', async () => {
      // This test needs a fresh service with a custom mock that can handle
      // two different update chains: one with .returning(), one without.
      // Create a mock that returns the right chain based on call count.
      let updateCallCount = 0;

      const firstReturning = vi
        .fn()
        .mockResolvedValueOnce([{ id: 'orphan-1', cleanupAttempts: 3 }]);
      const firstWhere = vi.fn().mockReturnValue({ returning: firstReturning });
      const firstSet = vi.fn().mockReturnValue({ where: firstWhere });

      // Second update doesn't need returning (markDeleted-style)
      const secondWhere = vi.fn().mockResolvedValueOnce([{ id: 'orphan-1' }]);
      const secondSet = vi.fn().mockReturnValue({ where: secondWhere });

      const multiUpdateDb = {
        update: vi.fn().mockImplementation(() => {
          updateCallCount++;
          if (updateCallCount === 1) {
            return { set: firstSet };
          }
          return { set: secondSet };
        }),
        insert: vi.fn(),
        select: vi.fn(),
      } as unknown as Database;

      const multiUpdateService = new OrphanedFileService({
        db: multiUpdateDb,
        environment: 'test',
      });

      await multiUpdateService.recordFailedAttempt('orphan-1', 'Final failure');

      // Should be called twice: once for increment, once for marking failed
      expect(multiUpdateDb.update).toHaveBeenCalledTimes(2);
      // First call should set cleanupAttempts increment and error
      expect(firstSet).toHaveBeenCalledWith(
        expect.objectContaining({ errorMessage: 'Final failure' })
      );
      // Second call should set status to 'failed'
      expect(secondSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' })
      );
    });

    it('should not mark as failed when attempts below MAX', async () => {
      mockDb._mocks.updateReturning.mockResolvedValueOnce([
        { id: 'orphan-1', cleanupAttempts: 2 },
      ]);

      await service.recordFailedAttempt('orphan-1', 'Temporary failure');

      // Only one update call (no second call to mark as failed)
      expect(mockDb.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStats()', () => {
    it('should return correct counts for each status', async () => {
      mockDb._mocks.from.mockReturnValueOnce(
        Promise.resolve([
          {
            pending: '5',
            deleted: '10',
            failed: '2',
            retained: '1',
          },
        ])
      );

      const stats = await service.getStats();

      expect(stats).toEqual({
        processed: 12, // deleted + failed
        deleted: 10,
        failed: 2,
        remaining: 5,
      });
    });

    it('should return zeros when no records exist', async () => {
      mockDb._mocks.from.mockReturnValueOnce(Promise.resolve([]));

      const stats = await service.getStats();

      expect(stats).toEqual({
        processed: 0,
        deleted: 0,
        failed: 0,
        remaining: 0,
      });
    });
  });

  describe('markRetained()', () => {
    it('should update status to retained with reason', async () => {
      mockDb._mocks.updateWhere.mockResolvedValueOnce([{ id: 'orphan-1' }]);

      await service.markRetained('orphan-1', 'Keep for audit');

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb._mocks.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'retained',
          errorMessage: 'Keep for audit',
        })
      );
    });

    it('should use default reason when not provided', async () => {
      mockDb._mocks.updateWhere.mockResolvedValueOnce([{ id: 'orphan-1' }]);

      await service.markRetained('orphan-1');

      expect(mockDb._mocks.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'retained',
          errorMessage: 'Marked for retention',
        })
      );
    });
  });

  describe('getFailedOrphans()', () => {
    it('should return failed orphans ordered by orphanedAt', async () => {
      const mockFailedOrphans = [
        {
          id: 'orphan-1',
          r2Key: 'old-failed.webp',
          status: 'failed',
          cleanupAttempts: 3,
          errorMessage: 'R2 unavailable',
        },
      ];
      mockDb._mocks.limit.mockResolvedValueOnce(mockFailedOrphans);

      const result = await service.getFailedOrphans();

      expect(result).toEqual(mockFailedOrphans);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should respect custom limit', async () => {
      mockDb._mocks.limit.mockResolvedValueOnce([]);

      await service.getFailedOrphans(25);

      expect(mockDb._mocks.limit).toHaveBeenCalledWith(25);
    });

    it('should use default limit of 100', async () => {
      mockDb._mocks.limit.mockResolvedValueOnce([]);

      await service.getFailedOrphans();

      expect(mockDb._mocks.limit).toHaveBeenCalledWith(100);
    });
  });
});
