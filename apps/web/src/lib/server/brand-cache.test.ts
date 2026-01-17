import type { BrandingSettingsResponse } from '@codex/validation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CachedBrandConfig,
  deleteBrandConfig,
  getBrandConfig,
  setBrandConfig,
} from './brand-cache';

vi.mock('$lib/observability', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('Brand Cache', () => {
  // Mock implementations
  const mockGet = vi.fn();
  const mockPut = vi.fn();
  const mockDelete = vi.fn();
  const mockWaitUntil = vi.fn();

  const mockPlatform = {
    env: {
      BRAND_KV: {
        get: mockGet,
        put: mockPut,
        delete: mockDelete,
      },
    },
    context: {
      waitUntil: mockWaitUntil,
    },
  } as unknown as App.Platform;

  const mockSlug = 'test-org';
  const mockBranding: BrandingSettingsResponse = {
    logoUrl: 'https://example.com/logo.png',
    primaryColorHex: '#ff0000',
  };
  const mockCachedData: CachedBrandConfig = {
    updatedAt: new Date().toISOString(),
    branding: mockBranding,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBrandConfig', () => {
    it('should return cached data on hit', async () => {
      mockGet.mockResolvedValue(mockCachedData);

      const result = await getBrandConfig(mockPlatform, mockSlug);

      expect(result).toEqual(mockCachedData);
      expect(mockGet).toHaveBeenCalledWith('brand:test-org', 'json');
    });

    it('should return null on cache miss', async () => {
      mockGet.mockResolvedValue(null);

      const result = await getBrandConfig(mockPlatform, mockSlug);

      expect(result).toBeNull();
    });

    it('should return null when KV is undefined', async () => {
      // Create incomplete platform override
      const emptyPlatform = {} as App.Platform;
      const result = await getBrandConfig(emptyPlatform, mockSlug);
      expect(result).toBeNull();
    });

    it('should return null on KV error', async () => {
      mockGet.mockRejectedValue(new Error('KV Error'));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const result = await getBrandConfig(mockPlatform, mockSlug);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('setBrandConfig', () => {
    it('should write to KV and use waitUntil', () => {
      // Return a fake promise to verify it's passed to waitUntil
      const fakePromise = Promise.resolve();
      mockPut.mockReturnValue(fakePromise);

      setBrandConfig(mockPlatform, mockSlug, mockCachedData);

      expect(mockPut).toHaveBeenCalledWith(
        'brand:test-org',
        JSON.stringify(mockCachedData),
        { expirationTtl: 604800 }
      );
      expect(mockWaitUntil).toHaveBeenCalledWith(fakePromise);
    });

    it('should do nothing when platform is undefined', () => {
      setBrandConfig(undefined, mockSlug, mockCachedData);
      expect(mockPut).not.toHaveBeenCalled();
    });
  });

  describe('deleteBrandConfig', () => {
    it('should delete from KV and use waitUntil', () => {
      const fakePromise = Promise.resolve();
      mockDelete.mockReturnValue(fakePromise);

      deleteBrandConfig(mockPlatform, mockSlug);

      expect(mockDelete).toHaveBeenCalledWith('brand:test-org');
      expect(mockWaitUntil).toHaveBeenCalledWith(fakePromise);
    });
  });
});
