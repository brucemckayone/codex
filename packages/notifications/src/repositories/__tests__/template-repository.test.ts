import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateRepository } from '../template-repository';

// Mock database with query builder
const createMockDb = () => {
  const mockFindFirst = vi.fn();
  const mockFindMany = vi.fn();
  const mockInsert = vi.fn();

  return {
    query: {
      emailTemplates: {
        findFirst: mockFindFirst,
        findMany: mockFindMany,
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: mockInsert,
      }),
    }),
    _mocks: {
      findFirst: mockFindFirst,
      findMany: mockFindMany,
      insert: mockInsert,
    },
  };
};

describe('TemplateRepository', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let repo: TemplateRepository;

  beforeEach(() => {
    mockDb = createMockDb();
    repo = new TemplateRepository(mockDb as any);
  });

  describe('findTemplate', () => {
    it('returns organization template when found and organizationId provided', async () => {
      const orgTemplate = {
        id: 'org-template-1',
        name: 'welcome',
        scope: 'organization',
        organizationId: 'org-123',
      };
      mockDb._mocks.findFirst.mockResolvedValueOnce(orgTemplate);

      const result = await repo.findTemplate('welcome', 'org-123', null);

      expect(result).toEqual(orgTemplate);
      expect(mockDb._mocks.findFirst).toHaveBeenCalledTimes(1);
    });

    it('falls back to creator template when org template not found', async () => {
      const creatorTemplate = {
        id: 'creator-template-1',
        name: 'newsletter',
        scope: 'creator',
        creatorId: 'creator-456',
      };
      // First call (org) returns null, second call (creator) returns template
      mockDb._mocks.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(creatorTemplate);

      const result = await repo.findTemplate(
        'newsletter',
        'org-123',
        'creator-456'
      );

      expect(result).toEqual(creatorTemplate);
      expect(mockDb._mocks.findFirst).toHaveBeenCalledTimes(2);
    });

    it('falls back to global template when org and creator not found', async () => {
      const globalTemplate = {
        id: 'global-template-1',
        name: 'password-reset',
        scope: 'global',
      };
      // Org and creator return null, global returns template
      mockDb._mocks.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(globalTemplate);

      const result = await repo.findTemplate(
        'password-reset',
        'org-123',
        'creator-456'
      );

      expect(result).toEqual(globalTemplate);
      expect(mockDb._mocks.findFirst).toHaveBeenCalledTimes(3);
    });

    it('returns null when no template found at any scope', async () => {
      mockDb._mocks.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await repo.findTemplate(
        'nonexistent',
        'org-123',
        'creator-456'
      );

      expect(result).toBeNull();
    });

    it('skips org lookup when organizationId is null', async () => {
      const creatorTemplate = { id: 'ct', name: 'test', scope: 'creator' };
      mockDb._mocks.findFirst.mockResolvedValueOnce(creatorTemplate);

      const result = await repo.findTemplate('test', null, 'creator-456');

      expect(result).toEqual(creatorTemplate);
      // Only 1 call (creator), not 2 (org + creator)
      expect(mockDb._mocks.findFirst).toHaveBeenCalledTimes(1);
    });

    it('skips creator lookup when creatorId is null', async () => {
      const globalTemplate = { id: 'gt', name: 'test', scope: 'global' };
      mockDb._mocks.findFirst
        .mockResolvedValueOnce(null) // org
        .mockResolvedValueOnce(globalTemplate); // global

      const result = await repo.findTemplate('test', 'org-123', null);

      expect(result).toEqual(globalTemplate);
      // 2 calls (org + global), not 3 (org + creator + global)
      expect(mockDb._mocks.findFirst).toHaveBeenCalledTimes(2);
    });

    it('looks up only global when both org and creator are null', async () => {
      const globalTemplate = { id: 'gt', name: 'test', scope: 'global' };
      mockDb._mocks.findFirst.mockResolvedValueOnce(globalTemplate);

      const result = await repo.findTemplate('test', null, null);

      expect(result).toEqual(globalTemplate);
      expect(mockDb._mocks.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('getTemplateById', () => {
    it('returns template when found', async () => {
      const template = { id: 'template-123', name: 'test' };
      mockDb._mocks.findFirst.mockResolvedValueOnce(template);

      const result = await repo.getTemplateById('template-123');

      expect(result).toEqual(template);
    });

    it('returns null when not found', async () => {
      mockDb._mocks.findFirst.mockResolvedValueOnce(undefined);

      const result = await repo.getTemplateById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('createTemplate', () => {
    it('creates and returns new template', async () => {
      const newTemplate = {
        id: 'new-123',
        name: 'new-template',
        scope: 'global',
        subject: 'Test',
        htmlBody: '<p>Test</p>',
        textBody: 'Test',
      };
      mockDb._mocks.insert.mockResolvedValueOnce([newTemplate]);

      const result = await repo.createTemplate({
        name: 'new-template',
        scope: 'global',
        subject: 'Test',
        htmlBody: '<p>Test</p>',
        textBody: 'Test',
        status: 'active',
      } as any);

      expect(result).toEqual(newTemplate);
    });
  });
});
