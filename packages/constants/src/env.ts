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

export function isDev(env?: Env | boolean): boolean {
  if (typeof env === 'boolean') return env;
  if (env?.MODE === 'development') return true;
  if (env?.dev === true) return true;
  // Node.js fallback
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development')
    return true;
  return false;
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
 */
export function validateServiceUrl(
  url: string,
  requireHttps: boolean = false
): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL format: ${url}`);
  }

  // Only allow http/https protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Invalid protocol: ${parsed.protocol}. Only http/https allowed.`
    );
  }

  // In production, require HTTPS
  if (requireHttps && parsed.protocol !== 'https:') {
    throw new Error('HTTPS is required in production');
  }

  return url;
}

const DEFAULT_URLS = {
  auth: {
    prod: 'https://auth.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.AUTH}`,
  },
  content: {
    prod: 'https://content-api.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.CONTENT}`,
  },
  access: {
    prod: 'https://content-api.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.ACCESS}`,
  },
  org: {
    prod: 'https://organization-api.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.ORGANIZATION}`,
  },
  ecom: {
    prod: 'https://api.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.ECOMMERCE}`,
  },
  admin: {
    prod: 'https://admin-api.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.ADMIN}`,
  },
  identity: {
    prod: 'https://identity-api.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.IDENTITY}`,
  },
  notifications: {
    prod: 'https://notifications-api.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.NOTIFICATIONS}`,
  },
  media: {
    prod: 'https://media-api.revelations.studio',
    dev: `http://localhost:${SERVICE_PORTS.MEDIA}`,
  },
} as const;

export function getServiceUrl(
  service: ServiceName,
  env?: Env | boolean
): string {
  const devMode = isDev(env);
  const bindings = typeof env === 'object' ? env : {};

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
        bindings.AUTH_WORKER_URL as string | undefined,
        devMode ? DEFAULT_URLS.auth.dev : DEFAULT_URLS.auth.prod
      );
    case 'content':
      return getValidatedUrl(
        bindings.API_URL as string | undefined,
        devMode ? DEFAULT_URLS.content.dev : DEFAULT_URLS.content.prod
      );
    case 'access':
      return getValidatedUrl(
        bindings.API_URL as string | undefined,
        devMode ? DEFAULT_URLS.access.dev : DEFAULT_URLS.access.prod
      );
    case 'org':
      return getValidatedUrl(
        bindings.ORG_API_URL as string | undefined,
        devMode ? DEFAULT_URLS.org.dev : DEFAULT_URLS.org.prod
      );
    case 'ecom':
      return getValidatedUrl(
        bindings.ECOM_API_URL as string | undefined,
        devMode ? DEFAULT_URLS.ecom.dev : DEFAULT_URLS.ecom.prod
      );
    case 'admin':
      return getValidatedUrl(
        bindings.ADMIN_API_URL as string | undefined,
        devMode ? DEFAULT_URLS.admin.dev : DEFAULT_URLS.admin.prod
      );
    case 'identity':
      return getValidatedUrl(
        bindings.IDENTITY_API_URL as string | undefined,
        devMode ? DEFAULT_URLS.identity.dev : DEFAULT_URLS.identity.prod
      );
    case 'notifications':
      return getValidatedUrl(
        bindings.NOTIFICATIONS_API_URL as string | undefined,
        devMode
          ? DEFAULT_URLS.notifications.dev
          : DEFAULT_URLS.notifications.prod
      );
    case 'media':
      return getValidatedUrl(
        bindings.MEDIA_API_URL as string | undefined,
        devMode ? DEFAULT_URLS.media.dev : DEFAULT_URLS.media.prod
      );
    default: {
      // Runtime fallback for unknown services
      const defaults = DEFAULT_URLS[service as keyof typeof DEFAULT_URLS];
      if (defaults) {
        return devMode ? defaults.dev : defaults.prod;
      }
      return '';
    }
  }
}
