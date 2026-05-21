import { ERROR_CODES, UrlValidationError } from './errors';
import { SERVICE_PORTS } from './urls';

export type ServiceName =
  | 'auth'
  | 'content'
  | 'access'
  | 'org'
  | 'ecom'
  | 'admin'
  | 'identity'
  | 'notifications'
  | 'media';

export const ENV_NAMES = {
  PRODUCTION: 'production',
  STAGING: 'staging',
  DEV: 'dev', // deployed long-lived dev branch (dev.revelations.studio)
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
  return env.ENVIRONMENT === ENV_NAMES.DEV;
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
  // - No user-controlled URLs are passed to getServiceUrl()
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

const DEFAULT_URLS = {
  auth: {
    prod: 'https://auth.revelations.studio',
    devRemote: 'https://auth.dev.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.AUTH}`,
  },
  content: {
    prod: 'https://content-api.revelations.studio',
    devRemote: 'https://content-api.dev.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.CONTENT}`,
  },
  access: {
    prod: 'https://content-api.revelations.studio',
    devRemote: 'https://content-api.dev.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.ACCESS}`,
  },
  org: {
    prod: 'https://organization-api.revelations.studio',
    devRemote: 'https://organization-api.dev.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.ORGANIZATION}`,
  },
  ecom: {
    prod: 'https://ecom-api.revelations.studio',
    devRemote: 'https://ecom-api.dev.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.ECOMMERCE}`,
  },
  admin: {
    prod: 'https://admin-api.revelations.studio',
    devRemote: 'https://admin-api.dev.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.ADMIN}`,
  },
  identity: {
    prod: 'https://identity-api.revelations.studio',
    devRemote: 'https://identity-api.dev.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.IDENTITY}`,
  },
  notifications: {
    prod: 'https://notifications-api.revelations.studio',
    devRemote: 'https://notifications-api.dev.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.NOTIFICATIONS}`,
  },
  media: {
    prod: 'https://media-api.revelations.studio',
    devRemote: 'https://media-api.dev.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.MEDIA}`,
  },
} as const;

type ServiceUrls = (typeof DEFAULT_URLS)[keyof typeof DEFAULT_URLS];

function pickDefaultUrl(urls: ServiceUrls, env?: Env | boolean): string {
  if (isDevRemote(env)) return urls.devRemote;
  return isDev(env) ? urls.dev : urls.prod;
}

export function getServiceUrl(
  service: ServiceName,
  env?: Env | boolean
): string {
  const devMode = isDev(env);
  const bindings = typeof env === 'object' ? env : {};

  /**
   * Resolve an environment variable from bindings or process.env
   */
  const getEnvVar = (key: string): string | undefined => {
    // 1. Check bindings (Cloudflare/SvelteKit platform.env)
    if (bindings[key]) return bindings[key] as string;

    // 2. Check Node.js process.env (for local development and E2E tests)
    if (typeof process !== 'undefined' && process.env[key]) {
      return process.env[key];
    }

    return undefined;
  };

  // Helper to validate and return URL from env or use default
  const getValidatedUrl = (
    envUrl: string | undefined,
    defaultUrl: string
  ): string => {
    if (envUrl) {
      return validateServiceUrl(envUrl, !devMode);
    }
    return defaultUrl;
  };

  switch (service) {
    case 'auth':
      return getValidatedUrl(
        getEnvVar('AUTH_WORKER_URL'),
        pickDefaultUrl(DEFAULT_URLS.auth, env)
      );
    case 'content':
      return getValidatedUrl(
        getEnvVar('API_URL'),
        pickDefaultUrl(DEFAULT_URLS.content, env)
      );
    case 'access':
      return getValidatedUrl(
        getEnvVar('API_URL'),
        pickDefaultUrl(DEFAULT_URLS.access, env)
      );
    case 'org':
      return getValidatedUrl(
        getEnvVar('ORG_API_URL'),
        pickDefaultUrl(DEFAULT_URLS.org, env)
      );
    case 'ecom':
      return getValidatedUrl(
        getEnvVar('ECOM_API_URL'),
        pickDefaultUrl(DEFAULT_URLS.ecom, env)
      );
    case 'admin':
      return getValidatedUrl(
        getEnvVar('ADMIN_API_URL'),
        pickDefaultUrl(DEFAULT_URLS.admin, env)
      );
    case 'identity':
      return getValidatedUrl(
        getEnvVar('IDENTITY_API_URL'),
        pickDefaultUrl(DEFAULT_URLS.identity, env)
      );
    case 'notifications':
      return getValidatedUrl(
        getEnvVar('NOTIFICATIONS_API_URL'),
        pickDefaultUrl(DEFAULT_URLS.notifications, env)
      );
    case 'media':
      return getValidatedUrl(
        getEnvVar('MEDIA_API_URL'),
        pickDefaultUrl(DEFAULT_URLS.media, env)
      );
    default: {
      // Runtime fallback for unknown services
      const defaults = DEFAULT_URLS[service as keyof typeof DEFAULT_URLS];
      if (defaults) {
        return pickDefaultUrl(defaults, env);
      }
      throw new Error(`Unknown service: ${service}`);
    }
  }
}
