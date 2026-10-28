/**
 * The money services' fire-and-forget mailers are required (Codex-2hxff.55),
 * so the registry fills them with `sendAfterResponse`. Every request path has
 * an ExecutionContext; a registry built without one cannot send, and must say
 * so with an errorId, through the ObservabilityClient or, with none, the
 * console (review A, silent #10). Never the recipient's address.
 *
 * DATABASE-FREE: the DB client is constructed, never queried (same env shape
 * as webhook-services.test.ts).
 */
import type { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { createServiceRegistry } from '../service-registry';

function testEnv(): Bindings {
  return {
    DB_METHOD: 'NEON_BRANCH',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/never-connected',
    ENVIRONMENT: 'production',
    WEB_APP_URL: 'https://app.example.test',
  } as unknown as Bindings;
}

const email = {
  to: 'creator@example.test',
  templateName: 'creator-connect-needed',
  category: 'transactional',
  userId: 'user_abc123',
  data: { amountFormatted: '£9.00' },
};

/** The purchase service's private mailer, without widening its type. */
function purchaseMailerOf(service: object) {
  return (service as { mailer: (params: typeof email) => void }).mailer;
}

describe('the money mailers without an ExecutionContext', () => {
  it('log the email they could not send, with an errorId and no address', async () => {
    const obs = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const { registry, cleanup } = await createServiceRegistry(
      testEnv(),
      obs as unknown as ObservabilityClient
    );
    try {
      purchaseMailerOf(registry.purchase)(email);

      expect(obs.error).toHaveBeenCalledWith(
        'Email not sent: the registry has no ExecutionContext',
        {
          errorId: expect.any(String),
          templateName: 'creator-connect-needed',
          userId: 'user_abc123',
        }
      );
      expect(JSON.stringify(obs.error.mock.calls)).not.toContain(email.to);
    } finally {
      await cleanup();
    }
  });

  it('fall back to the console when there is no ObservabilityClient', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { registry, cleanup } = await createServiceRegistry(testEnv());
    try {
      purchaseMailerOf(registry.purchase)(email);

      expect(errorSpy).toHaveBeenCalledWith(
        '[service-registry] Email not sent: the registry has no ExecutionContext',
        expect.objectContaining({ errorId: expect.any(String) })
      );
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(email.to);
    } finally {
      errorSpy.mockRestore();
      await cleanup();
    }
  });
});
