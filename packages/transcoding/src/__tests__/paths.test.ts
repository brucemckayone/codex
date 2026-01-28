import { describe, expect, it } from 'vitest';
import {
  B2_PATH_CONFIG,
  getContentThumbnailKey,
  getHlsMasterKey,
  getHlsPreviewKey,
  getMezzanineKey,
  getMezzaninePrefix,
  getOrgLogoKey,
  getOriginalKey,
  getThumbnailKey,
  getUserAvatarKey,
  getWaveformKey,
  isValidR2Key,
  parseR2Key,
} from '../paths';

describe('Path Helpers', () => {
  const creatorId = 'user_123';
  const mediaId = '550e8400-e29b-41d4-a716-446655440000';

  describe('R2 Key Generation', () => {
    it('getOriginalKey should return correct format', () => {
      const key = getOriginalKey(creatorId, mediaId, 'video.mp4');
      expect(key).toBe(`${creatorId}/originals/${mediaId}/video.mp4`);
    });

    it('getHlsMasterKey should return correct format', () => {
      const key = getHlsMasterKey(creatorId, mediaId);
      expect(key).toBe(`${creatorId}/hls/${mediaId}/master.m3u8`);
    });

    it('getHlsPreviewKey should return correct format', () => {
      const key = getHlsPreviewKey(creatorId, mediaId);
      expect(key).toBe(`${creatorId}/hls/${mediaId}/preview/preview.m3u8`);
    });

    it('getThumbnailKey should return correct format', () => {
      const key = getThumbnailKey(creatorId, mediaId);
      expect(key).toBe(`${creatorId}/thumbnails/${mediaId}/auto-generated.jpg`);
    });

    it('getWaveformKey should return correct format', () => {
      const key = getWaveformKey(creatorId, mediaId);
      expect(key).toBe(`${creatorId}/waveforms/${mediaId}/waveform.json`);
    });

    it('getContentThumbnailKey should return correct format', () => {
      const key = getContentThumbnailKey(creatorId, 'content-123', 'md');
      expect(key).toBe(`${creatorId}/content-thumbnails/content-123/md.webp`);
    });

    it('getOrgLogoKey should return correct format', () => {
      const key = getOrgLogoKey(creatorId, 'lg');
      expect(key).toBe(`${creatorId}/branding/logo/lg.webp`);
    });

    it('getUserAvatarKey should return correct format', () => {
      const key = getUserAvatarKey('user-456', 'sm');
      expect(key).toBe(`avatars/user-456/sm.webp`);
    });
  });

  describe('B2 Key Generation', () => {
    it('getMezzanineKey should return correct format', () => {
      const key = getMezzanineKey(creatorId, mediaId);
      expect(key).toBe(
        `${creatorId}/${B2_PATH_CONFIG.MEZZANINE_FOLDER}/${mediaId}/${B2_PATH_CONFIG.MEZZANINE_FILENAME}`
      );
      // Double check exact string to ensure config wasn't accidentally changed
      expect(key).toBe(`${creatorId}/mezzanine/${mediaId}/mezzanine.mp4`);
    });

    it('getMezzaninePrefix should return correct format', () => {
      const prefix = getMezzaninePrefix(creatorId, mediaId);
      expect(prefix).toBe(
        `${creatorId}/${B2_PATH_CONFIG.MEZZANINE_FOLDER}/${mediaId}/`
      );
    });
  });

  describe('R2 Key Parsing and Validation', () => {
    it('isValidR2Key should return true for valid keys', () => {
      const validKey = `${creatorId}/originals/${mediaId}/video.mp4`;
      expect(isValidR2Key(validKey)).toBe(true);
    });

    // isValidR2Key only validates format, not ownership against a creatorId argument
    it('isValidR2Key should return true for valid key structure regardless of creator', () => {
      const otherCreatorKey = `other_user/originals/${mediaId}/video.mp4`;
      expect(isValidR2Key(otherCreatorKey)).toBe(true);
    });

    it('isValidR2Key should return false for malformed keys', () => {
      expect(isValidR2Key('invalid-key')).toBe(false);
      expect(isValidR2Key(`${creatorId}/foo`)).toBe(false); // Too short
    });

    it('parseR2Key should extract components correctly', () => {
      const key = `${creatorId}/originals/${mediaId}/video.mp4`;
      const result = parseR2Key(key);
      expect(result).toEqual({
        creatorId,
        folder: 'originals',
        mediaId,
        filename: 'video.mp4',
      });
    });

    it('parseR2Key should return null for invalid keys', () => {
      expect(parseR2Key('invalid-key')).toBeNull();
    });
  });
});
