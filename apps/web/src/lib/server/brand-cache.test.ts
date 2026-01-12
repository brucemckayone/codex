import type { BrandingSettingsResponse } from '@codex/validation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CachedBrandConfig,
  deleteBrandConfig,
  getBrandConfig,
  setBrandConfig,
} from './brand-cache';

describe('BrandCache Service', () => {
  const mockPlatform = {
    env: {
      BRAND_KV: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      },
    },
    context: {
      waitUntil: vi.fn(),
    },
  } as unknown as App.Platform;

  const mockSlug = 'test-org';
  const mockBranding: BrandingSettingsResponse = {
    logoUrl: 'https://example.com/logo.png',
    primaryColorHex: '#ff0000',
  };
  const mockCachedData: CachedBrandConfig = {
    version: 1,
    updatedAt: new Date().toISOString(),
    branding: mockBranding,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBrandConfig', () => {
    it('should return cached data on hit', async () => {
      vi.mocked(mockPlatform.env!.BRAND_KV!.get).mockResolvedValue(
        mockCachedData as any
      );

      const result = await getBrandConfig(mockPlatform, mockSlug);

      expect(result).toEqual(mockCachedData);
      expect(mockPlatform.env!.BRAND_KV!.get).toHaveBeenCalledWith(
        'brand:test-org',
        'json'
      );
    });

    it('should return null on cache miss', async () => {
      vi.mocked(mockPlatform.env!.BRAND_KV!.get).mockResolvedValue(null);

      const result = await getBrandConfig(mockPlatform, mockSlug);

      expect(result).toBeNull();
    });

    it('should return null when KV is undefined', async () => {
      const result = await getBrandConfig({} as App.Platform, mockSlug);
      expect(result).toBeNull();
    });

    it('should return null on KV error', async () => {
      vi.mocked(mockPlatform.env!.BRAND_KV!.get).mockRejectedValue(
        new Error('KV Error')
      );
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
      vi.mocked(mockPlatform.env!.BRAND_KV!.put).mockReturnValue(
        fakePromise as any
      );

      setBrandConfig(mockPlatform, mockSlug, mockCachedData);

      expect(mockPlatform.env!.BRAND_KV!.put).toHaveBeenCalledWith(
        'brand:test-org',
        JSON.stringify(mockCachedData),
        { expirationTtl: 604800 }
      );
      expect(mockPlatform.context.waitUntil).toHaveBeenCalledWith(fakePromise);
    });

    it('should do nothing when platform is undefined', () => {
      setBrandConfig(undefined, mockSlug, mockCachedData);
      expect(mockPlatform.env!.BRAND_KV!.put).not.toHaveBeenCalled();
    });
  });

  describe('deleteBrandConfig', () => {
    it('should delete from KV and use waitUntil', () => {
      const fakePromise = Promise.resolve();
      vi.mocked(mockPlatform.env!.BRAND_KV!.delete).mockReturnValue(
        fakePromise as any
      );

      deleteBrandConfig(mockPlatform, mockSlug);

      expect(mockPlatform.env!.BRAND_KV!.delete).toHaveBeenCalledWith(
        'brand:test-org'
      );
      expect(mockPlatform.context.waitUntil).toHaveBeenCalledWith(fakePromise);
    });
  });
});
