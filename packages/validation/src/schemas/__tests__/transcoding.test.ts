/**
 * Transcoding Schema Tests
 *
 * Validates transcoding-related schemas and ensures cross-platform consistency.
 */

import { describe, expect, it } from 'vitest';
import {
  runpodWebhookOutputSchema,
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
});
