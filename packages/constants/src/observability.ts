/**
 * Observability domain constants
 */

/**
 * Sensitive field names that should always be redacted from logs
 */
export const SENSITIVE_KEYS = [
  // Authentication & Secrets
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'apikey',
  'authorization',
  'auth',
  'cookie',
  'session',
  'sessionId',
  'session_id',
  'csrf',
  'csrfToken',
  'csrf_token',

  // Database
  'database_url',
  'databaseUrl',
  'DATABASE_URL',
  'db_url',
  'connectionString',
  'connection_string',

  // Stripe & Payment
  'stripe_signature',
  'stripeSignature',
  'stripe_key',
  'stripeKey',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'card_number',
  'cardNumber',
  'cvv',
  'cvc',
  'card_cvc',

  // Personal Identifiable Information (PII)
  'ssn',
  'social_security',
  'socialSecurity',
  'passport',
  'driverLicense',
  'driver_license',
  'creditCard',
  'credit_card',

  // Cloudflare & Infrastructure
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'NEON_API_KEY',
] as const;

/**
 * Patterns to detect sensitive data in values
 */
export const SENSITIVE_PATTERNS = {
  STRIPE_SK_LIVE: /sk_live_[a-zA-Z0-9]+/,
  STRIPE_SK_TEST: /sk_test_[a-zA-Z0-9]+/,
  STRIPE_PK_LIVE: /pk_live_[a-zA-Z0-9]+/,
  STRIPE_PK_TEST: /pk_test_[a-zA-Z0-9]+/,
  STRIPE_RK_LIVE: /rk_live_[a-zA-Z0-9]+/,
  POSTGRES_URL: /postgres:\/\/[^@]+:[^@]+@/,
  MYSQL_URL: /mysql:\/\/[^@]+:[^@]+@/,
  BEARER_TOKEN: /Bearer\s+[a-zA-Z0-9._-]+/,
  RANDOM_SECRET: /[a-zA-Z0-9]{32,}/,
  EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
} as const;

export const LOG_LEVELS = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;
