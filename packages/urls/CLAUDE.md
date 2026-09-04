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

Adding a new env = one new row. Adding a new service = a `ServiceName` member plus one entry each in `SERVICE_SUBDOMAIN` and `SERVICE_PORT_MAP` (ports come from `@codex/constants` `SERVICE_PORTS`).

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

### URL building

```ts
import {
  buildServiceUrl,   // implemented (WP-3 landed, #249) — replaces constants' getServiceUrl
  buildOrgUrl,
  buildOrgUrlFromEnv,
  buildPlatformUrl,
  buildCreatorsUrl,
  buildContentUrl,
  buildJourneyUrl,   // journey/portal URL surfaces (JourneyUrlTarget, JourneySurface)
} from '@codex/urls';
```

### CORS origins

```ts
import { corsOriginsFor } from '@codex/urls';

corsOriginsFor('development');
// → ['http://localhost:42069', 'http://lvh.me:3000',
//    'http://lvh.me:5173', 'http://*.lvh.me:3000',
//    'http://*.lvh.me:5173', 'http://*.nip.io']
```

### Cookie domain

```ts
import { cookieDomainFor } from '@codex/urls';
// Implemented (WP-5a landed, #255): host-driven (primary) or env-driven cookie
// Domain. localhost/127.x → undefined; lvh.me → .lvh.me; revelations.studio →
// .revelations.studio (or COOKIE_DOMAIN override).
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

The package is landed and consumed by 33 files across `packages/`, `workers/`
and `apps/web`. Every export documented above is implemented — `buildServiceUrl`
(WP-3, #249) replaced `@codex/constants`' `getServiceUrl`, `apps/web`'s
hostname parsers are wrappers over `parseHost` (WP-2, #250), and
`cookieDomainFor` is the single cookie-domain source (WP-5a).

**One work package is still open:**

- ⏳ **WP-7** — wrangler URL env-var cleanup (Codex-10hr1). 8 of 9 worker
  configs still declare `WEB_APP_URL` / `API_URL` vars (e.g.
  `workers/auth/wrangler.jsonc:71`) that `buildServiceUrl` now derives from
  `SERVICE_PORTS` + `ENV_HOSTS`. Removing them is the last step.

Investigation: `docs/routing-centralization.md`.
