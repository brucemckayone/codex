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

import { dev } from '$app/environment';

/**
 * Default worker URLs
 * Used as fallback if platform environment variables are missing
 */
export const DEFAULT_AUTH_URL = dev
  ? 'http://localhost:42069'
  : 'https://auth.revelations.studio';

/**
 * Reserved subdomains that cannot be used as org slugs
 * These are infrastructure, API, or special-purpose subdomains
 */
export const RESERVED_SUBDOMAINS = new Set([
  // Infrastructure
  'www',
  'auth',
  'api',
  'content-api',
  'organization-api',
  'ecom-api',
  'identity-api',
  'media-api',
  'notifications-api',
  // Special routes
  'creators',
  'admin',
  'platform',
  // Environments
  'staging',
  'dev',
  'test',
  'localhost',
]);
