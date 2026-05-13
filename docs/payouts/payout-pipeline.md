# Payout Pipeline — End to End

How money flows from a customer's card to creator and org Connect accounts.
This is the authoritative reference for the subscription payout pipeline as
it stands after the **payouts audit epic (Codex-b1hgr, closed 2026-05-13)**.

Companion doc: [fee-configuration.md](./fee-configuration.md) covers the
**rate** decisions (who-gets-what-percent). This doc covers the **mechanics**
(when transfers fire, what happens when they can't, how stuck money is
drained, currency enforcement, idempotency).

---

## TL;DR

1. Customer's card is charged on an invoice (`invoice.payment_succeeded`).
2. Currency is GBP-or-throw (`UnsupportedCurrencyError`). Non-GBP rejected
   **before** any transfer fires.
3. Revenue split is computed via the DB-configurable fee chain
   (`FeeConfigService`) and the min-platform-fee floor.
4. `executeTransfers` does the fan-out:
   - **Org fee** → org's primary-user Connect account
   - **Creator pool** → each creator's Connect account (per-creator min-transfer
     floor; below floor → accumulated as pendingPayout)
5. Any transfer that can't fire (Connect not ready, transfer failed, below
   min-transfer floor) writes a `pending_payouts` row.
6. **Primary drain**: when a Connect account becomes active, the
   `account.updated` webhook fires `resolvePendingPayouts(orgId, accountId)`
   via `waitUntil` — replays accumulated payouts with `idempotencyKey`.
7. **Safety-net drain**: every 15 minutes, the ecom-api `scheduled` cron
   runs `sweepUnresolvedPayouts` — picks up rows whose webhook was dropped.
8. All Stripe transfer calls use deterministic idempotency keys — replay is
   safe.

---

## Stage 1 — Invoice payment lands

Stripe fires `invoice.payment_succeeded` to
`POST /webhooks/stripe/subscription` (ecom-api, port 42072).

`SubscriptionService.handleInvoicePaymentSucceeded(stripeInvoice)`:

1. Resolves the local `subscriptions` row from
   `stripeInvoice.parent.subscription_details.subscription`.
2. Updates period dates (`currentPeriodStart`/`End`), status `ACTIVE`,
   recalculates the split via `computeSubscriptionSplit(orgId, amountCents)`
   (the resolve-split-floor sequence extracted in PR #182).
3. **Currency guard (Codex-yv18n)** — `assertGbpOnly(stripeInvoice.currency,
   { invoiceId, subscriptionId, stripeSubscriptionId })`. Any non-GBP
   currency throws `UnsupportedCurrencyError` (HTTP 400, code
   `UNSUPPORTED_CURRENCY`) **before** any Stripe transfer is attempted.
4. Calls `executeTransfers(subscriptionId, orgId, sourceTransaction,
   orgFeeCents, creatorPayoutCents)`.
5. Builds a renewal email payload (only for `billing_reason ===
   'subscription_cycle'`), invalidates user/org caches, returns.

### Currency enforcement design

The platform is **GBP-only today**. Every `stripe.transfers.create()` call
in `executeTransfers` and `resolvePendingPayouts` hardcodes
`currency: CURRENCY.GBP`. The guard runs at **two enforcement points**:

| Site | Source | Why |
|---|---|---|
| `handleInvoicePaymentSucceeded` | `stripeInvoice.currency` | Reject before transfers fire |
| `resolvePendingPayouts` row loop | `payout.currency` (DB) | Reject historic rows on replay |

Both call into the **single** private helper
`SubscriptionService.assertGbpOnly(currency, context)` — see
[PR #183](../../README.md) for the dedup. Adding a new transfer call site
without an `assertGbpOnly` guard is a regression — the test suite
`subscription-service.test.ts > "Currency GBP-only enforcement"` covers both
existing sites.

---

## Stage 2 — `executeTransfers` (the fan-out)

Private method on `SubscriptionService`. Always GBP. Always idempotent.

### 2a. Org fee transfer

- Resolves the org's **primary user** Connect row via
  `resolvePrimaryConnect(orgId)` — same account checkout validated against.
- If `orgConnect.chargesEnabled && orgFeeCents > 0`:
  `stripe.transfers.create({ amount: orgFeeCents, currency: 'gbp',
  destination: orgConnect.stripeAccountId, source_transaction: chargeId,
  transfer_group: 'sub_${subscriptionId}' }, { idempotencyKey:
  '${chargeId}_org_fee' })`.
- On Stripe error → `pendingPayouts` row with `reason='transfer_failed'`.
- If Connect not ready → falls back to `resolveOrgOwnerId(orgId)` and writes
  `pendingPayouts` with `reason='connect_not_ready'`.

### 2b. Per-creator fan-out

For each creator with an active `creator_organization_agreements` row:

- Resolves per-creator fee config via `getFeesForCreator(orgId, creatorId,
  'subscription')` — walks the override chain.
- Computes the creator's share applying the per-creator share percentage.
- **Min-transfer floor (Codex-m644n)**: if
  `creatorAmount < fees.minTransferCents`, writes
  `pendingPayouts { reason: 'min_transfer_floor' }` instead of firing a
  transfer. The next invoice payment re-evaluates against the (possibly
  larger) accumulated amount.
- Otherwise: `stripe.transfers.create({ amount, currency: 'gbp',
  destination: creatorConnect.stripeAccountId, source_transaction:
  chargeId, transfer_group: 'sub_${subscriptionId}' }, { idempotencyKey:
  '${chargeId}_creator_${creatorId}' })`.

**Why `source_transaction`?** Links the transfer to the originating charge
so Stripe can hold the balance correctly when funds are pending.

**Why `transfer_group`?** Lets you reconcile all transfers from a single
subscription invoice via the Stripe Dashboard / `transfers.list`.

---

## Stage 3 — Pending payouts (the accumulation layer)

Schema: `packages/database/src/schema/subscriptions.ts` — `pendingPayouts`.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid PK | Stable row identifier; reused as idempotency-key seed |
| `userId` | text → users | Recipient (org owner or creator) |
| `organizationId` | uuid → organizations | Org context |
| `subscriptionId` | uuid → subscriptions | Source invoice |
| `amountCents` | int notNull, CHECK > 0 | Pence to transfer |
| `currency` | varchar(3) default `'gbp'` | Defensive — schema default + row-level guard |
| `reason` | varchar(100), CHECK one of 4 | See below |
| `resolvedAt` | timestamptz nullable | NULL = unresolved |
| `stripeTransferId` | varchar nullable | Set on successful resolution |
| `createdAt` | timestamptz | Sweep threshold input |

### `reason` enum (CHECK constraint)

| Reason | Set by | Trigger |
|---|---|---|
| `connect_not_ready` | `executeTransfers` | Destination Connect lacks `chargesEnabled` |
| `connect_restricted` | reserved | (legacy — kept for forward compat) |
| `transfer_failed` | `executeTransfers` catch block | Stripe call threw |
| `min_transfer_floor` | `executeTransfers`, `resolvePendingPayouts` | `amount < feeConfig.minTransferCents` |

### Indexes

- `idx_pending_payouts_user_id` — `resolvePendingPayouts` filter
- `idx_pending_payouts_org_id` — admin/diagnostic queries
- `idx_pending_payouts_unresolved (userId, resolvedAt)` — composite for the
  drain query in `resolvePendingPayouts`

---

## Stage 4 — Primary drain: `account.updated` webhook

When a creator or org owner completes Stripe Connect onboarding, Stripe
fires `account.updated`. The webhook handler does the work that the
**original** transfer attempt couldn't.

`workers/ecom-api/src/handlers/connect-webhook.ts`:

1. Reads the **current DB row** via
   `ConnectAccountService.getAccountByStripeId(account.id)` — this is the
   source of truth for `wasActive`, NOT Stripe's `previous_attributes`.
2. Computes `wasActive = (chargesEnabled ?? false) && (payoutsEnabled ??
   false)` from the **DB row before the update**.
3. Computes `isNowActive = account.charges_enabled &&
   account.payouts_enabled` from the **Stripe payload**.
4. Calls `service.handleAccountUpdated(account)` to persist the new state
   (status string, `chargesEnabled`, `payoutsEnabled`,
   `onboardingCompletedAt`). The conjunction is named `isActive` once and
   reused for both status decision and timestamp.
5. **Transition gate**: if `isNowActive && !wasActive` AND
   `account.metadata.codex_organization_id` is present, fires
   `subscriptionService.resolvePendingPayouts(orgId, account.id)` via
   `executionCtx.waitUntil` with its **own** DB client + cleanup.

### Why `wasActive` from DB, not `previous_attributes` (Codex-qigid)

Per Stripe docs (Context7-verified 2026-05-13): `account.updated` fires on
**any** status or property change, and `previous_attributes` may NOT
contain `charges_enabled`/`payouts_enabled` when the event is triggered by
a tangential field flip (capability ricochet, requirement past_due → ok,
etc.). Reading the **persisted prior state** from the DB gives:

- **Correct transition signal** — fires only when the row actually flipped
  to active.
- **Idempotency for free** — a duplicate `active → active` event finds
  `wasActive=true` and skips the resolution call.
- **Ricochet correctness** — `active → restricted → active` clears
  `wasActive` during the restricted hop and fires resolution again on
  re-activation.

### Resolution loop (`resolvePendingPayouts`)

`SubscriptionService.resolvePendingPayouts(orgId, stripeAccountId)`:

1. Look up the local `stripe_connect_accounts` row by
   `(stripeAccountId, organizationId)` to derive the `userId`.
2. Query all `pendingPayouts` rows where `userId` matches AND
   `organizationId = orgId` AND `resolvedAt IS NULL`.
3. For each row, in sequence (best-effort batch):
   - **Currency guard** — `assertGbpOnly(payoutCurrency, { pendingPayoutId,
     subscriptionId, organizationId })`.
   - **Min-transfer guard** — `getFeesForCreator(orgId, payout.userId,
     'subscription')`; if `amountCents < minTransferCents`, log + skip (row
     stays unresolved, no new row inserted — avoids retry-duplication).
   - `stripe.transfers.create({ amount, currency: payoutCurrency,
     destination: stripeAccountId, metadata: { pending_payout_id,
     subscription_id, type: 'pending_payout_resolution' } },
     { idempotencyKey: 'payout_${payout.id}' })`.
   - On success: `UPDATE pending_payouts SET resolvedAt = now(),
     stripeTransferId = transfer.id`.
   - On failure: log, increment `failed`, **continue to next row**. One
     bad row never poisons the batch.
4. Returns `{ resolved, failed }` aggregate counters for observability.

**Idempotency key shape**: `payout_${pendingPayoutId}` — the
`pendingPayouts.id` is a stable UUID, so any replay (webhook redelivery,
sweep + webhook race, manual re-run) hits Stripe's idempotency cache and
short-circuits to the original Transfer.

---

## Stage 5 — Safety-net drain: 15-minute cron sweep

The webhook is **primary**; the cron is **insurance**. Stripe retries
`account.updated` for 3 days then drops it — the sweep is what catches
rows whose webhook was lost, dropped, or fired on a capability-ricochet
event without the relevant `previous_attributes` fields.

### Trigger

`workers/ecom-api/wrangler.jsonc`:

```jsonc
"triggers": {
  "crons": ["*/15 * * * *"]
}
```

Every 15 minutes in **all** environments (dev, staging, production).

### Entry point

`workers/ecom-api/src/index.ts`:

```ts
export default {
  fetch: app.fetch,
  scheduled: dispatchScheduled,
};
```

`dispatchScheduled` lives in
`workers/ecom-api/src/handlers/payouts-sweep.ts`. Three layers:

1. **`dispatchScheduled(controller, env, ctx)`** — top-level cron entry.
   Wraps `runScheduledPayoutsSweep` in `ctx.waitUntil(...).catch(...)`.
   The inner `.catch` is belt-and-braces — `runScheduledPayoutsSweep`
   already swallows its own errors.
2. **`runScheduledPayoutsSweep(env, deps?)`** — constructs Database,
   Stripe, Observability from env; guards on `DATABASE_URL` +
   `STRIPE_SECRET_KEY` (logs + exits cleanly on missing); delegates to
   `runPayoutsSweep`.
3. **`runPayoutsSweep({ db, stripe, obs, environment, olderThanMinutes
   = 15 })`** — calls `SubscriptionService.sweepUnresolvedPayouts(15)` and
   logs the aggregate counters. Never throws.

### Sweep loop (`sweepUnresolvedPayouts`)

`SubscriptionService.sweepUnresolvedPayouts(olderThanMinutes = 15)`:

1. Compute `threshold = now() - olderThanMinutes * 60 * 1000`.
2. `SELECT DISTINCT (organizationId, userId) FROM pending_payouts WHERE
   resolvedAt IS NULL AND createdAt < threshold` — fresh rows are owned by
   the webhook; we only sweep rows old enough that the webhook would
   already have fired by now if it was going to.
3. For each `(orgId, userId)` group:
   - Look up the `stripe_connect_accounts` row for that pair. If missing
     (rare — Connect account deleted but pendingPayouts survived), log
     `warn` and `groupsSkipped++`.
   - `stripe.accounts.retrieve(stripeAccountId)` — ask Stripe directly,
     don't trust the DB mirror (the **bug this sweep exists to fix** is
     stale DB).
   - If `account.charges_enabled === true && account.payouts_enabled ===
     true`, delegate to `resolvePendingPayouts(orgId, stripeAccountId)`
     and `groupsResolved++`.
   - Otherwise `groupsSkipped++`.
   - Any per-group exception: log error, `errors++`, **continue** —
     isolated failures don't poison the sweep.
4. Returns `{ groupsScanned, groupsResolved, groupsSkipped, errors }`.

### Why grouping is by (orgId, userId)

The unique constraint on `stripe_connect_accounts` is
`(userId, organizationId)` — exactly one Connect account per user per
org. Grouping the unresolved payouts by the same pair gives one
`stripe.accounts.retrieve` call per Connect account regardless of how
many pending rows that account has accumulated.

---

## Replay safety / idempotency

Every Stripe write in the pipeline is idempotent by construction:

| Write | Idempotency key | Why it's safe to replay |
|---|---|---|
| Org fee transfer | `${chargeId}_org_fee` | Charge ID is unique per invoice; one org transfer per charge |
| Creator fee transfer | `${chargeId}_creator_${creatorId}` | Creator ID makes the key unique per creator per charge |
| Pending-payout resolution | `payout_${pendingPayoutId}` | Payout UUID is stable; replay returns the original Transfer |

**Replay scenarios that are safe**:
- Webhook redelivery on transient 500
- Sweep fires before webhook has finished (race)
- Manual operator replay of an old `pendingPayouts` row
- Resolving a row that was already resolved by a concurrent sweep+webhook
  pair — Stripe's idempotency cache returns the same Transfer; the local
  `UPDATE pending_payouts SET resolvedAt = now()` is a no-op on the second
  pass

**Anti-pattern** — don't replace the idempotency key with anything random
(`crypto.randomUUID()`, `Date.now()`) "to ensure freshness". That defeats
the entire replay-safety design.

---

## Currency invariant (Codex-yv18n)

The pipeline is **GBP-only** today. Cross-currency support is a tracked
future feature bead, not on the near roadmap.

### Three pieces of the invariant

1. **Stripe API calls** — every `stripe.transfers.create()` in
   `executeTransfers` and `resolvePendingPayouts` passes `currency:
   CURRENCY.GBP`.
2. **DB default** — `pendingPayouts.currency` defaults to `'gbp'` at the
   schema level.
3. **Runtime guard** — `SubscriptionService.assertGbpOnly(currency,
   context)` enforces the invariant at **both** transfer-fan-out
   entry-points before any Stripe call.

### Rule for new transfer call sites

If you add a new path that calls `stripe.transfers.create()`:

- Hardcode `currency: CURRENCY.GBP`.
- Call `this.assertGbpOnly(sourceCurrency, { ...context })` immediately
  before.
- Add a test under `subscription-service.test.ts > "Currency GBP-only
  enforcement"`.

The comment on `executeTransfers` is the canonical reminder — read it
before extending the method.

---

## Observability surface

All payout-pipeline ops emit structured logs via
`ObservabilityClient.info/warn/error` (PII-redacted). Useful searches:

| Log message | Where | Signal |
|---|---|---|
| `'Invoice payment processed'` | `handleInvoicePaymentSucceeded` | Happy path; per-invoice |
| `'Org transfer failed, accumulating as pending payout'` | `executeTransfers` org branch | Org Connect down or Stripe error |
| `'Failed to record pending payout for org transfer'` | `executeTransfers` catch-inside-catch | DB write failed — money in limbo |
| `'Cannot record pending payout: no Connect account and no org owner found'` | `executeTransfers` fallback | **Page on this** — data integrity issue |
| `'Pending payouts resolved on account activation'` | `connect-webhook.ts` waitUntil | Primary drain succeeded |
| `'Failed to resolve pending payouts'` | `connect-webhook.ts` waitUntil catch | Webhook-triggered drain failed |
| `'Resolving pending payouts'` | `resolvePendingPayouts` start | Drain started, includes count |
| `'Failed to resolve pending payout'` | `resolvePendingPayouts` per-row catch | One row failed; batch continues |
| `'Pending payout resolution complete'` | `resolvePendingPayouts` end | Aggregate `{ resolved, failed }` |
| `'sweepUnresolvedPayouts: no pending groups'` | `sweepUnresolvedPayouts` early return | Cron fired, nothing to do |
| `'sweepUnresolvedPayouts: connect row missing for pending group'` | sweep per-group warn | Orphan rows — investigate |
| `'sweepUnresolvedPayouts: per-group failure'` | sweep per-group error | One group failed; sweep continues |
| `'sweepUnresolvedPayouts: complete'` | sweep end | Aggregate `{ groupsScanned, groupsResolved, groupsSkipped, errors }` |
| `'payouts-sweep cron completed'` | `runPayoutsSweep` | Cron-level summary |
| `'payouts-sweep cron failed at top level'` | `runPayoutsSweep` catch | Sweep threw before reaching service |

---

## Emergency SQL inspection

```sql
-- Unresolved payouts (full snapshot)
SELECT pp.id, pp.user_id, pp.organization_id, pp.subscription_id,
       pp.amount_cents, pp.currency, pp.reason, pp.created_at,
       o.slug AS org_slug
FROM pending_payouts pp
JOIN organizations o ON o.id = pp.organization_id
WHERE pp.resolved_at IS NULL
ORDER BY pp.created_at ASC;

-- Per-org pending totals
SELECT pp.organization_id, o.slug,
       COUNT(*) AS rows, SUM(pp.amount_cents) AS total_pence
FROM pending_payouts pp
JOIN organizations o ON o.id = pp.organization_id
WHERE pp.resolved_at IS NULL
GROUP BY pp.organization_id, o.slug
ORDER BY total_pence DESC;

-- Rows by reason (where money is stuck)
SELECT reason, COUNT(*), SUM(amount_cents) AS pence
FROM pending_payouts
WHERE resolved_at IS NULL
GROUP BY reason
ORDER BY pence DESC;

-- Rows old enough to be in the sweep window
SELECT id, user_id, organization_id, amount_cents, reason, created_at
FROM pending_payouts
WHERE resolved_at IS NULL
  AND created_at < now() - INTERVAL '15 minutes'
ORDER BY created_at ASC;

-- Connect account state for a given org
SELECT sca.user_id, sca.stripe_account_id, sca.status,
       sca.charges_enabled, sca.payouts_enabled, sca.updated_at
FROM stripe_connect_accounts sca
WHERE sca.organization_id = '<orgId>';
```

If a creator is stuck, the most common fix path is:

1. Confirm their Connect account is `charges_enabled=true` AND
   `payouts_enabled=true` in Stripe Dashboard.
2. Wait up to 15 minutes for the cron sweep, OR re-trigger the
   `account.updated` webhook from the Stripe CLI.
3. Verify resolution via `SELECT resolved_at, stripe_transfer_id FROM
   pending_payouts WHERE user_id = '<id>'`.

---

## Reference files

### Code
- `packages/subscription/src/services/subscription-service.ts`
  - `handleInvoicePaymentSucceeded` — currency guard + split + transfers
  - `computeSubscriptionSplit` — resolve-split-floor sequence (PR #182)
  - `executeTransfers` — fan-out + per-creator min-transfer floor
  - `resolvePendingPayouts` — primary drain with idempotency + currency + min-transfer
  - `sweepUnresolvedPayouts` — safety-net drain
  - `assertGbpOnly` — single source of truth for the currency guard (PR #183)
- `packages/subscription/src/services/connect-account-service.ts`
  - `handleAccountUpdated` — status derivation + `isActive` conjunction (PR #183)
  - `getAccountByStripeId` — webhook prior-state lookup
- `workers/ecom-api/src/handlers/connect-webhook.ts` —
  `account.updated` → `resolvePendingPayouts` transition gate
- `workers/ecom-api/src/handlers/payouts-sweep.ts` —
  cron entry point (`dispatchScheduled`, `runScheduledPayoutsSweep`,
  `runPayoutsSweep`)
- `workers/ecom-api/src/index.ts` — `scheduled: dispatchScheduled` export
- `workers/ecom-api/wrangler.jsonc` — `triggers.crons: ["*/15 * * * *"]`

### Schema
- `packages/database/src/schema/subscriptions.ts` — `pendingPayouts`,
  `stripeConnectAccounts` definitions + indexes + CHECK constraints
- `packages/database/src/migrations/` — schema history (see audit migrations
  for column additions; PR #180 added `pendingPayouts.currency`)

### Errors
- `packages/service-errors/src/base-errors.ts` —
  `UnsupportedCurrencyError` (HTTP 400, code `UNSUPPORTED_CURRENCY`,
  carries `received: string` and `supported: readonly string[]`)

### Tests
- `packages/subscription/src/services/__tests__/subscription-service.test.ts`
  - `"Currency GBP-only enforcement (Codex-yv18n)"` — both call-site guards
  - `"UnsupportedCurrencyError contract"` — error shape contract
- `packages/subscription/src/services/__tests__/connect-account-service.test.ts`
  — `handleAccountUpdated` + `getAccountByStripeId`
- `workers/ecom-api/src/handlers/__tests__/payouts-sweep.test.ts` —
  sweep end-to-end (test fixture orgs + mocked Stripe)

### Related
- [fee-configuration.md](./fee-configuration.md) — the rates side of the
  pipeline (FeeConfigService, 3-tier override chain, min-platform-fee
  floor, min-transfer floor source)
- `docs/caching-strategy.md` — VersionedCache pattern (fee-config cache
  invalidation reuses this; pendingPayouts itself is not cached — direct
  DB reads only)
- `docs/stripe-connect-subscription-reference.md` — broader Stripe Connect
  background (account types, controller properties, onboarding URL flow)

---

## Audit history (Codex-b1hgr, closed 2026-05-13)

PRs that built this pipeline in its current form:

| PR | Bead | Landed | What |
|---|---|---|---|
| #173 | Codex-qigid | 2026-05-12 | `connect-webhook` reads `wasActive` from DB row, not Stripe `previous_attributes` |
| #175 | Codex-90ocz | 2026-05-12 | Stripe idempotency-key in `resolvePendingPayouts` loop |
| #177 | Codex-aq58x | 2026-05-12 | Creator-exit orphan contract test for `resolvePendingPayouts` |
| #178 | Codex-gki66 | 2026-05-12 | Multi-creator split invariants |
| #180 | Codex-yv18n | 2026-05-13 | GBP-only enforcement via `UnsupportedCurrencyError`; `pendingPayouts.currency` column |
| #181 | Codex-vv77x | 2026-05-13 | Scheduled-sweep cron + ecom-api `scheduled` export |
| #182 | Codex-m644n | 2026-05-13 | 3-tier DB-configurable fee model + min-transfer floor |
| #183 | (residual) | 2026-05-13 | Second simplify pass: `assertGbpOnly` + named `isActive` |
