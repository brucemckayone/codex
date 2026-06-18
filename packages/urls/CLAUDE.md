# @codex/urls

Centralized URL building, hostname parsing, and cookie/CORS domain helpers for the Codex platform.

Owns the routing-related concerns that were previously duplicated across:

- `apps/web/src/lib/utils/subdomain.ts` (hostname parsers + URL builders)
- `packages/constants/src/{env,cookies}.ts` (service URLs + cookie config)
- `workers/auth/src/auth-config.ts` (BetterAuth cookie domain + trustedOrigins)
- `packages/organization/src/services/dev-domain-service.ts` (Phase 7 hostname)

## Source of truth: `ENV_HOSTS`

A 5-row table keyed by `EnvName`. Each row provides:

- `scheme` — `http` (local) or `https` (deployed)
- `port` — local-dev only (3000 for `development` / `test`)
- `apiUrl(service)` — worker URL for a given service
- `orgHost(slug)` — hostname (no scheme, no path) for a given org slug

Adding a new env = one new row. Adding a new service = one new entry in `SERVICE_SUBDOMAIN`.

## Public API

### Hostname parsing

```ts
import { parseHost } from '@codex/urls';

parseHost('studio-alpha.dev.revelations.studio');
// → { env: 'dev', baseDomain: 'dev.revelations.studio',
//     subdomain: 'studio-alpha', port: null, nipApex: null }

parseHost('codex-staging.revelations.studio');
// → { env: 'staging', baseDomain: 'revelations.studio',
//     subdomain: 'codex-staging', port: null, nipApex: null }

parseHost('bruce-studio.192.168.1.10.nip.io:3000');
// → { env: 'development', baseDomain: '192.168.1.10.nip.io',
//     subdomain: 'bruce-studio', port: '3000',
//     nipApex: '192.168.1.10.nip.io' }
```

`env: null` is returned for unknown hosts (custom domains, IPs, etc.) — workers should pass env explicitly when building URLs from non-routable contexts.

### URL building (WP-3 / WP-4 stubs)

```ts
import {
  buildServiceUrl,         // WP-3 stub — throws until WP-3 lands
  buildOrgUrl,             // WP-4 stub
  buildOrgUrlFromEnv,      // WP-4 stub
  buildPlatformUrl,        // WP-4 stub
  buildCreatorsUrl,        // WP-4 stub
  buildContentUrl,         // WP-4 stub
} from '@codex/urls';
```

### CORS origins

```ts
import { corsOriginsFor } from '@codex/urls';

corsOriginsFor('development');
// → ['http://localhost:42069', 'http://lvh.me:3000',
//    'http://lvh.me:5173', 'http://*.nip.io']
```

### Cookie domain (WP-5a stub)

```ts
import { cookieDomainFor } from '@codex/urls';
// Throws "not implemented (WP-5a)" until WP-5a lands.
```

## ENV_HOSTS table

| env | scheme | `orgHost(slug)` | `apiUrl('auth')` (example) |
|---|---|---|---|
| `production` | https | `{slug}.revelations.studio` | `https://auth.revelations.studio` |
| `staging` | https | `{slug}-staging.revelations.studio` | `https://auth-staging.revelations.studio` |
| `dev` | https | `{slug}.dev.revelations.studio` | `https://auth.dev.revelations.studio` |
| `development` | http | `{slug}.lvh.me` | `http://localhost:42069` |
| `test` | http | `{slug}.lvh.me` | `http://localhost:42069` |

## Two-`dev` naming clarification

`EnvName` has two values that both contain "dev":

- **`dev`** — the deployed long-lived `dev.revelations.studio` environment. HTTPS, secure cookies, per-org Cloudflare Custom Domains via `DevDomainService`.
- **`development`** — local development on the developer's machine. HTTP, non-secure cookies, lvh.me / nip.io / localhost.

`ENV_NAMES.DEV_REMOTE` in `@codex/constants` is the matching constant for the `dev` env value. Avoid `'dev'` string literals; always use `ENV_NAMES.DEV_REMOTE`.

## Strict rules

- **Zero runtime deps** except `@codex/constants` (for `SERVICE_PORTS`)
- **Never hardcode** hostname patterns elsewhere; always import from `ENV_HOSTS` or call `parseHost`
- **Never duplicate** TLD-branch logic. Single source of truth in `parse-host.ts`.
- `parseHost` returns `env: null` for unknown hosts — callers MUST pass env explicitly when building URLs from non-routable contexts.

## Migration status (Codex-rscgk epic)

- ✅ **WP-1** — package foundation + `ENV_HOSTS` + `parseHost` + `corsOriginsFor` + DEV_REMOTE rename
- ⏳ **WP-2** — hostname parsers in `apps/web` become wrappers (Codex-qyjds)
- ⏳ **WP-3** — `buildServiceUrl` replaces `getServiceUrl` + `DEFAULT_URLS` (Codex-4xbuw)
- ⏳ **WP-4** — URL builders + `buildOrgUrlFromEnv` (Codex-fiveo)
- ⏳ **WP-5a** — `cookieDomainFor` unification + byte-equal fixture (Codex-ora41)
- ⏳ **WP-5b** — BetterAuth cross-subdomain integration test (Codex-7okxb)
- ⏳ **WP-6** — `DevDomainService` rewire (Codex-0hxw4)
- ⏳ **WP-7** — wrangler URL env-var cleanup (Codex-10hr1)
- ⏳ **WP-8** — sitemap structural test (Codex-6wvam)
- ⏳ **WP-9** — dev-deploy smoke gate in CI (Codex-ikum9)

Plan: `~/.claude/plans/typed-honking-canyon.md`. Investigation: `docs/routing-centralization.md`.
