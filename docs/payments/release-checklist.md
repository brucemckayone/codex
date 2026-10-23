# Release checklist

Checks to run against **production** when a `dev` → `main` release carries a
payments change that moves data or money. Merging to `main` deploys, so the
"before" checks must be done first. Every query here is read-only.

**Where to run them:** the Neon console → the production project → SQL Editor.
Keep each result (a screenshot or CSV), so a later question about where money
went can be answered from what the data looked like at deploy time.

Remove a section once the release that needs it is live.

---

## Before the deploy: one owner per organisation (migration `0097`, PR #589)

**What changes.** Until this release, an organisation's share of a sale was
paid to the user in `organizations.primary_connect_account_user_id` (the "pin")
when one was set, and otherwise to the earliest-joined active owner. From this
release:

- an organisation has **exactly one** active owner — `0097` makes any extra
  owners admins;
- the organisation's share of a sale goes to whoever owned it **at the time of
  the sale**, read from the new `organization_ownership_periods` table; the pin
  is no longer read (dropping it is `Codex-2hxff.36`).

So for some organisations the payee changes on deploy, and an organisation with
no owner has no payee at all. R1–R4 list exactly which ones.

### R1 — organisations with more than one active owner

`0097` keeps the first user in each list (earliest-joined, then by id) as owner
and makes the rest admins.

```sql
SELECT organization_id, array_agg(user_id ORDER BY created_at, id) AS owners_kept_first
FROM organization_memberships
WHERE role = 'owner' AND status = 'active'
GROUP BY organization_id HAVING count(*) > 1;
```

- **No rows:** nothing to do.
- **Rows:** check the first user is the right owner. If not, deploy, then
  reassign the owner (see [Assigning an owner](#assigning-an-owner)).

### R2 — organisations with no active owner

These get no ownership period, so their share of every sale has no payee. Since
PR #592 it is **held**, not lost: each slice is a pending `no_owner` row with no
payee, logged as an error when recorded, and handed to whoever support makes
the owner (`Codex-2hxff.37`). Until then nobody is paid it.

```sql
SELECT o.id, o.slug, o.primary_connect_account_user_id AS pin
FROM organizations o
WHERE o.deleted_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM organization_memberships m
  WHERE m.organization_id = o.id AND m.role = 'owner' AND m.status = 'active');
```

- **No rows:** nothing to do.
- **Rows:** give each one an owner. A row with a `pin` was being paid to the
  pin until now, so it appears in R3 as well.

### R3 — organisations whose payee changes on deploy

Today's payee is the pin; after the deploy it is the owner `0097` keeps.

```sql
WITH kept AS (
  SELECT DISTINCT ON (organization_id) organization_id, user_id
  FROM organization_memberships
  WHERE role = 'owner' AND status = 'active'
  ORDER BY organization_id, created_at, id
)
SELECT o.id, o.slug, o.deleted_at,
       o.primary_connect_account_user_id AS pin_paid_today,
       k.user_id AS payee_after_deploy
FROM organizations o
LEFT JOIN kept k ON k.organization_id = o.id
WHERE o.primary_connect_account_user_id IS NOT NULL
  AND o.primary_connect_account_user_id IS DISTINCT FROM k.user_id;
```

- **No rows:** no organisation's payee changes.
- **`payee_after_deploy` set:** from the deploy that user is paid instead of
  the pin. If the pin is the right person, make them the owner after the
  deploy.
- **`payee_after_deploy` empty:** the organisation has no owner — same as R2.

### R4 — removed owners demoted to `member`

Informational. Rows for owners who left or were removed (`status` is not
`active`) still say `role = 'owner'`; `0097` changes them to `member` so a
later re-subscription can never make them owner again. No action.

```sql
SELECT organization_id, user_id, status, updated_at
FROM organization_memberships
WHERE role = 'owner' AND status <> 'active';
```

### Assigning an owner

The way to assign an owner arrives with this release: platform support calls

```
POST /api/admin/organizations/:orgId/owner      (admin-api, platform_owner)
{ "userId": "<new owner>", "reason": "<why, for the audit log>" }
```

- The new owner must already be an **active admin or creator** of the
  organisation. An organisation with nobody in those roles cannot be given an
  owner this way; add the person as an admin first.
- Any previous owner becomes an admin; an open ownership offer is withdrawn;
  the team is emailed.
- The new owner is paid for sales **from that moment on**, and also receives
  everything held for the organisation while it had no owner: the pending
  `no_owner` rows move to them in the same transaction, and the response's
  `heldPayoutsReleased` says how many and how much. A held slice whose sale
  was refunded stays cancelled and is not handed over.

As of 2026-10-13 production takes no real payments (it runs on the Stripe
sandbox; see [status.md](status.md#decisions)). With held slices, assigning
owners after the deploy loses nothing either way; it only delays the payee.

---

## Before the deploy: one ledger row per slice (migration `0099`, PR #592)

**What changes.** `0099` makes every payout slice unique per charge
(`uq_payouts_org_slice_per_charge`, `uq_payouts_creator_slice_per_charge`) and
lets the drains retry `failed` rows (`Codex-2hxff.11`). Two things in today's
data can get in the way.

### R5 — duplicate slices

A duplicate slice already in the table (the bug `0099` fixes) makes its unique
index fail. `db:migrate` runs this same query itself before applying **any**
pending migration and stops with the database untouched if it returns a row
(`packages/database/scripts/migration-preflight.ts`), so the deploy cannot fail
halfway. Run it first anyway, so each duplicate is decided before deploy day.

```sql
-- Org slices: one per charge whoever the payee is
SELECT stripe_charge_id, payout_type, count(*) AS n,
       array_agg(user_id ORDER BY created_at) AS payees,
       array_agg(status ORDER BY created_at) AS statuses,
       array_agg(id ORDER BY created_at) AS ids
FROM payouts
WHERE stripe_charge_id IS NOT NULL
  AND payout_type IN ('organization_fee', 'creator_payout_to_owner')
GROUP BY stripe_charge_id, payout_type
HAVING count(*) > 1
UNION ALL
-- Creator slices: one per charge per creator
SELECT stripe_charge_id, payout_type, count(*),
       array_agg(user_id ORDER BY created_at),
       array_agg(status ORDER BY created_at),
       array_agg(id ORDER BY created_at)
FROM payouts
WHERE stripe_charge_id IS NOT NULL AND payout_type = 'creator_payout'
GROUP BY stripe_charge_id, payout_type, user_id
HAVING count(*) > 1;
```

- **No rows:** nothing to do.
- **Rows:** decide each one before deploying. Two `paid` rows mean the slice
  was paid twice: reverse one transfer in Stripe, then keep the row that
  matches the transfer left standing. Never delete a row that carries a
  transfer id; mark the extra row `reversed`.

### R6 — failed rows written before this release

The drains now retry `failed` rows, but only those this ledger attempted. The
old write paths recorded no attempt (`last_retry_at` empty), and the transfer
they called failed may have landed anyway (a timeout, a reset connection) under
metadata no lookup can match. Retrying them could pay twice, so the drains
leave them alone.

```sql
SELECT id, user_id, organization_id, payout_type, amount_cents,
       stripe_charge_id, purchase_id, subscription_id, course_subscription_id,
       created_at
FROM payouts
WHERE status = 'failed' AND last_retry_at IS NULL
ORDER BY created_at;
```

For each row, look in Stripe for a transfer to the payee's account around
`created_at`, matching the amount and the source id in its metadata:

- **Found:** set the row `paid`, with that `stripe_transfer_id` and
  `resolved_at`.
- **Not found:** set `last_retry_at = now() - interval '11 minutes'`, so the
  next drain sends it.
- **Its sale was refunded:** set it `cancelled_by_refund`. Old course
  subscription rows may have no `stripe_charge_id`, so a refund never found
  them; check the source's refund state.

---

## After the deploy: payouts waiting for support (migration `0111`)

`0111` makes a payout Stripe keeps refusing stop retrying and wait for support
(`Codex-2hxff.48`). A permanent refusal flags the row at once; any other
refusal flags it on the fifth. Rows that failed before this release start
with `failure_count = 0`, so they can take up to five more refusals to flag.

### R7 — the support queue

A day after the deploy, and then as part of support's routine, run the queue
query in [When Stripe keeps refusing a payout](connect-and-payouts.md#when-stripe-keeps-refusing-a-payout).
Each row is money still owed. Fix the cause with the payee (most often their
Connect account), then release the row with that section's `UPDATE`. Nothing
here needs doing before the deploy: `0111` only adds columns and changes
`ON DELETE` rules, and every existing row already satisfies them.

---

## After the deploy: the price-change email (migration `0098`, PR #590)

`0098` replaces "your subscription will renew at the new price on the next
billing cycle" in the `subscription-tier-price-change` email with the date the
new price applies (`Codex-2hxff.35`).

```sql
SELECT scope, organization_id,
       strpos(html_body, 'renews at the new price from') > 0 AS fixed_html,
       strpos(text_body, 'renews at the new price from') > 0 AS fixed_text
FROM email_templates
WHERE name = 'subscription-tier-price-change' AND deleted_at IS NULL;
```

Every row should show `true` / `true`. A `false` row is a copy someone reworded
(`0098` leaves those alone on purpose): read it and decide whether its wording
is still right.
