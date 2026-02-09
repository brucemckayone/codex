import { RESERVED_SUBDOMAINS_SET } from '@codex/constants';

/**
 * Auth routes that can be accessed from any domain
 */
export const AUTH_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
]);

/**
 * Reserved subdomains that cannot be used as org slugs.
 * Single source of truth: @codex/constants (packages/constants/src/urls.ts)
 */
export const RESERVED_SUBDOMAINS = RESERVED_SUBDOMAINS_SET;
