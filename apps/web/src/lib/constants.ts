import { RESERVED_SUBDOMAINS_SET } from '@codex/constants';

/**
 * Auth routes that can be accessed from any domain
 */
export const AUTH_PATHS = new Set([
  '/login',
  '/logout',
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

// e2e probe 2026-09-01: no-op comment to force the E2E Web job on dev content (path-filter bypass). Delete this branch after.
