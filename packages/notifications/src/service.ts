// See /design/features/notifications/ttd-dphase-1.md
import type { EmailPayload, EmailResult, INotificationService } from './types';

// Mocking dependencies for placeholder scaffolding
const emailAdapter = {
  send: async (payload: any): Promise<EmailResult> => {
    console.log('Mock email sent:', payload);
    return { success: true, emailId: 'mock-email-id' };
  }
};
const logger = {
  info: (message: string, ...args: any[]) => console.log(`[INFO] ${message}`, ...args),
  warn: (message: string, ...args: any[]) => console.warn(`[WARN] ${message}`, ...args),
  error: (message: string, ...args: any[]) => console.error(`[ERROR] ${message}`, ...args),
}
const loadTemplate = async (name: string) => ({ subject: `Subject for ${name}`, html: `<p>HTML for ${name}</p>`, text: `Text for ${name}`});
const renderTemplate = async (template: any, data: any) => template;


export class NotificationService implements INotificationService {
  async sendEmail(payload: EmailPayload): Promise<EmailResult> {
    const { template, recipient, data, replyTo } = payload;

    try {
      // 1. Load and render template
      const templateContent = await loadTemplate(template);
      const { subject, html, text } = await renderTemplate(templateContent, data);

      // 2. Send via adapter (with retry)
      const result = await this.sendWithRetry({
        to: recipient,
        subject,
        html,
        text,
        replyTo
      });

      // 3. Log success
      logger.info('Email sent successfully', {
        template,
        recipient: this.maskEmail(recipient),
        emailId: result.emailId
      });

      return result;
    } catch (error: any) {
      // Log error with context
      logger.error('Email send failed', {
        template,
        recipient: this.maskEmail(recipient),
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  private async sendWithRetry(payload: any): Promise<EmailResult> {
    try {
      return await emailAdapter.send(payload);
    } catch (error: any) {
      logger.warn('Email send failed, retrying...', { error: error.message });

      // Retry once
      try {
        return await emailAdapter.send(payload);
      } catch (retryError: any) {
        throw new Error(`Email send failed after retry: ${retryError.message}`);
      }
    }
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return 'invalid-email';
    return `${local[0]}***@${domain}`;
  }
}

export const notificationService = new NotificationService();
