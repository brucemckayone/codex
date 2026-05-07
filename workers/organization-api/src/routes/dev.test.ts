/**
 * Production-guard tests for the dev-only KV flush endpoint.
 *
 * The production-safety property (`/__dev__/flush-kv` is unreachable
 * outside `ENVIRONMENT === 'development'`) is the load-bearing invariant
 * here — a regression would let an attacker wipe production caches.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../index';

const FLUSH_URL = 'http://localhost/__dev__/flush-kv';

async function postFlush(environment: string | undefined) {
  const ctx = createExecutionContext();
  // Spread first, then override — undefined explicitly removes the key.
  const customEnv: Record<string, unknown> = { ...env };
  if (environment === undefined) {
    delete customEnv.ENVIRONMENT;
  } else {
    customEnv.ENVIRONMENT = environment;
  }
  const response = await worker.fetch(
    new Request(FLUSH_URL, { method: 'POST' }),
    customEnv as typeof env,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return response;
}

describe('POST /__dev__/flush-kv production guard', () => {
  it.each([
    ['production'],
    ['staging'],
    ['test'],
    [''],
  ])('returns 404 when ENVIRONMENT is %p', async (environment) => {
    const response = await postFlush(environment);
    expect(response.status).toBe(404);
  });

  it('returns 404 when ENVIRONMENT is unset', async () => {
    const response = await postFlush(undefined);
    expect(response.status).toBe(404);
  });

  it('accepts the request when ENVIRONMENT is exactly "development"', async () => {
    const response = await postFlush('development');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      flushed: { cache: number; session: number };
    };
    expect(body.flushed).toEqual({
      cache: expect.any(Number),
      session: expect.any(Number),
    });
  });
});
