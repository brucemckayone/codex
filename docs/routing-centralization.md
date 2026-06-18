# Routing & URL Centralization — Investigation

> Read-only audit, 2026-05-22. Source: dev branch tip.
> Maps every hostname-parsing, URL-building, and cookie-domain site across the monorepo; proposes a centralization plan.

## TL;DR

Routing logic is duplicated across **five layers**:

1. SvelteKit client-side reroute (`apps/web/src/hooks.ts`)
2. URL utilities (`apps/web/src/lib/utils/subdomain.ts` — 2 parsers + 4 builders)
3. Constants package (`packages/constants/src/{urls,env,cookies}.ts` — 9-service URL table, cookie domain logic)
4. Auth worker config (`workers/auth/src/auth-config.ts` — 3rd cookie-domain deriver, trustedOrigins)
5. Wrangler env blocks (7 worker configs × 4 envs × N URLs = ~150 hardcoded URL strings)

Adding a new env (say "staging-eu") today touches **all five layers** and ~25 distinct files. The TypeScript layer can be unified, but the wrangler layer is the **largest** drift surface and can only be partially deduplicated.

**Recommendation**: ship a new `@codex/urls` package that owns host parsing, URL building, and cookie domain derivation. Reduce `DEFAULT_URLS` (27 literals) to one `EnvHost` table (5 rows). Wire the three cookie-domain derivers through one `cookieDomainFor()`. Leave wrangler URL env vars in place but generate them from a single source (post-investigation follow-up).

Out of scope: SEO canonical URLs (already use `url.origin`), R2/CDN paths (creator-id keyed, no env coupling), Stripe redirects (use `WEB_APP_URL` directly), studio SPA, brand editor.

---

## Current-state matrix

### Hostname parsing — readers

| # | Site | File | What it reads | Branches | Env-aware via |
|---|---|---|---|---|---|
| 1 | `extractSubdomain(hostname)` | `apps/web/src/lib/utils/subdomain.ts:25-79` | request hostname → org slug \| reserved \| null | lvh.me / nip.io / localhost / dev.rs / prod | TLD discrimination only |
| 2 | `deriveBaseDomain(host)` | `apps/web/src/lib/utils/subdomain.ts:127-147` | request hostname → apex domain | same 4 TLD branches as #1 | TLD discrimination only |
| 3 | `getSubdomainContext(hostname)` | `apps/web/src/lib/utils/subdomain.ts:198-218` | hostname → `{ platform \| creators \| organization \| reserved }` | wraps #1 | RESERVED_SUBDOMAINS_SET |
| 4 | `cdnRewriteHook` | `apps/web/src/hooks.server.ts:105-136` | event URL → rewrites `localhost:4100` to nip.io for LAN mobile | nip.io only | `if (!dev)` early return |
| 5 | `getCookieConfig(env, host)` | `packages/constants/src/cookies.ts:31-84` | host + env → `Domain=` cookie attribute | localhost / lvh.me / nip.io / dev.rs / prod default | `isDev(env)` + host check |
| 6 | `getDevCookieDomain(env)` | `workers/auth/src/auth-config.ts:36-47` | `env.WEB_APP_URL` → `.lvh.me` or `.{ip}.nip.io` | nip.io regex, fallback `.lvh.me` | URL hostname |
| 7 | `crossSubDomainCookies.domain` ternary | `workers/auth/src/auth-config.ts:217-224` | `env.ENVIRONMENT` literal → BetterAuth cookie domain | DEVELOPMENT / TEST / DEV / else | `ENV_NAMES.X` literal compare |

> **Same fact, four code paths**: #5 derives cookie domain from request host, #6 from `WEB_APP_URL` hostname, #7 from `ENVIRONMENT` env var, and #1+#2 derive the apex from hostname for URL building. Each makes a defensible local choice (defense in depth, different inputs available), but the net effect is four independent traversals of the lvh.me/nip.io/dev.rs/prod tree.

### URL building — writers

| # | Site | File | Constructs | Drift risk |
|---|---|---|---|---|
| 8 | `buildOrgUrl(currentUrl, slug, path)` | `apps/web/src/lib/utils/subdomain.ts:109-118` | `{scheme}//{slug}.{baseDomain}{port?}{path}` | low — uses #2 |
| 9 | `buildCreatorsUrl` | `apps/web/src/lib/utils/subdomain.ts:153-155` | wraps #8 with `slug='creators'` | low |
| 10 | `buildPlatformUrl` | `apps/web/src/lib/utils/subdomain.ts:161-169` | `{scheme}//{baseDomain}{port?}{path}` | low |
| 11 | `buildContentUrl` | `apps/web/src/lib/utils/subdomain.ts:178-196` | root-relative on own org, full URL on others | low |
| 12 | `DEFAULT_URLS` literal table | `packages/constants/src/env.ts:189-235` | 9 services × 3 envs = **27 hardcoded URLs** | **HIGH** — every new env or service multiplies |
| 13 | `getServiceUrl(service, env)` | `packages/constants/src/env.ts:244-332` | env-var lookup with `DEFAULT_URLS` fallback | medium — staging missing (only prod/devRemote/dev branches) |
| 14 | `DevDomainService.hostnameFor(slug)` | `packages/organization/src/services/dev-domain-service.ts:140-142` | `{slug}.dev.{zoneName}` — but `zoneName` is **injected**, not from `DOMAINS.DEV_REMOTE` | medium — independent source of truth |
| 15 | Sitemap entries | `apps/web/src/routes/sitemap.xml/+server.ts`, `apps/web/src/routes/_org/[slug]/sitemap.xml/+server.ts` | use `url.origin` — correct, no hardcoding | none |

### Environment declaration — wrangler

| # | Site | What it declares | Env count | Drift per new env |
|---|---|---|---|---|
| 16 | `apps/web/wrangler.jsonc` | 9 API URL env vars + `ENVIRONMENT` + zone routes | 4 (test/prod/staging/dev) | **9 new URL env vars** + zone routes |
| 17–22 | 6 × API worker `wrangler.jsonc` (auth, content-api, ecom-api, admin-api, identity-api, notifications-api, media-api, organization-api) | `WEB_APP_URL`, `API_URL`, `R2_PUBLIC_URL_BASE`, `ENVIRONMENT`, routes | 4 each | 2–3 URL env vars per worker |
| 23 | `RESERVED_SUBDOMAINS` | `packages/constants/src/urls.ts:29-81` — 51 strings | n/a | 8 new `{service}-{env}` entries |

**Total wrangler URL declarations: ~150 strings across 8 files.** This is the largest drift surface; centralizing the TypeScript side only addresses ~30% of the problem.

### Identifying critical findings

- **Two "dev" namespaces, easily confused.** `ENV_NAMES.DEV` is the *deployed long-lived* dev environment (`dev.revelations.studio`); `ENV_NAMES.DEVELOPMENT` is *local* development. `isDev()` returns true for DEVELOPMENT and TEST; `isDevRemote()` returns true for DEV. Six call sites compare `env.ENVIRONMENT === ENV_NAMES.X` directly (`workers/auth/src/auth-config.ts`) — any rename or new env requires literal-match audit. The names are correct but inverted from intuition (DEV is the deployed env, DEVELOPMENT is the local one).

- **`extractSubdomain` and `deriveBaseDomain` are two halves of the same parse.** Both traverse lvh.me → nip.io → localhost → dev.revelations.studio → revelations.studio in that order. A single `parseHost(host) → { subdomain, baseDomain, env }` would replace both.

- **`DEFAULT_URLS` is missing a `staging` branch.** `pickDefaultUrl()` only handles `prod`, `devRemote`, `dev`. On staging deploys, every URL must come from wrangler env vars; if any worker forgets a `*_URL` in its staging block, the fallback fires and the call goes to **prod**. This is a latent foot-gun, currently masked by the wrangler files being complete.

- **The Phase 7 routing model differs from prod.** Prod uses a wildcard zone route `*.revelations.studio/*` for org subdomains. Dev cannot — Cloudflare Universal SSL doesn't auto-issue certs two levels deep, AND a wildcard `*.dev.revelations.studio/*` route would shadow the API workers' custom domains (auth/content-api/etc). Phase 7 instead provisions a per-org Cloudflare Custom Domain via `DevDomainService` (org-create/rename/delete hooks). Any centralization must preserve this asymmetry, not collapse it.

- **`DevDomainService` doesn't share zone constants with the SvelteKit side.** It takes `zoneName` as injected config; the SvelteKit side uses `DOMAINS.DEV_REMOTE` literal. If the dev zone ever changes, both must update independently.

- **Cookie-domain logic exists in three forms** (#5, #6, #7 above) deriving the same fact from three different inputs. All three are technically correct; defense in depth has merit. But the regex `(\d+\.\d+\.\d+\.\d+\.nip\.io)$` appears in **four** files (subdomain.ts, hooks.server.ts, cookies.ts, auth-config.ts) — drift target.

---

## Proposed centralization

### New package: `@codex/urls`

Pure routing/URL utilities, separated from `@codex/constants` because URL building is logic, not constants. Zero runtime deps; usable by both workers and SvelteKit.

```
packages/urls/
  src/
    env-hosts.ts        # The 5-row env→host table (single source of truth)
    parse-host.ts       # parseHost(host) → HostInfo
    build-url.ts        # buildServiceUrl, buildOrgUrl, buildPlatformUrl, buildContentUrl
    cookie-domain.ts    # cookieDomainFor(host, env) — replaces 3 derivers
    cors-origins.ts     # corsOriginsFor(env) — replaces trustedOrigins array
    index.ts
```

#### `env-hosts.ts`

```ts
export interface EnvHost {
  scheme: 'http' | 'https';
  apex: string;              // 'revelations.studio' | 'dev.revelations.studio' | 'lvh.me'
  port?: number;             // local dev only
  // Per-service URL pattern. {service} is replaced; {apex} can be reused.
  apiPattern: (service: ServiceName, env: EnvName) => string;
}

export const ENV_HOSTS: Record<EnvName, EnvHost> = {
  production: {
    scheme: 'https',
    apex: 'revelations.studio',
    apiPattern: (s) => `https://${SERVICE_SUBDOMAIN[s]}.revelations.studio`,
  },
  staging: {
    scheme: 'https',
    apex: 'staging.revelations.studio',
    apiPattern: (s) => `https://${SERVICE_SUBDOMAIN[s]}-staging.revelations.studio`,
  },
  dev: {
    scheme: 'https',
    apex: 'dev.revelations.studio',
    apiPattern: (s) => `https://${SERVICE_SUBDOMAIN[s]}.dev.revelations.studio`,
  },
  development: {
    scheme: 'http',
    apex: 'lvh.me',
    port: 3000,
    apiPattern: (s) => `http://localhost:${SERVICE_PORTS[s]}`,
  },
  test: { /* same as development */ },
};
```

This collapses the 27-cell `DEFAULT_URLS` table to **5 rows + one function**. Adding `staging` (already partially present) requires 1 row, not 9 URL literals.

#### `parse-host.ts`

```ts
export interface HostInfo {
  env: EnvName;              // detected from TLD
  baseDomain: string;        // 'lvh.me' | 'dev.revelations.studio' | 'revelations.studio'
  subdomain: string | null;  // 'studio-alpha' | null for apex
  port: string | null;
  // For LAN testing: '.192.168.1.10.nip.io' lookup is exposed
  nipIpPart?: string;
}

export function parseHost(host: string): HostInfo;
```

Single traversal replaces `extractSubdomain` + `deriveBaseDomain` and feeds both `cookieDomainFor` and the SvelteKit reroute hook.

#### `cookie-domain.ts`

```ts
// Used by:
//   - getCookieConfig (web app, request-host driven)
//   - auth-worker BetterAuth crossSubDomainCookies.domain
//   - cookie deletion in (auth) layout
export function cookieDomainFor(input: { host: string; env?: EnvName }): string | undefined;
```

Wires through `parseHost`. The auth worker's `crossSubDomainCookies.domain` ternary collapses to `cookieDomainFor({ host: new URL(env.WEB_APP_URL).host, env: env.ENVIRONMENT })`.

#### `build-url.ts`

```ts
// All builders take a HostInfo (parsed once at request entry) or an EnvName.
buildServiceUrl(service: ServiceName, env: EnvName | Env): string;
buildOrgUrl(host: HostInfo, slug: string, path?: string): string;
buildPlatformUrl(host: HostInfo, path?: string): string;
buildCreatorsUrl(host: HostInfo, path?: string): string;
buildContentUrl(host: HostInfo, content: { slug?, id, organizationSlug? }): string;
// New: server-side org URL builder for workers (no current URL to derive from)
buildOrgUrlFromEnv(env: EnvName, slug: string, path?: string): string;
```

The last one resolves the `DevDomainService` drift — it can call `buildOrgUrlFromEnv('dev', slug)` instead of `${slug}.dev.${zoneName}` with its own `zoneName` config.

### Why a new package, not extending `@codex/constants`

`@codex/constants`'s CLAUDE.md says: *"NEVER add side effects to this package — it must be pure constants/functions."* URL building reads env discriminators and returns derived strings — borderline. The `urls.ts` and `env.ts` already strain that contract (`getServiceUrl` is logic, not a constant). A separate `@codex/urls` package keeps the boundary clean and lets `@codex/constants` shed `getServiceUrl`/`getCookieConfig` later.

Alternative: keep everything in `@codex/constants`. Lower file churn, mildly muddier semantics. Acceptable, but the new-package option leaves a cleaner long-term home.

---

## Migration plan

Five PRs, each green-on-its-own:

1. **`@codex/urls` package skeleton + `parseHost`** — replace `extractSubdomain` and `deriveBaseDomain` with internal wrappers calling `parseHost`. Keep export names stable. ~80 LOC + tests for all 4 TLD branches.

2. **`buildServiceUrl` → ENV_HOSTS table** — replace `DEFAULT_URLS` (27 literals) with `ENV_HOSTS` (5 rows). `getServiceUrl` becomes a thin re-export from `@codex/urls` (or eventually deleted). Adds `staging` as a first-class branch. ~30 LOC reduced + tests.

3. **`cookieDomainFor` unification** — `getCookieConfig`, `getDevCookieDomain`, and the `crossSubDomainCookies.domain` ternary all call the new helper. Must add integration test for auth worker: register on lvh.me, register on dev.rs, register on nip.io. ~60 LOC + integration test.

4. **`buildOrgUrlFromEnv` + `DevDomainService` wiring** — `DevDomainService.hostnameFor` becomes a one-liner `buildOrgUrlFromEnv(env, slug)` (or its hostname-only sibling). Removes the `zoneName` config injection. ~30 LOC + Phase 7 regression test.

5. **Wrangler URL deduplication (optional / future)** — generate worker wrangler URL blocks from a single TypeScript source (build-time codegen). Not a hard dependency on the centralization; saves ~150 lines but adds build complexity. **Defer; revisit when adding next env.**

Each PR is independently revert-safe. PR 3 is the highest-risk (auth cookies are revocation-critical); PR 4 is the freshest payoff (matches user's mental model of Phase 7's drift).

---

## Out of scope

- **R2/CDN paths** (`packages/transcoding/src/paths.ts`) — purely creator-id keyed. The one URL-builder (`getMediaThumbnailUrl`) takes `cdnBase` as a parameter. No env coupling.
- **Sitemaps** — use `url.origin`, already correct.
- **Stripe redirect URLs** — pulled from `WEB_APP_URL` directly. Bounded scope, no parsing.
- **Email links** — same, via `WEB_APP_URL`.
- **Brand editor / studio SPA** — client-rendered subtrees, don't touch URL resolution.
- **CSP / security headers** — handled separately in `@codex/security`.
- **SEO canonical URLs** — already use `url.origin`.

---

## Open questions for the design phase

- **EnvName detection.** Today: a mix of `env.ENVIRONMENT === 'dev'` (workers), `isDev(env)` (constants), TLD inspection (subdomain.ts). Should `parseHost` infer env from TLD, should it require an explicit `env` param, or both? My recommendation: both — TLD detection for SvelteKit (where there's no env binding handy), explicit param for workers (where ENVIRONMENT is authoritative).

- **Backward-compatible re-exports?** The codebase has 30+ callers of `extractSubdomain`/`buildOrgUrl`/`getServiceUrl`/`getCookieConfig`. Move them all in PR 1, or shim through re-exports? Per project rule "don't add backwards-compatibility shims" — migrate all callers in the same PR.

- **Where does `RESERVED_SUBDOMAINS` live?** Today it has per-env variants (`cdn-staging`, `cdn-dev`). With centralization, the per-env subdomain is derived from `ENV_HOSTS.apiPattern` — the reserved list collapses to the base service names (cdn, auth, content-api, etc) and the env variants are derived. ~30 entries instead of 51.

- **Wrangler codegen vs hand-maintained?** Auto-generating wrangler env URL blocks from `ENV_HOSTS` is structurally clean but adds build-time complexity and a "manifest of trust" review pattern. Probably defer until the next env is added; current state is at least internally consistent.

---

*Investigation done by Claude, dev branch, 2026-05-22. No code changed; this is the design surface map.*
