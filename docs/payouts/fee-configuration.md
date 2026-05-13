# Fee Configuration (Codex-m644n)

3-tier DB-configurable fee model with version-cache invalidation and audit logging.

Design was locked by user 2026-05-13 in closed bead Codex-8qmop. Implementation
landed via Codex-m644n. This document is the authoritative reference for
operators editing fees and for engineers wiring new payout paths.

---

## TL;DR

- Read the chain: **creator-override → org-default → platform-default → code constants (`FEES.*`)**.
- Every write bumps the row's `version` column AND `cache.invalidate(...)` —
  cache reads return stale values for at most one request after a write.
- **No TTL** — KV entries live until the next write invalidates them.
- Every column change writes one row to `fee_config_audit_log`.
- All mutation endpoints (`/api/admin/fees/*`) are gated by `platform_owner`.
  There are **no public web routes**.

---

## Schema (4 tables, namespace `fee_config_*`)

| Table | Cardinality | Purpose |
|---|---|---|
| `fee_config_platform` | 1 row (id='singleton') | Platform-wide defaults |
| `fee_config_org` | 0-N (PK: orgId) | Per-org overrides; nullable cols inherit |
| `fee_config_org_creator` | 0-N (PK: orgId+creatorId) | Per-creator-per-org overrides |
| `fee_config_audit_log` | append-only | Change history (who/when/before/after) |

### Naming-collision note

The legacy `platform_fee_config` / `organization_platform_agreements` tables
predate this design and use a time-windowed UUID model. They are dormant (not
read by production code) but retained to avoid breaking the migration chain.
The new tables use the `fee_config_*` namespace to coexist without collision.
`creator_organization_agreements` is still active — it encodes creator
**revenue-share splits** within an org (different domain from fee rates), and
is consumed by `SubscriptionService.executeTransfers` per-creator fan-out.

### Column shape

All percentages are basis points (10000 = 100%). All cents are integers.

```
fee_config_platform
├── id: 'singleton' (CHECK enforced)
├── platformFeePercent       int   notNull  -- platform's cut of gross
├── subscriptionOrgFeePercent int  notNull  -- org's cut of post-platform on subs
├── oneOffOrgFeePercent      int   notNull  -- org's cut of post-platform on one-offs
├── minPlatformFeeCents      int   notNull  -- platform floor
├── minTransferCents         int   notNull  -- accumulate below this
├── version                  int   notNull default 1
├── updatedAt                timestamptz
└── updatedBy                text  → users.id (set null on delete)

fee_config_org
├── organizationId           uuid  PK → organizations.id (cascade)
├── platformFeePercent       int?  null = inherit
├── orgFeePercent            int?  applies to active path
├── minPlatformFeeCents      int?
├── minTransferCents         int?
├── version, updatedAt, updatedBy

fee_config_org_creator
├── (organizationId, creatorId) composite PK
├── platformFeePercent, orgFeePercent, minPlatformFeeCents, minTransferCents (all nullable)
├── notes: text?  -- negotiation context (e.g. "white-label deal Q2 2026")
├── version, updatedAt, updatedBy

fee_config_audit_log
├── id: uuid PK default gen_random_uuid()
├── scope: 'platform' | 'org' | 'override'
├── scopeOrgId: uuid?  -- present when scope='org' or 'override'
├── scopeCreatorId: text?  -- present when scope='override'
├── columnName: text
├── oldValue: text?
├── newValue: text
├── changedBy: text → users.id (restrict)
└── changedAt: timestamptz default now()
```

CHECK constraints enforce: bps in `[0, 10000]`, cents `>= 0`, singleton id,
and scope/scopeId coherence on the audit log.

---

## Read fallback (FeeConfigService)

```ts
import { FeeConfigService } from '@codex/purchase';

// Subscription invoice flow
const fees = await feeConfig.getFeesForOrg(orgId, 'subscription');

// Per-creator payout (executeTransfers fan-out)
const fees = await feeConfig.getFeesForCreator(orgId, creatorId, 'subscription');

// One-off purchase
const fees = await feeConfig.getFeesForCreator(orgId, creatorId, 'one_off');
```

Resolution walks:
1. `fee_config_org_creator(orgId, creatorId)` — non-null columns override
2. `fee_config_org(orgId)` — non-null columns override
3. `fee_config_platform` singleton — path-specific defaults
4. `FEES.PLATFORM_PERCENT`, `FEES.SUBSCRIPTION_ORG_PERCENT`, `FEES.ORG_PERCENT`
   (code constants, used when no row exists at any tier — fresh install)

The returned `FeeConfig` is a flat shape:

```ts
interface FeeConfig {
  platformFeePercent: number;        // bps
  orgFeePercent: number;             // bps, already path-resolved
  minPlatformFeeCents: number;       // platform floor
  minTransferCents: number;          // skip transfers below this
}
```

`calculateRevenueSplit(...)` stays **pure** — it accepts the resolved
percentages as parameters. Floor logic is applied in the **caller** so the DB
CHECK constraint `amount = platform + org + creator` is preserved by
construction.

### Min-platform-fee floor (applied in caller)

When `(amountCents * platformFeePercent) / 10000 < minPlatformFeeCents`, we
override the platform fee to the floor and subtract the shortfall from the
creator pool first, then the org fee. Both floor at 0 so the row never goes
negative. If the floor exceeds the entire transaction (degenerate case),
platform takes everything — safer than rejecting the row at DB-level.

### Min-transfer floor (applied in payout)

`SubscriptionService.executeTransfers` consults
`getFeesForCreator(orgId, creatorId, 'subscription').minTransferCents` per
creator. When `creatorAmount < floor`, the per-creator share is recorded as a
`pendingPayouts` row with `reason='min_transfer_floor'` instead of firing a
Stripe transfer. The next invoice payment re-evaluates.

`SubscriptionService.resolvePendingPayouts` performs the same gate **before**
calling `stripe.transfers.create({ idempotencyKey: payout_${payout.id} })` —
leaves the unresolved row in place so a later resolution attempt picks it up
(no duplicate row inserted on retry).

---

## Cache (VersionedCache, NO TTL)

Cache key shape:

```
cache:version:platform                     -- version key for singleton
cache:version:org:${orgId}                 -- version key for org row
cache:version:override:${orgId}:${creatorId}
cache:fee:platform:platform:v${ts}         -- payload
cache:fee:org:org:${orgId}:v${ts}
cache:fee:override:override:${orgId}:${creatorId}:v${ts}
```

`CacheType.FEE_CONFIG_PLATFORM`, `..._ORG`, `..._OVERRIDE` constants are in
`packages/cache/src/cache-keys.ts`.

Writer pattern (already implemented in `FeeConfigService`):

1. `UPDATE` the row with `version = version + 1` (DB).
2. Insert one audit row per changed column.
3. `cache.invalidate(id)` — bumps the version key in KV. Fire-and-forget via
   `executionCtx.waitUntil` when injected.

Reader pattern (cache-aside):

1. `cache.get(id, CacheType.FEE_CONFIG_*, () => fetchRowFromDb(), {})` —
   `VersionedCache.get` resolves the current version key, reads the
   versioned payload key, and falls back to the fetcher on miss or KV error.

**Why no TTL?** Fee config changes are operator-initiated and rare. The
cost of a stale read is incorrect revenue split for one request after an
update — and the version bump on write eliminates that window. TTLs would
add unnecessary thrash for data that is effectively immutable between writes.

---

## Internal admin API (`/api/admin/fees/*`)

All routes use `procedure({ policy: { auth: 'platform_owner' } })`. There are
no public OpenAPI entries and no SvelteKit pages calling these endpoints.

| Method | Path | Body / params | Purpose |
|---|---|---|---|
| GET    | `/api/admin/fees/platform` | — | Read platform singleton |
| PATCH  | `/api/admin/fees/platform` | `updatePlatformFeesSchema` | Update singleton |
| GET    | `/api/admin/fees/org/:orgId` | params | Read org override (or null) |
| PATCH  | `/api/admin/fees/org/:orgId` | `updateOrgFeesSchema` | Upsert org override |
| DELETE | `/api/admin/fees/org/:orgId` | params | Remove org override |
| GET    | `/api/admin/fees/org/:orgId/creators` | params | List all overrides for org |
| GET    | `/api/admin/fees/org/:orgId/creator/:creatorId` | params | Read override |
| PUT    | `/api/admin/fees/org/:orgId/creator/:creatorId` | `upsertCreatorOverrideSchema` | Upsert override |
| DELETE | `/api/admin/fees/org/:orgId/creator/:creatorId` | params | Remove override |
| GET    | `/api/admin/fees/audit-log` | `feeAuditLogQuerySchema` | Paginated audit log |

All write endpoints:
- Increment `version` on the touched row.
- Insert one row to `fee_config_audit_log` per changed column.
- Fire-and-forget `cache.invalidate(...)` for the touched entity.

Validation lives in
`packages/validation/src/schemas/fee-config.ts`.

### Future consumer

There is **no public web UI** today. The planned consumer is a local desktop
admin app filed as **epic Codex-xyb7v** (separate from this implementation).
Until that lands, mutations can be performed via:

- Direct DB edits (recommended for one-off seeding only; bypasses audit log).
- Ad-hoc admin tooling running on a trusted local machine that signs in as a
  `platform_owner` and POSTs to `/api/admin/fees/*`.

Direct DB edits should be rare and accompanied by a manual audit log insert
to preserve the trail.

---

## Emergency SQL inspection

```sql
-- Current platform defaults
SELECT * FROM fee_config_platform;

-- All org overrides
SELECT * FROM fee_config_org ORDER BY updated_at DESC;

-- All creator overrides for a single org
SELECT * FROM fee_config_org_creator
WHERE organization_id = '<orgId>'
ORDER BY updated_at DESC;

-- Last 50 changes (any scope)
SELECT scope, scope_org_id, scope_creator_id, column_name,
       old_value, new_value, changed_by, changed_at
FROM fee_config_audit_log
ORDER BY changed_at DESC
LIMIT 50;
```

If you mutate via raw SQL, also invalidate the cache or wait for the version
bump from the next admin-api write to clear stale KV entries.

---

## Reference files

- `packages/database/src/schema/fee-config.ts` — table definitions
- `packages/database/src/migrations/0062_*.sql` — initial migration
- `packages/purchase/src/services/fee-config-service.ts` — service implementation
- `packages/validation/src/schemas/fee-config.ts` — Zod schemas
- `packages/cache/src/cache-keys.ts` — `FEE_CONFIG_*` cache type constants
- `workers/admin-api/src/index.ts` — `/api/admin/fees/*` routes
- `packages/subscription/src/services/subscription-service.ts` —
  `resolveSubscriptionFees`, `applyMinPlatformFeeFloor`, executeTransfers +
  resolvePendingPayouts min-transfer guards
- `packages/purchase/src/services/purchase-service.ts` —
  one-off path fee resolution + min-platform-fee floor

Related: `docs/caching-strategy.md` (VersionedCache pattern reference).
