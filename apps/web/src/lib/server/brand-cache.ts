import { CACHE_TTL } from '@codex/constants';
import type { BrandingSettingsResponse } from '@codex/shared-types';
import { logger } from '$lib/observability';

const CACHE_KEY_PREFIX = 'brand:';
const TTL_SECONDS = CACHE_TTL.BRAND_CACHE_SECONDS;

export interface CachedBrandConfig {
  updatedAt: string;
  branding: BrandingSettingsResponse;
}

/** Result type for cache operations - distinguishes hit/miss/error */
export type CacheResult =
  | { status: 'hit'; data: CachedBrandConfig }
  | { status: 'miss' }
  | { status: 'error'; error: string };

/**
 * Retrieve branding configuration from KV cache with status information.
 * Returns status to distinguish between cache miss and KV errors for monitoring.
 */
export async function getBrandConfigWithStatus(
  platform: App.Platform | undefined,
  slug: string
): Promise<CacheResult> {
  if (!platform?.env?.BRAND_KV) return { status: 'miss' };

  try {
    const result = await platform.env.BRAND_KV.get<CachedBrandConfig>(
      `${CACHE_KEY_PREFIX}${slug}`,
      'json'
    );
    return result ? { status: 'hit', data: result } : { status: 'miss' };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('Error reading brand cache', {
      slug,
      error: errorMessage,
    });
    return { status: 'error', error: errorMessage };
  }
}

/**
 * Retrieve branding configuration from KV cache.
 * Returns null if cache miss, KV undefined (local dev), or error.
 * @deprecated Use getBrandConfigWithStatus for better error handling
 */
export async function getBrandConfig(
  platform: App.Platform | undefined,
  slug: string
): Promise<CachedBrandConfig | null> {
  const result = await getBrandConfigWithStatus(platform, slug);
  return result.status === 'hit' ? result.data : null;
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
