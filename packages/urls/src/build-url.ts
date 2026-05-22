import type { EnvName, HostInfo, ServiceName } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// STUBS — filled in WP-3 (buildServiceUrl) and WP-4 (org/platform/content URL
// builders). Signatures are stable so WP-2/3/4/5a can develop in parallel.
// Throwing here surfaces an explicit error if any consumer reaches a stub
// before its implementing WP has landed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a worker service URL. Reads env-var override first; falls back to
 * `ENV_HOSTS[env].apiUrl(service)`.
 *
 * Replaces `getServiceUrl` from `@codex/constants/src/env.ts` (which becomes
 * a re-export shim in WP-3).
 */
export function buildServiceUrl(
  _service: ServiceName,
  _env: EnvName | boolean | { ENVIRONMENT?: string; [k: string]: unknown }
): string {
  throw new Error('buildServiceUrl: not implemented (WP-3)');
}

/**
 * Build a full URL on a specific org subdomain, derived from a parsed host.
 * Preserves the current page's protocol and port (when present).
 */
export function buildOrgUrl(
  _host: HostInfo,
  _slug: string,
  _path = '/'
): string {
  throw new Error('buildOrgUrl: not implemented (WP-4)');
}

/**
 * Build an org subdomain URL from an env name (no request context required).
 * Used by `DevDomainService` and any worker that needs an org URL without
 * a `currentUrl` to derive from.
 */
export function buildOrgUrlFromEnv(
  _env: EnvName,
  _slug: string,
  _path = '/'
): string {
  throw new Error('buildOrgUrlFromEnv: not implemented (WP-4)');
}

/**
 * Build a platform URL (no subdomain, root of the apex).
 */
export function buildPlatformUrl(_host: HostInfo, _path = '/'): string {
  throw new Error('buildPlatformUrl: not implemented (WP-4)');
}

/**
 * Build a URL on the `creators` subdomain.
 */
export function buildCreatorsUrl(_host: HostInfo, _path = '/'): string {
  throw new Error('buildCreatorsUrl: not implemented (WP-4)');
}

/**
 * Build a URL to a content detail page, handling cross-org subdomain routing.
 *
 * - On the content's own org subdomain → root-relative `/content/{slug}`
 * - On a different origin (platform, other org) → full URL via buildOrgUrl
 * - Falls back to content ID if slug is unavailable
 */
export function buildContentUrl(
  _host: HostInfo,
  _content: {
    slug?: string | null;
    id: string;
    organizationSlug?: string | null;
  }
): string {
  throw new Error('buildContentUrl: not implemented (WP-4)');
}
