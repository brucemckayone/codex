import {
  BrandingSettingsService,
  ContactSettingsService,
} from '@codex/platform-settings';
import { BaseService } from '@codex/service-errors';
import { TemplateNotFoundError } from '../errors';
import type {
  EmailMessage,
  EmailProvider,
  SendResult,
} from '../providers/types';
import { TemplateRepository } from '../repositories/template-repository';
import { getAllowedTokens, renderTemplate } from '../templates/renderer';
import type { NotificationsServiceConfig, TemplateData } from '../types';

interface SendEmailParams {
  to: string;
  toName?: string;
  templateName: string;
  data: TemplateData;
  organizationId?: string | null;
  creatorId?: string | null;
  locale?: string;
  replyTo?: string;
}

/** Default brand tokens when no org-specific branding is available */
const DEFAULT_BRAND_TOKENS = {
  platformName: 'Codex',
  primaryColor: '#000000',
  secondaryColor: '#ffffff',
  supportEmail: 'support@codex.io',
  logoUrl: '',
} as const;

export class NotificationsService extends BaseService {
  private readonly emailProvider: EmailProvider;
  private readonly templateRepository: TemplateRepository;
  private readonly defaultFrom: { email: string; name?: string };

  constructor(config: NotificationsServiceConfig) {
    super(config);
    this.templateRepository = new TemplateRepository(this.db);

    if (!config.emailProvider) {
      throw new Error('EmailProvider is required');
    }
    this.emailProvider = config.emailProvider;

    this.defaultFrom = {
      email: config.fromEmail || 'noreply@codex.io',
      name: config.fromName || 'Codex',
    };
  }

  /**
   * Resolve brand tokens for an organization.
   * Instantiates settings services per-request since they're org-scoped.
   */
  private async resolveBrandTokens(
    organizationId: string
  ): Promise<Record<string, string>> {
    try {
      // Services require organizationId in constructor (org-scoped design)
      const brandingService = new BrandingSettingsService({
        db: this.db,
        environment: this.environment,
        organizationId,
      });
      const contactService = new ContactSettingsService({
        db: this.db,
        environment: this.environment,
        organizationId,
      });

      const [branding, contact] = await Promise.all([
        brandingService.get(),
        contactService.get(),
      ]);

      const primaryColor: string =
        branding.primaryColorHex ?? DEFAULT_BRAND_TOKENS.primaryColor;
      const logoUrl: string = branding.logoUrl ?? DEFAULT_BRAND_TOKENS.logoUrl;
      const supportEmail: string =
        contact.supportEmail ?? DEFAULT_BRAND_TOKENS.supportEmail;

      return {
        platformName: DEFAULT_BRAND_TOKENS.platformName,
        primaryColor,
        secondaryColor: DEFAULT_BRAND_TOKENS.secondaryColor,
        logoUrl,
        supportEmail,
      };
    } catch (e) {
      this.obs.warn('Failed to load branding', { organizationId, error: e });
      return { ...DEFAULT_BRAND_TOKENS };
    }
  }

  /**
   * Send an email using a template
   */
  async sendEmail(params: SendEmailParams): Promise<SendResult> {
    const { to, toName, templateName, data, organizationId, creatorId } =
      params;

    // 1. Resolve Template
    const template = await this.templateRepository.findTemplate(
      templateName,
      organizationId,
      creatorId
    );

    if (!template) {
      throw new TemplateNotFoundError(templateName);
    }

    // 2. Resolve Branding (if organization context exists)
    const brandTokens = organizationId
      ? await this.resolveBrandTokens(organizationId)
      : { ...DEFAULT_BRAND_TOKENS };

    // 3. Render Template
    const mergedData = { ...brandTokens, ...data };
    const allowedTokens = getAllowedTokens(template.name);

    const subjectResult = renderTemplate({
      template: template.subject,
      data: mergedData,
      allowedTokens,
      escapeValues: false,
    });

    const htmlResult = renderTemplate({
      template: template.htmlBody,
      data: mergedData,
      allowedTokens,
      escapeValues: true,
    });

    const textResult = renderTemplate({
      template: template.textBody,
      data: mergedData,
      allowedTokens,
      escapeValues: false,
    });

    // 4. Send Email
    const message: EmailMessage = {
      to,
      toName,
      subject: subjectResult.content,
      html: htmlResult.content,
      text: textResult.content,
    };

    try {
      return await this.emailProvider.send(message, this.defaultFrom);
    } catch (_error) {
      // Immediate retry (Workers can terminate during setTimeout delays)
      this.obs.info('Retrying email send', { templateName });
      try {
        return await this.emailProvider.send(message, this.defaultFrom);
      } catch (retryError) {
        this.obs.error('Failed to send email after retry', {
          error: retryError,
        });
        return {
          success: false,
          error:
            retryError instanceof Error
              ? retryError.message
              : 'Failed to send email after retry',
        };
      }
    }
  }

  /**
   * Preview a rendered template without sending
   */
  async previewTemplate(
    templateName: string,
    data: TemplateData,
    organizationId?: string,
    creatorId?: string
  ) {
    const template = await this.templateRepository.findTemplate(
      templateName,
      organizationId,
      creatorId
    );

    if (!template) {
      throw new TemplateNotFoundError(templateName);
    }

    // Resolve branding
    const brandTokens = organizationId
      ? await this.resolveBrandTokens(organizationId)
      : { ...DEFAULT_BRAND_TOKENS };

    const mergedData = { ...brandTokens, ...data };
    const allowedTokens = getAllowedTokens(template.name);

    return {
      subject: renderTemplate({
        template: template.subject,
        data: mergedData,
        allowedTokens,
        escapeValues: false,
      }).content,
      html: renderTemplate({
        template: template.htmlBody,
        data: mergedData,
        allowedTokens,
        escapeValues: true,
      }).content,
      text: renderTemplate({
        template: template.textBody,
        data: mergedData,
        allowedTokens,
        escapeValues: false,
      }).content,
    };
  }
}
