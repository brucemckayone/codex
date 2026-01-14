/**
 * Client-side reroute hook for subdomain-based routing
 *
 * Maps subdomains to internal route groups:
 * - revelations.studio/* → /(platform)/*
 * - creators.revelations.studio/* → /(creators)/*
 * - {org-slug}.revelations.studio/* → /(org)/[slug]/*
 */

import type { Reroute } from '@sveltejs/kit';
import { AUTH_PATHS } from '$lib/constants';
import { extractSubdomain, isReservedSubdomain } from '$lib/utils/subdomain';

/**
 * Check if a pathname is an auth route
 */
function isAuthPath(pathname: string): boolean {
  // Check both exact match and prefix match
  for (const authPath of AUTH_PATHS) {
    if (pathname === authPath || pathname.startsWith(`${authPath}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Reroute based on subdomain
 *
 * Examples:
 * - revelations.studio/about → /(platform)/about
 * - revelations.studio/login → /(auth)/login
 * - yoga-studio.revelations.studio/explore → /(org)/yoga-studio/(space)/explore
 * - yoga-studio.revelations.studio/studio → /(org)/yoga-studio/studio
 * - creators.revelations.studio/alice → /(creators)/alice
 * - creators.revelations.studio/studio → /(creators)/studio
 */
export const reroute: Reroute = ({ url }) => {
  const hostname = url.hostname;
  const pathname = url.pathname;

  // Extract subdomain
  const subdomain = extractSubdomain(hostname);

  // Auth routes are always global and strictly mapped to (auth) group
  // This allows logging in from any subdomain (org specific or platform)
  if (isAuthPath(pathname)) {
    return pathname;
  }

  // No subdomain or www → platform routes (files in (platform) group)
  // Route groups like (platform) are INVISIBLE to the router - they only affect layouts
  // So we just return the original pathname and let SvelteKit match against (platform)/* files
  if (!subdomain || subdomain === 'www') {
    // Just pass through - SvelteKit will match to (platform)/* files
    return pathname;
  }

  // Creators subdomain
  if (subdomain === 'creators') {
    if (pathname.startsWith('/studio')) {
      // /studio/* → /_creators/studio/*
      return `/_creators${pathname}`;
    }
    // /{username}/* → /_creators/[username]/*
    return `/_creators${pathname}`;
  }

  // Reserved subdomains → don't rewrite (let them 404 or be handled elsewhere)
  if (isReservedSubdomain(subdomain)) {
    return pathname;
  }

  // Organization subdomain
  if (pathname.startsWith('/studio')) {
    // /studio/* → /_org/[slug]/studio/*
    return `/_org/${subdomain}${pathname}`;
  }

  // Public org pages → /_org/[slug]/(space)/*
  return `/_org/${subdomain}/(space)${pathname}`;
};
