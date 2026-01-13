/**
 * Client-side reroute hook for subdomain-based routing
 *
 * Maps subdomains to internal route groups:
 * - revelations.studio/* → /(platform)/*
 * - creators.revelations.studio/* → /(creators)/*
 * - {org-slug}.revelations.studio/* → /(org)/[slug]/*
 */

import type { Reroute } from '@sveltejs/kit';
import { extractSubdomain, isReservedSubdomain } from '$lib/utils/subdomain';

/**
 * Auth routes that can be accessed from any domain
 */
const AUTH_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
]);

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

  console.log('[REROUTE]', { hostname, pathname, subdomain });

  // No subdomain or www → platform routes (files in (platform) group)
  // Route groups like (platform) are INVISIBLE to the router - they only affect layouts
  // So we just return the original pathname and let SvelteKit match against (platform)/* files
  if (!subdomain || subdomain === 'www') {
    // Auth routes need to route to (auth) group
    if (isAuthPath(pathname)) {
      console.log('[REROUTE] Auth route - passing through:', pathname);
      // Route groups are transparent, so just return the pathname
      return pathname;
    }
    console.log('[REROUTE] Platform route - passing through:', pathname);
    // Just pass through - SvelteKit will match to (platform)/* files
    return pathname;
  }

  // Creators subdomain
  if (subdomain === 'creators') {
    if (pathname.startsWith('/studio')) {
      // /studio/* → /_creators/studio/*
      return `/_creators/studio${pathname.slice(7)}`;
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
    return `/_org/${subdomain}/studio${pathname.slice(7)}`;
  }

  // Public org pages → /_org/[slug]/(space)/*
  return `/_org/${subdomain}/(space)${pathname}`;
};
