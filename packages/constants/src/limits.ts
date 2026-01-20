export const PAGINATION = {
  DEFAULT: 20,
  MAX: 100,
} as const;

export const FILE_SIZES = {
  LOGO_MAX_BYTES: 5 * 1024 * 1024, // 5MB
} as const;

export const RATE_LIMITS = {
  AUTH: 10,
  GENERAL: 100,
} as const;

export const TIMEOUTS = {
  DEFAULT_TEST: 10000,
  LONG_TEST: 60000,
} as const;

export const CACHE_TTL = {
  BRAND_CACHE_SECONDS: 604800, // 7 days
  BRAND_CACHE_REFRESH_MS: 24 * 60 * 60 * 1000, // 24 hours
} as const;
