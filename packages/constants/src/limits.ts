export const PAGINATION = {
  DEFAULT: 20,
  MAX: 100,
} as const;

export const FILE_SIZES = {
  LOGO_MAX_BYTES: 5 * 1024 * 1024, // 5MB
} as const;

export const VIDEO_PROGRESS = {
  COMPLETION_THRESHOLD: 0.95, // 95%
} as const;

export const RATE_LIMIT_PRESETS = {
  /**
   * Auth - for authentication endpoints (5 requests per 15 minutes)
   */
  AUTH: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
  },

  /**
   * Strict - for sensitive operations like streaming URLs (20 requests per minute)
   */
  STRICT: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 20,
  },

  /**
   * Streaming - for presigned URL generation (60 requests per minute)
   * Prevents abuse while allowing legitimate HLS segment refreshes
   */
  STREAMING: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60,
    keyPrefix: 'rl:stream:',
  },

  /**
   * API - for standard API endpoints (100 requests per minute)
   */
  API: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
  },

  /**
   * Webhook - for webhooks (1000 requests per minute)
   */
  WEBHOOK: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 1000,
  },

  /**
   * Web - for general web traffic (300 requests per minute)
   */
  WEB: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 300,
  },
} as const;

export const TIMEOUTS = {
  DEFAULT_TEST: 10000,
  LONG_TEST: 60000,
} as const;

export const STREAMING = {
  DEFAULT_EXPIRY_SECONDS: 3600, // 1 hour
} as const;

export const R2_DEFAULTS = {
  MAX_RETRIES: 3,
  BASE_DELAY_MS: 100,
  MAX_DELAY_MS: 2000,
  MAX_EXPIRY_SECONDS: 604800, // 7 days (AWS limit)
} as const;

export const ANALYTICS = {
  TREND_DAYS_DEFAULT: 30,
  MAX_RANGE_DAYS: 365,
} as const;

export const CACHE_TTL = {
  BRAND_CACHE_SECONDS: 604800, // 7 days
  BRAND_CACHE_REFRESH_MS: 24 * 60 * 60 * 1000, // 24 hours
} as const;
