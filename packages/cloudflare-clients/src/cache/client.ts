import type { CachePurgeConfig, CloudflarePurgeResponse } from './types';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4/zones';
const MAX_URLS_PER_BATCH = 30;

/**
 * Cloudflare Cache Purge Client
 *
 * Purges CDN-cached URLs via the Cloudflare API.
 * Fire-and-forget: errors are logged, never thrown.
 *
 * Uses the same standalone class pattern as R2Service.
 */
export class CachePurgeClient {
  private readonly zoneId: string;
  private readonly apiToken: string;
  private readonly enabled: boolean;

  constructor(config?: CachePurgeConfig) {
    if (config?.zoneId && config?.apiToken) {
      this.zoneId = config.zoneId;
      this.apiToken = config.apiToken;
      this.enabled = true;
    } else {
      this.zoneId = '';
      this.apiToken = '';
      this.enabled = false;
    }
  }

  /**
   * Create a CachePurgeClient, returning a no-op stub if config is missing.
   */
  static create(zoneId?: string, apiToken?: string): CachePurgeClient {
    if (zoneId && apiToken) {
      return new CachePurgeClient({ zoneId, apiToken });
    }
    return new CachePurgeClient();
  }

  /**
   * Purge specific URLs from Cloudflare cache.
   * Batches requests to respect the 30-URL-per-call limit.
   * Errors are logged, never thrown.
   */
  async purgeByUrls(urls: string[]): Promise<void> {
    if (!this.enabled) return;
    if (urls.length === 0) return;

    const batches: string[][] = [];
    for (let i = 0; i < urls.length; i += MAX_URLS_PER_BATCH) {
      batches.push(urls.slice(i, i + MAX_URLS_PER_BATCH));
    }

    for (const batch of batches) {
      try {
        await this.purgeRequest({ files: batch });
      } catch (error) {
        console.error('Cache purge failed:', error);
      }
    }
  }

  /**
   * Purge all cached content for the zone.
   * Errors are logged, never thrown.
   */
  async purgeEverything(): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.purgeRequest({ purge_everything: true });
    } catch (error) {
      console.error('Cache purge (everything) failed:', error);
    }
  }

  private async purgeRequest(
    body: { files: string[] } | { purge_everything: true }
  ): Promise<CloudflarePurgeResponse> {
    const url = `${CF_API_BASE}/${this.zoneId}/purge_cache`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = (await response.json()) as CloudflarePurgeResponse;

    if (!result.success) {
      throw new Error(
        `Cloudflare purge failed: ${result.errors.map((e) => e.message).join(', ')}`
      );
    }

    return result;
  }
}
