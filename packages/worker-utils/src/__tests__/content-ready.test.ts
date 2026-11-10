import type { ObservabilityClient } from '@codex/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONTENT_MEDIA_READY_ROUTE,
  contentApiUrlFor,
  WorkerContentReadyNotifier,
} from '../content-ready';

/** Publish when ready (Codex-a6ofh.2.8): media-api's call to content-api. */

function collector() {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    settled: () => Promise.all(pending),
  };
}

const fakeObs = () =>
  ({ warn: vi.fn(), error: vi.fn() }) as unknown as ObservabilityClient & {
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

/** content-api takes the item and settles after: 204, no body. */
const taken = () => new Response(null, { status: 204 });
const refused = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code, message: 'no' } }), { status });

const MEDIA_ID = '4d000000-0000-4000-8000-000000000001';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WorkerContentReadyNotifier', () => {
  it("posts the item to content-api's route, signed, and resolves once it is taken", async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(taken());

    await expect(
      new WorkerContentReadyNotifier(
        'https://content-api.test',
        'secret',
        collector().waitUntil
      ).settle(MEDIA_ID)
    ).resolves.toBeUndefined();

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://content-api.test${CONTENT_MEDIA_READY_ROUTE}`);
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('X-Worker-Signature')).toBeTruthy();
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      mediaItemId: MEDIA_ID,
    });
  });

  // A bad secret, a route not deployed, a contract drift: publish when ready
  // is off for everyone until fixed, so it is loud. A blip is only thrown.
  it.each([
    ['a refusal no retry cures (401)', () => refused(401, 'UNAUTHORIZED'), 1],
    ['a missing route (404)', () => refused(404, 'NOT_FOUND'), 1],
    ['a blip (503)', () => new Response(null, { status: 503 }), 0],
    ['rate limited (429)', () => refused(429, 'RATE_LIMITED'), 0],
  ])('settle throws on %s, at error %i time(s) first', async (_case, make, errors) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(make());
    const obs = fakeObs();

    await expect(
      new WorkerContentReadyNotifier(
        'https://content-api.test',
        'secret',
        collector().waitUntil,
        obs
      ).settle(MEDIA_ID)
    ).rejects.toThrow();
    expect(obs.error).toHaveBeenCalledTimes(errors);
    if (errors > 0) {
      expect(obs.error).toHaveBeenCalledWith(
        'Publish-when-ready call refused by content-api',
        expect.objectContaining({ mediaId: MEDIA_ID })
      );
    }
  });

  it('mediaChanged sends in the background, logs a failure, and never throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 503 })
    );
    const obs = fakeObs();
    const background = collector();
    const notifier = new WorkerContentReadyNotifier(
      'https://content-api.test',
      'secret',
      background.waitUntil,
      obs
    );

    expect(() => notifier.mediaChanged(MEDIA_ID)).not.toThrow();
    await background.settled();
    expect(obs.warn).toHaveBeenCalledWith(
      'Publish-when-ready call to content-api failed',
      expect.objectContaining({ mediaId: MEDIA_ID })
    );
  });
});

describe('contentApiUrlFor', () => {
  // media-api's API_URL is its own address, for RunPod's callbacks.
  it("reaches content-api, never the caller's own API_URL", () => {
    const mediaApiBindings = {
      ENVIRONMENT: 'production',
      API_URL: 'https://media-api.revelations.studio',
    };

    const url = contentApiUrlFor(mediaApiBindings);

    expect(url).not.toBe(mediaApiBindings.API_URL);
    expect(url).toBe(contentApiUrlFor({ ENVIRONMENT: 'production' }));
    expect(url).toContain('content-api');
  });
});
