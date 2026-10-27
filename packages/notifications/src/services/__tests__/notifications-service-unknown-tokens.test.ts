/**
 * A template token the allowlist does not name renders as nothing, and is
 * now WARNED, once per render, with every such token
 * (review of Codex-bnxhw).
 *
 * A stale template row (one a migration has not rewritten yet) or a
 * customised copy used to ship a blank: `<a href="">`, "expires in  days".
 * `renderTemplate` returned the tokens in `unknownTokens`, and no caller read
 * them.
 *
 * So did an ALLOWED token the data lacks (`missingTokens`): a sender that
 * stops passing `acceptUrl` while a row still links its button to it
 * (Codex-2hxff.83). A send now warns those too, except the tokens whose copy
 * reads well without them (a decline with no reason).
 *
 * Mocks mirror notifications-service.test.ts: a stub database, provider and
 * platform-settings.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database, EmailProvider } from '../../types';
import { NotificationsService } from '../notifications-service';

vi.mock('../notification-preferences-service', () => ({
  NotificationPreferencesService: class {
    hasOptedOut = vi.fn().mockResolvedValue(false);
  },
}));

vi.mock('@codex/platform-settings', async () => {
  const { vi } = await import('vitest');
  return {
    BrandingSettingsService: vi.fn().mockImplementation(() => ({
      get: vi
        .fn()
        .mockResolvedValue({ logoUrl: null, primaryColorHex: '#ff0000' }),
    })),
    ContactSettingsService: vi.fn().mockImplementation(() => ({
      get: vi.fn().mockResolvedValue({ supportEmail: 'help@test.com' }),
    })),
  };
});

const findMany = vi.fn();
const mockDbRaw = {
  query: { emailTemplates: { findFirst: vi.fn(), findMany } },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi
    .fn()
    .mockResolvedValue([{ id: 'audit-log-1', status: 'pending' }]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([{ id: 'audit-log-1' }]),
  transaction: vi.fn(),
};
const mockDb = mockDbRaw as unknown as Database;

const provider = {
  name: 'mock',
  send: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
} as unknown as EmailProvider;

const WARNING =
  'Email template uses tokens it does not allow; they render as nothing';

function template(overrides: Record<string, string>) {
  return {
    id: 'template-1',
    name: 'test-template',
    subject: 'Hello {{platformName}}',
    htmlBody: '<p>Welcome to {{platformName}}</p>',
    textBody: 'Welcome to {{platformName}}',
    scope: 'global',
    ...overrides,
  };
}

describe('NotificationsService: unknown template tokens', () => {
  let service: NotificationsService;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NotificationsService({
      db: mockDb,
      environment: 'test',
      emailProvider: provider,
    });
    warn = vi.fn();
    (service as unknown as { obs: { warn: typeof warn } }).obs.warn = warn;
  });

  it('a send warns ONCE, listing each unknown token once, across subject and bodies', async () => {
    findMany.mockResolvedValue([
      template({
        subject: 'Hi {{staleToken}}',
        htmlBody: '<a href="{{staleToken}}">Go</a> {{otherToken}}',
        textBody: 'Go: {{staleToken}}',
      }),
    ]);

    await service.sendEmail({
      to: 'user@example.com',
      templateName: 'test-template',
      data: {},
    });

    const calls = warn.mock.calls.filter(([message]) => message === WARNING);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({
      templateName: 'test-template',
      organizationId: null,
      unknownTokens: ['staleToken', 'otherToken'],
    });
  });

  it('a preview warns too', async () => {
    findMany.mockResolvedValue([
      template({ htmlBody: '<p>{{staleToken}}</p>' }),
    ]);

    await service.previewTemplate('test-template', {});

    expect(warn).toHaveBeenCalledWith(WARNING, {
      templateName: 'test-template',
      organizationId: null,
      unknownTokens: ['staleToken'],
    });
  });

  it('a template whose tokens are all allowed warns nothing', async () => {
    findMany.mockResolvedValue([template({})]);

    await service.sendEmail({
      to: 'user@example.com',
      templateName: 'test-template',
      data: {},
    });

    expect(warn).not.toHaveBeenCalledWith(WARNING, expect.anything());
    expect(warn).not.toHaveBeenCalledWith(MISSING, expect.anything());
  });
});

const MISSING =
  'Email data lacks tokens its template uses; they render as nothing';

/** The invitation row production has today: its button is `{{acceptUrl}}`. */
const invitationRow = template({
  name: 'org-member-invitation',
  subject: "You've been invited to {{orgName}}",
  htmlBody:
    '<p>{{inviterName}} has invited you to join {{orgName}} as a {{roleName}}.</p><a href="{{acceptUrl}}">Accept Invitation</a><p>This invitation expires in {{expiryDays}} days.</p>',
  textBody:
    'Accept your invitation: {{acceptUrl}}\n\nThis invitation expires in {{expiryDays}} days.',
});

const invitationData = {
  inviterName: 'Sam',
  orgName: 'Studio Alpha',
  roleName: 'creator',
  roleLabel: 'a creator',
  orgUrl: 'https://studio-alpha.revelations.studio/studio',
};

describe('NotificationsService: allowed tokens the data lacks', () => {
  let service: NotificationsService;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NotificationsService({
      db: mockDb,
      environment: 'test',
      emailProvider: provider,
    });
    warn = vi.fn();
    (service as unknown as { obs: { warn: typeof warn } }).obs.warn = warn;
  });

  it('a send warns ONCE, listing each blank token once, across subject and bodies', async () => {
    findMany.mockResolvedValue([invitationRow]);

    await service.sendEmail({
      to: 'user@example.com',
      templateName: 'org-member-invitation',
      data: invitationData,
    });

    const calls = warn.mock.calls.filter(([message]) => message === MISSING);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({
      templateName: 'org-member-invitation',
      organizationId: null,
      missingTokens: ['acceptUrl', 'expiryDays'],
    });
    // Allowed, so not the unknown-token warning.
    expect(warn).not.toHaveBeenCalledWith(WARNING, expect.anything());
  });

  it("the sender's full payload fills that row: no warning", async () => {
    findMany.mockResolvedValue([invitationRow]);

    await service.sendEmail({
      to: 'user@example.com',
      templateName: 'org-member-invitation',
      data: {
        ...invitationData,
        acceptUrl: invitationData.orgUrl,
        expiryDays: '7',
      },
    });

    expect(warn).not.toHaveBeenCalledWith(MISSING, expect.anything());
  });

  it('a token whose copy reads well without it is not warned', async () => {
    findMany.mockResolvedValue([
      template({
        name: 'refund-processed',
        htmlBody: '<p>Hi {{userName}}, {{refundAmount}} refunded.</p>',
        textBody: 'Hi {{userName}}. {{accessNote}}',
      }),
    ]);

    await service.sendEmail({
      to: 'user@example.com',
      templateName: 'refund-processed',
      data: {
        userName: 'Ana',
        contentTitle: 'Course',
        refundAmount: '£5.00',
        originalAmount: '£10.00',
        refundDate: '27 October 2026',
      },
    });

    expect(warn).not.toHaveBeenCalledWith(MISSING, expect.anything());
  });

  it("a preview does not warn: it renders an editor's sample data", async () => {
    findMany.mockResolvedValue([invitationRow]);

    await service.previewTemplate('org-member-invitation', {});

    expect(warn).not.toHaveBeenCalledWith(MISSING, expect.anything());
  });
});
