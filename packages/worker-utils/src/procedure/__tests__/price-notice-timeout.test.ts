/**
 * ecom-api's hourly price-moves step waits `PRICE_NOTICE_TIMEOUT_MS` for each
 * notice (Codex-2hxff.86): its 8-minute budget and batches of 8 count on it.
 * So the registry passes that constant to the SubscriptionService mailer the
 * step sends through, and does not lean on worker-utils' own default (review
 * A round 2, correctness #1). The course service sends no price notice any
 * more: the step sends course plans' too.
 *
 * DATABASE-FREE: the DB client is constructed, never queried (same env shape
 * as money-mailer-no-context.test.ts).
 */
import type { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import { PRICE_NOTICE_TIMEOUT_MS } from '@codex/subscription';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendEmailToWorkerAwaited } from '../../email/send-email';
import { createServiceRegistry } from '../service-registry';

vi.mock('../../email/send-email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../email/send-email')>()),
  sendEmailToWorkerAwaited: vi.fn(async () => ({ accepted: true as const })),
}));

function testEnv(): Bindings {
  return {
    DB_METHOD: 'NEON_BRANCH',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/never-connected',
    ENVIRONMENT: 'production',
    WEB_APP_URL: 'https://app.example.test',
  } as unknown as Bindings;
}

const notice = {
  to: 'subscriber@example.test',
  templateName: 'subscription-tier-price-change' as const,
  category: 'transactional' as const,
  userId: 'user_abc123',
  data: { planName: 'Basic' },
};

/** A money service's private notice mailer, without widening its type. */
function mailerOf(service: object) {
  return (service as { mailer: (params: typeof notice) => Promise<unknown> })
    .mailer;
}

describe('the price-change notice mailer', () => {
  beforeEach(() => {
    vi.mocked(sendEmailToWorkerAwaited).mockClear();
  });

  it.each([
    'subscription',
  ] as const)('the %s service waits PRICE_NOTICE_TIMEOUT_MS for each notice', async (name) => {
    const obs = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const env = testEnv();
    const { registry, cleanup } = await createServiceRegistry(
      env,
      obs as unknown as ObservabilityClient
    );
    try {
      await mailerOf(registry[name])(notice);

      expect(PRICE_NOTICE_TIMEOUT_MS).toBe(5_000);
      expect(sendEmailToWorkerAwaited).toHaveBeenCalledWith(env, notice, {
        timeoutMs: PRICE_NOTICE_TIMEOUT_MS,
      });
    } finally {
      await cleanup();
    }
  });
});
