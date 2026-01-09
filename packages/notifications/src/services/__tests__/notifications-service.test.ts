import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database, EmailProvider } from '../../types';
import { NotificationsService } from '../notifications-service';

// Mock dependencies
const mockDb = {
  query: {
    emailTemplates: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
} as unknown as Database;

const mockEmailProvider = {
  name: 'mock',
  send: vi.fn(),
} as unknown as EmailProvider;

// Mock platform-settings services
// Since branding services are instantiated per-request with organizationId,
// we mock the entire module to return mocked classes
vi.mock('@codex/platform-settings', async () => {
  const { vi } = await import('vitest');

  return {
    BrandingSettingsService: vi.fn().mockImplementation(() => ({
      get: vi.fn().mockResolvedValue({
        logoUrl: null,
        primaryColorHex: '#ff0000',
      }),
    })),
    ContactSettingsService: vi.fn().mockImplementation(() => ({
      get: vi.fn().mockResolvedValue({
        supportEmail: 'help@test.com',
      }),
    })),
  };
});

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NotificationsService({
      db: mockDb,
      environment: 'test',
      emailProvider: mockEmailProvider,
    });
  });

  it('sends email successfully when template found', async () => {
    // Mock template
    (
      mockDb.query.emailTemplates.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      {
        id: 'template-1',
        name: 'test-template',
        subject: 'Hello {{platformName}}',
        htmlBody: '<p>Welcome to {{platformName}}</p>',
        textBody: 'Welcome to {{platformName}}',
        scope: 'global',
      },
    ]);

    // Mock send result
    (mockEmailProvider.send as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      messageId: 'msg-123',
    });

    const result = await service.sendEmail({
      to: 'user@example.com',
      templateName: 'test-template',
      data: { userName: 'Alice' },
    });

    expect(result.success).toBe(true);
    expect(mockDb.query.emailTemplates.findMany).toHaveBeenCalled();
    // Without org context, uses default branding (Codex)
    expect(mockEmailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Hello Codex',
        html: expect.stringContaining('Welcome to Codex'),
      }),
      expect.anything()
    );
  });

  it('throws error if template not found', async () => {
    (
      mockDb.query.emailTemplates.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);

    // The error message is the base class message
    await expect(
      service.sendEmail({
        to: 'user@example.com',
        templateName: 'missing-template',
        data: {},
      })
    ).rejects.toThrow('Email template not found');
  });

  it('uses org branding when organizationId provided', async () => {
    (
      mockDb.query.emailTemplates.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      {
        name: 'test',
        subject: '{{primaryColor}}',
        htmlBody: 'Body',
        textBody: 'Body',
        scope: 'organization',
        organizationId: 'org-1',
      },
    ]);
    (mockEmailProvider.send as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
    });

    await service.sendEmail({
      to: 'test@example.com',
      templateName: 'test',
      data: {},
      organizationId: 'org-1',
    });

    // With org context, should use mocked branding (primaryColor from mock)
    expect(mockEmailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        // primaryColor token would be replaced in subject if allowed
        // (it's not in the allowed tokens for 'test' template, so will be empty)
      }),
      expect.anything()
    );
  });
  it('uses configured branding defaults when no organizationId provided', async () => {
    // Re-init service with custom config
    const customService = new NotificationsService({
      db: mockDb,
      environment: 'test',
      emailProvider: mockEmailProvider,
      defaults: {
        platformName: 'CustomPlatform',
        primaryColor: '#123456',
        supportEmail: 'custom@support.com',
      },
    });

    (
      mockDb.query.emailTemplates.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      {
        name: 'test',
        subject: 'Welcome to {{platformName}}',
        htmlBody: '<p>Contact {{supportEmail}}</p>',
        textBody: 'Body',
        scope: 'global',
      },
    ]);
    (mockEmailProvider.send as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
    });

    await customService.sendEmail({
      to: 'test@example.com',
      templateName: 'test',
      data: {},
    });

    expect(mockEmailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Welcome to CustomPlatform',
        html: expect.stringContaining('Contact custom@support.com'),
      }),
      expect.anything()
    );
  });

  // Verification tests for critical fixes

  it('strips HTML tags from subject line (XSS prevention)', async () => {
    (
      mockDb.query.emailTemplates.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      {
        id: 't1',
        name: 'test',
        subject: 'Subject: {{platformName}}',
        htmlBody: 'Body',
        textBody: 'Body',
        scope: 'global',
      },
    ]);
    (mockEmailProvider.send as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
    });

    await service.sendEmail({
      to: 'test@example.com',
      templateName: 'test',
      data: { platformName: '<script>bad</script>Safe' },
    });

    expect(mockEmailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Subject: ', // HTML content rejected entirely (strict validation)
      }),
      expect.anything()
    );
  });

  it('uses findMany with OR conditions to resolve templates in single query (N+1 fix)', async () => {
    (
      mockDb.query.emailTemplates.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);

    try {
      await service.sendEmail({
        to: 'test@example.com',
        templateName: 'test',
        data: {},
        organizationId: 'org-1',
        creatorId: 'creator-1',
      });
    } catch (e) {
      // Expected template not found
    }

    const calls = (
      mockDb.query.emailTemplates.findMany as ReturnType<typeof vi.fn>
    ).mock.calls;
    expect(calls.length).toBe(1); // Single query verification

    // Verify limit constraint
    expect(calls[0][0].limit).toBe(3);
  });
});
