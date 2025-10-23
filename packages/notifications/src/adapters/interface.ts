// See /design/features/notifications/ttd-dphase-1.md
import type { EmailResult } from '../types';

/**
 * Raw email payload (provider-agnostic)
 */
export interface RawEmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

/**
 * Email Adapter Interface
 */
export interface IEmailAdapter {
  send(payload: RawEmailPayload): Promise<EmailResult>;
  verify(): Promise<boolean>;
}
