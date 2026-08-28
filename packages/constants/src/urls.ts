export const SERVICE_PORTS = {
  AUTH: 42069,
  CONTENT: 4001,
  ACCESS: 4001, // Shares CONTENT worker deployment
  ORGANIZATION: 42071,
  ECOMMERCE: 42072,
  ADMIN: 42073,
  IDENTITY: 42074,
  NOTIFICATIONS: 42075,
  MEDIA: 4002, // Media API worker port
  MAILHOG: 8025,
} as const;

export const DOMAINS = {
  PROD: 'revelations.studio',
  STAGING: 'staging.revelations.studio',
  DEV_REMOTE: 'dev.revelations.studio', // deployed long-lived dev branch (separate from local DEV)
  DEV: 'lvh.me', // *.lvh.me → 127.0.0.1, supports cross-subdomain cookie sharing
  LOCAL: 'localhost',
} as const;

// ---------------------------------------------------------------------------
// Infrastructure hostname axes
// ---------------------------------------------------------------------------
//
// `getSubdomainContext()` in apps/web treats EVERY subdomain that is not
// reserved as an organization slug. Tenant slugs are unbounded, so this list is
// the only thing carving out infrastructure hostnames — a missing entry costs
// 3-4 worker subrequests and 3-4 Neon queries per request and ends in
// "Organization not found".
//
// The infrastructure entries below are therefore GENERATED from axes rather
// than hand-listed. Each axis is pinned by
// `src/__tests__/reserved-subdomains.test.ts` against the file that actually
// PROVISIONS the hostname:
//
//   - worker/app hostnames  → `routes[].pattern` in workers/*/wrangler.jsonc
//                             and apps/web/wrangler.jsonc
//   - CDN hostnames         → `.github/config/r2-infrastructure.json`
//                             (applied to Cloudflare by sync-r2-infrastructure.yml)
//   - tunnel hostnames      → infrastructure/cloudflare-tunnel/config.yml
//
// A hostname cannot begin resolving without an edit to one of those files, so
// the guard fails on the same commit that creates the hostname. The previous
// hand-maintained list drifted precisely because nothing tied it to those
// files: it still carried `cdn-staging` (a naming scheme that never shipped)
// while 13 live `cdn-*` hostnames were absent.

/**
 * Bucket types in the R2 estate — one custom domain per bucket type.
 * Mirrors the `domainStructure` keys in `.github/config/r2-infrastructure.json`.
 */
export const R2_BUCKET_TYPES = [
  'assets',
  'media',
  'platform',
  'resources',
] as const;

/**
 * Per-environment suffix carried by CDN hostnames — one per env key under each
 * `domainStructure` entry (`production` → '', `preview` → '-preview',
 * `dev` → '-dev'). There is deliberately no `-staging`: R2 has no staging
 * bucket and never had one.
 */
export const CDN_HOST_SUFFIXES = ['', '-dev', '-preview'] as const;

/**
 * API worker subdomains — one per worker `wrangler.jsonc` that declares a
 * `custom_domain` route.
 */
export const WORKER_SUBDOMAINS = [
  'admin-api',
  'auth',
  'content-api',
  'ecom-api',
  'identity-api',
  'media-api',
  'notifications-api',
  'organization-api',
] as const;

/**
 * Frontend subdomains served by the SvelteKit worker on a dedicated (non
 * wildcard) route in `apps/web/wrangler.jsonc`.
 */
export const APP_SUBDOMAINS = ['codex', 'creators'] as const;

/**
 * Per-environment suffix on worker/app hostnames — one per wrangler `env` block
 * that declares routes (production → '', staging → '-staging').
 */
export const DEPLOY_HOST_SUFFIXES = ['', '-staging'] as const;

/**
 * Cloudflare Tunnel suffix. The tunnel exposes local services to external
 * integrations (Stripe webhooks) — see infrastructure/cloudflare-tunnel/config.yml.
 */
export const TUNNEL_HOST_SUFFIXES = ['-local'] as const;

/**
 * Cloudflare preview-deployment DNS records pending deletion. These resolve
 * today, so they must not be treated as org slugs; they are transient by
 * definition. Empty this array once the records are gone — do NOT add new
 * suffixes here, a permanent hostname belongs on a real axis above.
 */
export const TRANSIENT_HOST_SUFFIXES = ['-preview-226'] as const;

type R2BucketType = (typeof R2_BUCKET_TYPES)[number];
type CdnHostSuffix = (typeof CDN_HOST_SUFFIXES)[number];
type WorkerSubdomain = (typeof WORKER_SUBDOMAINS)[number];
type AppSubdomain = (typeof APP_SUBDOMAINS)[number];
type DeployHostSuffix = (typeof DEPLOY_HOST_SUFFIXES)[number];
type TunnelHostSuffix = (typeof TUNNEL_HOST_SUFFIXES)[number];
type TransientHostSuffix = (typeof TRANSIENT_HOST_SUFFIXES)[number];

/** `-local` → `local`: the tunnel's own apex hostname. */
type TunnelApexSubdomain = TunnelHostSuffix extends `-${infer Label}`
  ? Label
  : never;

type GeneratedInfrastructureSubdomain =
  | `cdn${CdnHostSuffix}`
  | `cdn-${R2BucketType}${CdnHostSuffix}`
  | `${WorkerSubdomain}${DeployHostSuffix | TunnelHostSuffix | TransientHostSuffix}`
  | `${AppSubdomain}${DeployHostSuffix | TransientHostSuffix}`
  | TunnelApexSubdomain;

/**
 * Infrastructure hostnames, expanded from the axes above. Never hand-edit —
 * add the missing axis value instead so every environment expands with it.
 */
export const GENERATED_INFRASTRUCTURE_SUBDOMAINS: readonly GeneratedInfrastructureSubdomain[] =
  [
    // R2 custom domains: the bare `cdn` family plus one per bucket type.
    ...CDN_HOST_SUFFIXES.map((suffix) => `cdn${suffix}` as const),
    ...R2_BUCKET_TYPES.flatMap((type) =>
      CDN_HOST_SUFFIXES.map((suffix) => `cdn-${type}${suffix}` as const)
    ),

    // API workers: deployed envs, the dev tunnel, and preview leftovers.
    ...WORKER_SUBDOMAINS.flatMap((worker) =>
      [
        ...DEPLOY_HOST_SUFFIXES,
        ...TUNNEL_HOST_SUFFIXES,
        ...TRANSIENT_HOST_SUFFIXES,
      ].map((suffix) => `${worker}${suffix}` as const)
    ),

    // Frontend routes: deployed envs and preview leftovers (never tunnelled —
    // the tunnel points its apex at the local SvelteKit server instead).
    ...APP_SUBDOMAINS.flatMap((app) =>
      [...DEPLOY_HOST_SUFFIXES, ...TRANSIENT_HOST_SUFFIXES].map(
        (suffix) => `${app}${suffix}` as const
      )
    ),

    // The tunnel apex itself (`local.revelations.studio` → local SvelteKit).
    ...TUNNEL_HOST_SUFFIXES.map(
      (suffix) => suffix.slice(1) as TunnelApexSubdomain
    ),
  ];

/**
 * Reserved subdomains with no generator axis: single-label platform hostnames,
 * DNS records created by hand, and defensive squats on names a tenant must
 * never claim.
 *
 * This list may NOT hold anything the generator owns — the drift test rejects
 * duplicates and rejects `cdn-*`, `*-local` and `*-preview*` shapes outright,
 * so a future infrastructure hostname cannot be smuggled in as a one-off.
 */
export const STATIC_RESERVED_SUBDOMAINS = [
  // Legacy API records (targets of .github/scripts/delete-conflicting-dns.sh);
  // no worker is bound to them, but they must never become a slug.
  'api',
  'api-staging',

  // Platform frontends on their own routes or apexes.
  'app',
  'dev', // dev.revelations.studio — the deployed long-lived dev apex
  'platform',
  'www',

  // Manually created DNS record with no repo provenance. Reserved because it
  // resolves; if it is ever deleted, delete it here too.
  'bot',

  // Plausible tenant slug that scanners probe constantly. Reserved in-app
  // rather than blocked at the edge so the 404 stays cheap.
  'preview',

  // Infrastructure & common reserved
  'admin',
  'assets',
  'blog',
  'dashboard',
  'docs',
  'ftp',
  'help',
  'mail',
  'smtp',
  'ssh',
  'static',
  'status',
  'support',
  'staging',
  'test',
  'localhost',
] as const;

type StaticReservedSubdomain = (typeof STATIC_RESERVED_SUBDOMAINS)[number];

export type ReservedSubdomain =
  | GeneratedInfrastructureSubdomain
  | StaticReservedSubdomain;

/**
 * Reserved subdomains that cannot be used for organization slugs.
 * These are infrastructure subdomains for CDN, APIs, and services.
 *
 * Organization slugs are validated against this list to prevent conflicts
 * with platform infrastructure (e.g., cdn-assets.revelations.studio,
 * api.revelations.studio).
 */
export const RESERVED_SUBDOMAINS: readonly ReservedSubdomain[] = [
  ...GENERATED_INFRASTRUCTURE_SUBDOMAINS,
  ...STATIC_RESERVED_SUBDOMAINS,
];

/** Pre-built Set for O(1) lookups against reserved subdomains */
export const RESERVED_SUBDOMAINS_SET = new Set<string>(RESERVED_SUBDOMAINS);
