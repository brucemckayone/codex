export { ConsoleProvider } from './console-provider';
export { MailHogHttpProvider } from './mailhog-provider';
export { ResendProvider } from './resend-provider';
export * from './types';

import { ConsoleProvider } from './console-provider';
import { MailHogHttpProvider } from './mailhog-provider';
import { ResendProvider } from './resend-provider';
import type { EmailProvider } from './types';

export interface ProviderConfig {
  /** Use mock provider instead of real email */
  useMock?: boolean;
  /** Resend API key (required for production) */
  resendApiKey?: string;
  /** MailHog URL (for integration tests) */
  mailhogUrl?: string;
}

/**
 * Create email provider based on environment configuration
 */
export function createEmailProvider(config: ProviderConfig): EmailProvider {
  // Development: Console provider
  if (config.useMock) {
    console.log('[Email] Using Console provider (mock mode)');
    return new ConsoleProvider();
  }

  // Integration tests: MailHog
  if (config.mailhogUrl) {
    console.log(`[Email] Using MailHog provider: ${config.mailhogUrl}`);
    return new MailHogHttpProvider(config.mailhogUrl);
  }

  // Production: Resend
  if (config.resendApiKey) {
    console.log('[Email] Using Resend provider');
    return new ResendProvider(config.resendApiKey);
  }

  // Fallback to console
  console.warn('[Email] No provider configured, falling back to Console');
  return new ConsoleProvider();
}
