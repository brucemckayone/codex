import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  getPlaybackProgressSchema,
  getStreamingUrlSchema,
  listUserLibrarySchema,
  savePlaybackProgressSchema,
} from './access';

const validUUID = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';

describe('Content Access Validation Schemas', () => {
  describe('getStreamingUrlSchema', () => {
    it('should validate a correct input', () => {
      const input = { contentId: validUUID, expirySeconds: 3600 };
      const result = getStreamingUrlSchema.parse(input);
      expect(result).toEqual(input);
    });

    it('should use default expiry when not provided', () => {
      const input = { contentId: validUUID };
      const result = getStreamingUrlSchema.parse(input);
      expect(result.expirySeconds).toBe(3600);
    });

    it('should throw an error for an invalid UUID', () => {
      const input = { contentId: 'invalid-uuid' };
      expect(() => getStreamingUrlSchema.parse(input)).toThrow(ZodError);
    });

    it('should throw an error for expiry below the minimum', () => {
      const input = { contentId: validUUID, expirySeconds: 299 };
      expect(() => getStreamingUrlSchema.parse(input)).toThrow(
        'Minimum expiry is 5 minutes (300 seconds)'
      );
    });

    it('should throw an error for expiry above the maximum', () => {
      const input = { contentId: validUUID, expirySeconds: 86401 };
      expect(() => getStreamingUrlSchema.parse(input)).toThrow(
        'Maximum expiry is 24 hours (86400 seconds)'
      );
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
      });
    });

    it('should validate a complete input', () => {
      const input = {
        page: 2,
        limit: 50,
        filter: 'in-progress',
        sortBy: 'title',
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
  });
});
