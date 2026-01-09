import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database, NewEmailTemplate } from '../../types';
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
    repo = new TemplateRepository(mockDb as unknown as Database);
  });

  describe('findTemplate', () => {
    it('returns organization template when found and organizationId provided', async () => {
      const orgTemplate = {
        id: 'org-template-1',
        name: 'welcome',
        scope: 'organization',
        organizationId: 'org-123',
      };
      // findMany returns array of candidates
      mockDb._mocks.findMany.mockResolvedValueOnce([orgTemplate]);

      const result = await repo.findTemplate('welcome', 'org-123', null);

      expect(result).toEqual(orgTemplate);
      expect(mockDb._mocks.findMany).toHaveBeenCalledTimes(1);
    });

    it('falls back to creator template when org template not found', async () => {
      const creatorTemplate = {
        id: 'creator-template-1',
        name: 'newsletter',
        scope: 'creator',
        creatorId: 'creator-456',
      };
      // Single query returns only creator template (no org match)
      mockDb._mocks.findMany.mockResolvedValueOnce([creatorTemplate]);

      const result = await repo.findTemplate(
        'newsletter',
        'org-123',
        'creator-456'
      );

      expect(result).toEqual(creatorTemplate);
      expect(mockDb._mocks.findMany).toHaveBeenCalledTimes(1);
    });

    it('falls back to global template when org and creator not found', async () => {
      const globalTemplate = {
        id: 'global-template-1',
        name: 'password-reset',
        scope: 'global',
      };
      // Single query returns only global template
      mockDb._mocks.findMany.mockResolvedValueOnce([globalTemplate]);

      const result = await repo.findTemplate(
        'password-reset',
        'org-123',
        'creator-456'
      );

      expect(result).toEqual(globalTemplate);
      expect(mockDb._mocks.findMany).toHaveBeenCalledTimes(1);
    });

    it('returns null when no template found at any scope', async () => {
      // Empty array - no templates found
      mockDb._mocks.findMany.mockResolvedValueOnce([]);

      const result = await repo.findTemplate(
        'nonexistent',
        'org-123',
        'creator-456'
      );

      expect(result).toBeNull();
    });

    it('prioritizes organization over creator template', async () => {
      const orgTemplate = { id: 'ot', name: 'test', scope: 'organization' };
      const creatorTemplate = { id: 'ct', name: 'test', scope: 'creator' };
      // Both returned, org should be selected
      mockDb._mocks.findMany.mockResolvedValueOnce([
        creatorTemplate,
        orgTemplate,
      ]);

      const result = await repo.findTemplate('test', 'org-123', 'creator-456');

      expect(result).toEqual(orgTemplate);
    });

    it('prioritizes creator over global template', async () => {
      const creatorTemplate = { id: 'ct', name: 'test', scope: 'creator' };
      const globalTemplate = { id: 'gt', name: 'test', scope: 'global' };
      // Both returned, creator should be selected
      mockDb._mocks.findMany.mockResolvedValueOnce([
        globalTemplate,
        creatorTemplate,
      ]);

      const result = await repo.findTemplate('test', null, 'creator-456');

      expect(result).toEqual(creatorTemplate);
    });

    it('returns global when no org or creator provided', async () => {
      const globalTemplate = { id: 'gt', name: 'test', scope: 'global' };
      mockDb._mocks.findMany.mockResolvedValueOnce([globalTemplate]);

      const result = await repo.findTemplate('test', null, null);

      expect(result).toEqual(globalTemplate);
      expect(mockDb._mocks.findMany).toHaveBeenCalledTimes(1);
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
      } as NewEmailTemplate);

      expect(result).toEqual(newTemplate);
    });
  });
});
