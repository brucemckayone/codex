/**
 * Subdomain parsing utilities (apps/web wrapper layer)
 *
 * Used by the reroute hook (`apps/web/src/hooks.ts`), auth-layer guards
 * (`apps/web/src/routes/(auth)/+layout.server.ts`), and 30+ Svelte
 * components that import from `$lib/utils/subdomain`.
 *
 * All parsing AND URL-building lives in `@codex/urls`. This file is a
 * thin re-export / adapter layer so existing callers don't change imports.
 */

import {
  buildContentUrl as buildContentUrlInner,
  buildCreatorsUrl as buildCreatorsUrlInner,
  buildJourneyUrl as buildJourneyUrlInner,
  buildOrgUrl as buildOrgUrlInner,
  buildPlatformUrl as buildPlatformUrlInner,
  parseHost,
} from '@codex/urls';
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
 * URL builders re-exported from `@codex/urls` (WP-4 / Codex-fiveo).
 * 30+ Svelte components import these via `$lib/utils/subdomain`; the
 * re-export layer means consumers don't change imports.
 */
export const buildOrgUrl = buildOrgUrlInner;
export const buildCreatorsUrl = buildCreatorsUrlInner;
export const buildPlatformUrl = buildPlatformUrlInner;
export const buildContentUrl = buildContentUrlInner;
/** Journeys build (Codex-2pryk · WP-0) — sibling of buildContentUrl for course pages. */
export const buildJourneyUrl = buildJourneyUrlInner;

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
