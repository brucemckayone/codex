/**
 * POST /internal/send passes `platformTemplate` on (Codex-a6ofh.6.4, owner
 * 2026-11-21): the leaving sweep's takedown email asks for the platform's own
 * template, so the org being moderated can't write it. The service's half
 * (the org's template skipped, its brand kept) is pinned in
 * `@codex/notifications`; this file pins that the route hands the flag over,
 * and that a send without it asks for nothing new.
 *
 * Real `procedure()` (so the real HMAC check) on a bare Hono app. Stubbed:
 * the notifications service.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { HEADERS } from '@codex/constants';
import { ObservabilityClient } from '@codex/observability';
import { generateWorkerSignature } from '@codex/security';
import type { HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const notificationsSpies = { sendEmail: vi.fn() };

vi.mock('@codex/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/notifications')>();
  return {
    ...actual,
    NotificationsService: vi.fn(() => notificationsSpies),
  };
});

// Below the mock on purpose: biome's organizeImports never moves an import
// across a statement, so the registry resolves the mocked class.
import internal from '../internal';

/** The secret `.dev.vars.test` gives the worker. */
function sharedSecret(): string {
  const secret = (env as unknown as { WORKER_SHARED_SECRET?: unknown })
    .WORKER_SHARED_SECRET;
  if (typeof secret !== 'string' || secret === '') {
    throw new Error('WORKER_SHARED_SECRET must be set for this suite');
  }
  return secret;
}

const obs = new ObservabilityClient('notifications-api-test', 'test');

async function send(body: Record<string, unknown>): Promise<Response> {
  const app = new Hono<HonoEnv>();
  app.use('*', async (c, next) => {
    c.set('obs', obs);
    await next();
  });
  app.route('/internal', internal);
  const payload = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request('http://notifications-api.test/internal/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [HEADERS.WORKER_SIGNATURE]: await generateWorkerSignature(
          payload,
          sharedSecret(),
          timestamp
        ),
        [HEADERS.WORKER_TIMESTAMP]: String(timestamp),
      },
      body: payload,
    }),
    env,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

const takedown = {
  to: 'owner@example.test',
  templateName: 'content-removed',
  data: { userName: 'Riley', contentTitle: 'Flow' },
  organizationId: '3d000000-0000-4000-8000-000000000001',
  category: 'transactional',
  userId: 'user-1',
};

describe('POST /internal/send: the platform template flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationsSpies.sendEmail.mockResolvedValue({
      success: true,
      messageId: 'msg-1',
    });
  });

  it('hands platformTemplate to the service, with the org for its brand', async () => {
    const res = await send({ ...takedown, platformTemplate: true });

    expect(res.status).toBe(200);
    expect(notificationsSpies.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'content-removed',
        organizationId: takedown.organizationId,
        platformTemplate: true,
      })
    );
  });

  it('a send without it asks for no platform template', async () => {
    const res = await send(takedown);

    expect(res.status).toBe(200);
    expect(
      notificationsSpies.sendEmail.mock.calls[0]?.[0]?.platformTemplate
    ).toBeUndefined();
  });
});
