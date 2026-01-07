import { Resend } from 'resend';
import type {
  EmailFrom,
  EmailMessage,
  EmailProvider,
  SendResult,
} from './types';

export class ResendProvider implements EmailProvider {
  readonly name = 'resend';
  private client: Resend;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Resend API key is required');
    }
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage, from: EmailFrom): Promise<SendResult> {
    try {
      const result = await this.client.emails.send({
        from: from.name ? `${from.name} <${from.email}>` : from.email,
        to: message.toName ? `${message.toName} <${message.to}>` : message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      if (result.error) {
        return {
          success: false,
          error: result.error.message,
        };
      }

      return {
        success: true,
        messageId: result.data?.id ?? undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
