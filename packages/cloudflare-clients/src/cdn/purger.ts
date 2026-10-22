/**
 * Purges Cloudflare's edge cache for one zone (Codex-kk9nv.15).
 *
 * Stills are stored `immutable` for a year, and deleting an R2 object does not
 * evict the copies Cloudflare's cache holds for the bucket's custom domain:
 * anyone holding the URL keeps loading it until the edge evicts it. A purge is
 * the only way to make a delete reach the edge. Browser caches cannot be
 * purged.
 *
 * The token needs the zone's Cache Purge permission and nothing else.
 */

/** The API's own limit on prefixes in one purge request. */
const MAX_PREFIXES_PER_PURGE = 100;

/**
 * How long a purge may take before it is given up. A Workers subrequest has
 * no time limit of its own, and a purge runs inside a request that has more
 * to do after it (account deletion still has to clear the user's sessions).
 */
const DEFAULT_PURGE_TIMEOUT_MS = 5_000;

export type CdnPurgeResult = { ok: true } | { ok: false; reason: string };

export interface CdnCachePurgerConfig {
  zoneId: string;
  apiToken: string;
  /** Default {@link DEFAULT_PURGE_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Test seam; the global `fetch` otherwise. */
  fetch?: typeof fetch;
}

export class CdnCachePurger {
  constructor(private readonly config: CdnCachePurgerConfig) {}

  /**
   * Purge everything cached under each prefix: a hostname and path with no
   * scheme, such as `cdn.example.com/avatars/u1`.
   *
   * Never throws, and never takes longer than the timeout. A purge follows a
   * change that has already happened, so a failure is returned for the caller
   * to log, never raised over that change.
   */
  async purgePrefixes(prefixes: readonly string[]): Promise<CdnPurgeResult> {
    if (prefixes.length === 0) return { ok: true };
    if (prefixes.length > MAX_PREFIXES_PER_PURGE) {
      return {
        ok: false,
        reason: `${prefixes.length} prefixes; one purge takes at most ${MAX_PREFIXES_PER_PURGE}`,
      };
    }

    // Called bare: workerd rejects a `fetch` invoked as another object's method.
    const send = this.config.fetch ?? fetch;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_PURGE_TIMEOUT_MS;
    try {
      const res = await send(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(this.config.zoneId)}/purge_cache`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prefixes }),
          signal: AbortSignal.timeout(timeoutMs),
        }
      );
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        errors?: unknown;
      } | null;
      if (res.ok && body?.success === true) return { ok: true };
      return {
        ok: false,
        reason: `HTTP ${res.status}: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        return { ok: false, reason: `timed out after ${timeoutMs}ms` };
      }
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
