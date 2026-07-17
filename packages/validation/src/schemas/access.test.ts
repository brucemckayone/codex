import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  getPlaybackProgressSchema,
  getStreamingUrlSchema,
  hlsProxyQuerySchema,
  hlsVariantParamsSchema,
  listUserLibrarySchema,
  savePlaybackProgressSchema,
} from './access';

const validUUID = 'a1b2c3d4-e5f6-4a90-b234-567890abcdef';
// Note: 3rd segment must start with 1-8 (version), 4th segment must start with 8-9-a-b (variant)

describe('Content Access Validation Schemas', () => {
  describe('getStreamingUrlSchema', () => {
    it('should validate a correct input', () => {
      const input = { contentId: validUUID, expirySeconds: 3600 };
      const result = getStreamingUrlSchema.parse(input);
      expect(result).toEqual(input);
    });

    it('should use default expiry when not provided', () => {
      // Default tightened from 3600 → 600 (10 min) to bound post-revocation
      // exposure for cancelled subscriptions. See
      // docs/subscription-cache-audit/phase-2-followup.md — Phase 3.
      const input = { contentId: validUUID };
      const result = getStreamingUrlSchema.parse(input);
      expect(result.expirySeconds).toBe(600);
    });

    it('should throw an error for an invalid UUID', () => {
      const input = { contentId: 'invalid-uuid' };
      expect(() => getStreamingUrlSchema.parse(input)).toThrow(ZodError);
    });

    it('should throw an error for expiry below the minimum', () => {
      const input = { contentId: validUUID, expirySeconds: 299 };
      expect(() => getStreamingUrlSchema.parse(input)).toThrow(
        'Must be at least 5 minutes (300 seconds)'
      );
    });

    it('should throw an error for expiry above the maximum', () => {
      const input = { contentId: validUUID, expirySeconds: 7201 };
      expect(() => getStreamingUrlSchema.parse(input)).toThrow(
        'Must be 2 hours or less (7200 seconds)'
      );
    });

    it('should accept valid expiry at minimum boundary', () => {
      const input = { contentId: validUUID, expirySeconds: 300 };
      const result = getStreamingUrlSchema.parse(input);
      expect(result.expirySeconds).toBe(300);
    });

    it('should accept valid expiry at maximum boundary', () => {
      const input = { contentId: validUUID, expirySeconds: 7200 };
      const result = getStreamingUrlSchema.parse(input);
      expect(result.expirySeconds).toBe(7200);
    });
  });

  describe('savePlaybackProgressSchema', () => {
    it('should validate a correct input', () => {
      const input = {
        contentId: validUUID,
        positionSeconds: 120,
        durationSeconds: 600,
        completed: false,
      };
      const result = savePlaybackProgressSchema.parse(input);
      expect(result).toEqual(input);
    });

    it('should use default completed flag when not provided', () => {
      const input = {
        contentId: validUUID,
        positionSeconds: 120,
        durationSeconds: 600,
      };
      const result = savePlaybackProgressSchema.parse(input);
      expect(result.completed).toBe(false);
    });

    it('should throw an error for negative position', () => {
      const input = {
        contentId: validUUID,
        positionSeconds: -1,
        durationSeconds: 600,
      };
      expect(() => savePlaybackProgressSchema.parse(input)).toThrow(
        'Must be 0 or greater'
      );
    });

    it('should accept position of 0', () => {
      const input = {
        contentId: validUUID,
        positionSeconds: 0,
        durationSeconds: 600,
      };
      const result = savePlaybackProgressSchema.parse(input);
      expect(result.positionSeconds).toBe(0);
    });

    it('should throw an error for duration less than 1', () => {
      const input = {
        contentId: validUUID,
        positionSeconds: 0,
        durationSeconds: 0,
      };
      expect(() => savePlaybackProgressSchema.parse(input)).toThrow(
        'Must be greater than 0'
      );
    });
  });

  describe('getPlaybackProgressSchema', () => {
    it('should validate a correct input', () => {
      const input = { contentId: validUUID };
      const result = getPlaybackProgressSchema.parse(input);
      expect(result).toEqual(input);
    });

    it('should throw an error for an invalid UUID', () => {
      const input = { contentId: 'invalid-uuid' };
      expect(() => getPlaybackProgressSchema.parse(input)).toThrow(ZodError);
    });
  });

  describe('listUserLibrarySchema', () => {
    it('should validate an empty input and use defaults', () => {
      const input = {};
      const result = listUserLibrarySchema.parse(input);
      expect(result).toEqual({
        page: 1,
        limit: 20,
        filter: 'all',
        sortBy: 'recent',
        contentType: 'all',
        accessType: 'all',
        search: '',
      });
    });

    it('should validate a complete input', () => {
      const input = {
        page: 2,
        limit: 50,
        filter: 'in_progress',
        sortBy: 'title',
        contentType: 'video',
        accessType: 'purchased',
        search: 'test',
      };
      const result = listUserLibrarySchema.parse(input);
      expect(result).toEqual(input);
    });

    it('should throw an error for invalid filter value', () => {
      const input = { filter: 'invalid-filter' };
      expect(() => listUserLibrarySchema.parse(input)).toThrow(ZodError);
    });

    it('should throw an error for invalid sortBy value', () => {
      const input = { sortBy: 'invalid-sort' };
      expect(() => listUserLibrarySchema.parse(input)).toThrow(ZodError);
    });

    it('should throw an error for page number above maximum', () => {
      const input = { page: 1001 };
      expect(() => listUserLibrarySchema.parse(input)).toThrow(
        'Must be 1000 or less'
      );
    });

    it('should throw an error for limit above maximum', () => {
      const input = { limit: 101 };
      expect(() => listUserLibrarySchema.parse(input)).toThrow(
        'Must be 100 or less'
      );
    });

    it('should accept page at maximum boundary', () => {
      const input = { page: 1000 };
      const result = listUserLibrarySchema.parse(input);
      expect(result.page).toBe(1000);
    });

    it('should accept limit at maximum boundary', () => {
      const input = { limit: 100 };
      const result = listUserLibrarySchema.parse(input);
      expect(result.limit).toBe(100);
    });

    it.each([
      'free',
      'followers',
    ] as const)("should accept accessType='%s'", (accessType) => {
      const result = listUserLibrarySchema.parse({ accessType });
      expect(result.accessType).toBe(accessType);
    });

    it('should reject unknown accessType values', () => {
      expect(() => listUserLibrarySchema.parse({ accessType: 'team' })).toThrow(
        ZodError
      );
    });
  });

  describe('hlsProxyQuerySchema', () => {
    it('accepts a non-empty token', () => {
      expect(hlsProxyQuerySchema.parse({ token: 'abc.def' })).toEqual({
        token: 'abc.def',
      });
    });

    it('rejects an empty token', () => {
      expect(() => hlsProxyQuerySchema.parse({ token: '' })).toThrow(ZodError);
    });

    it('rejects a missing token', () => {
      expect(() => hlsProxyQuerySchema.parse({})).toThrow(ZodError);
    });
  });

  describe('hlsVariantParamsSchema', () => {
    it('accepts a UUID id with a valid variant', () => {
      const result = hlsVariantParamsSchema.parse({
        id: validUUID,
        variant: '1080p',
      });
      expect(result).toEqual({ id: validUUID, variant: '1080p' });
    });

    // Regression: audio media's master playlist references PHYSICAL bitrate
    // rungs (`128k` / `64k`), not the logical `audio` label. Validating the
    // proxy `:variant` param against the logical enum 403'd all audio playback
    // ("Invalid request"). See infrastructure/runpod/handler/main.py
    // AUDIO_VARIANTS + hlsVariantPathSchema.
    it.each([
      '720p',
      '480p',
      'source',
      '128k',
      '64k',
    ] as const)("accepts physical variant directory '%s'", (variant) => {
      const result = hlsVariantParamsSchema.parse({ id: validUUID, variant });
      expect(result).toEqual({ id: validUUID, variant });
    });

    it("rejects the logical-only 'audio' label (no physical audio/ directory)", () => {
      expect(() =>
        hlsVariantParamsSchema.parse({ id: validUUID, variant: 'audio' })
      ).toThrow(ZodError);
    });

    it('rejects an unknown variant', () => {
      expect(() =>
        hlsVariantParamsSchema.parse({ id: validUUID, variant: '4320p' })
      ).toThrow(ZodError);
    });

    it('rejects a non-UUID id', () => {
      expect(() =>
        hlsVariantParamsSchema.parse({ id: 'not-a-uuid', variant: '720p' })
      ).toThrow(ZodError);
    });
  });
});
