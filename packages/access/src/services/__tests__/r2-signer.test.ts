/**
 * The dev-cdn signer's existence check (Codex-a6ofh.6.5): the leaving download
 * refuses a lost original, so only dev-cdn's 404 may read as "absent". Any
 * other failed answer throws, or a dev-cdn outage would read as a lost file.
 */

import { InternalServiceError } from '@codex/service-errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevR2Signer } from '../content-access/r2-signer';

const signer = new DevR2Signer('http://dev-cdn.test/bucket');

function answer(status: number) {
  const fetchMock = vi.fn(async () => new Response(null, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('DevR2Signer.objectExists', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks dev-cdn with a HEAD, and a 200 is there', async () => {
    const fetchMock = answer(200);

    await expect(signer.objectExists('c/originals/m/video.mp4')).resolves.toBe(
      true
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://dev-cdn.test/bucket/c/originals/m/video.mp4',
      { method: 'HEAD' }
    );
  });

  it('reads only a 404 as absent', async () => {
    answer(404);
    await expect(signer.objectExists('c/originals/m/gone.mp4')).resolves.toBe(
      false
    );
  });

  it.each([
    500, 503, 403,
  ])('throws on a %i, never answering absent', async (status) => {
    answer(status);
    const err = await signer
      .objectExists('c/originals/m/video.mp4')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InternalServiceError);
    expect(err).toMatchObject({ statusCode: 500, context: { status } });
  });
});
