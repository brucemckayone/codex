import type {
  EmailFrom,
  EmailMessage,
  EmailProvider,
  SendResult,
} from './types';

/**
 * In-memory email provider for unit and integration tests.
 * Stores sent emails in memory for assertion.
 *
 * @example
 * ```typescript
 * const provider = new InMemoryEmailProvider();
 * await service.sendEmail({ ... });
 *
 * expect(provider.getSentEmails()).toHaveLength(1);
 * expect(provider.getLastEmail()?.message.to).toBe('user@example.com');
 * provider.clear();
 * ```
 */
export class InMemoryEmailProvider implements EmailProvider {
  readonly name = 'in-memory';
  private sentEmails: Array<{
    message: EmailMessage;
    from: EmailFrom;
    timestamp: Date;
  }> = [];

  async send(message: EmailMessage, from: EmailFrom): Promise<SendResult> {
    const messageId = `inmem-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    this.sentEmails.push({
      message,
      from,
      timestamp: new Date(),
    });

    return {
      success: true,
      messageId,
    };
  }

  /**
   * Get all sent emails
   */
  getSentEmails(): Array<{
    message: EmailMessage;
    from: EmailFrom;
    timestamp: Date;
  }> {
    return [...this.sentEmails];
  }

  /**
   * Get the last sent email
   */
  getLastEmail():
    | { message: EmailMessage; from: EmailFrom; timestamp: Date }
    | undefined {
    return this.sentEmails[this.sentEmails.length - 1];
  }

  /**
   * Get emails sent to a specific recipient
   */
  getEmailsTo(
    email: string
  ): Array<{ message: EmailMessage; from: EmailFrom; timestamp: Date }> {
    return this.sentEmails.filter((e) => e.message.to === email);
  }

  /**
   * Get emails with a specific subject
   */
  getEmailsWithSubject(
    subject: string
  ): Array<{ message: EmailMessage; from: EmailFrom; timestamp: Date }> {
    return this.sentEmails.filter((e) => e.message.subject.includes(subject));
  }

  /**
   * Clear all stored emails
   */
  clear(): void {
    this.sentEmails = [];
  }

  /**
   * Get count of sent emails
   */
  get count(): number {
    return this.sentEmails.length;
  }
}
