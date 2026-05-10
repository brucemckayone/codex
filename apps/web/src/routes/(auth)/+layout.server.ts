/**
 * Auth layout server load
 *
 * Detects the org subdomain on the inbound request and fetches public org
 * branding so the auth pages can theme themselves to the org. Subdomain-only
 * detection — query strings and Referer are deliberately ignored to avoid
 * letting an attacker craft a phishing URL where the visible URL bar disagrees
 * with the brand on the page.
 *
 * Falls back to platform context (no branding, default shader preset) when:
 *   - hostname has no subdomain (lvh.me / revelations.studio)
 *   - subdomain is reserved (www, creators, app, …)
 *   - public endpoint returns null or throws (unknown slug, worker error)
 */

import type { ShaderPresetId } from '$lib/components/ui/ShaderHero/shader-config';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { OrganizationData } from '$lib/types';
import { extractSubdomain, isReservedSubdomain } from '$lib/utils/subdomain';
import type { LayoutServerLoad } from './$types';

const PLATFORM_DEFAULT_PRESET: ShaderPresetId = 'flow';

export const load: LayoutServerLoad = async ({
  url,
  platform,
  cookies,
  setHeaders,
}) => {
  setHeaders(CACHE_HEADERS.PRIVATE);

  const subdomain = extractSubdomain(url.hostname);
  const isOrgSubdomain =
    subdomain !== null &&
    subdomain !== 'www' &&
    !isReservedSubdomain(subdomain);

  if (!isOrgSubdomain) {
    return { branding: null, defaultPreset: PLATFORM_DEFAULT_PRESET };
  }

  try {
    const api = createServerApi(platform, cookies);
    const org = await api.org.getPublicInfo(subdomain);
    if (org && typeof org === 'object' && 'id' in org) {
      return {
        branding: org as OrganizationData,
        defaultPreset: PLATFORM_DEFAULT_PRESET,
      };
    }
  } catch {
    // Unknown slug, worker unreachable, or any other failure — degrade
    // silently to the platform default. Never surface "no such org" on the
    // login page; that would be an enumeration oracle.
  }

  return { branding: null, defaultPreset: PLATFORM_DEFAULT_PRESET };
};
