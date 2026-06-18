import { ERROR_CODES, UrlValidationError } from './errors';

export const ENV_NAMES = {
  PRODUCTION: 'production',
  STAGING: 'staging',
  // DEV_REMOTE is the deployed long-lived dev branch (dev.revelations.studio).
  // Renamed from DEV to disambiguate from DEVELOPMENT (= local). The string
  // value 'dev' is unchanged — this rename is identifier-only and does NOT
  // require updating ENVIRONMENT bindings in any wrangler.jsonc.
  DEV_REMOTE: 'dev',
  DEVELOPMENT: 'development',
  TEST: 'test',
} as const;

/**
 * Loose interface for environment bindings.
 *
 * Note: The index signature `[key: string]: unknown` allows passing any
 * Cloudflare Worker bindings without requiring explicit type definitions
 * for all possible bindings (KV, R2, D1, Queues, etc.).
 */
export interface Env {
  AUTH_WORKER_URL?: string;
  API_URL?: string;
  ORG_API_URL?: string;
  ECOM_API_URL?: string;
  ADMIN_API_URL?: string;
  IDENTITY_API_URL?: string;
  NOTIFICATIONS_API_URL?: string;
  MEDIA_API_URL?: string;
  COOKIE_DOMAIN?: string;

  MODE?: string;
  dev?: boolean;
  [key: string]: unknown;
}

/**
 * Shared infrastructure environment variable keys
 */
export const INFRA_KEYS = {
  R2: {
    ACCOUNT_ID: 'R2_ACCOUNT_ID',
    ACCESS_KEY_ID: 'R2_ACCESS_KEY_ID',
    SECRET_ACCESS_KEY: 'R2_SECRET_ACCESS_KEY',
    BUCKET_MEDIA: 'R2_BUCKET_MEDIA',
  },
  STRIPE: {
    SECRET_KEY: 'STRIPE_SECRET_KEY',
    WEBHOOK_SECRET: 'STRIPE_WEBHOOK_SECRET',
  },
  DATABASE: {
    URL: 'DATABASE_URL',
    URL_LOCAL_PROXY: 'DATABASE_URL_LOCAL_PROXY',
  },
} as const;

export function isDev(env?: Env | boolean): boolean {
  if (typeof env === 'boolean') return env;
  if (env?.MODE === 'production') return false;
  if (env?.MODE === 'development') return true;
  if (env?.dev === true) return true;
  // Node.js fallback — includes 'test' so cookies are non-secure on localhost
  // during E2E tests (SvelteKit dev server + Cloudflare adapter passes env
  // bindings without MODE/dev, so we rely on process.env.NODE_ENV)
  if (
    typeof process !== 'undefined' &&
    (process.env?.NODE_ENV === 'development' ||
      process.env?.NODE_ENV === 'test')
  )
    return true;
  return false;
}

/**
 * True when running on the deployed long-lived `dev` environment
 * (dev.revelations.studio). Distinct from `isDev()` which is true for
 * local development — the deployed dev env runs over HTTPS with secure
 * cookies, just at a different apex than prod.
 */
export function isDevRemote(env?: Env | boolean): boolean {
  if (typeof env !== 'object' || env === null) return false;
  return env.ENVIRONMENT === ENV_NAMES.DEV_REMOTE;
}

/**
 * Validate a service URL to prevent SSRF attacks.
 *
 * @param url - The URL to validate
 * @param requireHttps - If true, only HTTPS is allowed (use in production)
 * @returns The validated URL
 * @throws Error if the URL is invalid or uses a disallowed protocol
 *
 * Security:
 * - Only allows http:// and https:// protocols
 * - Rejects javascript:, data:, file:, ftp: and other dangerous protocols
 * - Enforces HTTPS in production when requireHttps is true
 * - Blocks private IP ranges and cloud metadata services
 *
 * Called by `@codex/urls.buildServiceUrl` for env-var override URLs. The
 * URL-builder defaults (`ENV_HOSTS`) are NOT validated — they're
 * code-controlled, not env-controlled, so no SSRF surface.
 */
export function validateServiceUrl(
  url: string,
  requireHttps: boolean = false
): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UrlValidationError(
      `Invalid URL format: ${url}`,
      ERROR_CODES.INVALID_URL
    );
  }

  // Only allow http/https protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UrlValidationError(
      `Invalid protocol: ${parsed.protocol}. Only http/https allowed.`,
      ERROR_CODES.INVALID_URL
    );
  }

  // In production, require HTTPS
  if (requireHttps && parsed.protocol !== 'https:') {
    throw new UrlValidationError(
      'HTTPS is required in production',
      ERROR_CODES.HTTPS_REQUIRED
    );
  }

  const hostname = parsed.hostname;

  // Block Cloud Metadata Service (AWS, GCP, Azure)
  if (hostname === '169.254.169.254') {
    throw new UrlValidationError(
      'Access to metadata service is blocked',
      ERROR_CODES.SSRF_BLOCKED
    );
  }

  // Block Google Cloud Metadata DNS
  if (hostname === 'metadata.google.internal') {
    throw new UrlValidationError(
      'Access to internal metadata DNS is blocked',
      ERROR_CODES.SSRF_BLOCKED
    );
  }

  // Block Private IP Ranges (simple regex check for IPv4)
  // 10.0.0.0/8
  // 172.16.0.0/12
  // 192.168.0.0/16
  // 127.0.0.0/8 (Loopback - allowed in dev/test via requireHttps=false usually, but strict check here might be safer)
  //
  // NOTE: DNS rebinding attacks (where evil.com → 127.0.0.1) are mitigated because:
  // - Service URLs come from trusted env vars or hardcoded defaults
  // - No user-controlled URLs are passed to buildServiceUrl()
  // - Cloudflare Workers restrict outbound requests to known origins
  //
  // We allow localhost/127.0.0.1 ONLY if requireHttps is false (dev mode implication).

  if (requireHttps) {
    // In production (requireHttps=true), also block private IPs
    const isPrivateIp =
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      /^127\./.test(hostname) ||
      hostname === 'localhost';

    if (isPrivateIp) {
      throw new UrlValidationError(
        `Private IP/Localhost access is blocked in production: ${hostname}`,
        ERROR_CODES.SSRF_BLOCKED
      );
    }
  }

  return url;
}
