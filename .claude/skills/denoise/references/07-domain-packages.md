# Reference 07 — Domain: packages/

> Loaded by `/denoise --scope=packages` regardless of phase. Pair with the relevant phase reference (01–04).
> Owns the patterns specific to `@codex/*` library packages: BaseService contract, scoping, error hierarchy, service-registry coupling.

---

## §0 — Scope of this reference

The 21 packages under `packages/` split into three tiers (per root `CLAUDE.md`):

- **Foundation**: database, shared-types, service-errors, security, validation, constants
- **Services**: content, organization, identity, access, purchase, notifications, admin, transcoding
- **Utilities**: worker-utils, cloudflare-clients, cache, observability, image-processing, platform-settings, test-utils

Every package has a `CLAUDE.md` documenting its key exports + contract. Audit findings should respect those contracts — flagging an exported symbol as "duplicate" when it's the package's documented public API is wrong (the duplicate is on the consumer side).

---

## §1 — BaseService Contract

Service classes extend `BaseService` from `@codex/service-errors`. One method:

- `handleError(err, ctx?)` — re-throws known `ServiceError` subclasses, wraps unknown errors with context

For not-found checks, throw `new NotFoundError(...)` directly (there is no `assertNotFound` helper on BaseService).

**Audit recipe:**

```bash
grep -rn 'extends BaseService' packages/*/src --include='*.ts'
# For each: confirm it uses handleError() in catches, not catch-and-swallow
grep -rn 'class.*Service' packages/*/src --include='*.ts' | grep -v 'extends BaseService'
# Any service class NOT extending BaseService is a finding
```

**Findings to flag:**

- `packages:service-not-extending-baseservice` — Service class without `extends BaseService`
- `packages:catch-and-swallow` — Service method catches and returns/logs without re-throwing typed error
- `packages:throw-raw-error` — `throw new Error(...)` instead of typed `*Error` subclass

---

## §2 — Scoped Queries (single biggest source of vulnerabilities)

Every service method that queries a tenant-scoped table MUST take `creatorId` (or `orgId`) as a parameter. The service uses one of:

```typescript
import { scopedNotDeleted, withCreatorScope, withOrgScope } from '@codex/database';

// Helper-based
const rows = await db.query.content.findMany({
  where: scopedNotDeleted(content, ctx.creatorId),
});

// Builder-based for joins
const rows = await withCreatorScope({ db, table: content, creatorId: ctx.creatorId })
  .leftJoin(...)
  .where(...);
```

**Audit recipe:**

```bash
# Find every service method
grep -rn 'async \w\+(' packages/*/src/services --include='*.ts' | grep -v '\.test\.ts'
# For each, look at the body: does it accept a scope param? does the query use a scope helper?
```

**Findings to flag:**

- `packages:service-method-missing-scope-param` — Public service method that queries a tenant-scoped table without taking `creatorId`/`orgId` as parameter
- `packages:scope-from-input-passthrough` — Service takes scope from request body and uses it directly without verifying caller has access to that scope
- `packages:soft-delete-bypass` — Query against soft-deletable table without `deleted_at IS NULL` predicate

---

## §3 — Error Hierarchy

`@codex/service-errors` defines the typed error hierarchy. Every service throw MUST be one of:

- `NotFoundError`
- `ForbiddenError`
- `ValidationError` (for input shape mismatches that escape Zod)
- `ConflictError` (e.g., unique constraint violation)
- `BusinessLogicError` (domain invariant violation)
- `InternalServiceError` (only for genuinely unexpected; carries original error as cause)

> **Note**: Rate-limiting is handled by middleware (`rateLimit: 'auth'` in `procedure()` options) which returns 429 directly — there is no `RateLimitError` class.

The `procedure()` factory's `mapErrorToResponse()` translates these to HTTP status codes. Throwing `new Error(...)` produces a 500 with no useful client message. See `packages/service-errors/src/index.ts` for the canonical barrel exports.

**Audit recipe:**

```bash
grep -rn 'throw new Error' packages/*/src --include='*.ts'
# Each match is potentially a finding (flag, then verify it's not a constructor / sanity check)
```

**Findings to flag:**

- `packages:throw-raw-error` — (same fingerprint as §1; combined detection)
- `packages:internal-error-no-cause` — `throw new InternalServiceError(...)` without the original error attached as `cause`
- `packages:caught-error-rethrown-as-internal` — `catch (e) { throw new InternalServiceError(e.message) }` — loses error class info; use `handleError(e)` instead

---

## §4 — Cross-Package Coupling

Allowed dependency arrows (per `pnpm-workspace.yaml` + `tsconfig.json` paths):

```
apps/web      → workers/* (NEVER, only via HTTP)
apps/web      → packages/* (allowed)
workers/*     → packages/* (allowed)
packages/*    → packages/* (allowed; foundation < services < utilities is the convention)
packages/*    → workers/* (FORBIDDEN — packages must not depend on workers)
packages/*    → apps/web (FORBIDDEN — packages must not depend on web)
```

Shared types live in `@codex/shared-types`. If two packages declare the same shape, the duplicate is a finding.

**Audit recipe:**

```bash
# Find packages importing from forbidden directions
for pkg in packages/*/; do
  grep -rn "from '@codex/[^']*'" "$pkg/src" --include='*.ts' | grep -E "from '(\.\./)*apps/|workers/" && echo "Layer leak in $pkg"
done

# Find type duplicates (same interface name in 2+ packages)
grep -rhn '^export interface ' packages/*/src --include='*.ts' | sort | uniq -c | sort -rn | awk '$1 > 1'
```

**Findings to flag:**

- `packages:layer-leak-package-imports-worker` — Package importing from `workers/`
- `packages:layer-leak-package-imports-web` — Package importing from `apps/web/`
- `packages:type-duplicate-across-packages` — Same `interface Foo` defined in 2+ packages without going through `@codex/shared-types`
- `packages:type-from-shared-types-duplicated` — Local declaration of a type already in `@codex/shared-types`

---

## §5 — Service Registry Coupling

`packages/worker-utils/src/procedure/service-registry.ts` holds lazy getters for every service. The service is instantiated on first access via `ctx.services.X`. Any new service MUST be registered there.

**Audit recipe:**

```bash
grep -rn 'class.*Service' packages/*/src --include='*.ts' | grep -v '\.test\.ts'
# For each service class found, verify it appears in service-registry.ts
grep -n 'XxxService' packages/worker-utils/src/procedure/service-registry.ts
```

If a service class is exported but NOT registered, either:
- It's an unused service (cross-skill: route to `/fallow-audit`)
- It's used directly via `new XxxService(env)` somewhere (anti-pattern; should go through `ctx.services`)
- It's intentionally low-level (e.g., a builder helper) — verify

**Findings to flag:**

- `packages:service-not-in-registry` — Exported service class not registered in `service-registry.ts`
- `packages:service-instantiated-directly` — `new XxxService(env)` in route handler instead of `ctx.services.xxx`

---

## §6 — Public API Hygiene

Every package's `index.ts` re-exports its public API. Cross-package imports MUST come through the package's `index.ts`, never deep imports.

**Audit recipe:**

```bash
# Find deep imports
grep -rn "from '@codex/[^/]*/[^']*'" packages/ workers/ apps/web/src --include='*.ts'
# Each match is a potential finding (verify it's not a sub-export the package explicitly supports)
```

**Findings to flag:**

- `packages:deep-import-bypassing-barrel` — `import { x } from '@codex/foo/src/internal'` bypassing `packages/foo/src/index.ts`
- `packages:internal-export-leaking` — Symbol exported from `index.ts` that's marked `@internal` in JSDoc

---

## §7 — Anti-Pattern Table (packages domain)

| # | Fingerprint | Pattern | Why bad | Fix |
|---|---|---|---|---|
| 1 | `packages:service-method-missing-scope-param` | Service method querying tenant table without `creatorId`/`orgId` param | Cross-tenant data exposure | Add scope param + use `scopedNotDeleted()` |
| 2 | `packages:throw-raw-error` | `throw new Error(...)` in service | Loses class info; client gets 500 | Throw typed `*Error` subclass |
| 3 | `packages:catch-and-swallow` | Try/catch in service that swallows the error | Silent failure | Use `handleError()` to re-throw typed errors |
| 4 | `packages:layer-leak-package-imports-worker` | `from '../workers/...'` in a package | Reverses dep arrow | Move shared type to `@codex/shared-types` |
| 5 | `packages:type-duplicate-across-packages` | Same interface declared in 2+ packages | Drift over time | Move to `@codex/shared-types`; import from there |
| 6 | `packages:service-not-in-registry` | Service class not in `service-registry.ts` | Falls back to direct instantiation; loses lifecycle | Register with lazy getter |
| 7 | `packages:deep-import-bypassing-barrel` | Deep import past `index.ts` | Couples to internal layout | Add public re-export to `index.ts`, import from there |
| 8 | `packages:soft-delete-bypass` | Query without `deleted_at IS NULL` on soft-deletable table | Returns deleted rows | Use `scopedNotDeleted()` (handles both) |
| 9 | `packages:service-instantiated-directly` | `new XxxService(env)` outside the registry | Bypasses lazy lifecycle, request scoping | `ctx.services.xxx` from `procedure()` handler |
| 10 | `packages:internal-error-no-cause` | `throw new InternalServiceError(...)` without `cause` | Lost stack trace | `throw new InternalServiceError('message', { cause: e })` |

Add new rows here as cycles surface new patterns.

---

## §8 — Cross-links

- `references/01-security-audit.md` — security phase reference (paired with this for security × packages cell)
- `references/02-type-audit.md` — types phase reference (paired for types × packages cell)
- `references/03-simplification.md` — simplification phase reference
- `references/04-performance.md` — performance phase reference
- `/backend-dev` reference 02 (service-layer) — implementation-time guidance for fixing findings
- `packages/<pkg>/CLAUDE.md` — per-package public API documentation; READ this before flagging an exported symbol as duplicate or unused
- `/fallow-audit` SKILL.md "False-Positive Taxonomy" — read before flagging anything that grepps as low-consumer (service registry dispatch is FP #3)
