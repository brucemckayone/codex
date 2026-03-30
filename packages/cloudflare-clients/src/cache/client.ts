import type { CachePurgeConfig, CloudflarePurgeResponse } from './types';

/** Minimal logger interface to avoid coupling to @codex/observability */
interface Logger {
  warn(message: string, metadata?: Record<string, unknown>): void;
}

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
  private readonly logger?: Logger;

  constructor(config?: CachePurgeConfig, logger?: Logger) {
    if (config?.zoneId && config?.apiToken) {
      this.zoneId = config.zoneId;
      this.apiToken = config.apiToken;
      this.enabled = true;
    } else {
      this.zoneId = '';
      this.apiToken = '';
      this.enabled = false;
    }
    this.logger = logger;
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

    const results = await Promise.allSettled(
      batches.map((batch) => this.purgeRequest({ files: batch }))
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        const msg = 'Cache purge failed';
        if (this.logger) {
          this.logger.warn(msg, { reason: String(result.reason) });
        } else {
          console.error(msg, result.reason);
        }
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
      const msg = 'Cache purge (everything) failed';
      if (this.logger) {
        this.logger.warn(msg, {
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        console.error(msg, error);
      }
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
      signal: AbortSignal.timeout(10_000),
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
