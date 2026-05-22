// Stubs for WP-3 (buildServiceUrl) and WP-4 (URL builders).
// Each throws an explicit "not implemented (WP-N)" error on call.
export {
  buildContentUrl,
  buildCreatorsUrl,
  buildOrgUrl,
  buildOrgUrlFromEnv,
  buildPlatformUrl,
  buildServiceUrl,
} from './build-url';
// Stub for WP-5a (cookieDomainFor). Throws "not implemented (WP-5a)" on call.
export { cookieDomainFor } from './cookie-domain';
export { corsOriginsFor } from './cors-origins';
export {
  ENV_HOSTS,
  type EnvHost,
  SERVICE_SUBDOMAIN,
} from './env-hosts';
export { parseHost } from './parse-host';
export type { EnvName, HostInfo, ServiceName } from './types';
