// See /design/features/notifications/ttd-dphase-1.md
import type { IEmailAdapter } from './interface';
import { ResendAdapter } from './resend';

const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'resend';

function createEmailAdapter(): IEmailAdapter {
  switch (EMAIL_PROVIDER) {
    case 'resend':
      return new ResendAdapter();
    // Future providers like SendGrid, Postmark, etc. would be added here
    default:
      console.warn(`Unknown email provider: ${EMAIL_PROVIDER}. Falling back to Resend.`);
      return new ResendAdapter();
  }
}

export const emailAdapter = createEmailAdapter();
