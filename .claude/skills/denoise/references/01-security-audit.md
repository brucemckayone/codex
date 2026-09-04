# Reference 01 — Security Audit

> Loaded by `/denoise --phase=security` regardless of scope. Pair with the relevant domain reference (05/06/07).
> Owned MCPs (per scope): `playwright`, `chrome-devtools` for apps/web; Vitest integration for workers; Vitest unit for packages.

---

## §0 — When this reference applies

Every cell where `--phase=security`. The cell selects which **scope reference** (05/06/07) to pair with — this file owns the cross-cutting security rules; the scope reference owns the domain-specific patterns (HMAC for workers, CSP for web, BaseService scoping for packages).

If you're auditing something that's primarily about **cache layers** (e.g., a cache key that reveals tenant data), the finding may belong to `/caching` instead. Check the boundary in §8 of `SKILL.md`.

---

## §1 — Auth & Policy (`procedure()` enforcement)

Every API endpoint MUST go through `procedure()` from `@codex/worker-utils` with an explicit `policy.auth` setting.

| Policy value | Meaning |
|---|---|
| `'required'` (default) | Session required; user resolved into `ctx.user` |
| `'optional'` | Session if present; `ctx.user` may be `null` |
| `'none'` | Public endpoint; explicitly opted out of auth |
| `'worker'` | HMAC-SHA256 signature required (worker-to-worker) |
| `'platform_owner'` | Auth required AND user.role === 'platform_owner' |

**Audit recipe:**

```bash
# Find every procedure() call and check the policy is set
grep -rn 'procedure({' workers/*/src --include='*.ts' | grep -v '\.test\.ts'
# For each match, verify the next 5-10 lines contain `policy:` and `auth:`
```

**Findings to flag** (each with stable fingerprint):

- `security:procedure-without-auth-policy` — `procedure({ ... })` with no `policy.auth`
- `security:procedure-explicit-none` — `policy.auth: 'none'` on a path that handles user data
- `security:procedure-input-any` — `procedure().input(z.any())` (also caught by types phase)
- `security:auth-required-but-no-org-check` — `auth: 'required'` for org-scoped resources without `requireOrgMembership: true`

---

## §2 — Tenant Scoping

Every database query against a tenant-scoped table MUST include the scope predicate (`creatorId`, `orgId`, or both).

The canonical helpers in `@codex/database`:
- `scopedNotDeleted(table, creatorId)` — adds `WHERE creator_id = ? AND deleted_at IS NULL`
- `withCreatorScope({ table, creatorId })` — query builder helper for joins
- `withOrgScope({ table, orgId })` — same for org-scoped tables

**Audit recipe:**

```bash
# Find every db.query.<table>.findMany / findFirst that's NOT wrapped
grep -rn 'db\.query\.' packages/*/src workers/*/src apps/web/src --include='*.ts' | grep -v 'scopedNotDeleted\|withCreatorScope\|withOrgScope'
```

Every match needs human inspection: is the table tenant-scoped? If yes, is the scope applied via the where clause directly?

**Findings to flag:**

- `security:unscoped-tenant-query` — Query against `creator_id`/`org_id` table without scope predicate
- `security:scope-from-input` — Scope param taken directly from request body without verifying it matches `ctx.user`'s allowed scopes
- `security:scope-mismatched` — Query scopes by `creatorId` but the table is `org_id`-scoped (or vice versa)
- `security:soft-delete-bypass` — Query that doesn't filter `deleted_at IS NULL` on a soft-deletable table

---

## §3 — HMAC Verification (webhooks + worker-to-worker)

Two flavours:

### 3a. Stripe webhook signatures

Stripe webhooks land at `workers/ecom-api/src/webhooks/stripe.ts`. Every payload MUST be verified via `stripe.webhooks.constructEventAsync(rawBody, signatureHeader, secret)`. The sync `constructEvent` does not work in the workerd runtime. **Do NOT use `JSON.parse(rawBody)` directly** — Stripe requires the raw bytes for signature verification.

**Audit recipe:**

```bash
grep -rn 'webhooks/stripe' workers/ --include='*.ts'
# Each handler MUST contain `constructEventAsync(`
```

Findings to flag:
- `security:stripe-webhook-no-signature-verify` — Webhook handler reads body without `constructEventAsync`
- `security:stripe-webhook-shared-secret-fallback` — Handler accepts a fallback secret if env var missing (silent downgrade)

### 3b. Worker-to-worker HMAC (`policy.auth: 'worker'`)

Internal worker calls use HMAC-SHA256 via `@codex/security`. **Caller-side**: `workerFetch()` (high-level, signs and fetches) or `generateWorkerSignature()` (low-level, signs only). **Receiver-side**: `workerAuth` middleware + `policy.auth: 'worker'`.

**Audit recipe:**

```bash
# Find all worker-to-worker fetch calls
grep -rn "getServiceUrl\|fetch.*workers" workers/ packages/ --include='*.ts'
# Each MUST be paired with workerFetch()/generateWorkerSignature() at the caller and policy.auth: 'worker' at the receiver
```

Findings to flag:
- `security:worker-call-no-hmac` — Cross-worker fetch without `workerFetch()` / `generateWorkerSignature()`
- `security:hmac-receiver-missing-policy` — Receiver endpoint lacks `policy.auth: 'worker'`
- `security:hmac-secret-hardcoded` — Shared secret hardcoded instead of pulled from env

---

## §4 — Rate Limiting

Auth endpoints use `rateLimit: 'auth'` (5 req/15min). Other endpoints may use `rateLimit: 'standard'` (60 req/min) or define custom limits.

**Audit recipe:**

```bash
grep -rn 'procedure({' workers/auth/src --include='*.ts'
# Every auth endpoint MUST have rateLimit set
```

Findings to flag:
- `security:auth-endpoint-no-ratelimit` — Auth endpoint without `rateLimit`
- `security:ratelimit-bypassable` — Rate limit keyed on a header the client controls (e.g., `x-forwarded-for` directly, instead of CF-resolved IP)

---

## §5 — Sanitisation

User input that reaches storage or rendering MUST be sanitised at the boundary.

### 5a. SVG content

`@codex/validation` `sanitizeSvgContent()` strips dangerous SVG constructs (`<script>`, `javascript:` URLs, event handlers). Used for org-uploaded SVG (logos, brand icons).

**Audit recipe:**

```bash
grep -rn 'svg' packages/*/src apps/web/src --include='*.ts' | grep -i 'upload\|store\|content'
# Every SVG storage path MUST go through sanitizeSvgContent()
```

Findings to flag:
- `security:unsanitised-svg-storage` — SVG bytes stored to R2 without `sanitizeSvgContent()`
- `security:unsanitised-svg-render` — SVG inlined into HTML without sanitisation

### 5b. Markdown / rich text

User markdown rendered server-side OR client-side MUST go through a vetted sanitiser (DOMPurify on client, sanitize-html or remark-sanitize on server).

Findings to flag:
- `security:unsanitised-markdown-render` — `dangerouslySetInnerHTML` / `{@html ...}` on user-provided markdown

### 5c. Filename / path

User-provided filenames used in R2 keys must be path-traversal-safe.

Findings to flag:
- `security:path-traversal-r2-key` — User filename concatenated into R2 key without sanitisation

---

## §6 — CSP & Security Headers

`@codex/security` `securityHeaders` middleware sets default headers (CSP, X-Frame-Options, Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy).

**Audit recipe (workers):**

```bash
grep -rn 'securityHeaders\|app.use.*security' workers/*/src --include='*.ts'
# Every worker SHOULD apply securityHeaders middleware
```

**Audit recipe (apps/web):**

CSP is configured in `apps/web/svelte.config.js` (`kit.csp` field) AND `apps/web/src/hooks.server.ts` (header overrides).

Findings to flag:
- `security:csp-unsafe-inline` — CSP allows `'unsafe-inline'` in `script-src` or `style-src` without nonce
- `security:csp-wildcard-sources` — CSP `*` in `script-src`/`connect-src`
- `security:missing-security-headers` — Worker without `securityHeaders` middleware

---

## §7 — Secret Hygiene

Secrets (API keys, JWT secrets, DB URLs) MUST come from `env.*` Cloudflare Worker bindings. Never hardcoded, never logged.

**Audit recipe:**

```bash
# Find any string that looks like an API key
grep -rn 'sk_test_\|sk_live_\|whsec_\|Bearer ' packages/ workers/ apps/web/src --include='*.ts' | grep -v '\.test\.ts'

# Find console.log near secret-looking variables
grep -rn 'console\.\(log\|info\|debug\)' packages/ workers/ --include='*.ts' | grep -i 'token\|secret\|key\|password\|cookie'
```

`@codex/observability` auto-redacts sensitive values in every `obs.{info,warn,error,debug}` call (keys matching `SENSITIVE_KEYS` + value-pattern detection). For explicit redaction of metadata objects before passing to other systems, use the standalone `redactSensitiveData(metadata, options?)` exported from `@codex/observability` (implemented in `packages/observability/src/redact.ts`).*

Findings to flag:
- `security:hardcoded-secret` — Recognisable secret pattern in source
- `security:secret-in-log` — `console.log` / `obs.info` containing a token-like variable without redaction
- `security:env-var-fallback-default` — `process.env.X || 'default-value'` for a secret var

---

## §8 — Anti-Pattern Table (Phase 1 Seed)

These rows are the recurrence-counter inputs. Each fingerprint is stable kebab-case; agents emit it on every finding match.

| # | Fingerprint | Pattern | Why bad | Fix |
|---|---|---|---|---|
| 1 | `security:procedure-input-any` | `procedure().input(z.any())` | Bypasses validation; arbitrary shape reaches handler | Use a named zod schema in `@codex/validation` |
| 2 | `security:procedure-without-auth-policy` | `procedure({ ... })` without `policy.auth` | Silently defaults; risk of unintended public endpoint | Always set `policy.auth` explicitly |
| 3 | `security:unscoped-tenant-query` | `db.query.X.findMany()` against tenant-scoped table without scope predicate | Cross-tenant data exposure | Wrap with `scopedNotDeleted()` / `withCreatorScope()` / `withOrgScope()` |
| 4 | `security:unsanitised-svg-storage` | SVG written to R2 without `sanitizeSvgContent()` | Stored XSS via SVG (Codex-06ygy precedent) | Route through `sanitizeSvgContent()` first |
| 5 | `security:stripe-webhook-no-signature-verify` | Stripe handler reads body without `constructEventAsync` | Forged webhook accepted | Call `stripe.webhooks.constructEventAsync(rawBody, sig, secret)` |
| 6 | `security:worker-call-no-hmac` | Cross-worker fetch without HMAC signature | Spoofable internal call | Caller: `workerFetch()` or `generateWorkerSignature()` from `@codex/security`; Receiver: `workerAuth` middleware + `policy.auth: 'worker'` |
| 7 | `security:auth-endpoint-no-ratelimit` | Auth route without `rateLimit: 'auth'` | Brute-force vulnerability | Add `rateLimit: 'auth'` (5/15min) |
| 8 | `security:csp-unsafe-inline` | CSP `script-src` allows `'unsafe-inline'` without nonce | XSS amplifier | Use nonce-based CSP via SvelteKit `csp.directives` |
| 9 | `security:secret-in-log` | `console.log` / `obs.info` with token-like var, unredacted | Token exposure in tail logs | Use `obs.*` methods (auto-redact metadata) or `redactSensitiveData()` from `@codex/observability`; never raw `console.log` secrets |
| 10 | `security:hardcoded-secret` | Recognisable secret pattern (`sk_*`, `whsec_*`) in source | Secret in git history | Read from `env.X` binding; rotate the leaked secret |
| 11 | `security:cookie-no-httponly` | Session/auth cookie without `HttpOnly`/`Secure`/`SameSite` | XSS-readable session | Use `getCookieConfig()` from `@codex/constants` |
| 12 | `security:cors-wildcard` | `app.use('*', cors())` with no allow-list | Cross-origin data leak | Pin to `getServiceUrl()` allow-list |

Add new rows here as cycles surface new patterns. Rows that hit ≥3 times in trailing 6 cycles get promoted to a hard rule in `SKILL.md` §1.

---

## §9 — MCP Verification Matrix (security cells)

| Scope | Required MCPs | What they prove |
|---|---|---|
| `apps/web` | `playwright` | Auth flow: unauthenticated → 401/redirect; authenticated user can't access another tenant's data |
| `apps/web` | `chrome-devtools` | Headers screenshot showing CSP, HSTS, X-Frame-Options applied |
| `workers` | (Vitest integration test using `@cloudflare/vitest-pool-workers`) | HMAC verification rejects malformed signatures; rate limiter enforces |
| `packages` | (Vitest unit test) | `sanitizeSvgContent` strips `<script>`; `scopedNotDeleted` adds correct WHERE clause |

**No MCP evidence = bead does not close (R6).**

---

## §10 — Cross-links

- `/backend-dev` reference 04 — security patterns deep dive (HMAC, session validation, scoping). Read this when implementing a fix; this denoise reference covers detection.
- `/caching` SKILL.md §6 — anti-pattern row "DYNAMIC_PUBLIC on auth-varying URLs" (cache leak of authenticated state).
- `packages/security/CLAUDE.md` — canonical security utility documentation.
- `packages/validation/CLAUDE.md` — canonical sanitisation utility documentation.
- `/fallow-audit` SKILL.md "False-Positive Taxonomy" — read before flagging anything that grepps as low-consumer (e.g., `.remote.ts` framework dispatch).
