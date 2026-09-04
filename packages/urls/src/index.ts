// URL builders and host/cookie-domain logic. WP-3 (buildServiceUrl) and WP-4
// (the content/org/journey builders) are fully implemented in build-url.ts.
export {
  type BuildJourneyUrlOptions,
  buildContentUrl,
  buildCreatorsUrl,
  buildJourneyUrl,
  buildOrgUrl,
  buildOrgUrlFromEnv,
  buildPlatformUrl,
  buildServiceUrl,
  type JourneySurface,
  type JourneyUrlTarget,
} from './build-url';
export { getCookieConfig } from './cookie-config';
export { cookieDomainFor } from './cookie-domain';
export { corsOriginsFor } from './cors-origins';
export {
  ENV_HOSTS,
  type EnvHost,
  SERVICE_SUBDOMAIN,
} from './env-hosts';
export { parseHost } from './parse-host';
export type { EnvName, HostInfo, ServiceName } from './types';
