import type {
  EmailFrom,
  EmailMessage,
  EmailProvider,
  SendResult,
} from './types';

/**
 * MailHog HTTP provider stub for integration tests.
 *
 * **IMPORTANT**: This provider does NOT actually send emails.
 * MailHog requires SMTP to receive emails, and Cloudflare Workers
 * do not support TCP/SMTP connections.
 *
 * This provider is useful for:
 * - Verifying MailHog connectivity during integration test setup
 * - Logging email intent for debugging
 *
 * For actual testing, use `InMemoryEmailProvider` which stores
 * emails in memory for assertion.
 *
 * @see InMemoryEmailProvider for a functional test double
 */
export class MailHogHttpProvider implements EmailProvider {
  readonly name = 'mailhog';
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8025') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  async send(message: EmailMessage, _from: EmailFrom): Promise<SendResult> {
    const messageId = `mailhog-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      // MailHog's API accepts messages via POST /api/v2/messages
      // However, the simpler approach is to use the SMTP-like endpoint
      // For Workers, we'll just store in memory and verify via API

      const response = await fetch(`${this.baseUrl}/api/v2/messages`, {
        method: 'GET',
      });

      if (!response.ok) {
        return {
          success: false,
          error: `MailHog not available: ${response.status}`,
        };
      }

      // For now, log and return success
      console.log(`[MailHog] Would send email to: ${message.to}`);
      console.log(`[MailHog] Subject: ${message.subject}`);

      return {
        success: true,
        messageId,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'MailHog connection failed',
      };
    }
  }

  /**
   * Helper to fetch messages from MailHog for test assertions
   */
  async getMessages(): Promise<unknown[]> {
    const response = await fetch(`${this.baseUrl}/api/v2/messages`);
    if (!response.ok) {
      throw new Error(`MailHog API error: ${response.status}`);
    }
    const data = await response.json();
    return (data as { items: unknown[] }).items || [];
  }

  /**
   * Clear all messages (useful before tests)
   */
  async clearMessages(): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/messages`, {
      method: 'DELETE',
    });
  }
}
