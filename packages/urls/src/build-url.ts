import { type Env, validateServiceUrl } from '@codex/constants';
import { ENV_HOSTS } from './env-hosts';
import { parseHost } from './parse-host';
import type { EnvName, ServiceName } from './types';

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
// URL builders — derive scheme/baseDomain/port from the request URL.
//
// Signatures take `URL` (not `HostInfo`) so existing apps/web callers using
// `page.url` migrate with zero call-site change. The handler internally calls
// `parseHost` to extract the baseDomain that goes after the org slug.
//
// `buildOrgUrlFromEnv` is the worker-side variant — for callers like
// `DevDomainService` that don't have a request URL. It derives scheme + port
// + baseDomain entirely from `ENV_HOSTS[env]`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a full URL on a different org subdomain, preserving the current
 * page's protocol and port. Used when the user navigates from one org's
 * subdomain to another (different origin → needs a full URL, not a path).
 *
 * @example
 * buildOrgUrl(new URL('http://lvh.me:3000/'), 'bruce-studio', '/studio')
 * // → 'http://bruce-studio.lvh.me:3000/studio'
 *
 * @example
 * buildOrgUrl(new URL('https://yoga-studio.revelations.studio/'), 'cooking-school')
 * // → 'https://cooking-school.revelations.studio/'
 */
export function buildOrgUrl(currentUrl: URL, slug: string, path = '/'): string {
  const { baseDomain } = parseHost(currentUrl.hostname);
  const portSuffix = currentUrl.port ? `:${currentUrl.port}` : '';
  return `${currentUrl.protocol}//${slug}.${baseDomain}${portSuffix}${path}`;
}

/**
 * Build an org subdomain URL from an `EnvName` (no request context required).
 * Used by `DevDomainService` (Codex-0hxw4, WP-6) and any worker that needs
 * an org URL without a `currentUrl` to derive from.
 *
 * @example
 * buildOrgUrlFromEnv('dev', 'studio-alpha')
 * // → 'https://studio-alpha.dev.revelations.studio/'
 *
 * @example
 * buildOrgUrlFromEnv('development', 'bruce-studio', '/studio')
 * // → 'http://bruce-studio.lvh.me:3000/studio'
 */
export function buildOrgUrlFromEnv(
  env: EnvName,
  slug: string,
  path = '/'
): string {
  const cfg = ENV_HOSTS[env];
  const portSuffix = cfg.port ? `:${cfg.port}` : '';
  return `${cfg.scheme}://${cfg.orgHost(slug)}${portSuffix}${path}`;
}

/**
 * Build a platform URL — strips the subdomain, keeps the rest of the origin.
 * E.g. `https://yoga-studio.revelations.studio/foo` → `https://revelations.studio/path`.
 */
export function buildPlatformUrl(currentUrl: URL, path = '/'): string {
  const { baseDomain } = parseHost(currentUrl.hostname);
  const portSuffix = currentUrl.port ? `:${currentUrl.port}` : '';
  return `${currentUrl.protocol}//${baseDomain}${portSuffix}${path}`;
}

/**
 * Build a URL on the `creators` subdomain. Thin wrapper over `buildOrgUrl`
 * with `slug='creators'` — kept as a named export for ergonomics and
 * grep-ability at call sites.
 */
export function buildCreatorsUrl(currentUrl: URL, path = '/'): string {
  return buildOrgUrl(currentUrl, 'creators', path);
}

/**
 * Build a URL to a content detail page, handling cross-org subdomain routing.
 *
 * - On the content's own org subdomain → root-relative `/content/{slug}`
 * - On a different origin (platform, other org) → full URL via `buildOrgUrl`
 * - Falls back to content ID when `slug` is missing
 *
 * Codex-ga4d (closed Apr 2026) introduced this helper; 10+ Svelte components
 * adopted it. WP-4 moves the implementation to `@codex/urls` while preserving
 * the existing call-site contract via the `apps/web/src/lib/utils/subdomain.ts`
 * re-export wrapper.
 */
export function buildContentUrl(
  currentUrl: URL,
  content: {
    slug?: string | null;
    id: string;
    organizationSlug?: string | null;
  }
): string {
  const contentPath = `/content/${content.slug ?? content.id}`;

  if (content.organizationSlug) {
    const { subdomain } = parseHost(currentUrl.hostname);
    if (subdomain !== content.organizationSlug) {
      return buildOrgUrl(currentUrl, content.organizationSlug, contentPath);
    }
  }

  return contentPath;
}
