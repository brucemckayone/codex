/**
 * CPU-spike microbenchmark for WP-14 (Codex-fc5oh.14).
 *
 * Estimates worst-case per-variant SigV4 presign cost vs the Workers Free
 * 10ms CPU/invocation limit. `getSignedUrl` is pure crypto (HMAC chain, no
 * network), so this measures the actual per-URL CPU we'd pay when rewriting a
 * variant playlist's segment URIs.
 *
 * Not an assertion-heavy test — it prints µs/URL + the 600-URL total. Kept as a
 * `.test.ts` so it runs in the normal suite; the single expect just guards
 * that signing produced URLs.
 */
import { R2SigningClient } from '@codex/cloudflare-clients';
import { describe, expect, it } from 'vitest';

describe('SigV4 presign CPU spike (600 URLs)', () => {
  it('reports µs/URL and 600-URL total', async () => {
    const client = new R2SigningClient({
      accountId: 'benchmark-account',
      accessKeyId: 'benchmark-access-key',
      secretAccessKey: 'benchmark-secret-key',
      bucketName: 'benchmark-bucket',
    });

    const COUNT = 600;
    // Warm up the AWS SDK signer (first call lazily builds the credential
    // resolver / hashers) so the measured loop reflects steady-state cost.
    await client.generateSignedUrl('warmup/segment.ts', 600);

    const start = performance.now();
    let lastUrl = '';
    for (let i = 0; i < COUNT; i++) {
      lastUrl = await client.generateSignedUrl(
        `creator/hls/media/1080p/segment_${i}.ts`,
        600
      );
    }
    const totalMs = performance.now() - start;
    const perUrlUs = (totalMs / COUNT) * 1000;

    // eslint-disable-next-line no-console
    console.log(
      `[WP-14 CPU spike] ${COUNT} SigV4 presigns: total=${totalMs.toFixed(
        2
      )}ms, per-URL=${perUrlUs.toFixed(1)}µs`
    );

    expect(lastUrl).toContain('X-Amz-Signature');
  });
});
