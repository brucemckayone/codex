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
} from '../transcoding';

describe('Thumbnail Sizes', () => {
  /**
   * CRITICAL: This test ensures THUMBNAIL_SIZES stays in sync with Python.
   *
   * If you modify THUMBNAIL_SIZES, you MUST also update:
   * - infrastructure/runpod/handler/main.py:ALLOWED_THUMBNAIL_SIZES
   *
   * Both locations have cross-references in comments.
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
    const { width, height, ...withoutDimensions } = validAudioOutput;
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
