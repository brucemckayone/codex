import { SERVICE_PORTS } from '@codex/constants';
import type { EnvName, ServiceName } from './types';

/**
 * Service → subdomain prefix. The dot-separated apex follows from `ENV_HOSTS`.
 *
 * `content` and `access` share the same worker deployment (content-api).
 */
export const SERVICE_SUBDOMAIN: Record<ServiceName, string> = {
  auth: 'auth',
  content: 'content-api',
  access: 'content-api',
  org: 'organization-api',
  ecom: 'ecom-api',
  admin: 'admin-api',
  identity: 'identity-api',
  notifications: 'notifications-api',
  media: 'media-api',
};

/**
 * Service → local-dev port. Pulled from `@codex/constants.SERVICE_PORTS` so
 * the port table stays the single source of truth. Re-exposed here as a
 * `ServiceName`-keyed map for ergonomic lookup in `ENV_HOSTS.development.apiUrl`.
 */
const SERVICE_PORT_MAP: Record<ServiceName, number> = {
  auth: SERVICE_PORTS.AUTH,
  content: SERVICE_PORTS.CONTENT,
  access: SERVICE_PORTS.ACCESS,
  org: SERVICE_PORTS.ORGANIZATION,
  ecom: SERVICE_PORTS.ECOMMERCE,
  admin: SERVICE_PORTS.ADMIN,
  identity: SERVICE_PORTS.IDENTITY,
  notifications: SERVICE_PORTS.NOTIFICATIONS,
  media: SERVICE_PORTS.MEDIA,
};

/**
 * Per-env routing primitives. Source of truth for URL construction across
 * the entire codebase — every consumer that needs a worker URL, an org
 * hostname, or a platform scheme reads it from here.
 */
export interface EnvHost {
  /** HTTP scheme for this env. Local envs use http; deployed envs use https. */
  scheme: 'http' | 'https';
  /** Port suffix for local envs only (omitted for deployed envs). */
  port?: number;
  /** Worker URL for a given service. */
  apiUrl(service: ServiceName): string;
  /** Hostname (no scheme, no path) for a given org slug. */
  orgHost(slug: string): string;
}

/**
 * The 5-row environment table. Replaces the 27-cell `DEFAULT_URLS` table in
 * `@codex/constants/src/env.ts` (migrated to call `apiUrl(service)` in WP-3).
 *
 * Notes:
 * - Staging uses a **suffix** pattern (`{slug}-staging.revelations.studio`),
 *   NOT a depth pattern. The apex stays `revelations.studio`; the staging-ness
 *   is encoded in the subdomain prefix. This matches the wrangler route
 *   `*-staging.revelations.studio/*` pattern.
 * - Dev uses per-org Cloudflare Custom Domains (provisioned by
 *   `DevDomainService`), not a wildcard zone route. Cloudflare research
 *   verdict to keep this asymmetry — see
 *   `docs/routing-centralization/cloudflare-edge-cases.md`.
 */
export const ENV_HOSTS: Record<EnvName, EnvHost> = {
  production: {
    scheme: 'https',
    apiUrl: (s) => `https://${SERVICE_SUBDOMAIN[s]}.revelations.studio`,
    orgHost: (slug) => `${slug}.revelations.studio`,
  },
  staging: {
    scheme: 'https',
    apiUrl: (s) => `https://${SERVICE_SUBDOMAIN[s]}-staging.revelations.studio`,
    orgHost: (slug) => `${slug}-staging.revelations.studio`,
  },
  dev: {
    scheme: 'https',
    apiUrl: (s) => `https://${SERVICE_SUBDOMAIN[s]}.dev.revelations.studio`,
    orgHost: (slug) => `${slug}.dev.revelations.studio`,
  },
  development: {
    scheme: 'http',
    port: 3000,
    apiUrl: (s) => `http://localhost:${SERVICE_PORT_MAP[s]}`,
    orgHost: (slug) => `${slug}.lvh.me`,
  },
  test: {
    scheme: 'http',
    port: 3000,
    apiUrl: (s) => `http://localhost:${SERVICE_PORT_MAP[s]}`,
    orgHost: (slug) => `${slug}.lvh.me`,
  },
};
