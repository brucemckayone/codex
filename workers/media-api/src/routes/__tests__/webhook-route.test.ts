/**
 * The webhook route's answers for payloads it cannot use (Codex-l2c48.4).
 *
 * RunPod retries anything that is not a 2xx, so the status code IS the
 * behaviour: a payload that can never succeed must get a 200 (stop
 * retrying), and only a transient failure a 500. These cases return before
 * any database call. The terminal-rejection path (OUTPUT_REJECTED) is
 * covered against Postgres in @codex/transcoding's DB-backed suite.
 */

import { MIME_TYPES } from '@codex/constants';
import type { HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { signRunpodPayload } from '../../__tests__/runpod-signature';
import webhookRoutes from '../webhook';

const SECRET = 'route-test-secret';

async function post(body: string) {
  const app = new Hono<HonoEnv>().route('/', webhookRoutes);
  const timestamp = Math.floor(Date.now() / 1000);
  return app.request(
    '/api/transcoding/webhook',
    {
      method: 'POST',
      headers: {
        'Content-Type': MIME_TYPES.APPLICATION.JSON,
        'X-Runpod-Signature': await signRunpodPayload(body, SECRET, timestamp),
        'X-Runpod-Timestamp': timestamp.toString(),
      },
      body,
    },
    {
      RUNPOD_WEBHOOK_SECRET: SECRET,
      RUNPOD_API_KEY: 'test-key',
      RUNPOD_ENDPOINT_ID: 'test-endpoint',
    } as unknown as HonoEnv['Bindings']
  );
}

describe('POST /api/transcoding/webhook, unusable payloads', () => {
  it('answers 200 to a progress update it cannot read, so RunPod stops retrying it', async () => {
    const res = await post(
      JSON.stringify({ jobId: 'job-1', status: 'progress', progress: 500 })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
  });

  it('answers 200 to a payload that is not a webhook at all', async () => {
    const res = await post(
      JSON.stringify({ jobId: 'job-1', status: 'exploded' })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true });
  });

  it('answers 200 to a body that is not JSON', async () => {
    const res = await post('not json');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      received: true,
      error: 'Invalid JSON in request body',
    });
  });
});
