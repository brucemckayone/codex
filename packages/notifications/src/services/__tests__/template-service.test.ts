import { InternalServiceError } from '@codex/service-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateAccessDeniedError, TemplateNotFoundError } from '../../errors';
import type { Database } from '../../types';
import { TemplateService } from '../template-service';

// Mock DB
const mockDbRaw = {
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
  returning: vi
    .fn()
    .mockResolvedValue([{ id: '1', name: 'template', scope: 'global' }]),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  transaction: vi.fn().mockImplementation((cb) => cb(mockDb)),
};

const mockDb = mockDbRaw as unknown as Database;

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
      // The paginatedQuery helper runs db.select({ total: count() }).from(...).where(...)
      // Since we mock the chain, we need to make the last call return the value
      const mockWhere = vi.fn().mockResolvedValue([{ total: 10 }]);
      mockDbRaw.from.mockReturnValue({
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

  // The creator-template membership reads (Codex-tgkgb) run inside the
  // `handleError` try: a failed read is wrapped, a refusal stays a typed 403.
  describe('creator template membership reads', () => {
    const ORG_ID = '00000000-0000-4000-8000-000000000001';
    const creatorTemplate = {
      name: 'creator-hello',
      subject: 'Hello',
      htmlBody: '<p>Hello there</p>',
      textBody: 'Hello there',
      status: 'draft' as const,
      organizationId: ORG_ID,
    };
    const membershipRead = () =>
      mockDb.query.organizationMemberships.findFirst as ReturnType<
        typeof vi.fn
      >;
    const templateRead = () =>
      mockDb.query.emailTemplates.findFirst as ReturnType<typeof vi.fn>;
    const obsOf = (s: TemplateService) =>
      (s as unknown as { obs: { error: (...args: unknown[]) => void } }).obs;

    it('create: a failed membership read is wrapped as an internal error, not passed on raw', async () => {
      const dbDown = new Error('connection terminated');
      membershipRead().mockRejectedValueOnce(dbDown);

      const attempt = service.createCreatorTemplate(
        'creator_1',
        creatorTemplate
      );

      await expect(attempt).rejects.toBeInstanceOf(InternalServiceError);
      await expect(attempt).rejects.not.toBe(dbDown);
    });

    it('create: a creator who is not an active member is refused with the typed 403, unlogged', async () => {
      membershipRead().mockResolvedValueOnce(undefined);
      const logged = vi.spyOn(obsOf(service), 'error');

      await expect(
        service.createCreatorTemplate('creator_1', creatorTemplate)
      ).rejects.toBeInstanceOf(TemplateAccessDeniedError);
      expect(logged).not.toHaveBeenCalled();
    });

    it('update: a failed membership read is wrapped as an internal error, not passed on raw', async () => {
      const dbDown = new Error('connection terminated');
      templateRead().mockResolvedValueOnce({ organizationId: ORG_ID });
      membershipRead().mockRejectedValueOnce(dbDown);

      const attempt = service.updateCreatorTemplate('creator_1', 'tpl_1', {
        subject: 'Hello again',
      });

      await expect(attempt).rejects.toBeInstanceOf(InternalServiceError);
      await expect(attempt).rejects.not.toBe(dbDown);
    });

    it('update: a creator who is no longer an active member is refused with the typed 403', async () => {
      templateRead().mockResolvedValueOnce({ organizationId: ORG_ID });
      membershipRead().mockResolvedValueOnce(undefined);

      await expect(
        service.updateCreatorTemplate('creator_1', 'tpl_1', {
          subject: 'Hello again',
        })
      ).rejects.toBeInstanceOf(TemplateAccessDeniedError);
    });

    it('update: a template the creator does not own is still the typed 404', async () => {
      templateRead().mockResolvedValueOnce(undefined);

      await expect(
        service.updateCreatorTemplate('creator_1', 'tpl_1', {
          subject: 'Hello again',
        })
      ).rejects.toBeInstanceOf(TemplateNotFoundError);
    });
  });
});
