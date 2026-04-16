# @codex/constants

Shared constants and utilities. Zero dependencies — safe to import anywhere.

## Service Ports & URLs

**MUST** use `getServiceUrl(service, env)` — NEVER hardcode ports or URLs.

```ts
import { getServiceUrl } from '@codex/constants';

const authUrl = getServiceUrl('auth', env);       // → https://auth.revelations.studio (prod)
const contentUrl = getServiceUrl('content', env); // → http://localhost:4001 (dev)
```

**`ServiceName`** values: `'auth' | 'content' | 'access' | 'org' | 'ecom' | 'admin' | 'identity' | 'notifications' | 'media'`

`getServiceUrl` resolves via env vars first (`AUTH_WORKER_URL`, `API_URL`, `ORG_API_URL`, etc.), then falls back to defaults. Validates all URLs through `validateServiceUrl()` (SSRF protection).

| Service | Port | Env var override |
|---|---|---|
| `auth` | 42069 | `AUTH_WORKER_URL` |
| `content` / `access` | 4001 | `API_URL` |
| `org` | 42071 | `ORG_API_URL` |
| `ecom` | 42072 | `ECOM_API_URL` |
| `admin` | 42073 | `ADMIN_API_URL` |
| `identity` | 42074 | `IDENTITY_API_URL` |
| `notifications` | 42075 | `NOTIFICATIONS_API_URL` |
| `media` | 4002 | `MEDIA_API_URL` |

`SERVICE_PORTS` is also exported (object of port numbers) — use for reference but not for building URLs.

## Environment

```ts
isDev(env)           // true in development/test; accepts Env object or boolean
ENV_NAMES            // { PRODUCTION, STAGING, DEVELOPMENT, TEST }
validateServiceUrl(url, requireHttps?) // SSRF protection — throws on private IPs in prod
```

**SSRF protection**: blocks `javascript:`, `data:`, `file:` protocols; cloud metadata (`169.254.169.254`, `metadata.google.internal`); private IPs (10.x, 172.16-31.x, 192.168.x, 127.x) when `requireHttps=true`.

## Cookies

```ts
getCookieConfig(env?, host?, options?)
// Returns: { path, httpOnly, secure, sameSite, domain?, maxAge? }
// secure=true always in prod; false only for localhost/lvh.me/nip.io in dev
// domain=.revelations.studio in prod (or COOKIE_DOMAIN env var)
// domain=.lvh.me in dev when host contains lvh.me

COOKIES.SESSION_NAME  // 'codex-session'
COOKIES.SESSION_MAX_AGE  // 604800s (7 days)
COOKIES.TOKEN_MAX_AGE    // 300s (5 minutes)
```

## Commerce

```ts
FEES.PLATFORM_PERCENT    // 1000 (10.00% in basis points)
FEES.SUBSCRIPTION_ORG_PERCENT  // 1500 (15.00%)
CURRENCY                 // { GBP: 'gbp', USD: 'usd', EUR: 'eur' }
STRIPE_EVENTS            // checkout.session.completed, customer.subscription.*, etc.
PURCHASE_STATUS          // { PENDING, COMPLETED, FAILED, REFUNDED }
SUBSCRIPTION_STATUS      // { ACTIVE, PAST_DUE, CANCELLING, CANCELLED, INCOMPLETE }
BILLING_INTERVAL         // { MONTH, YEAR }
CONNECT_ACCOUNT_STATUS   // { ONBOARDING, ACTIVE, RESTRICTED, DISABLED }
```

**Default currency is GBP (£)**, not USD.

## Limits & File Sizes

```ts
PAGINATION           // { DEFAULT: 20, MAX: 100 }
FILE_SIZES           // { LOGO_MAX_BYTES: 5MB, IMAGE_MAX_BYTES: 5MB, MEDIA_MAX_BYTES: 5GB, MEDIA_MIN_BYTES: 1KB }
R2_DEFAULTS          // { MAX_RETRIES: 3, BASE_DELAY_MS: 100, MAX_EXPIRY_SECONDS: 604800 }
STREAMING            // { DEFAULT_EXPIRY_SECONDS: 3600 }
CACHE_TTL            // { BRAND_CACHE_SECONDS: 604800, ORG_PUBLIC_INFO_SECONDS: 1800 }
VIDEO_PROGRESS       // { COMPLETION_THRESHOLD: 0.95 }
```

## Rate Limit Presets

Used by `@codex/security`'s `RATE_LIMIT_PRESETS`:

```ts
RATE_LIMIT_PRESETS   // { AUTH, STRICT, STREAMING, API, WEBHOOK, WEB }
// AUTH: 5/15min, STRICT: 20/min, STREAMING: 60/min, API: 100/min, WEB: 300/min, WEBHOOK: 1000/min
```

## MIME Types & Headers

```ts
MIME_TYPES           // { APPLICATION: { JSON }, IMAGE: { ... }, VIDEO: { ... }, ... }
HEADERS              // { CONTENT_TYPE, WORKER_SIGNATURE, WORKER_TIMESTAMP, ... }
SUPPORTED_IMAGE_MIME_TYPES  // Set of allowed image MIME types
SUPPORTED_MEDIA_MIME_TYPES  // Set of allowed video/audio MIME types
MIME_TO_EXTENSION    // Map from MIME type to file extension
```

## Content & Database Constants

```ts
CONTENT_STATUS       // { DRAFT, PUBLISHED, ARCHIVED }
MEDIA_STATUS         // { PENDING, PROCESSING, READY, FAILED }
CONTENT_TYPES        // { VIDEO, AUDIO, WRITTEN }
MEDIA_TYPES          // { VIDEO, AUDIO }
VISIBILITY           // { PUBLIC, MEMBERS, PURCHASERS, PRIVATE }
ACCESS_TYPES         // { FREE, PAID, MEMBERS_ONLY, ... }
CONTENT_ACCESS_TYPE  // content access type constants

ORGANIZATION_ROLES   // { OWNER, ADMIN, CREATOR, SUBSCRIBER, MEMBER }
ORGANIZATION_STATUS  // org status constants
DB_METHODS           // { LOCAL_PROXY, NEON_BRANCH, PRODUCTION }
POSTGRES_ERROR_CODES // { UNIQUE_VIOLATION: '23505', FOREIGN_KEY_VIOLATION: '23503', NOT_NULL_VIOLATION: '23502' }
```

## URLs & Subdomains

```ts
DOMAINS              // { PROD: 'revelations.studio', STAGING: '...', DEV: 'lvh.me', LOCAL: 'localhost' }
RESERVED_SUBDOMAINS  // Array of reserved org slug names (cdn, api, auth, www, admin, etc.)
RESERVED_SUBDOMAINS_SET  // Set<string> for O(1) lookups
```

**MUST** check `RESERVED_SUBDOMAINS_SET` when validating org slugs (built into `createOrganizationSchema` in `@codex/validation`).

## Security & Observability Constants

```ts
AUTH_ROLES           // { ADMIN, CREATOR, USER }
CSP_DIRECTIVES       // CSP directive constants for security headers
SENSITIVE_KEYS       // Array of field names to redact in logs
SENSITIVE_PATTERNS   // Regex patterns for detecting sensitive data
LOG_LEVELS           // { DEBUG, INFO, WARN, ERROR }
```

## Infrastructure Keys

```ts
INFRA_KEYS.R2        // { ACCOUNT_ID, ACCESS_KEY_ID, SECRET_ACCESS_KEY, BUCKET_MEDIA }
INFRA_KEYS.STRIPE    // { SECRET_KEY, WEBHOOK_SECRET }
INFRA_KEYS.DATABASE  // { URL, URL_LOCAL_PROXY }
```

## Strict Rules

- **MUST** use `getServiceUrl(service, env)` — NEVER hardcode URLs or port numbers
- **MUST** use `RESERVED_SUBDOMAINS_SET` for org slug validation
- **MUST** use `getCookieConfig(env)` for cookie configuration
- **NEVER** add side effects to this package — it must be pure constants/functions

## Reference Files

- `packages/constants/src/urls.ts` — `SERVICE_PORTS`, `DOMAINS`, `RESERVED_SUBDOMAINS`
- `packages/constants/src/env.ts` — `getServiceUrl`, `isDev`, `validateServiceUrl`, `INFRA_KEYS`
- `packages/constants/src/cookies.ts` — `getCookieConfig`, `COOKIES`
- `packages/constants/src/limits.ts` — `PAGINATION`, `FILE_SIZES`, `RATE_LIMIT_PRESETS`, `CACHE_TTL`
- `packages/constants/src/commerce.ts` — `FEES`, `CURRENCY`, `STRIPE_EVENTS`, `PURCHASE_STATUS`
- `packages/constants/src/content.ts` — `CONTENT_STATUS`, `MEDIA_STATUS`, `CONTENT_TYPES`, `VISIBILITY`
- `packages/constants/src/mime.ts` — `MIME_TYPES`, `HEADERS`, `SUPPORTED_*_MIME_TYPES`
- `packages/constants/src/database.ts` — `POSTGRES_ERROR_CODES`, `ORGANIZATION_ROLES`, `DB_METHODS`
