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

**Standing check: a release that changes the Stripe `apiVersion`.** It isn't
removed after one release. Before merging a change to the pin in
`packages/purchase/src/stripe-client.ts`, run the switch-credit proof in Stripe
TEST mode:

    pnpm exec tsx --env-file=.env.dev packages/subscription/scripts/test-clock-paid-price.ts

It must pass and leave 0 test clocks. It proves that a switch after an early
price move credits what the member paid. Stripe credits the invoiced line
(`credited_items`), not the item's current Price (`Codex-2hxff.95`). If a new
version breaks that, the plan-change dialog would charge differently from what
the member paid for. The script makes TEST-mode objects only, tagged
`codex_env: 'test-clock'`, which production's webhook ignores. `.env.dev`'s
test key is production's Stripe account, so its webhooks do see the events.

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
    (`rk_test_` beside `sk_test_`; the upload refuses any other prefix). Set
    these Dashboard rows, on the platform account unless noted, and leave every
    other row at None:
    - **Charges and Refunds: Write.** Stripe has no refunds-only permission;
      this one row covers `refunds.create` and the charge and refund reads.
    - **Payment Intents: Read.**
    - **Payment Disputes: Read.**
    - **Invoices: Read.**
    - **Transfers: Read.** `transfers.list`, `retrieve` and `listReversals`,
      for settling a failed refund and "Check Stripe again".
    - **Balance: Read, on connected accounts**, for Creator debts' live
      balance. Also on the platform account: the charge detail expands
      `balance_transaction` for Stripe's fee, and Stripe's permission reference
      names no row for balance transactions, so Balance is assumed to cover it.

    This list is built from the Stripe calls in the header of
    `packages/admin/src/services/support-service.ts`; the other places that
    mention this key point here. Save it as `ADMIN_API_STRIPE_RESTRICTED_KEY`;
    the next deploy uploads it.
  - **Without it:** support refunds fail, and Creator debts shows the 08:00
    snapshot with a warning per load.
  - **Check it:** after the deploy, Creator debts shows a live balance, and a
    payment's refund detail shows Stripe's fee.

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
workers read it as **free to anyone signed in**. The parity check for that
window (formerly R12) ran on 2026-10-31 after the deploy: check A = 0, check
B = 0/0, check C = 0. It is done.

R13 uses a read-only script, `audit:plan-access`. It runs in a `READ ONLY`
transaction and prints counts and content ids only. It loads no env file, so
pass the production connection string in the shell (Neon console → Connection
details), never from a file. Never run `0120`'s step 6 unscoped now that the
new Studio is in use: it would add every dearer tier to each bundle ("Basic,
Premium") a creator has saved.

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

---

## Dated fees and fee notices (migration `0123`)

`0123` adds `fee_changes`, `fee_config_versions` and `fee_change_notices`,
two columns on `fee_config_audit_log`, and the `fee-change-notice` and
`fee-change-cancelled` email templates (`Codex-2hxff.33`;
[Fees and splits](fees-and-splits.md#fee-configuration)). It backfills one
`cut` change and one version per existing `fee_config_*` row, dated
1970-01-01, so every sale, old or new, resolves exactly the fees it did
before. It is additive and runs before the workers deploy; old workers never
read the new tables.

### R14 — after the deploy: the old fee rows match the versions

**Change no fee between the merge and the deploy summary.** Until admin-api
deploys, the old admin-api writes only the old `fee_config_*` rows, which
the new resolver never reads.

Each level's old row should hold the values of its version in force. Expect
the first query to list nothing, and both template rows to exist:

```sql
BEGIN TRANSACTION READ ONLY;
WITH in_force AS (
  -- Each level's version in force now: the newest dated, not voided one.
  SELECT DISTINCT ON (c.scope, c.organization_id, c.creator_id)
         c.scope, c.organization_id, c.creator_id, v.removed,
         v.platform_fee_percent, v.subscription_org_fee_percent,
         v.one_off_org_fee_percent, v.org_fee_percent,
         v.min_platform_fee_cents, v.min_transfer_cents, v.notes
    FROM fee_changes c
    JOIN fee_config_versions v
      ON v.change_id = c.id AND v.superseded_at IS NULL
   WHERE c.voided_at IS NULL AND c.effective_from <= now()
   ORDER BY c.scope, c.organization_id, c.creator_id,
            c.effective_from DESC, c.created_at DESC
), live AS (
  -- A removed version means the level has no old row.
  SELECT * FROM in_force WHERE NOT removed
)
SELECT 'platform' AS level, NULL::uuid AS organization_id,
       NULL::text AS creator_id
  FROM (SELECT * FROM live WHERE scope = 'platform') f
  FULL JOIN fee_config_platform p ON true
 WHERE (p.id IS NOT NULL, p.platform_fee_percent,
        p.subscription_org_fee_percent, p.one_off_org_fee_percent,
        p.min_platform_fee_cents, p.min_transfer_cents)
       IS DISTINCT FROM
       (f.scope IS NOT NULL, f.platform_fee_percent,
        f.subscription_org_fee_percent, f.one_off_org_fee_percent,
        f.min_platform_fee_cents, f.min_transfer_cents)
UNION ALL
SELECT 'org', coalesce(o.organization_id, f.organization_id), NULL
  FROM (SELECT * FROM live WHERE scope = 'org') f
  FULL JOIN fee_config_org o ON o.organization_id = f.organization_id
 WHERE (o.organization_id IS NOT NULL, o.platform_fee_percent,
        o.org_fee_percent, o.min_platform_fee_cents, o.min_transfer_cents)
       IS DISTINCT FROM
       (f.organization_id IS NOT NULL, f.platform_fee_percent,
        f.org_fee_percent, f.min_platform_fee_cents, f.min_transfer_cents)
UNION ALL
SELECT 'creator', coalesce(x.organization_id, f.organization_id),
       coalesce(x.creator_id, f.creator_id)
  FROM (SELECT * FROM live WHERE scope = 'creator') f
  FULL JOIN fee_config_org_creator x
    ON x.organization_id = f.organization_id AND x.creator_id = f.creator_id
 WHERE (x.creator_id IS NOT NULL, x.platform_fee_percent, x.org_fee_percent,
        x.min_platform_fee_cents, x.min_transfer_cents, x.notes)
       IS DISTINCT FROM
       (f.creator_id IS NOT NULL, f.platform_fee_percent, f.org_fee_percent,
        f.min_platform_fee_cents, f.min_transfer_cents, f.notes);
SELECT name, status FROM email_templates
 WHERE name IN ('fee-change-notice', 'fee-change-cancelled')
   AND scope = 'global' AND deleted_at IS NULL;
ROLLBACK;
```

It compares values, not counts, so a fee edited through the old admin-api in
the deploy window shows here even though every level still has one row and
one change. Each level it lists is one where the two disagree. Don't fix it
with SQL ([why](operations.md#changing-fees)). Through the new admin route,
save the level's values as its old row has them, or remove the level if its
old row is gone: either writes the change, the version, the audit rows and
the old row together. Then run it again.

The query holds at any time, not only after the deploy. Its one expected
exception: a level whose dated rise started since midnight, listed until the
08:00 fee step writes the rise into its old row (R15).

### R15 — the first 08:00 run

The morning after the deploy, read notifications-api's `fee step completed`
log line. With no rise saved it reads all zeros. Its `mirrored` count is the
levels whose old fee row took a dated rise that started since the last run.
Look for any `fee step: template missing` line (the templates didn't arrive:
R14's second query): a warning while nothing waits on it, an alert naming
the changes once a rise does. Look too for a `fee step part failed` error.

The fee cache's key types changed (`fee:*` to `fee-versions:*`, because the
payload changed). Nothing to purge: the old slots had the default 10-minute
TTL and expire by themselves, and the version keys are per level, shared by
both.

### Rollback

`0123` stays. See [Changing fees › Rollback](operations.md#changing-fees).
The old workers read the old `fee_config_*` rows. Every admin save keeps them
at the values in force then, and the 08:00 fee step writes a dated rise into
them on the morning it starts, so sales keep the right fee. Before rolling
back, run R14's first query: it should list nothing. A level whose rise
started since midnight is listed until the 08:00 run, so roll back after it.
While rolled back the fee step stops: a waiting rise doesn't start, and one
whose date falls in the rollback starts only at the roll forward. Don't change
fees while rolled back.

---

## Waiting moves, course amounts and price moves (migrations `0122`, `0124` and `0125`)

`0122` adds the waiting-move columns on `subscriptions` (`Codex-2hxff.16`) and
`course_subscriptions.amount_cents` (`Codex-2hxff.52`). `0124` adds
`price_changes` and `subscription_price_moves` (`Codex-2hxff.85`, `.86`;
[Subscriptions › Price changes](subscriptions.md#price-changes)). `0125` adds
`pending_billing_interval`, `pending_amount_cents` and `stripe_schedule_id` on
`subscriptions`: a change from yearly to monthly billing waits for the year's
end, on a Stripe subscription schedule (`Codex-2hxff.97`). All three are
additive and run before the workers deploy; old workers never read the new
columns or tables. None backfills anything: no move or change of billing can
wait before `.16` and `.97` ship, and a price change saved before the deploy
either finished its fan-out or raised an alert.

`0125`'s CHECK is the only one in this batch that ties a new column to an old
one: a waiting interval must differ from `billing_interval`. New code clears
the waiting change in the same write that lands it. Old code doesn't know it
exists, which matters only on a rollback (below).

### R16 — after the deploy: the course amount backfill (only with the owner's OK)

A course subscription made before the deploy has no `amount_cents` until one
of its webhooks arrives, so Account › Subscriptions shows it without a price.
The backfill reads each such live subscription from Stripe once (it never
writes to Stripe) and writes its item's amount to the production database.
First the dry run, which writes nothing:

    pnpm --filter @codex/database exec tsx scripts/backfill-course-subscription-amounts.ts --env production --test-keys

It prints one line per row (our row id, its Stripe subscription, the amount
Stripe has, the action), then the counts. The owner reads it. Only then:

    … --env production --test-keys --apply

At most 200 rows a run (`--limit`, up to 1000). When the limit is reached it
prints the `--after <id>` to carry on from. A re-run is a no-op: the write is
guarded by `amount_cents IS NULL`, so an amount a webhook wrote meanwhile
wins. `--test-keys` works as in R10.

Afterwards, expect `missing` to be 0:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT count(*) FILTER (WHERE amount_cents IS NULL) AS missing,
       count(*) AS live
FROM course_subscriptions
WHERE ended_at IS NULL AND duplicate_of_course_subscription_id IS NULL;
ROLLBACK;
```

### R17 — the first hourly price-moves run

ecom-api's hourly cron runs the price-moves step, except on the 08:00 London
run, which the bank payout has to itself. A run with nothing to do logs
nothing: `Price moves: run finished` appears only when a run claimed,
restarted or reopened at least one move. So with no price saved since the
deploy, expect no `Price moves` line at all (confirmed on production's 12:00Z
run, 2026-11-06). Either way, look for any `Price moves: a step of the run
failed` or `payouts-sweep cron could not run the price moves` error.

### Rollback

`0122`, `0124` and `0125` stay. Rolling forward is preferred: the old workers
know nothing of a waiting move or change of billing.

- **A waiting change of billing breaks the old webhook.** Its schedule is
  Stripe's, so at the year's end it still switches the item to the monthly
  Price. The old `customer.subscription.updated` handler then writes
  `billing_interval = 'month'` and leaves `pending_billing_interval` at
  `'month'`, which fails `check_subscription_pending_billing` (23514) on every
  retry, so the row stops following Stripe. The old cancel also fails, with
  Stripe's 400, while a schedule is attached.
- **A waiting move to a cheaper plan** already bills the cheaper price at the
  renewal, and the old code never flips the tier, so the member keeps the
  dearer plan at the cheaper price until the roll forward.

So before any rollback, list every subscription with a waiting move, a
waiting change of billing or a schedule:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT id, stripe_subscription_id, stripe_schedule_id,
       pending_tier_id, pending_tier_from, pending_billing_interval
  FROM subscriptions
 WHERE pending_tier_id IS NOT NULL
    OR pending_billing_interval IS NOT NULL
    OR stripe_schedule_id IS NOT NULL
 ORDER BY pending_tier_from NULLS LAST;
ROLLBACK;
```

If it lists anyone, decide with the owner first. To roll back anyway, for
each row: release its schedule at Stripe if it has one (the member then stays
on yearly billing), then clear the six columns, so nothing waits that the old
code can't see:

```sql
UPDATE subscriptions
   SET pending_tier_id = NULL, pending_tier_from = NULL,
       held_amount_cents = NULL, pending_billing_interval = NULL,
       pending_amount_cents = NULL, stripe_schedule_id = NULL
 WHERE id = '<row id>';
```

After the roll forward, the next event for each of them mirrors the waiting
move still recorded in the Stripe subscription's metadata back into its row.
A released change of billing comes back only while its renewal is still
ahead: the hourly backstop then sets its schedule again. If the renewal
passes first (during the rollback, say), Stripe bills the member another
year at the yearly price. The hourly step never flips that row: it alerts
`tier_move.apply_failed`, reason `billing_not_switched`, once a day until
support clears the record (subscriptions.md › Waiting changes of billing ›
Runbook). So roll back only when no listed `pending_tier_from` with a
`pending_billing_interval` falls inside the planned window, or decide those
members with the owner first. Don't change prices while
rolled back: the old fan-out writes no price moves, so the hourly step can't
see its subscribers after the roll forward.

---

## A late win undoes a lost chargeback (migrations `0126` and `0127`)

`0126` adds four nullable columns and three CHECKs to `disputes`
(`Codex-2hxff.70`; [dispute record](dispute-record.md)). It is plain
drizzle-kit DDL. The buyer's `purchase-access-restored` email is in no
migration: the deploy's template seed (`db:seed:templates`, which runs right
after `db:migrate` and before any worker deploys) inserts it, as it does every
new template, and skips one that already exists. `0127` adds one more nullable column,
`refunded_outside_stripe_at`: a charge whose buyer support refunded outside
Stripe, which its refund route then refuses
([operations](operations.md#late-wins)). Both
are additive and run before the workers deploy. The old workers never read the
columns, and they still only alert a late win and leave its row `lost`, which
every CHECK allows. No backfill: nothing sets the new column until support
settles a case, by hand, by settling a late win's own failed refund as
refunded elsewhere, or with R19's UPDATE for one refunded another way. Both stay on a rollback, but list the late wins still being
undone first ([R19](#r19--before-any-workers-rollback-late-wins-still-being-undone)).
The old support route doesn't read `refunded_outside_stripe_at`, so a charge
refunded outside Stripe is refundable through Stripe again while rolled back:
don't refund one then. R19 lists them.

### R18 — lost chargebacks already settled by hand

From this release the hourly reconcile undoes any lost dispute that Stripe
now shows as won, including one alerted under the old "alert only" rule that
a person has already put right by hand. Its first run comes within the hour
of the deploy, and the deploy migrates and starts the new workers in one job,
so such a row must stop being `lost` before the deploy. `0126`'s columns don't
exist until the deploy, so R18 has two parts.

**(a) Before the deploy.** List the rows the reconcile could pick up and check
each in Stripe:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT stripe_dispute_id, stripe_charge_id, purchase_id, subscription_id,
       course_subscription_id, amount_cents, stripe_created_at, outcome_applied_at
  FROM disputes
 WHERE status = 'lost'
   AND stripe_created_at >= now() - interval '12 months'
 ORDER BY stripe_created_at;
ROLLBACK;
```

**Expect none:** production runs on Stripe test keys and has had no late-win
alert.

For any that Stripe shows as won and that was already put right by hand, mark
it won and applied, so neither the old workers nor the new ones act on it
again. This one writes: run it only with the owner's OK, with the ids from the
list. Run it between :20 and :50 past the hour, as the operations step does:
the old workers' hourly retry of an unfinished loss takes no lock, so a write
while it runs could let it finish the loss on a row that is now won.

```sql
BEGIN;
UPDATE disputes
   SET status = 'won',
       outcome_applied_at = COALESCE(outcome_applied_at, now() - interval '1 second'),
       updated_at = now()
 WHERE stripe_dispute_id IN ('du_…') AND status = 'lost'
RETURNING stripe_dispute_id, status, outcome_applied_at;
COMMIT;
```

It returns one line per id. A missing line means the id was mistyped or is no
longer lost: check it before going on. Each row is now an applied win:

- **Every CHECK allows it, `0126`'s included.** It writes only columns that
  exist today, and `0126`'s three CHECKs test only its new columns, which
  arrive empty.
- **Nothing acts on it.** The webhook stops at an applied outcome, the hourly
  retry takes only unapplied rows, and the late-win check reads only lost ones,
  on the old workers and the new.
- **A row whose loss never finished** (`outcome_applied_at` empty in the list)
  gets an applied time a second before the write. It then still reads as
  settled by hand, not by the undo, and (b) leaves its `lost_applied_at`
  empty, as for any loss that never finished, so support shows no made-up
  "lost on" date. Marking it won also releases the sale's
  unpaid payouts that its unfinished loss was holding, and the next payout run
  pays them, as for any win. Check first that the hand settlement didn't pay
  those creators some other way.

**(b) After the deploy**, at any time, record the same rows as late wins. This
adds support's history ("Won late") and the lifted refund limit (Q7). Nothing
races it, because the row stays applied:

```sql
BEGIN;
UPDATE disputes
   SET late_won_at = now(),
       -- In the ARRAY: each id whose outcome_applied_at was EMPTY in (a)'s
       -- list (its loss never finished). ARRAY[]::text[] when there are none.
       lost_applied_at = CASE
         WHEN stripe_dispute_id = ANY (ARRAY['du_…']::text[]) THEN NULL
         ELSE outcome_applied_at
       END,
       updated_at = now()
 WHERE stripe_dispute_id IN ('du_…')
   AND status = 'won' AND late_won_at IS NULL
   AND outcome_applied_at IS NOT NULL
RETURNING stripe_dispute_id, outcome_applied_at, late_won_at, lost_applied_at;
COMMIT;
```

Then check that each is an applied late win settled by hand. Every column
should read `t`:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT stripe_dispute_id, status,
       outcome_applied_at < late_won_at AS applied_before_the_late_win,
       (late_won_at IS NULL OR status = 'won') AS check_late_won_status,
       (late_win_refund_id IS NULL OR late_won_at IS NOT NULL) AS check_late_win_refund,
       (lost_applied_at IS NULL OR late_won_at IS NOT NULL) AS check_lost_applied
  FROM disputes
 WHERE stripe_dispute_id IN ('du_…');
ROLLBACK;
```

`applied_before_the_late_win` is what keeps the buyer's "access is back" email
from being sent for it ([dispute record](dispute-record.md#an-applied-late-win)).

### R19 — before any workers rollback: late wins still being undone

A late win that the new workers have already undone stays undone. A late win
still being undone does not (won, `late_won_at` set, its outcome not yet
applied). Within the hour, the old workers' hourly retry finishes it as a plain
win: it re-pays the creators and marks it applied, but it leaves a refunded
purchase refunded, and it never refunds a payment the buyer made twice. After
the roll forward, nothing revisits it, because it is applied. So before any
workers rollback, list them:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT d.stripe_dispute_id, d.stripe_charge_id, d.purchase_id,
       d.subscription_id, d.course_subscription_id, d.late_won_at,
       d.late_win_refund_id, pu.status AS purchase_status,
       pu.duplicate_of_purchase_id,
       EXISTS (SELECT 1 FROM purchases o
                WHERE o.customer_id = pu.customer_id AND o.id <> pu.id
                  AND o.status = 'completed'
                  AND (o.content_id = pu.content_id
                       OR o.course_id = pu.course_id)) AS bought_again
  FROM disputes d
  LEFT JOIN purchases pu ON pu.id = d.purchase_id
 WHERE d.late_won_at IS NOT NULL AND d.outcome_applied_at IS NULL
 ORDER BY d.late_won_at;
ROLLBACK;
```

Keep this list for support too: the charges whose buyer was refunded outside
Stripe. The old charge page doesn't block them, so while rolled back none of
them is ever refunded through Stripe:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT stripe_dispute_id, stripe_charge_id, refunded_outside_stripe_at
  FROM disputes
 WHERE refunded_outside_stripe_at IS NOT NULL;
ROLLBACK;
```

At 0 late wins still being undone, a workers rollback is exact for them.
Otherwise, prefer a forward fix. Each listed row has a step that is retried
every hour and alerted ([operations](operations.md#late-wins)). Fix its cause
and let the next run finish it, or settle a refund Stripe won't make
([operations](operations.md#settling-a-late-win-refund-stripe-wont-make)), then
list again.

**A row whose last alert is the refund not made** ("Late win: Stripe refused
the refund of a payment the buyer made twice…" or "Late win: a payment the
buyer made twice (bought again, or a duplicate) could not be refunded…") **MUST
be settled with that operations step BEFORE any rollback.** It can't be
settled after: the step's first check needs the outcome empty. And once the
old workers mark it applied, the held re-pay is released and the next payout
run pays the creators back the first payment, with nothing to take it back. A
case the step stops (STOP) is the owner's to settle before the rollback; until
then, don't roll back.

**A late win's failed refund is settled with the NEW admin, or not until the
roll forward.** The new admin's "refunded elsewhere" marks the charge refunded
outside Stripe; the old one marks nothing, and once a refund is settled
nothing marks it later. So before any rollback, list them:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT r.stripe_refund_id, r.stripe_charge_id, d.stripe_dispute_id,
       COALESCE(d.late_win_refund_id = r.stripe_refund_id, false)
         AS recorded_as_the_late_wins
  FROM refunds r
  JOIN disputes d ON d.stripe_charge_id = r.stripe_charge_id
                 AND d.late_won_at IS NOT NULL
 WHERE r.status = 'failed' AND r.resolved_at IS NULL
 ORDER BY r.stripe_charge_id, r.stripe_refund_id;
ROLLBACK;
```

It lists every open failed refund on a late win's charge, not only the one
our record names: the late win's own refund may carry only Stripe's metadata
(`codex_late_win_dispute`) when our record's write was lost. Settle each as
the late-win alert row says ([operations](operations.md#late-wins)). One still
open at the rollback stays open until the roll forward: refund the buyer
another way meanwhile if need be, but don't settle it in the old admin, and
never with "Re-pay payees". One settled while rolled back anyway is recorded
with (b) below.

If the workers must roll back anyway, **keep the list first.** Once the old
workers mark a row applied, it looks exactly like a late win the new workers
undid, and it can't be found again. Then wait until each row shows
`outcome_applied_at` set, and act on it:

| The row | What to do |
|---|---|
| A subscription or a course subscription | Nothing: the old workers settle it as the new ones would |
| `purchase_status` is `completed` | Nothing: the buyer already has it back. They aren't sent the "access is back" email |
| `purchase_status` is `pending` (a duplicate payment the loss never got to) | Nothing: the hourly duplicate sweep refunds it |
| `late_win_refund_id` set | Nothing, once Stripe shows that refund succeeded: its `charge.refunded` takes it back from the creators. If a payout run paid their re-pay first, it leaves a `slice_repaid` debt for support, as any refund of a re-paid sale does. If it fails or is canceled instead, the buyer is still owed it: refund them another way. Settle a failed one in Failed refunds as refunded elsewhere, **never** "Re-pay payees": the old admin doesn't refuse it, and the old alert even suggests it. A canceled one paid nothing out and took nothing back, so there is nothing to settle. The old admin doesn't mark either charge refunded outside Stripe: record it with (b) after the roll forward, and never refund it through Stripe before then |
| `refunded`, `late_win_refund_id` empty, and `bought_again` true or `duplicate_of_purchase_id` set | The buyer paid twice. Refund what is left of the charge: from Stripe's Dashboard while rolled back (the old charge page keeps the 14-day limit), or from the charge page once rolled forward (a late win has no limit there). Its `charge.refunded` takes it back from the creators, as in the row above |
| `refunded`, and neither | The undo never gave the buyer the item back. Unless the charge's refunds cover what was paid (check in Stripe), give it back by hand, with the owner's OK: content with a [support grant](access.md#support-grants), and a course as the owner decides |

**(b) After the roll forward**, with the owner's OK for each case, mark every
charge whose buyer was refunded another way while rolled back: a late-win
refund that failed or was canceled (row 4), or one the old admin settled.
Nothing else marks it: the new admin marks only a refund it settles itself, so
the charge page would offer a Stripe refund again, with no end date.

```sql
BEGIN;
UPDATE disputes
   SET refunded_outside_stripe_at = now(),
       updated_at = now()
 WHERE stripe_dispute_id IN ('du_…')
   AND late_won_at IS NOT NULL
   AND refunded_outside_stripe_at IS NULL
RETURNING stripe_dispute_id, refunded_outside_stripe_at;
COMMIT;
```

It returns one line per id. A missing line means the id was mistyped, isn't a
late win, or is already marked: check it before going on.
