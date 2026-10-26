/**
 * Transcoding Schema Tests
 *
 * Validates transcoding-related schemas and ensures cross-platform consistency.
 */

import { describe, expect, it } from 'vitest';
import {
  runpodWebhookOutputSchema,
  runpodWebhookUnionSchema,
  THUMBNAIL_SIZES,
  thumbnailSizeSchema,
  transcodingStatusResponseSchema,
} from '../transcoding';

describe('Thumbnail Sizes', () => {
  /**
   * CRITICAL: This test ensures THUMBNAIL_SIZES stays in sync with Python.
   *
   * If you modify THUMBNAIL_SIZES, you MUST also update
   * infrastructure/runpod/handler/main.py FLAT_POSTER_SIZES (and POSTER_SIZES,
   * which adds xl), then regenerate the contract fixtures
   * (infrastructure/runpod/tests/fixtures/README.md).
   */
  it('should have exactly sm, md, lg variants (synced with Python)', () => {
    expect(THUMBNAIL_SIZES).toEqual(['sm', 'md', 'lg']);
  });

  it('should validate valid thumbnail sizes', () => {
    expect(thumbnailSizeSchema.safeParse('sm').success).toBe(true);
    expect(thumbnailSizeSchema.safeParse('md').success).toBe(true);
    expect(thumbnailSizeSchema.safeParse('lg').success).toBe(true);
  });

  it('should reject invalid thumbnail sizes', () => {
    expect(thumbnailSizeSchema.safeParse('xl').success).toBe(false);
    expect(thumbnailSizeSchema.safeParse('small').success).toBe(false);
    expect(thumbnailSizeSchema.safeParse('').success).toBe(false);
    expect(thumbnailSizeSchema.safeParse(null).success).toBe(false);
  });
});

describe('RunPod Webhook Output Schema', () => {
  const validOutput = {
    mediaId: '550e8400-e29b-41d4-a716-446655440000',
    type: 'video' as const,
    hlsMasterKey: 'user-123/hls/media-456/master.m3u8',
    durationSeconds: 300,
    width: 1920,
    height: 1080,
    readyVariants: ['1080p', '720p'] as const,
  };

  it('should validate complete webhook output', () => {
    const result = runpodWebhookOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it('should validate output with thumbnail variants', () => {
    const withVariants = {
      ...validOutput,
      thumbnailVariants: {
        sm: 'user-123/media-thumbnails/media-456/sm.webp',
        md: 'user-123/media-thumbnails/media-456/md.webp',
        lg: 'user-123/media-thumbnails/media-456/lg.webp',
      },
    };
    const result = runpodWebhookOutputSchema.safeParse(withVariants);
    expect(result.success).toBe(true);
  });

  it('should reject invalid thumbnail variant keys', () => {
    const withInvalidVariants = {
      ...validOutput,
      thumbnailVariants: {
        sm: 'path/sm.webp',
        md: 'path/md.webp',
        xl: 'path/xl.webp', // Invalid key
      },
    };
    const result = runpodWebhookOutputSchema.safeParse(withInvalidVariants);
    expect(result.success).toBe(false);
  });

  it('should reject durations over 24 hours', () => {
    const result = runpodWebhookOutputSchema.safeParse({
      ...validOutput,
      durationSeconds: 100000, // ~27 hours
    });
    expect(result.success).toBe(false);
  });

  it('should reject dimensions over 8K', () => {
    const result = runpodWebhookOutputSchema.safeParse({
      ...validOutput,
      width: 10000,
    });
    expect(result.success).toBe(false);
  });

  it('should accept a portrait 8K picture, reported upright', () => {
    const result = runpodWebhookOutputSchema.safeParse({
      ...validOutput,
      width: 4320,
      height: 7680,
    });
    expect(result.success).toBe(true);
  });

  it('should reject a height over 8K', () => {
    const result = runpodWebhookOutputSchema.safeParse({
      ...validOutput,
      width: 4320,
      height: 7681,
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty readyVariants', () => {
    const result = runpodWebhookOutputSchema.safeParse({
      ...validOutput,
      readyVariants: [],
    });
    expect(result.success).toBe(false);
  });

  it('should accept source variant in readyVariants', () => {
    const result = runpodWebhookOutputSchema.safeParse({
      ...validOutput,
      readyVariants: ['source'],
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid variant names in readyVariants', () => {
    const result = runpodWebhookOutputSchema.safeParse({
      ...validOutput,
      readyVariants: ['240p'],
    });
    expect(result.success).toBe(false);
  });

  it('should reject zero durationSeconds', () => {
    const result = runpodWebhookOutputSchema.safeParse({
      ...validOutput,
      durationSeconds: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should accept mezzanineKey when present', () => {
    const result = runpodWebhookOutputSchema.safeParse({
      ...validOutput,
      mezzanineKey: 'user-123/mezzanine/media-456/mezzanine.mp4',
    });
    expect(result.success).toBe(true);
  });
});

describe('RunPod Webhook Output Schema — Audio Payloads', () => {
  const validAudioOutput = {
    mediaId: '8f9f8d8e-6f58-43bf-9511-4f2223ba449a',
    type: 'audio' as const,
    hlsMasterKey: 'creator-123/hls/media-456/master.m3u8',
    waveformKey: 'creator-123/waveforms/media-456/waveform.json',
    waveformImageKey: 'creator-123/waveforms/media-456/waveform.png',
    durationSeconds: 2290,
    width: null,
    height: null,
    readyVariants: ['audio'] as const,
    loudnessIntegrated: -2117,
    loudnessPeak: -8,
    loudnessRange: 1170,
  };

  it('should accept audio payload with null width/height', () => {
    const result = runpodWebhookOutputSchema.safeParse(validAudioOutput);
    expect(result.success).toBe(true);
  });

  it('should accept audio payload with omitted width/height', () => {
    const {
      width: _width,
      height: _height,
      ...withoutDimensions
    } = validAudioOutput;
    const result = runpodWebhookOutputSchema.safeParse(withoutDimensions);
    expect(result.success).toBe(true);
  });

  it('should accept audio readyVariants', () => {
    const result = runpodWebhookOutputSchema.safeParse(validAudioOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.readyVariants).toEqual(['audio']);
    }
  });

  it('should accept null durationSeconds defensively', () => {
    const result = runpodWebhookOutputSchema.safeParse({
      ...validAudioOutput,
      durationSeconds: null,
    });
    expect(result.success).toBe(true);
  });

  it('should accept full audio payload matching Python handler output', () => {
    // Exact shape the Python handler sends for audio transcoding
    const pythonPayload = {
      mediaId: '8f9f8d8e-6f58-43bf-9511-4f2223ba449a',
      type: 'audio',
      hlsMasterKey: 'creator-123/hls/media-456/master.m3u8',
      hlsPreviewKey: null,
      thumbnailKey: null,
      thumbnailVariants: null,
      waveformKey: 'creator-123/waveforms/media-456/waveform.json',
      waveformImageKey: 'creator-123/waveforms/media-456/waveform.png',
      mezzanineKey: null,
      durationSeconds: 2290,
      width: null,
      height: null,
      readyVariants: ['audio'],
      loudnessIntegrated: -2117,
      loudnessPeak: -8,
      loudnessRange: 1170,
    };
    const result = runpodWebhookOutputSchema.safeParse(pythonPayload);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Codex-d3g6 sub-item 6: runpodWebhookUnionSchema (discriminated union)
// ============================================================================
describe('runpodWebhookUnionSchema', () => {
  const validOutput = {
    mediaId: '550e8400-e29b-41d4-a716-446655440000',
    type: 'video' as const,
    hlsMasterKey: 'user-123/hls/media-456/master.m3u8',
    durationSeconds: 300,
    width: 1920,
    height: 1080,
    readyVariants: ['1080p', '720p'] as const,
  };

  it("should accept 'completed' status branch with valid output", () => {
    const result = runpodWebhookUnionSchema.safeParse({
      jobId: 'runpod-job-1',
      status: 'completed',
      output: validOutput,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('completed');
    }
  });

  it("should accept 'failed' status branch with error message and optional mediaId", () => {
    const result = runpodWebhookUnionSchema.safeParse({
      jobId: 'runpod-job-2',
      status: 'failed',
      error: 'Transcoding failed',
      mediaId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.status === 'failed') {
      expect(result.data.error).toBe('Transcoding failed');
      expect(result.data.mediaId).toBe('550e8400-e29b-41d4-a716-446655440000');
    }
  });

  it("should accept 'failed' status branch without mediaId (cloud flow)", () => {
    // RunPod cloud failures arrive after runpodJobId is stored, so the
    // top-level mediaId is optional on the failed branch.
    const result = runpodWebhookUnionSchema.safeParse({
      jobId: 'runpod-job-3',
      status: 'failed',
      error: 'GPU OOM',
    });
    expect(result.success).toBe(true);
  });

  it("should accept 'progress' status branch with step + progress integer", () => {
    const result = runpodWebhookUnionSchema.safeParse({
      jobId: 'runpod-job-4',
      status: 'progress',
      progress: 50,
      step: 'encoding_variants',
      mediaId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.status === 'progress') {
      expect(result.data.progress).toBe(50);
      expect(result.data.step).toBe('encoding_variants');
    }
  });

  it('should reject payload with invalid status value', () => {
    const result = runpodWebhookUnionSchema.safeParse({
      jobId: 'runpod-job-5',
      status: 'unknown-status', // not one of completed/failed/progress
      error: 'something',
    });
    expect(result.success).toBe(false);
  });

  it('should reject payload missing the discriminator (status field)', () => {
    const result = runpodWebhookUnionSchema.safeParse({
      jobId: 'runpod-job-6',
      // status omitted entirely
      output: validOutput,
    });
    expect(result.success).toBe(false);
  });

  it("should reject 'progress' branch when progress is out of [0, 100] range", () => {
    const result = runpodWebhookUnionSchema.safeParse({
      jobId: 'runpod-job-7',
      status: 'progress',
      progress: 150, // out of range
      step: 'finalizing',
    });
    expect(result.success).toBe(false);
  });
});

describe('Webhook contract fields (Codex-l2c48)', () => {
  // The output today's deployed handler sends for a video (main.py `result`),
  // with every feature flag at its default.
  const deployedVideoOutput = {
    mediaId: '550e8400-e29b-41d4-a716-446655440000',
    type: 'video',
    hlsMasterKey:
      'creator/hls/550e8400-e29b-41d4-a716-446655440000/master.m3u8',
    hlsPreviewKey:
      'creator/hls/550e8400-e29b-41d4-a716-446655440000/preview/preview.m3u8',
    thumbnailKey: 'creator/media-thumbnails/550e8400/lg.webp',
    thumbnailVariants: {
      sm: 'creator/media-thumbnails/550e8400/sm.webp',
      md: 'creator/media-thumbnails/550e8400/md.webp',
      lg: 'creator/media-thumbnails/550e8400/lg.webp',
    },
    waveformKey: null,
    waveformImageKey: null,
    mezzanineKey: null,
    durationSeconds: 646,
    width: 3840,
    height: 2160,
    readyVariants: ['720p', '480p'],
    loudnessIntegrated: -2181,
    loudnessPeak: -1608,
    loudnessRange: 10,
  };

  it("accepts the deployed handler's output unchanged", () => {
    expect(
      runpodWebhookOutputSchema.safeParse(deployedVideoOutput).success
    ).toBe(true);
  });

  it('accepts null loudness, sent when loudness analysis is switched off', () => {
    const result = runpodWebhookOutputSchema.safeParse({
      ...deployedVideoOutput,
      loudnessIntegrated: null,
      loudnessPeak: null,
      loudnessRange: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an xl poster from the sized image layout', () => {
    const folder = 'creator/media-thumbnails/550e8400/3840x2160-0a1b2c3d';
    const result = runpodWebhookOutputSchema.safeParse({
      ...deployedVideoOutput,
      thumbnailKey: `${folder}/lg.webp`,
      thumbnailVariants: {
        sm: `${folder}/sm.webp`,
        md: `${folder}/md.webp`,
        lg: `${folder}/lg.webp`,
        xl: `${folder}/xl.webp`,
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.thumbnailVariants?.xl).toBe(`${folder}/xl.webp`);
  });

  it('still requires sm, md and lg beside xl', () => {
    const result = runpodWebhookOutputSchema.safeParse({
      ...deployedVideoOutput,
      thumbnailVariants: { lg: 'k/lg.webp', xl: 'k/xl.webp' },
    });
    expect(result.success).toBe(false);
  });

  it('keeps an errorCode on a failure, including one this build does not know', () => {
    const result = runpodWebhookUnionSchema.safeParse({
      jobId: 'runpod-job-9',
      status: 'failed',
      error: 'ffprobe failed (exit 1): moov atom not found',
      errorCode: 'SOME_FUTURE_CODE',
      mediaId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ errorCode: 'SOME_FUTURE_CODE' });
  });

  // A failure webhook must never be rejected for a detail: a rejected one
  // loses the very failure it reports, and the row waits 2 h for the cron.
  it.each([
    ['a null errorCode (Python None)', { errorCode: null }],
    ['an over-long errorCode', { errorCode: 'X'.repeat(51) }],
    ['an errorCode that is not a string', { errorCode: 42 }],
    ['a null mediaId (failure raised before it was read)', { mediaId: null }],
  ])('accepts a failure webhook with %s and keeps its error', (_, detail) => {
    const result = runpodWebhookUnionSchema.safeParse({
      jobId: 'runpod-job-9',
      status: 'failed',
      error: 'ffprobe failed (exit 1): moov atom not found',
      ...detail,
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      error: 'ffprobe failed (exit 1): moov atom not found',
    });
  });

  it('truncates an error message to the 2KB column instead of rejecting it', () => {
    // 1999 code points that are 2001 UTF-16 units: Python's [:2000] cut lets
    // this through, and a .max(2000) bound would have refused it.
    const message = `${'a'.repeat(1997)}🎬🎬`;
    const result = runpodWebhookUnionSchema.safeParse({
      jobId: 'runpod-job-9',
      status: 'failed',
      error: message,
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ error: message.slice(0, 2000) });
  });
});

describe('Sized poster folders (Codex-l2c48)', () => {
  const folder = 'creator/media-thumbnails/550e8400/1080x1920-0a1b2c3d';
  const output = {
    mediaId: '550e8400-e29b-41d4-a716-446655440000',
    type: 'video',
    thumbnailKey: `${folder}/lg.webp`,
    readyVariants: ['720p'],
  };
  const allFour = {
    sm: `${folder}/sm.webp`,
    md: `${folder}/md.webp`,
    lg: `${folder}/lg.webp`,
    xl: `${folder}/xl.webp`,
  };

  it('accepts a sized folder holding all four sizes', () => {
    expect(
      runpodWebhookOutputSchema.safeParse({
        ...output,
        thumbnailVariants: allFour,
      }).success
    ).toBe(true);
  });

  it('rejects a sized folder without xl, which the web lists by folder name', () => {
    const { xl: _xl, ...threeSizes } = allFour;
    const result = runpodWebhookOutputSchema.safeParse({
      ...output,
      thumbnailVariants: threeSizes,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['thumbnailVariants', 'xl']);
  });

  it('rejects a sized folder whose sizes live in another folder', () => {
    const result = runpodWebhookOutputSchema.safeParse({
      ...output,
      thumbnailVariants: { ...allFour, md: 'creator/elsewhere/md.webp' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['thumbnailVariants', 'md']);
  });

  it('rejects a sized folder with no variants at all', () => {
    expect(runpodWebhookOutputSchema.safeParse(output).success).toBe(false);
  });

  it('accepts the flat layout an older handler writes, without xl', () => {
    const flat = 'creator/media-thumbnails/550e8400';
    expect(
      runpodWebhookOutputSchema.safeParse({
        ...output,
        thumbnailKey: `${flat}/lg.webp`,
        thumbnailVariants: {
          sm: `${flat}/sm.webp`,
          md: `${flat}/md.webp`,
          lg: `${flat}/lg.webp`,
        },
      }).success
    ).toBe(true);
  });
});

describe('transcodingStatusResponseSchema', () => {
  const waiting = {
    status: 'uploaded',
    transcodingAttempts: 0,
    transcodingError: 'RunPod endpoint is paused',
    transcodingErrorCode: 'TRANSCODER_PAUSED',
    runpodJobId: null,
    transcodingPriority: 2,
    transcodingProgress: null,
    transcodingStep: null,
    readyVariants: null,
  };

  it('carries the error code of a waiting item', () => {
    const parsed = transcodingStatusResponseSchema.parse(waiting);
    expect(parsed.transcodingErrorCode).toBe('TRANSCODER_PAUSED');
  });

  it('accepts a null code when nothing has gone wrong', () => {
    expect(
      transcodingStatusResponseSchema.safeParse({
        ...waiting,
        transcodingError: null,
        transcodingErrorCode: null,
      }).success
    ).toBe(true);
  });

  // The response tracks the column: a status built without it is a bug.
  it('rejects a response that leaves the code out', () => {
    const { transcodingErrorCode: _omitted, ...withoutCode } = waiting;
    expect(transcodingStatusResponseSchema.safeParse(withoutCode).success).toBe(
      false
    );
  });
});
