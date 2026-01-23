import { DOMAINS, SERVICE_PORTS } from '@codex/constants';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleProvider } from '../console-provider';
import { createEmailProvider } from '../index';

describe('ConsoleProvider', () => {
  it('logs email and returns success', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    const provider = new ConsoleProvider();

    const result = await provider.send(
      {
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        text: 'Hello',
      },
      { email: 'from@example.com', name: 'Sender' }
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^console-/);
    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe('createEmailProvider', () => {
  it('returns Console provider when useMock is true', () => {
    const provider = createEmailProvider({ useMock: true });
    expect(provider.name).toBe('console');
  });

  it('returns Resend provider when API key provided', () => {
    const provider = createEmailProvider({ resendApiKey: 'test_key' });
    expect(provider.name).toBe('resend');
  });

  it('returns MailHog provider when URL provided', () => {
    const provider = createEmailProvider({
      mailhogUrl: `http://${DOMAINS.LOCAL}:${SERVICE_PORTS.MAILHOG}`,
    });
    expect(provider.name).toBe('mailhog');
  });

  it('falls back to Console when no config', () => {
    const provider = createEmailProvider({});
    expect(provider.name).toBe('console');
  });
});
