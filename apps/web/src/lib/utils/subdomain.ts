/**
 * Subdomain parsing utilities (apps/web wrapper layer)
 *
 * Used by the reroute hook (`apps/web/src/hooks.ts`), auth-layer guards
 * (`apps/web/src/routes/(auth)/+layout.server.ts`), and 30+ Svelte
 * components that import from `$lib/utils/subdomain`.
 *
 * The actual parsing lives in `@codex/urls.parseHost` — this file is a
 * thin re-export / adapter layer so the existing callers don't need to
 * change their imports. URL builders (buildOrgUrl, buildPlatformUrl,
 * buildCreatorsUrl, buildContentUrl) still live here pending WP-4
 * (Codex-fiveo) which will move them to @codex/urls.
 */

import { parseHost } from '@codex/urls';
import { RESERVED_SUBDOMAINS } from '$lib/constants';

/**
 * Extract subdomain from hostname. Returns `null` on the bare apex,
 * nested subdomains, or unknown hosts.
 *
 * Backward-compatible wrapper over `@codex/urls.parseHost`.
 */
export function extractSubdomain(hostname: string): string | null {
  return parseHost(hostname).subdomain;
}

/**
 * Check if a subdomain is reserved (cannot be an org slug). Unchanged
 * from historical behaviour — reads from `@codex/constants.RESERVED_SUBDOMAINS_SET`
 * via the apps/web re-export at `$lib/constants`.
 */
export function isReservedSubdomain(subdomain: string): boolean {
  return RESERVED_SUBDOMAINS.has(subdomain.toLowerCase());
}

type SubdomainContext =
  | { type: 'platform' }
  | { type: 'creators' }
  | { type: 'organization'; slug: string }
  | { type: 'reserved'; subdomain: string };

/**
 * Build a full URL on a different org subdomain.
 *
 * Cross-org navigation requires changing the hostname (different origin),
 * so we need a full URL rather than a root-relative path.
 *
 * @param currentUrl - The current page URL (used to derive protocol, port, and base domain)
 * @param slug - The org slug to navigate to
 * @param path - The path on the org subdomain (default: '/')
 * @returns Full URL string, e.g. "http://bruce-studio.lvh.me:3000/studio"
 *          or "http://bruce-studio.192.168.1.10.nip.io:3000/studio"
 */
export function buildOrgUrl(currentUrl: URL, slug: string, path = '/'): string {
  const baseDomain = deriveBaseDomain(currentUrl.hostname);
  const port = currentUrl.port;
  const portSuffix = port ? `:${port}` : '';
  return `${currentUrl.protocol}//${slug}.${baseDomain}${portSuffix}${path}`;
}

/**
 * Derive the base apex domain (everything AFTER an org slug). Thin
 * wrapper over `@codex/urls.parseHost` — the builder family below uses
 * this internally. WP-4 will inline `parseHost` directly into each
 * builder and remove this helper.
 */
function deriveBaseDomain(host: string): string {
  return parseHost(host).baseDomain;
}

/**
 * Build a URL to the creators subdomain.
 * E.g., buildCreatorsUrl(currentUrl, '/studio') → 'http://creators.lvh.me:3000/studio'
 */
export function buildCreatorsUrl(currentUrl: URL, path = '/'): string {
  return buildOrgUrl(currentUrl, 'creators', path);
}

/**
 * Build a URL to the root platform domain (no subdomain).
 * E.g., buildPlatformUrl(currentUrl, '/library') → 'http://lvh.me:3000/library'
 */
export function buildPlatformUrl(currentUrl: URL, path = '/'): string {
  const baseDomain = deriveBaseDomain(currentUrl.hostname);
  const port = currentUrl.port;
  const portSuffix = port ? `:${port}` : '';
  return `${currentUrl.protocol}//${baseDomain}${portSuffix}${path}`;
}

/**
 * Build a URL to a content detail page, handling cross-org subdomain routing.
 *
 * - On the content's own org subdomain → root-relative `/content/{slug}`
 * - On a different origin (platform, other org) → full URL via buildOrgUrl()
 * - Falls back to content ID if slug is unavailable
 */
export function buildContentUrl(
  currentUrl: URL,
  content: {
    slug?: string | null;
    id: string;
    organizationSlug?: string | null;
  }
): string {
  const contentPath = `/content/${content.slug ?? content.id}`;

  if (content.organizationSlug) {
    const currentSubdomain = extractSubdomain(currentUrl.hostname);
    if (currentSubdomain !== content.organizationSlug) {
      return buildOrgUrl(currentUrl, content.organizationSlug, contentPath);
    }
  }

  return contentPath;
}

/**
 * Determine the context type from a hostname.
 *
 * Returns:
 * - `{ type: 'platform' }` on apex, www, or unrecognised host (parseHost env=null)
 * - `{ type: 'creators' }` on the creators subdomain
 * - `{ type: 'reserved', subdomain }` on infrastructure subdomains
 *   (api, auth, content-api, etc — see RESERVED_SUBDOMAINS)
 * - `{ type: 'organization', slug }` otherwise
 */
export function getSubdomainContext(hostname: string): SubdomainContext {
  const subdomain = parseHost(hostname).subdomain;

  // No subdomain or www → platform
  if (!subdomain || subdomain === 'www') {
    return { type: 'platform' };
  }

  // Creators subdomain
  if (subdomain === 'creators') {
    return { type: 'creators' };
  }

  // Reserved subdomains (APIs, admin, etc.)
  if (isReservedSubdomain(subdomain)) {
    return { type: 'reserved', subdomain };
  }

  // Otherwise, it's an organization subdomain
  return { type: 'organization', slug: subdomain };
}
