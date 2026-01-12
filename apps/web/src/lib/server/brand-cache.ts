import type { BrandingSettingsResponse } from '@codex/validation';

const CACHE_KEY_PREFIX = 'brand:';
const TTL_SECONDS = 604800; // 7 days

export interface CachedBrandConfig {
  version: number;
  updatedAt: string;
  branding: BrandingSettingsResponse;
}

/**
 * Retrieve branding configuration from KV cache.
 * Returns null if cache miss, KV undefined (local dev), or error.
 */
export async function getBrandConfig(
  platform: App.Platform | undefined,
  slug: string
): Promise<CachedBrandConfig | null> {
  if (!platform?.env?.BRAND_KV) return null;

  try {
    return await platform.env.BRAND_KV.get<CachedBrandConfig>(
      `${CACHE_KEY_PREFIX}${slug}`,
      'json'
    );
  } catch (err) {
    console.error(`[BrandCache] Error reading cache for ${slug}:`, err);
    return null;
  }
}

/**
 * Write branding configuration to KV cache.
 * Uses waitUntil to ensure non-blocking execution in Workers.
 */
export function setBrandConfig(
  platform: App.Platform | undefined,
  slug: string,
  data: CachedBrandConfig
): void {
  if (!platform?.env?.BRAND_KV) return;

  const promise = platform.env.BRAND_KV.put(
    `${CACHE_KEY_PREFIX}${slug}`,
    JSON.stringify(data),
    { expirationTtl: TTL_SECONDS }
  );

  platform.context.waitUntil(promise);
}

/**
 * Remove branding configuration from KV cache.
 * Uses waitUntil to ensure non-blocking execution.
 */
export function deleteBrandConfig(
  platform: App.Platform | undefined,
  slug: string
): void {
  if (!platform?.env?.BRAND_KV) return;

  const promise = platform.env.BRAND_KV.delete(`${CACHE_KEY_PREFIX}${slug}`);

  platform.context.waitUntil(promise);
}
