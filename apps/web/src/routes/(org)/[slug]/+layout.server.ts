import { CACHE_TTL } from '@codex/constants';
import { brandingSettingsSchema } from '@codex/validation';
import {
  getBrandConfigWithStatus,
  setBrandConfig,
} from '$lib/server/brand-cache';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, platform, fetch }) => {
  const { slug } = params;

  // 1. Fast Path: Check KV cache (Zero latency)
  const cacheResult = await getBrandConfigWithStatus(platform, slug);

  if (cacheResult.status === 'hit') {
    const cached = cacheResult.data;

    // Issue 3: Validate cached data to prevent poisoning
    const validation = brandingSettingsSchema.safeParse(cached.branding);

    if (validation.success) {
      // Issue 6: Background refresh if cache is getting stale (older than 24 hours)
      const cacheAge = Date.now() - new Date(cached.updatedAt).getTime();
      if (cacheAge > CACHE_TTL.BRAND_CACHE_REFRESH_MS) {
        // Refresh TTL in background without blocking response
        setBrandConfig(platform, slug, {
          updatedAt: new Date().toISOString(),
          branding: validation.data,
        });
      }

      return { brandConfig: validation.data };
    }

    // If validation fails, log it and fall through to API fetch (self-healing)
    console.warn(
      `[Layout] Invalid/Poisoned cache for ${slug}:`,
      validation.error
    );
  }

  // Log KV errors for monitoring (Issue 5)
  if (cacheResult.status === 'error') {
    console.warn(`[Layout] KV cache error for ${slug}:`, cacheResult.error);
  }

  // 2. Slow Path: Fetch from Organization API
  try {
    const apiUrl = platform?.env?.API_URL || 'https://api.revelations.studio';

    // Get branding from public endpoint
    const orgRes = await fetch(`${apiUrl}/api/organizations/public/${slug}`);

    if (orgRes.ok) {
      const brandingData = await orgRes.json();

      // Validate API response
      const validation = brandingSettingsSchema.safeParse(brandingData);

      if (validation.success) {
        const branding = validation.data;

        // Background write to cache
        setBrandConfig(platform, slug, {
          updatedAt: new Date().toISOString(),
          branding,
        });

        return { brandConfig: branding };
      }

      console.error(
        `[Layout] Invalid branding from API for ${slug}:`,
        validation.error
      );
    }
  } catch (err) {
    console.error(`[Layout] Error fetching branding for ${slug}:`, err);
  }

  // Fallback: Return null (app will use CSS defaults)
  return { brandConfig: null };
};
