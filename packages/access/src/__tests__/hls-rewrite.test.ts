import { describe, expect, it } from 'vitest';
import {
  collectVariantSegments,
  rewriteMasterPlaylist,
  rewriteVariantPlaylist,
} from '../hls-rewrite';
import { signHlsToken, verifyHlsToken } from '../hls-token';

const BASE = 'https://api.revelations.studio';
const CONTENT_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'tok.sig';

describe('rewriteMasterPlaylist', () => {
  it('rewrites relative variant URIs to absolute variant-proxy URLs with the token', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
      '1080p/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720',
      '720p/index.m3u8',
      '',
    ].join('\n');

    const out = rewriteMasterPlaylist(master, {
      contentApiBaseUrl: BASE,
      contentId: CONTENT_ID,
      token: TOKEN,
    });
    const lines = out.split('\n');

    expect(lines[0]).toBe('#EXTM3U');
    expect(lines[2]).toBe(
      `${BASE}/api/access/content/${CONTENT_ID}/hls/1080p/index.m3u8?token=tok.sig`
    );
    expect(lines[4]).toBe(
      `${BASE}/api/access/content/${CONTENT_ID}/hls/720p/index.m3u8?token=tok.sig`
    );
  });

  it('passes through #-lines and blank lines untouched', () => {
    const master = '#EXTM3U\n\n#EXT-X-VERSION:3\n';
    expect(
      rewriteMasterPlaylist(master, {
        contentApiBaseUrl: BASE,
        contentId: CONTENT_ID,
        token: TOKEN,
      })
    ).toBe(master);
  });

  it('passes through already-absolute variant URIs', () => {
    const master = '#EXTM3U\nhttps://cdn.example.com/1080p/index.m3u8\n';
    const out = rewriteMasterPlaylist(master, {
      contentApiBaseUrl: BASE,
      contentId: CONTENT_ID,
      token: TOKEN,
    });
    expect(out).toContain('https://cdn.example.com/1080p/index.m3u8');
    expect(out).not.toContain('/api/access/content/');
  });

  it('preserves CRLF newlines and trailing newline', () => {
    const master = '#EXTM3U\r\n1080p/index.m3u8\r\n';
    const out = rewriteMasterPlaylist(master, {
      contentApiBaseUrl: BASE,
      contentId: CONTENT_ID,
      token: TOKEN,
    });
    expect(out.startsWith('#EXTM3U\r\n')).toBe(true);
    expect(out.endsWith('\r\n')).toBe(true);
    expect(out).toContain('/hls/1080p/index.m3u8?token=tok.sig');
  });

  it('strips a trailing slash on the base URL', () => {
    const out = rewriteMasterPlaylist('1080p/index.m3u8', {
      contentApiBaseUrl: `${BASE}/`,
      contentId: CONTENT_ID,
      token: TOKEN,
    });
    expect(out).toBe(
      `${BASE}/api/access/content/${CONTENT_ID}/hls/1080p/index.m3u8?token=tok.sig`
    );
  });
});

describe('collectVariantSegments', () => {
  it('returns relative segment filenames in order, de-duplicated', () => {
    const variant = [
      '#EXTM3U',
      '#EXTINF:6.0,',
      'segment_000.ts',
      '#EXTINF:6.0,',
      'segment_001.ts',
      '#EXTINF:6.0,',
      'segment_000.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    expect(collectVariantSegments(variant)).toEqual([
      'segment_000.ts',
      'segment_001.ts',
    ]);
  });

  it('ignores absolute segment URIs', () => {
    const variant =
      '#EXTM3U\nhttps://cdn.example.com/segment_000.ts\nsegment_001.ts\n';
    expect(collectVariantSegments(variant)).toEqual(['segment_001.ts']);
  });
});

describe('rewriteVariantPlaylist', () => {
  it('replaces relative segment URIs with presigned URLs', () => {
    const variant = [
      '#EXTM3U',
      '#EXTINF:6.0,',
      'segment_000.ts',
      '#EXTINF:6.0,',
      'segment_001.ts',
      '#EXT-X-ENDLIST',
      '',
    ].join('\n');

    const out = rewriteVariantPlaylist(variant, {
      presignSegment: (filename) =>
        `https://r2.cloudflarestorage.com/${filename}?X-Amz-Signature=abc`,
    });
    const lines = out.split('\n');

    expect(lines[0]).toBe('#EXTM3U');
    expect(lines[2]).toBe(
      'https://r2.cloudflarestorage.com/segment_000.ts?X-Amz-Signature=abc'
    );
    expect(lines[4]).toBe(
      'https://r2.cloudflarestorage.com/segment_001.ts?X-Amz-Signature=abc'
    );
    expect(lines[5]).toBe('#EXT-X-ENDLIST');
  });

  it('passes through tags, blanks and absolute URIs', () => {
    const variant =
      '#EXTM3U\n\nhttps://cdn.example.com/segment_000.ts\n#EXT-X-ENDLIST\n';
    const out = rewriteVariantPlaylist(variant, {
      presignSegment: () => 'SHOULD_NOT_BE_USED',
    });
    expect(out).toBe(variant);
  });
});

describe('single-file HLS (EXT-X-BYTERANGE) — Approach B / Codex-bpjg5', () => {
  // Real `ffmpeg -hls_flags single_file` output shape (verified via spike S3):
  // every segment line references the SAME .ts file, with a preceding byte range.
  const singleFile = [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    '#EXT-X-TARGETDURATION:7',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXTINF:6.000000,',
    '#EXT-X-BYTERANGE:299108@0',
    'stream.ts',
    '#EXTINF:6.000000,',
    '#EXT-X-BYTERANGE:300048@299108',
    'stream.ts',
    '#EXTINF:6.000000,',
    '#EXT-X-BYTERANGE:300424@599156',
    'stream.ts',
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');

  it('collects exactly ONE segment regardless of byte-range count (O(1) presign)', () => {
    // The whole point: N byte-range entries → 1 unique file → 1 presign.
    expect(collectVariantSegments(singleFile)).toEqual(['stream.ts']);
  });

  it('presigns the single file exactly once when driven by collectVariantSegments', () => {
    // Mirrors the proxy flow: presign the collected set, then rewrite via a map.
    let presignCalls = 0;
    const map = new Map<string, string>();
    for (const seg of collectVariantSegments(singleFile)) {
      presignCalls++;
      map.set(
        seg,
        `https://r2.cloudflarestorage.com/${seg}?X-Amz-Signature=sig`
      );
    }
    expect(presignCalls).toBe(1);

    const out = rewriteVariantPlaylist(singleFile, {
      presignSegment: (f) => map.get(f) ?? 'MISSING',
    });

    // Every `stream.ts` line becomes the one presigned URL...
    const presignedUrl =
      'https://r2.cloudflarestorage.com/stream.ts?X-Amz-Signature=sig';
    expect(out.match(/stream\.ts\?X-Amz-Signature=sig/g)?.length).toBe(3);
    expect(out).toContain(presignedUrl);
    expect(out).not.toContain('MISSING');

    // ...and every byte-range / tag line is preserved untouched.
    expect(out).toContain('#EXT-X-VERSION:4');
    expect(out).toContain('#EXT-X-BYTERANGE:299108@0');
    expect(out).toContain('#EXT-X-BYTERANGE:300048@299108');
    expect(out).toContain('#EXT-X-BYTERANGE:300424@599156');
    expect(out).toContain('#EXT-X-ENDLIST');
  });
});

describe('hls-token sign/verify', () => {
  const SECRET = 'test-worker-shared-secret';
  const payload = {
    creatorId: 'user_abc',
    mediaId: '22222222-2222-4222-8222-222222222222',
  };

  it('verifies a freshly-signed valid token', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = await signHlsToken({ ...payload, exp }, SECRET);
    const result = await verifyHlsToken(token, SECRET);
    expect(result).toEqual({ ...payload, exp });
  });

  it('rejects a token signed with a different secret (tampered signature)', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = await signHlsToken({ ...payload, exp }, SECRET);
    expect(await verifyHlsToken(token, 'wrong-secret')).toBeNull();
  });

  it('rejects a token whose payload was tampered after signing', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = await signHlsToken({ ...payload, exp }, SECRET);
    const [, sig] = token.split('.');
    // Re-encode a different payload but keep the original signature.
    const forgedPayload = btoa(
      JSON.stringify({ ...payload, creatorId: 'attacker', exp })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyHlsToken(`${forgedPayload}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const token = await signHlsToken({ ...payload, exp }, SECRET);
    expect(await verifyHlsToken(token, SECRET)).toBeNull();
  });

  it('rejects a malformed token (no separator)', async () => {
    expect(await verifyHlsToken('not-a-token', SECRET)).toBeNull();
  });
});
