/**
 * Reactive studio-access helper for layout/header components.
 *
 * Centralises three pieces of derived state that were previously inlined in
 * `Header/UserMenu`, `Header/MobileNav`, and `MobileNav/MobileBottomSheet`:
 *
 *   1. `STUDIO_ROLES` — the role allowlist for the studio surface.
 *   2. `canAccessStudio` — whether the current user holds a studio role.
 *   3. `studioHref` — the cross-subdomain studio link (root-relative on org
 *      subdomains, full URL on platform/creators).
 *
 * Plus a duplicated `getInitials(name)` avatar fallback helper.
 *
 * Consumers pass a getter function so this module stays SSR-safe and
 * reactive — mirrors `useAccessContext` in `access-context.svelte.ts`.
 */

import { AUTH_ROLES } from '@codex/constants';

import type { LayoutUser } from '$lib/types';

import { buildCreatorsUrl, extractSubdomain } from './subdomain';

/**
 * Roles permitted to view/use the creator studio. Single source of truth —
 * adding a new role (e.g. 'manager') here propagates to every menu surface.
 */
export const STUDIO_ROLES: ReadonlySet<string> = new Set<string>([
  AUTH_ROLES.CREATOR,
  AUTH_ROLES.ADMIN,
  AUTH_ROLES.PLATFORM_OWNER,
]);

/**
 * Pure helper — does this user hold a studio-eligible role?
 * Exported for use in non-reactive contexts (tests, server loads).
 */
export function hasStudioRole(user: LayoutUser | null | undefined): boolean {
  return !!user?.role && STUDIO_ROLES.has(user.role);
}

/**
 * Pure helper — compute the studio link for a given URL.
 *
 * On an org subdomain (anything other than 'creators'/'www') the studio is
 * served at root-relative `/studio`. On platform or creators, we cross to
 * the creators subdomain because that's where the cross-org studio lives.
 */
export function resolveStudioHref(currentUrl: URL): string {
  const currentSubdomain = extractSubdomain(currentUrl.hostname);
  const isOrgSubdomain =
    !!currentSubdomain &&
    currentSubdomain !== 'creators' &&
    currentSubdomain !== 'www';
  return isOrgSubdomain ? '/studio' : buildCreatorsUrl(currentUrl, '/studio');
}

interface StudioAccessInput {
  user: LayoutUser | null | undefined;
  url: URL;
}

interface StudioAccess {
  readonly canAccessStudio: boolean;
  readonly studioHref: string;
}

/**
 * Reactive composable — wraps `hasStudioRole` and `resolveStudioHref` in
 * `$derived` so the result tracks reactive inputs (e.g. `page.url` from
 * `$app/state` or a `$props()`-bound user).
 *
 * Usage:
 * ```ts
 * const access = useStudioAccess(() => ({ user, url: page.url }));
 * // access.canAccessStudio, access.studioHref
 * ```
 */
export function useStudioAccess(
  getInput: () => StudioAccessInput
): StudioAccess {
  const canAccessStudio = $derived(hasStudioRole(getInput().user));
  const studioHref = $derived(resolveStudioHref(getInput().url));

  return {
    get canAccessStudio() {
      return canAccessStudio;
    },
    get studioHref() {
      return studioHref;
    },
  };
}

/**
 * Compute initials for an avatar fallback — first letter of up to the first
 * two whitespace-separated tokens, uppercased. Empty string in, empty out.
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
