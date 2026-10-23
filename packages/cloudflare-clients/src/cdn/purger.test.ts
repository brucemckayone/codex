import { describe, expect, it, vi } from 'vitest';
import { CdnCachePurger } from './purger';

const ZONE = 'zone-123';
const TOKEN = 'token-abc';

function purgerAnswering(response: Response | Error) {
  const fetch = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const purger = new CdnCachePurger({
    zoneId: ZONE,
    apiToken: TOKEN,
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { purger, fetch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('CdnCachePurger.purgePrefixes', () => {
  it("POSTs the prefixes to the zone's purge endpoint with the token", async () => {
    const { purger, fetch } = purgerAnswering(json({ success: true }));

    await expect(
      purger.purgePrefixes(['cdn.example.com/avatars/u1'])
    ).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/zones/${ZONE}/purge_cache`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefixes: ['cdn.example.com/avatars/u1'] }),
        signal: expect.any(AbortSignal),
      }
    );
  });

  it('sends nothing for no prefixes', async () => {
    const { purger, fetch } = purgerAnswering(json({ success: true }));

    await expect(purger.purgePrefixes([])).resolves.toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses more prefixes than one request takes, without sending', async () => {
    const { purger, fetch } = purgerAnswering(json({ success: true }));
    const prefixes = Array.from({ length: 101 }, (_, i) => `cdn.test/${i}`);

    const result = await purger.purgePrefixes(prefixes);

    expect(result.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the API's errors on a refused purge, never throws", async () => {
    const { purger } = purgerAnswering(
      json(
        {
          success: false,
          errors: [{ code: 10000, message: 'Authentication error' }],
        },
        403
      )
    );

    await expect(purger.purgePrefixes(['cdn.test/a'])).resolves.toEqual({
      ok: false,
      reason: 'HTTP 403: [{"code":10000,"message":"Authentication error"}]',
    });
  });

  it('treats a 200 that says success: false as a failure', async () => {
    const { purger } = purgerAnswering(json({ success: false, errors: [] }));

    const result = await purger.purgePrefixes(['cdn.test/a']);

    expect(result).toEqual({ ok: false, reason: 'HTTP 200: []' });
  });

  it('keeps the text of a body that is not JSON', async () => {
    const { purger } = purgerAnswering(
      new Response('<html>502 Bad Gateway</html>', { status: 502 })
    );

    await expect(purger.purgePrefixes(['cdn.test/a'])).resolves.toEqual({
      ok: false,
      reason: 'HTTP 502: <html>502 Bad Gateway</html>',
    });
  });

  it('returns a network failure, never throws', async () => {
    const { purger } = purgerAnswering(new TypeError('fetch failed'));

    await expect(purger.purgePrefixes(['cdn.test/a'])).resolves.toEqual({
      ok: false,
      reason: 'fetch failed',
    });
  });

  it('gives up on a purge that never answers, never hangs', async () => {
    // A fetch that settles only when its signal aborts, as a real one does.
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason)
          );
        })
    );
    const purger = new CdnCachePurger({
      zoneId: ZONE,
      apiToken: TOKEN,
      timeoutMs: 20,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await expect(purger.purgePrefixes(['cdn.test/a'])).resolves.toEqual({
      ok: false,
      reason: 'timed out after 20ms',
    });
  });
});
