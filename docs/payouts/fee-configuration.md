# Revenue model configuration (Codex-t2t8d)

The four knobs that drive the platform's revenue split — platform percent,
subscription org percent, min-platform-fee floor, and min-transfer floor — are
DB-configurable as of Codex-t2t8d. A single singleton row in
`revenue_model_config` holds the live values; updates take effect within the
cache TTL window (10 min) and require no redeploy.

> No admin UI is shipped in this iteration — updates are SQL-driven. A studio
> surface is tracked as a follow-up.

## Three-actor revenue model

Every transaction splits between three actors:

| Actor | When they earn | Default cut |
|---|---|---|
| **Platform** | Always | `FEES.PLATFORM_PERCENT` (10%) of gross, floored to `MIN_PLATFORM_FEE_CENTS` (£0.30) |
| **Organization** | Only when content is hosted on an org page (skipped for solo-creator pages) | `FEES.SUBSCRIPTION_ORG_PERCENT` (15%) of post-platform-fee for subscriptions, `FEES.ORG_PERCENT` (0%) for one-time purchases |
| **Creator** | Always | The remainder |

For cross-org guest-creator transactions (creator not in org, selling on org's
page), the same three-way split applies: platform first, then org, then
creator.

## Schema

```sql
CREATE TABLE revenue_model_config (
  id                            text PRIMARY KEY DEFAULT 'singleton',
  platform_fee_percent          integer NOT NULL,
  subscription_org_fee_percent  integer NOT NULL,
  min_platform_fee_cents        integer NOT NULL,
  min_transfer_cents            integer NOT NULL,
  updated_at                    timestamptz DEFAULT now(),
  updated_by                    text REFERENCES users(id),
  CONSTRAINT check_revenue_model_singleton CHECK (id = 'singleton'),
  CONSTRAINT check_revenue_model_platform_fee_percent
    CHECK (platform_fee_percent BETWEEN 0 AND 10000),
  CONSTRAINT check_revenue_model_subscription_org_fee_percent
    CHECK (subscription_org_fee_percent BETWEEN 0 AND 10000),
  CONSTRAINT check_revenue_model_min_platform_fee_cents
    CHECK (min_platform_fee_cents >= 0),
  CONSTRAINT check_revenue_model_min_transfer_cents
    CHECK (min_transfer_cents >= 0)
);
```

Percentages are stored as **basis points** (10000 = 100%). Amounts are
**integer cents** (GBP pence).

The `CHECK (id = 'singleton')` constraint is the DB-layer enforcement of the
singleton invariant — even direct SQL inserts cannot create a second row. The
service-layer upserts always target `id = 'singleton'` via `onConflictDoUpdate`.

## Code-default fallback (fresh install)

When `revenue_model_config` has no row (a fresh install, before any operator
has tuned the model), `FeeConfigService.getFees()` returns the constants in
`@codex/constants`:

```ts
export const FEES = {
  PLATFORM_PERCENT: 1000,           // 10.00%
  SUBSCRIPTION_ORG_PERCENT: 1500,   // 15.00%
  MIN_PLATFORM_FEE_CENTS: 30,       // £0.30
  MIN_TRANSFER_CENTS: 100,          // £1.00
};
```

The fallback logs INFO once per process lifetime (`fallbackLogged` guard
prevents log spam). First-install ops can see the fallback path in the
observability stream and know to seed the row.

## Cache

`FeeConfigService.getFees()` is wrapped in `VersionedCache` with a 10-minute
TTL keyed at `CacheType.PLATFORM_FEE_CONFIG` (`platform:fee-config`). On every
successful `updateFees()`, the cache is invalidated fire-and-forget so the
next read pulls from the DB.

In dev / test environments without `CACHE_KV`, the service degrades
gracefully — every call hits the DB, no caching, no error.

## Updating via SQL

```sql
-- First write (no row exists yet)
INSERT INTO revenue_model_config (
  id,
  platform_fee_percent,
  subscription_org_fee_percent,
  min_platform_fee_cents,
  min_transfer_cents,
  updated_by
) VALUES (
  'singleton',
  1200,   -- 12%
  1500,   -- 15%
  30,
  100,
  '<your-user-id>'
)
ON CONFLICT (id) DO UPDATE
  SET platform_fee_percent          = EXCLUDED.platform_fee_percent,
      subscription_org_fee_percent  = EXCLUDED.subscription_org_fee_percent,
      min_platform_fee_cents        = EXCLUDED.min_platform_fee_cents,
      min_transfer_cents            = EXCLUDED.min_transfer_cents,
      updated_by                    = EXCLUDED.updated_by,
      updated_at                    = now();

-- Subsequent update (existing row)
UPDATE revenue_model_config
   SET platform_fee_percent = 1200,
       updated_by           = '<your-user-id>',
       updated_at           = now()
 WHERE id = 'singleton';
```

After the SQL write, the next `getFees()` call within the 10-minute TTL window
will still return the cached value. To force an immediate refresh, also
invalidate the KV key:

```sql
-- KV invalidation cannot be done from SQL; either wait 10min, or call
-- FeeConfigService.updateFees(...) from a worker script so the cache
-- invalidate fires through the proper channel.
```

The cleanest path is to call `FeeConfigService.updateFees()` from a
one-shot script that exercises the worker runtime — this performs both
the DB write AND the cache invalidate in one atomic operation.

## Floor logic

Two independent floors guard against micro-fee economics:

### `minPlatformFeeCents` — applied per-transaction

For very small transactions (e.g. £0.10 paid content), the percentage-based
platform fee can fall below the floor. The floor is applied in the **caller**,
not inside `calculateRevenueSplit` — that calculator stays pure and total-
preserving.

```ts
// in PurchaseService.completePurchase()
const fees = await this.feeConfigService.getFees();
const percentageFeeCents = Math.ceil(
  (amountPaidCents * fees.platformFeePercent) / 10000
);
const useFloor = percentageFeeCents < fees.minPlatformFeeCents;
const effectivePlatformFeePercent = useFloor
  ? Math.min(Math.ceil((fees.minPlatformFeeCents / amountPaidCents) * 10000), 10000)
  : fees.platformFeePercent;

const split = calculateRevenueSplit(
  amountPaidCents,
  effectivePlatformFeePercent,
  DEFAULT_ORG_FEE_PERCENTAGE,
);
```

For the canonical helper, see `applyPlatformFeeFloor()` in
`@codex/purchase`.

### `minTransferCents` — applied at transfer execution

For transfers below the floor, Stripe's `transfers.create` is **skipped**.
Instead, a `pending_payouts` row is inserted with `reason = 'min_transfer_floor'`.
The amount accumulates and is paid out by a future resolution sweep once the
total exceeds the floor (or once the operator lowers the floor).

Sites that apply the min-transfer floor:

| Site | Behaviour when below floor |
|---|---|
| `SubscriptionService.executeTransfers` — org leg | Insert `pending_payouts` row, skip stripe.transfers.create |
| `SubscriptionService.executeTransfers` — creator-pool-to-owner leg | Same |
| `SubscriptionService.executeTransfers` — per-creator agreement leg | Same |
| `SubscriptionService.resolvePendingPayouts` — sweep loop | `continue` past the payout (leave pending) |

## Wiring

The service is registered in `packages/worker-utils/src/procedure/service-registry.ts`
as `ctx.services.feeConfig`. PurchaseService and SubscriptionService both
receive an instance via their constructor config and consult
`getFees()` once per request.

When a worker test or legacy harness does **not** wire the service, both
PurchaseService and SubscriptionService fall back to `DEFAULT_FEE_CONFIG`
(= `FEES.*` constants) so existing tests continue to pass unchanged.

## Tests

- `packages/purchase/src/services/__tests__/fee-config-service.test.ts` —
  full unit coverage (DB row present / fallback / cache hit / cache invalidate
  on update / partial-update merge / validation / floor scenarios).
- `packages/subscription/src/services/__tests__/subscription-service.test.ts` —
  `describe('FeeConfigService integration')` block verifying construction-
  time wiring (back-compat fallback, getFees delegation).

## Related

- Bead: `Codex-t2t8d` (child of epic `Codex-b1hgr`, replaces closed `Codex-a6hop`)
- Caching strategy: [`docs/caching-strategy.md`](../caching-strategy.md)
- Revenue calculator: `packages/purchase/src/services/revenue-calculator.ts`
