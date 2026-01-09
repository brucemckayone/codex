import type {
  EmailFrom,
  EmailMessage,
  EmailProvider,
  SendResult,
} from './types';

/**
 * Console provider for local development.
 * Logs emails to console instead of sending.
 */
export class ConsoleProvider implements EmailProvider {
  readonly name = 'console';

  async send(message: EmailMessage, from: EmailFrom): Promise<SendResult> {
    const messageId = `console-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    console.log('═'.repeat(60));
    console.log('📧 EMAIL (Console Provider - Not Sent)');
    console.log('═'.repeat(60));
    console.log(`Message ID: ${messageId}`);
    console.log(
      `From:       ${from.name ? `${from.name} <${from.email}>` : from.email}`
    );
    console.log(
      `To:         ${message.toName ? `${message.toName} <${message.to}>` : message.to}`
    );
    console.log(`Subject:    ${message.subject}`);
    console.log('─'.repeat(60));
    console.log('HTML Body:');
    console.log(
      message.html.slice(0, 500) + (message.html.length > 500 ? '...' : '')
    );
    console.log('─'.repeat(60));
    console.log('Text Body:');
    console.log(message.text);
    console.log('═'.repeat(60));

    return {
      success: true,
      messageId,
    };
  }
}
