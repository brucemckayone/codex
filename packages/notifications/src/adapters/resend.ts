// See /design/features/notifications/ttd-dphase-1.md
import { Resend } from 'resend';
import type { IEmailAdapter, RawEmailPayload } from './interface';
import type { EmailResult } from '../types';

export class ResendAdapter implements IEmailAdapter {
  private client: Resend;
  private fromAddress: string;
  private fromName: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      // In a real app, you might have a fallback or a no-op adapter
      console.warn('RESEND_API_KEY environment variable is not set. Email sending will be disabled.');
      this.client = {} as Resend; // Avoid crashing on init
    } else {
      this.client = new Resend(apiKey);
    }

    this.fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@example.com';
    this.fromName = process.env.EMAIL_FROM_NAME || 'Codex Platform';
  }

  async send(payload: RawEmailPayload): Promise<EmailResult> {
    if (!this.client.emails) {
        const errorMsg = 'Resend client not initialized. Is RESEND_API_KEY set?';
        console.error(errorMsg);
        return { success: false, error: errorMsg };
    }
    try {
      const result = await this.client.emails.send({
        from: `${this.fromName} <${this.fromAddress}>`,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        reply_to: payload.replyTo
      });

      if (result.error) {
        return { success: false, error: result.error.message };
      }

      return {
        success: true,
        emailId: result.data?.id
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async verify(): Promise<boolean> {
    if (!this.client.domains) return false;
    try {
      await this.client.domains.list();
      return true;
    } catch (error) {
      return false;
    }
  }
}
