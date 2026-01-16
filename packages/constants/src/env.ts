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

// Loose interface for environment bindings
export interface Env {
  AUTH_WORKER_URL?: string;
  API_URL?: string;
  ORG_API_URL?: string;
  ECOM_API_URL?: string;
  ADMIN_API_URL?: string;
  IDENTITY_API_URL?: string;
  NOTIFICATIONS_API_URL?: string;
  MEDIA_API_URL?: string;

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

  switch (service) {
    case 'auth':
      return (
        (bindings.AUTH_WORKER_URL as string) ??
        (devMode ? DEFAULT_URLS.auth.dev : DEFAULT_URLS.auth.prod)
      );
    case 'content':
      return (
        (bindings.API_URL as string) ??
        (devMode ? DEFAULT_URLS.content.dev : DEFAULT_URLS.content.prod)
      );
    case 'access':
      return (
        (bindings.API_URL as string) ??
        (devMode ? DEFAULT_URLS.access.dev : DEFAULT_URLS.access.prod)
      );
    case 'org':
      return (
        (bindings.ORG_API_URL as string) ??
        (devMode ? DEFAULT_URLS.org.dev : DEFAULT_URLS.org.prod)
      );
    case 'ecom':
      return (
        (bindings.ECOM_API_URL as string) ??
        (devMode ? DEFAULT_URLS.ecom.dev : DEFAULT_URLS.ecom.prod)
      );
    case 'admin':
      return (
        (bindings.ADMIN_API_URL as string) ??
        (devMode ? DEFAULT_URLS.admin.dev : DEFAULT_URLS.admin.prod)
      );
    case 'identity':
      return (
        (bindings.IDENTITY_API_URL as string) ??
        (devMode ? DEFAULT_URLS.identity.dev : DEFAULT_URLS.identity.prod)
      );
    case 'notifications':
      return (
        (bindings.NOTIFICATIONS_API_URL as string) ??
        (devMode
          ? DEFAULT_URLS.notifications.dev
          : DEFAULT_URLS.notifications.prod)
      );
    case 'media':
      return (
        (bindings.MEDIA_API_URL as string) ??
        (devMode ? DEFAULT_URLS.media.dev : DEFAULT_URLS.media.prod)
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
