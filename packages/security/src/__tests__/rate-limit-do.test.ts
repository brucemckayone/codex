/**
 * RateLimitDO — the arbitrary-window store.
 *
 * Covers the behaviour the KV store could not provide: a window that is not 10
 * or 60 seconds, an increment that cannot undercount a burst, and an exact
 * remaining/reset. The SQL text itself is verified by workerd, not here — see
 * the note in rate-limit-fakes.ts.
 */

import { RATE_LIMIT_DO_SHARDS } from '@codex/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  limitViaDurableObject,
  type RateLimitDecision,
  RateLimitDO,
  rateLimitShardName,
} from '../rate-limit-do';
import {
  createFakeDurableObjectState,
  createFakeRateLimitNamespace,
} from './rate-limit-fakes';

const WINDOW = { windowMs: 15 * 60 * 1000, maxRequests: 5 };

async function consume(
  instance: RateLimitDO,
  bucket: string,
  window = WINDOW
): Promise<RateLimitDecision> {
  const response = await instance.fetch(
    new Request('https://rate-limit.durable-object.internal/limit', {
      method: 'POST',
      body: JSON.stringify({ bucket, ...window }),
    })
  );
  expect(response.status).toBe(200);
  return (await response.json()) as RateLimitDecision;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RateLimitDO', () => {
  it('reports an exact remaining and reset on a fresh bucket', async () => {
    const instance = new RateLimitDO(createFakeDurableObjectState());
    const before = Date.now();

    const decision = await consume(instance, 'bucket-a');

    expect(decision.success).toBe(true);
    expect(decision.limit).toBe(5);
    expect(decision.remaining).toBe(4);
    expect(decision.resetAt).toBeGreaterThanOrEqual(before + WINDOW.windowMs);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts every request and blocks the one past the ceiling', async () => {
    const instance = new RateLimitDO(createFakeDurableObjectState());

    for (let attempt = 1; attempt <= WINDOW.maxRequests; attempt++) {
      const decision = await consume(instance, 'bucket-a');
      expect(decision.success).toBe(true);
      expect(decision.remaining).toBe(WINDOW.maxRequests - attempt);
    }

    const blocked = await consume(instance, 'bucket-a');
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('keeps buckets in the same shard independent', async () => {
    const instance = new RateLimitDO(createFakeDurableObjectState());

    for (let attempt = 0; attempt <= WINDOW.maxRequests; attempt++) {
      await consume(instance, 'bucket-a');
    }
    expect((await consume(instance, 'bucket-a')).success).toBe(false);
    expect((await consume(instance, 'bucket-b')).success).toBe(true);
  });

  it('holds the window fixed, then rolls it over — 15 minutes, not 10 or 60 seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'));

    const instance = new RateLimitDO(createFakeDurableObjectState());
    for (let attempt = 0; attempt <= WINDOW.maxRequests; attempt++) {
      await consume(instance, 'bucket-a');
    }
    expect((await consume(instance, 'bucket-a')).success).toBe(false);

    // A minute in — well past anything the native binding could express — the
    // window must still be closed.
    vi.setSystemTime(new Date('2026-08-27T12:01:00Z'));
    expect((await consume(instance, 'bucket-a')).success).toBe(false);

    // Past the 15-minute window it reopens with a full budget.
    vi.setSystemTime(new Date('2026-08-27T12:15:01Z'));
    const reopened = await consume(instance, 'bucket-a');
    expect(reopened.success).toBe(true);
    expect(reopened.remaining).toBe(WINDOW.maxRequests - 1);
  });

  it('caps the stored counter so a sustained attack cannot grow it', async () => {
    const state = createFakeDurableObjectState();
    const rows = (state as unknown as { __rows: Map<string, { hits: number }> })
      .__rows;
    const instance = new RateLimitDO(state);

    for (let attempt = 0; attempt < 50; attempt++) {
      await consume(instance, 'bucket-a');
    }

    expect(rows.get('bucket-a')?.hits).toBe(WINDOW.maxRequests + 1);
  });

  it('prunes expired rows once the sweep interval has passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'));

    const state = createFakeDurableObjectState();
    const rows = (state as unknown as { __rows: Map<string, unknown> }).__rows;
    const instance = new RateLimitDO(state);

    await consume(instance, 'short-lived', { windowMs: 1000, maxRequests: 5 });
    expect(rows.size).toBe(1);

    // Past both the row's expiry and the sweep interval.
    vi.setSystemTime(new Date('2026-08-27T12:05:00Z'));
    await consume(instance, 'other', WINDOW);

    expect(rows.has('short-lived')).toBe(false);
    expect(rows.has('other')).toBe(true);
  });

  it('rejects a malformed limit request rather than guessing', async () => {
    const instance = new RateLimitDO(createFakeDurableObjectState());

    const missingBucket = await instance.fetch(
      new Request('https://rate-limit.durable-object.internal/limit', {
        method: 'POST',
        body: JSON.stringify({ windowMs: 1000, maxRequests: 5 }),
      })
    );
    expect(missingBucket.status).toBe(400);

    const wrongPath = await instance.fetch(
      new Request('https://rate-limit.durable-object.internal/nope', {
        method: 'POST',
        body: '{}',
      })
    );
    expect(wrongPath.status).toBe(404);
  });
});

describe('rateLimitShardName', () => {
  it('is deterministic and stays inside the shard count', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const name = rateLimitShardName(`bucket-${i}`);
      expect(name).toBe(rateLimitShardName(`bucket-${i}`));
      expect(name).toMatch(/^rl-shard-\d+$/);
      seen.add(name);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(seen.size).toBeLessThanOrEqual(RATE_LIMIT_DO_SHARDS);
  });
});

describe('limitViaDurableObject', () => {
  it('routes a bucket to its shard and returns the decision', async () => {
    const namespace = createFakeRateLimitNamespace();

    const decision = await limitViaDurableObject(namespace, 'bucket-a', WINDOW);

    expect(decision.success).toBe(true);
    expect(namespace.shards.has(rateLimitShardName('bucket-a'))).toBe(true);
  });

  it('throws when the Durable Object errors so the caller owns the fail-open', async () => {
    const namespace = {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async () => new Response('boom', { status: 500 }),
      }),
    };

    await expect(
      limitViaDurableObject(namespace, 'bucket-a', WINDOW)
    ).rejects.toThrow('500');
  });
});
