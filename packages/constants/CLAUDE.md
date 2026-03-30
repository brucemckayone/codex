# @codex/constants

Shared constants and utilities. Zero-dependency — safe to import everywhere.

## Service Ports (Source of Truth)

**MUST** use `getServiceUrl(service, env)` to resolve URLs. NEVER hardcode ports.

| Service | Port | Worker |
|---|---|---|
| `AUTH` | 42069 | auth |
| `CONTENT` | 4001 | content-api |
| `ACCESS` | 4001 | content-api (shared) |
| `ORGANIZATION` | 42071 | organization-api |
| `ECOMMERCE` | 42072 | ecom-api |
| `ADMIN` | 42073 | admin-api |
| `IDENTITY` | 42074 | identity-api |
| `NOTIFICATIONS` | 42075 | notifications-api |
| `MEDIA` | 4002 | media-api |
| `MAILHOG` | 8025 | dev email UI |

## Key Exports

### URLs & Services
| Export | Purpose |
|---|---|
| `SERVICE_PORTS` | Port constants for all workers |
| `getServiceUrl(service, env)` | Resolves full URL (dev vs prod). Includes SSRF protection |
| `validateServiceUrl(url, requireHttps)` | Blocks dangerous protocols, private IPs, cloud metadata |
| `DOMAINS` | `{ PROD, STAGING, DEV, LOCAL }` |
| `RESERVED_SUBDOMAINS` | Array of reserved subdomain names |
| `RESERVED_SUBDOMAINS_SET` | Set for O(1) lookups |

### Commerce
| Export | Value | Notes |
|---|---|---|
| `PLATFORM_FEE_BPS` | 1000 (10%) | Platform take on purchases |
| `MIN_PURCHASE_AMOUNT_CENTS` | — | Minimum purchase in pence (GBP) |

### Environment
| Export | Purpose |
|---|---|
| `isDev(env)` | Returns true in development/test mode |
| `ENV_NAMES` | `{ PRODUCTION, STAGING, DEVELOPMENT, TEST }` |
| `INFRA_KEYS` | Environment variable key names for R2, Stripe, Database |

### Limits
| Export | Purpose |
|---|---|
| `MAX_FILE_SIZE_BYTES` | Upload size limit |
| `MAX_PAGINATION_LIMIT` | Max items per page |

### MIME Types
| Export | Purpose |
|---|---|
| `VIDEO` | Supported video MIME types |
| `IMAGE` | Supported image MIME types |
| `STREAMING` | HLS streaming MIME types |

### Cookies
| Export | Purpose |
|---|---|
| `getCookieConfig(env)` | Returns secure cookie config (HttpOnly, Secure, SameSite, domain) |
| `COOKIES.SESSION_NAME` | Session cookie name |

## SSRF Protection

`getServiceUrl()` validates all URLs via `validateServiceUrl()`:
- Only allows `http://` and `https://` protocols
- Blocks `javascript:`, `data:`, `file:`, `ftp:` protocols
- Blocks cloud metadata services (`169.254.169.254`, `metadata.google.internal`)
- Blocks private IP ranges in production (`10.x`, `172.16.x`, `192.168.x`, `127.x`)
- Allows localhost only in dev mode

## Strict Rules

- **MUST** use `getServiceUrl(service, env)` for ALL worker URL resolution — NEVER hardcode URLs or ports
- **MUST** use `SERVICE_PORTS` as single source of truth — NEVER duplicate port numbers
- **MUST** check `RESERVED_SUBDOMAINS_SET` when validating org slugs
- **MUST** use `getCookieConfig(env)` for cookie configuration — ensures correct domain/security settings
- **NEVER** hardcode port numbers, domains, or URLs in worker code
- **NEVER** import this package with side effects — it's pure constants/functions

## Integration

- **Depends on**: Nothing (zero dependencies)
- **Used by**: Every package and worker in the monorepo

## Reference Files

- `packages/constants/src/urls.ts` — ports, domains, reserved subdomains, `getServiceUrl()`
- `packages/constants/src/env.ts` — `isDev()`, `validateServiceUrl()`, `INFRA_KEYS`
- `packages/constants/src/cookies.ts` — `getCookieConfig()`, cookie names
- `packages/constants/src/mime.ts` — MIME type constants
