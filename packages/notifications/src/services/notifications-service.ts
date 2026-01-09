import {
  BrandingSettingsService,
  ContactSettingsService,
} from '@codex/platform-settings';
import { BaseService } from '@codex/service-errors';
import { z } from '@codex/validation';
import { TemplateNotFoundError, ValidationError } from '../errors';
import type {
  EmailMessage,
  EmailProvider,
  SendResult,
} from '../providers/types';
import { TemplateRepository } from '../repositories/template-repository';
import { getAllowedTokens, renderTemplate } from '../templates/renderer';
import type { NotificationsServiceConfig, TemplateData } from '../types';
import { validateTemplateData } from '../validation/template-validation';
import { BrandingCache } from './branding-cache';

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
  private readonly brandingCache: BrandingCache;

  constructor(config: NotificationsServiceConfig) {
    super(config);
    this.templateRepository = new TemplateRepository(this.db);
    this.brandingCache = new BrandingCache(); // 5 minute TTL by default
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
   * Uses cache to avoid repeated service instantiation.
   */
  private async resolveBrandTokens(
    organizationId: string
  ): Promise<Record<string, string>> {
    // Check cache first
    const cached = this.brandingCache.get(organizationId);
    if (cached) {
      return cached;
    }

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

      const tokens = {
        platformName: this.brandDefaults.platformName,
        primaryColor,
        secondaryColor: this.brandDefaults.secondaryColor,
        logoUrl,
        supportEmail,
      };

      // Cache the result
      this.brandingCache.set(organizationId, tokens);
      return tokens;
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

    // Defensive email validation (API layer also validates, but services should be defensive)
    const emailSchema = z.string().email();
    const validEmail = emailSchema.safeParse(to);
    if (!validEmail.success) {
      this.obs.warn('Invalid email address provided', {
        email: to,
        templateName,
      });
      throw new ValidationError('Invalid email address', {
        email: to,
        errors: validEmail.error.issues,
      });
    }

    // 1. Resolve Template
    const template = await this.templateRepository.findTemplate(
      templateName,
      organizationId,
      creatorId
    );

    if (!template) {
      throw new TemplateNotFoundError(templateName);
    }

    // 2. Validate template data
    const validatedData = validateTemplateData(template.name, data);

    // 3. Resolve Branding (if organization context exists)
    const brandTokens = organizationId
      ? await this.resolveBrandTokens(organizationId)
      : { ...this.brandDefaults };

    // 4. Render Template
    const mergedData = { ...brandTokens, ...validatedData };
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

    // 5. Send Email with retry logic
    return this.sendWithRetry(
      {
        to,
        toName,
        subject: subjectResult.content,
        html: htmlResult.content,
        text: textResult.content,
      },
      { templateName, organizationId: organizationId || 'none' }
    );
  }

  /**
   * Send email with exponential backoff retry.
   *
   * Retry strategy:
   * - Max 2 retries (3 total attempts)
   * - Backoff delays: 100ms, 200ms (Workers-compatible short delays)
   * - Throws on final failure for consistent error handling
   */
  private async sendWithRetry(
    message: EmailMessage,
    context: { templateName: string; organizationId: string }
  ): Promise<SendResult> {
    const maxRetries = 2;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Apply backoff delay on retries (100ms * attempt)
        if (attempt > 0) {
          const backoffMs = 100 * attempt;
          this.obs.info('Retrying email send', {
            ...context,
            attempt: attempt + 1,
            backoffMs,
          });
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }

        const result = await this.emailProvider.send(message, this.defaultFrom);

        // Track success metric
        this.obs.info('Email sent successfully', {
          ...context,
          success: true,
          attempt: attempt + 1,
          retried: attempt > 0,
        });

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.obs.warn(`Email send attempt ${attempt + 1} failed`, {
          ...context,
          errorType: lastError.name,
          errorMessage: lastError.message,
        });
      }
    }

    // Track final failure metric
    this.obs.error('Failed to send email after all retries', {
      ...context,
      success: false,
      totalAttempts: maxRetries + 1,
      errorMessage: lastError?.message || 'Unknown error',
    });

    // Throw for consistent error handling (callers can catch if needed)
    throw lastError || new Error('Failed to send email after retries');
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
