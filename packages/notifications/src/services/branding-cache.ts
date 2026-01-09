/**
 * Simple in-memory cache for branding settings
 * Reduces database queries and service instantiation overhead
 */

interface CacheEntry {
  data: Record<string, string>;
  expiresAt: number;
}

export class BrandingCache {
  private cache = new Map<string, CacheEntry>();
  private readonly ttl: number;

  constructor(ttlMs: number = 5 * 60 * 1000) {
    // Default: 5 minutes
    this.ttl = ttlMs;
  }

  /**
   * Get cached branding data for an organization
   * @returns Cached data or null if not found/expired
   */
  get(organizationId: string): Record<string, string> | null {
    const entry = this.cache.get(organizationId);
    if (!entry) {
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(organizationId);
      return null;
    }

    return entry.data;
  }

  /**
   * Cache branding data for an organization
   */
  set(organizationId: string, data: Record<string, string>): void {
    this.cache.set(organizationId, {
      data,
      expiresAt: Date.now() + this.ttl,
    });
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove a specific organization's cached data
   */
  delete(organizationId: string): void {
    this.cache.delete(organizationId);
  }
}
