/**
 * R2Presigner tests (aws4fetch lean SigV4).
 *
 * Two tiers:
 *  - Structural (hermetic, fake creds, no network): the presigned URL carries a
 *    well-formed SigV4 query string, expiry is honoured, PUT signs Content-Type,
 *    and a single reused instance can sign many URLs (the signing-key-cache path
 *    the HLS variant proxy depends on — Codex-bpjg5).
 *  - Acceptance (real R2 test bucket via .env.test, skipped when creds absent):
 *    R2 ACCEPTS the aws4fetch signature on a GET, and an unsigned `Range` header
 *    survives it. This is the signature-survival half of spike S2 for the
 *    single-file byte-range plan; the "206 + correct bytes for an existing
 *    object" half belongs to the dedicated spike (needs an uploaded object).
 */

import { describe, expect, it } from 'vitest';
import { R2Presigner } from './r2-presigner';
import type { R2SigningConfig } from './r2-service';

const FAKE_CONFIG: R2SigningConfig = {
  accountId: 'test-account-id',
  accessKeyId: 'AKIAEXAMPLEEXAMPLE',
  secretAccessKey: 'examplesecretkeyexamplesecretkeyexample0',
  bucketName: 'codex-media-test',
};

const ENV_CONFIG: R2SigningConfig = {
  accountId: process.env.R2_ACCOUNT_ID ?? '',
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  bucketName: process.env.R2_BUCKET_MEDIA ?? '',
};
const hasCreds = Object.values(ENV_CONFIG).every(Boolean);

describe('R2Presigner (structural)', () => {
  const presigner = new R2Presigner(FAKE_CONFIG);

  it('presignGet produces a well-formed SigV4 query string', async () => {
    const url = new URL(
      await presigner.presignGet('creator/hls/m/v/stream.ts', 600)
    );

    expect(url.hostname).toBe('test-account-id.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/codex-media-test/creator/hls/m/v/stream.ts');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.has('X-Amz-Credential')).toBe(true);
    expect(url.searchParams.has('X-Amz-Date')).toBe(true);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.has('X-Amz-Signature')).toBe(true);
    // host is always signed; Range deliberately is NOT (so a player can add it).
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('host');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).not.toContain('range');
  });

  it('presignPut signs the Content-Type header', async () => {
    const url = new URL(
      await presigner.presignPut('up/logo.png', 'image/png', 3600)
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain(
      'content-type'
    );
  });

  it('different keys yield different signatures', async () => {
    const a = new URL(await presigner.presignGet('a.ts', 600));
    const b = new URL(await presigner.presignGet('b.ts', 600));
    expect(a.searchParams.get('X-Amz-Signature')).not.toBe(
      b.searchParams.get('X-Amz-Signature')
    );
  });

  it('one reused instance signs many distinct URLs (signing-key-cache path)', async () => {
    // Mirrors the HLS variant proxy: many presigns in one go off a single client.
    const urls = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        presigner.presignGet(`creator/hls/m/v/segment_${i}.ts`, 600)
      )
    );
    expect(new Set(urls).size).toBe(50);
    for (const u of urls) {
      expect(new URL(u).searchParams.has('X-Amz-Signature')).toBe(true);
    }
  });
});

describe('R2Presigner (real R2 acceptance)', () => {
  it.skipIf(!hasCreds)(
    'R2 accepts the signature on a GET — 404 for a missing key, never 403',
    async () => {
      const presigner = new R2Presigner(ENV_CONFIG);
      const key = `__aws4fetch_probe__/${Date.now()}.ts`;
      const res = await fetch(await presigner.presignGet(key, 300));
      // 403 = SignatureDoesNotMatch (rejected). 404 = NoSuchKey (accepted, absent).
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(404);
    }
  );

  it.skipIf(!hasCreds)(
    'an unsigned Range header survives the signature (spike S2, signature half)',
    async () => {
      const presigner = new R2Presigner(ENV_CONFIG);
      const key = `__aws4fetch_probe__/${Date.now()}.ts`;
      const res = await fetch(await presigner.presignGet(key, 300), {
        headers: { Range: 'bytes=0-1023' },
      });
      expect(res.status).not.toBe(403);
    }
  );
});
