export const SERVICE_PORTS = {
  AUTH: 42069,
  CONTENT: 4001,
  ACCESS: 4001, // Shares CONTENT worker deployment
  ORGANIZATION: 42071,
  ECOMMERCE: 42072,
  ADMIN: 42073,
  IDENTITY: 42074,
  NOTIFICATIONS: 42075,
  MEDIA: 8788, // Media API (runpod integration port)
  MAILHOG: 8025,
} as const;

export const DOMAINS = {
  PROD: 'revelations.studio',
  STAGING: 'staging.revelations.studio',
  LOCAL: 'localhost',
} as const;

/**
 * Reserved subdomains that cannot be used for organization slugs.
 * These are infrastructure subdomains for CDN, APIs, and services.
 *
 * Organization slugs are validated against this list to prevent conflicts
 * with platform infrastructure (e.g., cdn.revelations.studio, api.revelations.studio).
 */
export const RESERVED_SUBDOMAINS = [
  // CDN subdomains (R2 custom domains - shared across all buckets)
  'cdn',
  'cdn-dev',
  'cdn-staging',

  // API service subdomains (workers)
  'api',
  'api-staging',
  'auth',
  'auth-staging',
  'content-api',
  'content-api-staging',
  'organization-api',
  'organization-api-staging',
  'identity-api',
  'identity-api-staging',
  'ecom-api',
  'ecom-api-staging',
  'admin-api',
  'admin-api-staging',
  'media-api',
  'media-api-staging',
  'notifications-api',
  'notifications-api-staging',

  // Frontend subdomains
  'app',
  'codex',
  'codex-staging',
  'www',

  // Infrastructure & common reserved
  'admin',
  'assets',
  'blog',
  'dashboard',
  'dev',
  'docs',
  'ftp',
  'help',
  'mail',
  'smtp',
  'ssh',
  'static',
  'status',
  'support',
  'staging',
  'test',
] as const;

export type ReservedSubdomain = (typeof RESERVED_SUBDOMAINS)[number];
