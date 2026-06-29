/**
 * CPU-spike microbenchmark for the HLS variant-playlist presign loop
 * (WP-14 / Codex-bpjg5).
 *
 * Estimates worst-case per-variant SigV4 presign cost vs the Workers Free
 * 10ms CPU/invocation limit. Presigning is pure crypto (HMAC chain, no network),
 * so this measures the per-URL CPU paid when rewriting a variant playlist's
 * segment URIs. It exercises the PRODUCTION path: R2SigningClient → R2Presigner
 * → aws4fetch, with a single reused client so the SigV4 signing-key cache is hit
 * (the property Codex-bpjg5 relies on).
 *
 * BASELINE: the old @aws-sdk/s3-request-presigner path measured ≈250µs/URL
 * (recorded in Codex-bpjg5). Compare the logged aws4fetch number against that.
 *
 * CAVEAT — this runs in Node/vitest, NOT workerd. Absolute µs differ between
 * runtimes; the authoritative segments-per-10ms ceiling MUST come from an
 * in-runtime spike (S1, `wrangler dev`). The assertions below only guard against
 * a catastrophic regression and confirm signing still produces URLs.
 */
import { R2SigningClient } from '@codex/cloudflare-clients';
import { describe, expect, it } from 'vitest';

const COUNT = 600;
const SDK_BASELINE_US = 250; // documented @aws-sdk per-URL cost (Codex-bpjg5)

describe('SigV4 presign CPU spike (600 URLs)', () => {
  it('aws4fetch signs 600 URLs off one reused client', async () => {
    const client = new R2SigningClient({
      accountId: 'benchmark-account',
      accessKeyId: 'benchmark-access-key',
      secretAccessKey: 'benchmark-secret-key',
      bucketName: 'benchmark-bucket',
    });

    // Warm up: first call lazily derives the signing key (cached thereafter).
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

    // biome-ignore lint/suspicious/noConsole: benchmark output is the point.
    console.log(
      `[CPU spike] ${COUNT} aws4fetch presigns: total=${totalMs.toFixed(2)}ms, ` +
        `per-URL=${perUrlUs.toFixed(1)}µs (SDK baseline ≈${SDK_BASELINE_US}µs). ` +
        'NOTE: Node timing — real ceiling needs the workerd spike (S1).'
    );

    expect(lastUrl).toContain('X-Amz-Signature');
    // Catastrophic-regression guard only (NOT a runtime budget assertion):
    // 5ms/URL in Node would mean something is badly wrong.
    expect(perUrlUs).toBeLessThan(5000);
  });
});
