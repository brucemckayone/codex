# Release checklist

Checks to run against **production** when a `dev` → `main` release carries a
payments change that moves data or money. Merging to `main` deploys, so the
"before" checks must be done first. Every query here is read-only.

**Where to run them:** the Neon console → the production project → SQL Editor.
Keep each result (a screenshot or CSV), so a later question about where money
went can be answered from what the data looked like at deploy time.

Remove a section once the release that needs it is live.

**Removed sections.** R1–R6 (migrations `0097` and `0099`) and the `0098`
price-change email check were removed once production had applied all three
(confirmed read-only on 2026-10-27, deploy `3f593c4c`). Code comments and
`packages/database/scripts/migration-preflight.ts` still name R2, R5 and R6:
read those sections with `git log -p -- docs/payments/release-checklist.md`.

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

## Payout timing and money owed (migration `0118`)

`0118` adds `connect_balances`, `payee_credits` and `money_notices`, and swaps
two email sentences (`Codex-2hxff.29`, `.30`, `.34`, `.71`, `.73`). From this
release, new Connect accounts are created on manual payouts, and the daily
bank payout job (08:00 London, inside the hourly cron) pays each account's
money once its sale is 14 days old. Accounts made before this release keep
Stripe's own schedule until the backfill (R10) switches them. Design:
[Payout timing](connect-and-payouts.md#payout-timing).

### R8 — before the deploy: the Stripe keys (owner)

Production runs on Stripe TEST keys for now (owner, 2026-10-29). Every key
below is then the test-mode one: `sk_test_`, `rk_test_`.

- **ecom-api's key** (GitHub production secret `STRIPE_SECRET_KEY`) must be a
  standard secret key, `sk_test_` for now and `sk_live_` later, not a
  restricted `rk_` key. A standard key already allows `balance.retrieve` and
  `payouts.create` with `Stripe-Account`. A restricted one would need, on
  connected accounts, Balance read, Payouts write and Transfers read. Without
  them the job reads nothing and pays nobody it switched, and it logs
  `bank_payout.account_failed` for each account.
- **admin-api's key** is optional for the release, but it is the only thing
  that makes support refunds and Creator debts' live balance work. Production
  has NONE today: the deploy uploads one only from the GitHub production
  secret `ADMIN_API_STRIPE_RESTRICTED_KEY` (Codex-2hxff.92).
  - **Create it:** a restricted key in the SAME mode as `STRIPE_SECRET_KEY`
    (`rk_test_` beside `sk_test_`), with Refunds write; Charges,
    PaymentIntents, Invoices and Disputes read; and Balance read on connected
    accounts. Save it as `ADMIN_API_STRIPE_RESTRICTED_KEY`; the next deploy
    uploads it.
  - **Without it:** support refunds fail, and Creator debts shows the 08:00
    snapshot with a warning per load.
  - **Check it:** after the deploy, Creator debts shows a live balance.

### R9 — before the backfill: the Express dashboard settings (owner)

Stripe Dashboard → Connect → Express dashboard settings: turn off
payout-schedule editing, self-serve manual payouts and Instant Payouts. No API
can read these settings, so nothing in the code can check them.

### R10 — after the deploy: the backfill (only with the owner's OK)

A Stripe write against production's accounts. Run it against the test
environment first, on one production-shaped account. Then the dry run, which
writes nothing:

    pnpm --filter @codex/database exec tsx scripts/backfill-payout-schedule.ts --env production --test-keys

The owner reads its list and checksum. Only then:

    … --env production --test-keys --apply --confirm <checksum>

`--test-keys` is there because production runs on Stripe test keys for now.
Without it, `--env production` refuses a test key, so a dev key run against the
production database by mistake still stops. Once production moves to live
keys, drop `--test-keys` and add `--live` to the apply: a write to live Stripe
needs `--live` as well as `--apply`.

It refuses if the set of accounts has changed since the dry run, and a re-run
is a no-op. The Studio switch-over notice shows for 14 days from each
account's switch.

### R11 — the first 08:00 runs

The day after the backfill, read the `bank_payout.run` summary in ecom-api's
logs, and look for any `bank_payout.*` error. Then check that every switched
account was read today:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT count(*) AS switched,
       count(*) FILTER (WHERE checked_at >= now() - interval '24 hours') AS read_today,
       count(*) FILTER (WHERE failing_since IS NOT NULL) AS refusing,
       count(*) FILTER (WHERE negative_since IS NOT NULL) AS below_zero
FROM connect_balances
WHERE manual_payouts_since IS NOT NULL;
ROLLBACK;
```

`read_today` should equal `switched`. A `refusing` account has had a payout
refused; its alert names the account.

### Rollback

`0118` stays if the workers are rolled back. The old ecom-api then sends the
"connect your Stripe account" email on every sale, while `0118`'s copy says
"We won't email you about each sale". Nothing else breaks: the new tables are
read only by the new code.

---

## Plan access by ticks (migration `0120`)

`0120` turns a film's single "this tier and above" (`content.included_in_tier_id`)
into the subscribers-only switch (`is_tier_gated`) plus one tick per tier
(`content_tier_access`), and backfills both once, when it runs
(`Codex-2hxff.91`; [Subscriptions](subscriptions.md)). The deploy applies
migrations first and redeploys content-api later. In between, the OLD
content-api still saves films, and it writes only the old column. A film saved
as "Subscribers" in that window has the switch off and no ticks, and the new
workers read it as **free to anyone signed in**. Production had 1 tier and 0
gated films on 2026-10-29, so expect nothing; the check below proves it.

Both steps use one read-only script. It runs in a `READ ONLY` transaction and
prints counts and content ids only. It loads no env file, so pass the
production connection string in the shell (Neon console → Connection details),
never from a file:

    DB_METHOD=PRODUCTION DATABASE_URL='<production url>' pnpm --filter @codex/database audit:plan-access

### R12 — after the deploy: the plan-access parity check

Run it once, after the production deploy has finished and before anyone saves a
film's access in the new Studio. Expect **check A = 0** and **check B = 0**;
the exit code is 1 only when A is not 0.

- **Check A** (legacy tier set, switch off): the window shape above. The fix is
  `0120`'s own backfill, steps 6 then 5, each scoped to `NOT is_tier_gated` so
  it touches only these rows. The script prints the same statements. Run them
  in the Neon SQL Editor, in one transaction, in this order (the INSERT finds
  its rows by the switch still being off), then run the script again:

  ```sql
  BEGIN;
  INSERT INTO content_tier_access (content_id, tier_id, organization_id)
  SELECT c.id, t.id, c.organization_id
    FROM content c
    JOIN subscription_tiers x ON x.id = c.included_in_tier_id
    JOIN subscription_tiers t ON t.organization_id = c.organization_id
                             AND t.deleted_at IS NULL
                             AND t.sort_order >= x.sort_order
   WHERE c.organization_id IS NOT NULL
     AND NOT c.is_tier_gated
  ON CONFLICT DO NOTHING;
  UPDATE content SET is_tier_gated = true
   WHERE included_in_tier_id IS NOT NULL
     AND NOT is_tier_gated;
  COMMIT;
  ```

  Never run `0120`'s step 6 unscoped once the new Studio is in use: it would
  add every dearer tier to each bundle ("Basic, Premium") a creator has saved.
  Both statements are idempotent.
- **Check B** (ticks differ from the ladder `0120` would give): straight after
  the deploy, a `ticked_not_ladder` row is an old-Studio edit in the window
  that narrowed or cleared the tier. Its ticks still open the old set. Open the
  film in the new Studio and save the tiers the creator wants. Once creators
  use the new Studio, bundles, "keep" deletes and tier reorders make B non-zero
  by design, so B is only meaningful on this first run.

### R13 — before any workers rollback

Keep this step until the cleanup release drops `included_in_tier_id`. The old
workers read only that column, and two shapes read **looser** there than now:

- a film closed with no tier ticked and no previous tier (`included_in_tier_id`
  NULL) and no price: the old decision serves it free;
- a `ladder_not_ticked` row: the old workers read "lowest ticked tier and
  above", which opens tiers the creator did not tick.

Run the script with `--pre-rollback`. It lists those rows (check C) and exits 1
when there are any:

    DB_METHOD=PRODUCTION DATABASE_URL='<production url>' pnpm --filter @codex/database audit:plan-access --pre-rollback

At 0, a workers rollback is exact. Otherwise prefer a forward fix. If the
workers must roll back anyway, the closed rows can be set
`is_team_only = true` for the window, which closes them to buyers too, and
reverted when rolling forward (data design §6.5). The `ladder_not_ticked` rows
have no honest old-code shape: they read wider until the roll forward. `0120`
itself stays: it is additive, and the old code ignores the new column and table.
