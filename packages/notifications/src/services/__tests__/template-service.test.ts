import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../types';
import { TemplateService } from '../template-service';

// Mock DB
const mockDb = {
  query: {
    emailTemplates: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    organizationMemberships: {
      findFirst: vi.fn(),
    },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
} as unknown as Database;

describe('TemplateService API Format', () => {
  let service: TemplateService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TemplateService({
      db: mockDb,
      environment: 'test',
    });
  });

  describe('listGlobalTemplates', () => {
    it('returns paginated response structure', async () => {
      // Mock findMany and count
      (
        mockDb.query.emailTemplates.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue([
        { id: '1', name: 't1' },
        { id: '2', name: 't2' },
      ]);

      // Mock count query
      // The service uses db.select({ count: ... }).from(...).where(...)
      // Since we mock the chain, we need to make the last call return the value
      const mockWhere = vi.fn().mockResolvedValue([{ count: 10 }]);
      (mockDb.from as ReturnType<typeof vi.fn>).mockReturnValue({
        where: mockWhere,
      });

      const result = await service.listGlobalTemplates({ page: 1, limit: 10 });

      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('pagination');
      expect(result.items).toHaveLength(2);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 10,
        totalPages: 1,
      });

      // Verify no "data" wrapper
      expect(result).not.toHaveProperty('data');
    });
  });

  describe('getGlobalTemplate', () => {
    it('returns unwrapped template object', async () => {
      const mockTemplate = { id: '1', name: 't1', scope: 'global' };
      (
        mockDb.query.emailTemplates.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockTemplate);

      const result = await service.getGlobalTemplate('1');

      expect(result).toEqual(mockTemplate);
      expect(result).not.toHaveProperty('data');
    });
  });
});
