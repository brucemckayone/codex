import { type Env, validateServiceUrl } from '@codex/constants';
import { ENV_HOSTS } from './env-hosts';
import type { EnvName, HostInfo, ServiceName } from './types';

/**
 * Per-service env-var override key. Workers + apps/web have always supported
 * overriding the default URL via these bindings (e.g. for pointing local dev
 * at a remote staging worker). Migration of the wrangler env-var declarations
 * is WP-7 — until then these overrides remain functional.
 *
 * `content` and `access` share `API_URL` because they deploy to the same
 * content-api worker.
 */
const SERVICE_ENV_VAR: Record<ServiceName, string> = {
  auth: 'AUTH_WORKER_URL',
  content: 'API_URL',
  access: 'API_URL',
  org: 'ORG_API_URL',
  ecom: 'ECOM_API_URL',
  admin: 'ADMIN_API_URL',
  identity: 'IDENTITY_API_URL',
  notifications: 'NOTIFICATIONS_API_URL',
  media: 'MEDIA_API_URL',
};

/**
 * Build a worker service URL. Reads env-var override first; falls back to
 * `ENV_HOSTS[env].apiUrl(service)`.
 *
 * Replaces `getServiceUrl` from `@codex/constants/src/env.ts`. Migration of
 * the 7 caller files happens in this same WP (WP-3) — `getServiceUrl` is
 * removed from `@codex/constants` rather than kept as a shim, because
 * `@codex/urls` already depends on `@codex/constants` and a shim would
 * create a module-load cycle.
 *
 * Security: env-var overrides are passed through `validateServiceUrl()`
 * (SSRF protection: blocks `javascript:`, `data:`, cloud metadata, private
 * IPs in non-dev). `ENV_HOSTS` defaults are NOT validated — they're
 * code-controlled, not env-controlled, so no SSRF surface.
 */
export function buildServiceUrl(
  service: ServiceName,
  env?: EnvName | boolean | Env
): string {
  const bindings: Record<string, unknown> =
    env && typeof env === 'object' ? env : {};
  const envName = resolveEnvName(env, bindings);

  const overrideUrl = readEnvVar(bindings, SERVICE_ENV_VAR[service]);
  if (overrideUrl) {
    return validateServiceUrl(overrideUrl, isDeployedEnv(envName));
  }

  return ENV_HOSTS[envName].apiUrl(service);
}

/**
 * Resolve the canonical `EnvName` from the loose `env` parameter shape
 * accepted by `buildServiceUrl` (and historically by `getServiceUrl`).
 *
 * Precedence:
 *   1. `EnvName` string literal (`'production'` / `'staging'` / `'dev'` / ...)
 *   2. `boolean` — true = development, false = production
 *   3. `Env` object —
 *      a. `ENVIRONMENT` binding STRICTLY wins when set to a valid EnvName.
 *         This is a deliberate divergence from the legacy `isDev()` which
 *         treated `MODE === 'production'` as a hard override — wrangler
 *         configs co-set ENVIRONMENT and MODE, so the precedence flip is
 *         benign in practice but documented + tested here for durability.
 *      b. `MODE` (only consulted when ENVIRONMENT is absent or invalid)
 *      c. `dev: true` (only consulted when ENVIRONMENT + MODE are absent)
 *   4. Fallback: `process.env.NODE_ENV` for Node.js test runners
 *   5. Default: `'production'` (safe-by-default — defaults to https / strict)
 *
 * `bindings` is the same `Env`-as-Record view already materialized by the
 * caller — passed in to avoid re-typing the object twice.
 */
function resolveEnvName(
  env: EnvName | boolean | Env | undefined,
  bindings: Record<string, unknown>
): EnvName {
  if (typeof env === 'string') return env;
  if (typeof env === 'boolean') return env ? 'development' : 'production';

  const environment = bindings.ENVIRONMENT;
  if (typeof environment === 'string' && isEnvName(environment)) {
    return environment;
  }
  const mode = bindings.MODE;
  if (mode === 'production') return 'production';
  if (mode === 'development') return 'development';
  if (bindings.dev === true) return 'development';

  if (typeof process !== 'undefined') {
    const nodeEnv = process.env?.NODE_ENV;
    if (nodeEnv === 'production') return 'production';
    if (nodeEnv === 'development' || nodeEnv === 'test') return 'development';
  }

  return 'production';
}

function isEnvName(value: string): value is EnvName {
  return (
    value === 'production' ||
    value === 'staging' ||
    value === 'dev' ||
    value === 'development' ||
    value === 'test'
  );
}

/** Deployed envs require HTTPS on env-var overrides. */
function isDeployedEnv(env: EnvName): boolean {
  return env === 'production' || env === 'staging' || env === 'dev';
}

/**
 * Read an env-var override from Cloudflare bindings (passed as object) or
 * Node.js `process.env` (for local dev + E2E tests).
 */
function readEnvVar(
  bindings: Record<string, unknown>,
  key: string
): string | undefined {
  const fromBindings = bindings[key];
  if (typeof fromBindings === 'string' && fromBindings) return fromBindings;
  if (typeof process !== 'undefined') {
    const fromProcess = process.env?.[key];
    if (fromProcess) return fromProcess;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// STUBS — filled in WP-4 (URL builders for org / platform / content).
// Signatures are stable so WP-4/5a can develop in parallel.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a full URL on a specific org subdomain, derived from a parsed host.
 * Preserves the current page's protocol and port (when present).
 */
export function buildOrgUrl(
  _host: HostInfo,
  _slug: string,
  _path = '/'
): string {
  throw new Error('buildOrgUrl: not implemented (WP-4)');
}

/**
 * Build an org subdomain URL from an env name (no request context required).
 * Used by `DevDomainService` and any worker that needs an org URL without
 * a `currentUrl` to derive from.
 */
export function buildOrgUrlFromEnv(
  _env: EnvName,
  _slug: string,
  _path = '/'
): string {
  throw new Error('buildOrgUrlFromEnv: not implemented (WP-4)');
}

/**
 * Build a platform URL (no subdomain, root of the apex).
 */
export function buildPlatformUrl(_host: HostInfo, _path = '/'): string {
  throw new Error('buildPlatformUrl: not implemented (WP-4)');
}

/**
 * Build a URL on the `creators` subdomain.
 */
export function buildCreatorsUrl(_host: HostInfo, _path = '/'): string {
  throw new Error('buildCreatorsUrl: not implemented (WP-4)');
}

/**
 * Build a URL to a content detail page, handling cross-org subdomain routing.
 *
 * - On the content's own org subdomain → root-relative `/content/{slug}`
 * - On a different origin (platform, other org) → full URL via buildOrgUrl
 * - Falls back to content ID if slug is unavailable
 */
export function buildContentUrl(
  _host: HostInfo,
  _content: {
    slug?: string | null;
    id: string;
    organizationSlug?: string | null;
  }
): string {
  throw new Error('buildContentUrl: not implemented (WP-4)');
}
