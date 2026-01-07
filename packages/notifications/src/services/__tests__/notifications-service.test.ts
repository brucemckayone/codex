import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, SendResult } from '../../providers/types';
import type { Database, EmailProvider } from '../../types';
import { NotificationsService } from '../notifications-service';

// Mock dependencies
const mockDb = {
  query: {
    emailTemplates: {
      findFirst: vi.fn(),
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

// Mock settings service (since we can't easily mock the class constructor in test without more setup,
// we might need to rely on the fact that the service instantiates them.
// Ideally we'd inject them, but the service creates them.
// For now, we will mock the database responses that settings service uses, OR just mock the module.)

vi.mock('@codex/platform-settings', async () => {
  const { vi } = await import('vitest');
  const MockBrandingService = vi.fn(() => ({
    getSettings: vi.fn().mockResolvedValue({
      platformName: 'Test Platform',
      primaryColor: '#ff0000',
    }),
  }));

  const MockContactService = vi.fn(() => ({
    getSettings: vi.fn().mockResolvedValue({
      supportEmail: 'help@test.com',
    }),
  }));

  return {
    BrandingSettingsService: MockBrandingService,
    ContactSettingsService: MockContactService,
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
    (mockDb.query.emailTemplates.findFirst as any).mockResolvedValue({
      id: 'template-1',
      name: 'test-template',
      subject: 'Hello {{platformName}}',
      htmlBody: '<p>Welcome to {{platformName}}</p>',
      textBody: 'Welcome to {{platformName}}',
      scope: 'global',
    });

    // Mock send result
    (mockEmailProvider.send as any).mockResolvedValue({
      success: true,
      messageId: 'msg-123',
    });

    const result = await service.sendEmail({
      to: 'user@example.com',
      templateName: 'test-template',
      data: { userName: 'Alice' },
    });

    expect(result.success).toBe(true);
    expect(mockDb.query.emailTemplates.findFirst).toHaveBeenCalled();
    expect(mockEmailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Hello Test Platform', // Branding should be applied
        html: expect.stringContaining('Welcome to Test Platform'),
      }),
      expect.anything()
    );
  });

  it('throws error if template not found', async () => {
    (mockDb.query.emailTemplates.findFirst as any).mockResolvedValue(null);

    await expect(
      service.sendEmail({
        to: 'user@example.com',
        templateName: 'missing-template',
        data: {},
      })
    ).rejects.toThrow("Template 'missing-template' not found");
  });

  it('falls back to defaults if branding fails', async () => {
    // Redeclare mock to force failure
    const { BrandingSettingsService } = await import(
      '@codex/platform-settings'
    );
    (BrandingSettingsService as any).mockImplementationOnce(() => ({
      getSettings: vi.fn().mockRejectedValue(new Error('DB Error')),
    }));

    // Re-init service with failing mock
    const failService = new NotificationsService({
      db: mockDb,
      environment: 'test',
      emailProvider: mockEmailProvider,
    });

    (mockDb.query.emailTemplates.findFirst as any).mockResolvedValue({
      name: 'test',
      subject: '{{platformName}}',
      htmlBody: 'Body',
      textBody: 'Body',
    });
    (mockEmailProvider.send as any).mockResolvedValue({ success: true });

    await failService.sendEmail({
      to: 'test@example.com',
      templateName: 'test',
      data: {},
      organizationId: 'org-1', // Trigger branding logic
    });

    // Should use default branding
    expect(mockEmailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Codex', // Default platform name
      }),
      expect.anything()
    );
  });
});
