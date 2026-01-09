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

export class NotificationsService extends BaseService {
  private readonly emailProvider: EmailProvider;
  private readonly templateRepository: TemplateRepository;
  private readonly defaultFrom: { email: string; name?: string };
  private readonly brandDefaults: Required<
    NonNullable<NotificationsServiceConfig['defaults']>
  >;

  constructor(config: NotificationsServiceConfig) {
    super(config);
    this.templateRepository = new TemplateRepository(this.db);
    this.brandDefaults = {
      platformName: config.defaults?.platformName || 'Codex',
      primaryColor: config.defaults?.primaryColor || '#000000',
      secondaryColor: config.defaults?.secondaryColor || '#ffffff',
      supportEmail: config.defaults?.supportEmail || 'support@codex.io',
      logoUrl: config.defaults?.logoUrl || '',
    };

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
        branding.primaryColorHex ?? this.brandDefaults.primaryColor;
      const logoUrl: string = branding.logoUrl ?? this.brandDefaults.logoUrl;
      const supportEmail: string =
        contact.supportEmail ?? this.brandDefaults.supportEmail;

      return {
        platformName: this.brandDefaults.platformName,
        primaryColor,
        secondaryColor: this.brandDefaults.secondaryColor,
        logoUrl,
        supportEmail,
      };
    } catch (error) {
      this.obs.warn('Failed to load branding', { organizationId, error });
      return { ...this.brandDefaults };
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
      : { ...this.brandDefaults };

    // 3. Render Template
    const mergedData = { ...brandTokens, ...data };
    const allowedTokens = getAllowedTokens(template.name);

    const subjectResult = renderTemplate({
      template: template.subject,
      data: mergedData,
      allowedTokens,
      escapeValues: false,
      stripTags: true, // Security: Strip HTML from subject lines
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
    } catch (error) {
      // Immediate retry (Workers can terminate during setTimeout delays)
      this.obs.info('Retrying email send', {
        templateName,
        organizationId: organizationId || 'none',
        errorType: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      try {
        return await this.emailProvider.send(message, this.defaultFrom);
      } catch (retryError) {
        this.obs.error('Failed to send email after retry', {
          templateName,
          organizationId: organizationId || 'none',
          errorType: retryError instanceof Error ? retryError.name : 'Unknown',
          errorMessage:
            retryError instanceof Error
              ? retryError.message
              : String(retryError),
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
      : { ...this.brandDefaults };

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
