/**
 * buildStreamingResponse — a failed signing logs the R2 key and its cause,
 * and throws an R2SigningError that carries neither (Codex-adcgb).
 *
 * The error's context used to hold `{ r2Key, cause, code }`, and a
 * ServiceError's context is serialised into the response, so an entitled
 * viewer whose signing failed was sent `{creatorId}/hls/{mediaId}/...` and
 * the serialised cause. The key and cause are the log's alone now.
 *
 * DB-free: `buildStreamingResponse` takes its signer and logger as deps.
 */

import type { ObservabilityClient } from '@codex/observability';
import { describe, expect, it, vi } from 'vitest';
import { R2SigningError } from '../../errors';
import {
  buildStreamingResponse,
  type StreamingTarget,
} from '../content-access/streaming';

const R2_KEY = 'creator-1/hls/media-1/master.m3u8';

const audioTarget: StreamingTarget = {
  r2Key: R2_KEY,
  creatorId: 'creator-1',
  mediaId: 'media-1',
  mediaType: 'audio',
  waveformKey: 'creator-1/waveforms/media-1/waveform.json',
  readyVariants: null,
};

function stubObs() {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (err: unknown) => err
  );
}

describe('buildStreamingResponse signing failures', () => {
  it('a signer failure: logged with the key and cause, thrown with no context', async () => {
    const obs = stubObs();
    const signFailure = new Error('SigV4 clock skew');
    const r2 = {
      generateSignedUrl: vi.fn().mockRejectedValue(signFailure),
      getObjectText: vi.fn(),
    };

    const err = await rejectionOf(
      buildStreamingResponse(
        audioTarget,
        {
          r2,
          contentApiBaseUrl: 'https://content.example',
          hlsTokenSecret: 'test-secret',
          obs: obs as unknown as ObservabilityClient,
        },
        'user-1',
        'content-1',
        600
      )
    );

    expect(err).toBeInstanceOf(R2SigningError);
    expect((err as R2SigningError).context).toBeUndefined();
    expect((err as R2SigningError).cause).toBe(signFailure);
    expect(obs.error).toHaveBeenCalledWith(
      'Failed to mint HLS streaming URL',
      expect.objectContaining({
        r2Key: R2_KEY,
        errorMessage: 'SigV4 clock skew',
        contentId: 'content-1',
      })
    );
  });

  it('an unconfigured proxy: the reason is logged, not left on an error nothing logs', async () => {
    const obs = stubObs();

    const err = await rejectionOf(
      buildStreamingResponse(
        audioTarget,
        {
          r2: { generateSignedUrl: vi.fn(), getObjectText: vi.fn() },
          contentApiBaseUrl: undefined,
          hlsTokenSecret: 'test-secret',
          obs: obs as unknown as ObservabilityClient,
        },
        'user-1',
        'content-1',
        600
      )
    );

    expect(err).toBeInstanceOf(R2SigningError);
    expect((err as R2SigningError).context).toBeUndefined();
    expect(obs.error).toHaveBeenCalledTimes(1);
    expect(obs.error).toHaveBeenCalledWith(
      'Failed to mint HLS streaming URL',
      expect.objectContaining({
        r2Key: R2_KEY,
        errorMessage: expect.stringContaining('not configured'),
      })
    );
  });
});
