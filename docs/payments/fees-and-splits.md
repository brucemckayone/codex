# Fees and splits

How the platform fee and organisation fee are configured, and exactly how every
sale and invoice is divided. The money itself moves as described in
[connect-and-payouts.md](connect-and-payouts.md).

A **gap** marker means the code does not behave this way yet; see
[status.md](status.md).

---

## Units and rounding

- Amounts are integer pence (GBP). Percentages are basis points: 10000 = 100%.
- The **platform fee** is a fraction of the **gross** amount.
- The **organisation fee** and every **creator share** are fractions of the
  **post-platform pool** (gross minus platform fee) — never of the gross.
- One-off purchases: the platform fee and organisation fee are rounded **up**;
  the creator gets the remainder, so the three always sum to the amount paid.
- Subscription invoices with agreements: each slice is rounded **down**, and the
  penny or two left over goes to the organisation — see
  [rounding remainders](#rounding-remainders).

## Fee configuration

Every sale path resolves its fees through `FeeConfigService`
(`packages/purchase`), over `resolveFeesAt` (`packages/payments`
`fee-versions.ts`): one-off purchases, course purchases, organisation
subscription invoices and course subscription invoices, whether reached from a
route, a webhook or the payouts cron.

**Fees are dated.** Each change is a row in `fee_changes` (a `cut` or a
`rise`, with the date it applies from, `effective_from`) and the level's full
values from then on are a row in `fee_config_versions`. Versions are
insert-only: a removal is a `removed` version, never a deleted row. A sale is
split by the fees **in force when it was made**: the newest version at each
level whose date is no later than the sale's time `at`. A one-off purchase
passes the time its offer was made (else its purchase time). A subscription
invoice should pass the time its invoice was raised — **gap**: the
subscription paths (`packages/subscription`) don't pass `at` yet, so an
invoice is split by the fees in force when it is processed (Codex-2hxff.33,
the subscription half).

Each value is looked up in this order; the first one set wins, column by column:

1. **Creator override** — scope `creator` (organisation + creator)
2. **Organisation** — scope `org`
3. **Platform** — scope `platform` (one level)
4. **Code constants** — `FEES` in `packages/constants/src/commerce.ts`

| Value | Meaning | Constant default |
|---|---|---|
| `platformFeePercent` | Platform's cut of gross | 1000 (10%) |
| `oneOffOrgFeePercent` (platform level) | Organisation's cut of the post-platform pool on one-off sales | 1000 (10%) |
| `subscriptionOrgFeePercent` (platform level) | Organisation's cut of the post-platform pool on subscriptions | 1500 (15%) |
| `orgFeePercent` (organisation and override levels) | One organisation fee that replaces both platform values above | — |
| `minPlatformFeeCents` | [Minimum platform fee](#minimum-platform-fee) | 25 (25p) |
| `minTransferCents` | [Minimum transfer](#minimum-transfer) | 0 |

The old "current row" tables (`fee_config_platform`, `fee_config_org`,
`fee_config_org_creator`) are still written, with the values **in force now**
(never a waiting rise), so code rolled back to before migration `0123` reads
the right fee. Every admin save writes its level's row, and notifications-api's
08:00 fee step writes a dated rise into it on the morning the rise starts.
Nothing new reads them; a later release stops writing them.

### Notice of a change

Owner decision 2026-10-13 ("Rises 30 days, cuts now (Recommended)"), with
batch C1's decisions F1–F9 and Q1–Q5 (2026-10-30):

- A **cut** applies to the next sale. A **rise**, at any level, waits until
  everyone it pays less has been told, then 30 days: it starts at the first
  UK midnight at least 30 days after the **last** person on the list was told
  (F4). Told means their email was accepted, or support marked them told
  another way.
- A change that is a rise anywhere waits as a whole, even if it also cuts
  something (F1). To get the cut sooner, save it on its own first.
- A higher minimum transfer counts as a rise (F9), and so does clearing a
  value back to a higher inherited one (an organisation losing its own lower
  fee).
- Who is told (F3): every active creator, admin and owner whose take falls,
  worked out with the same layering a sale uses. Anyone shielded by their
  own setting is not told, and an organisation's owner isn't told about a
  rise in the organisation fee (it raises their share).
- At most one pending rise per level: waiting for its emails, or dated and
  not yet started. A unique index allows one **waiting** rise per level (a
  started one must not block the next), and every write first takes a
  transaction lock on its level (`pg_advisory_xact_lock`), under which a
  dated rise that hasn't started counts as pending too. Saving again while one
  is pending: back to today cancels it (everyone its email told, or may have
  told, is emailed that it's off); below today cancels it and the cut applies
  at once; a **smaller** rise keeps its date and sends one short email to
  everyone its announcement told, or may have told (Q2); a **bigger** one
  replaces it, says so, and its 30 days start again (F2). Made smaller again,
  even the same day, it tells again everyone its last smaller email told, or
  may have told, so two smaller emails can come a day apart; anyone it surely
  missed just gets the lower figure.
- **Told, or may have been** (owner, 2026-11-09; one rule,
  `feeNoticeMayHaveTold` in `@codex/payments`, for all three above): the
  email was accepted, or support marked them told another way; or it may have
  gone: it got no answer, a run tried it (cut off after sending, or still
  sending), or it failed and was retried in the last 12 hours, the time a run
  can hold a notice. An email never tried has told nobody. Erring this way
  means some people get one email more, never one fewer.
- A rise made smaller while the daily run is sending: the run reads the
  figures again once it sees the edit (it looks after its claim and after
  each send), so its later emails name the new figure. One already on its
  way names the earlier one, and its person gets the smaller email the next
  morning.
- Someone who joins while a rise waits is told the same date, and never holds
  it (F8). Their failed email is still listed for support (Q4).
- Each email names a date: the change's, or the earliest it can be, with a
  line that it can only move later (Q1). No email goes when a rise starts
  (F6), and nobody gets a second notice of the same rise (Q5).
- Studio shows the change before it starts: Billing and Payouts to an owner,
  Earnings to a creator (Q3), from `GET /fees/upcoming` (ecom-api).

notifications-api's daily fee step (`0 8 * * *`, after the agreement and money
sweeps) makes each new rise's list, sends the emails, adds joiners, retries
failures every morning and sets the date once nobody on the list is waiting.
Support works the people it can't reach in Admin › Queue › Fee notices
([operations](operations.md#changing-fees)).

### Changing fees

Only the platform owner can, through admin-api (`/api/admin/fees/*`,
`auth: 'platform_owner'`). **Never edit the fee tables with SQL**: a SQL edit
skips the notice a rise needs, and the dated history every sale is split by.

| Method | Path | Purpose |
|---|---|---|
| `GET` / `PATCH` | `/api/admin/fees/platform` | Read / change the platform level |
| `GET` / `PATCH` / `DELETE` | `/api/admin/fees/org/:orgId` | Read / set / remove an organisation's values |
| `GET` | `/api/admin/fees/org/:orgId/creators` | List an organisation's creator overrides |
| `GET` / `PUT` / `DELETE` | `/api/admin/fees/org/:orgId/creator/:creatorId` | Read / set / remove a creator override |
| `POST` | `/api/admin/fees/changes/:changeId/cancel` | Cancel a rise that hasn't started (409 `FEE_CHANGE_NOT_WAITING` otherwise) |
| `GET` | `/api/admin/fees/audit-log` | Paginated change history |

There is no web screen; a local desktop admin app is planned (`Codex-xyb7v`).
On an organisation or override write, a value left out is kept, and `null`
clears it back to inheriting the level above. Every write answers with the
values in force now and the `change` it made (`null` when nothing changed),
including a removal, which answers 200, not 204. Each write is classified,
versioned, audited and mirrored to the old table in **one transaction**,
under a lock on its level, so two saves at once can't both make a rise
(the race `Codex-rtwpv` tracked). The audit log has one row per column that
**actually changed** (a clear is recorded as old value → `NULL`, and so is
each set value when an organisation's values or an override are removed),
each with the change it belongs to and the date it applies from (`NULL`
while a rise waits). In the log, `NULL` on either side means unset,
inheriting the level above. Rows written before migration 0112 hold the
string `'null'` instead: from an update, that was a clear that never took
effect (the old merge kept the value, `Codex-2hxff.23`); from removing an
organisation's values or an override, the removal did happen.

Fee versions are cached in KV per level (`fee-versions:*`), for a day, or an
hour while the level has a rise waiting: notifications-api dates the rise and
has no cache binding, so readers see the date within the hour (it is at least
30 days off). Every write and support's mark invalidates the level. A fee is
read when each sale is processed; it is never snapshotted on an agreement. A
replayed invoice keeps the platform fee its first delivery recorded
([below](#a-replayed-invoice)).

## Minimum platform fee

Owner decision P-7, "Minimum platform fee". The platform pays Stripe's
processing fee out of its own cut (see [how money moves](README.md#how-money-moves)),
so on a cheap sale 10% can be less than Stripe charges: a £1 sale earns 10p,
while Stripe's published UK card price is 1.5% + 20p, about 21.5p.

- The platform fee is the **larger** of its percentage and `minPlatformFeeCents`.
- The extra is taken from the creator first, then from the organisation; no slice
  goes below zero. If the floor exceeds the whole sale, the platform takes it all.
- The floor is **25p**. That is the code default (`FEES.MIN_PLATFORM_FEE_CENTS`),
  so every environment and a fresh database apply it with no row;
  `fee_config_platform.min_platform_fee_cents` overrides it when the row exists
  (set in production on 2026-10-20). Every price is at least **£1.00**, so the
  floor always covers Stripe's fee (owner decision 2026-10-13,
  "£1 price, 25p min fee (Recommended)"). Stripe itself refuses card charges
  under £0.30.
- A £1.00 sale with no agreement: the normal split is 10 / 9 / 81; the 15p
  shortfall comes from the creator, giving **platform 25p, organisation 9p,
  creator 66p**.

The £1.00 minimum price is enforced by validation on every price and
re-checked at checkout (`Codex-2hxff.32`). The floor reaches every sale path
since #597 (fee config in webhooks and the cron; `Codex-2hxff.7`, closed).

## Minimum transfer

Off: `minTransferCents = 0`, so every slice is transferred as it is earned
(owner decision 2026-10-13, "Keep it off (Recommended)"). Stripe charges nothing
per transfer, and bank payouts already wait out the 14-day refund window (the
daily bank payout, `Codex-2hxff.29`: [Payout timing](connect-and-payouts.md#payout-timing)).
If it is ever turned on, the creator payout terms must say so. Raising it is
a rise like any other (F9): it waits for the notice and its 30 days.

A creator slice smaller than `minTransferCents` is not transferred on its own.
It is recorded as a pending row (reason `min_transfer_floor`) and paid together
with the creator's other pending money for that organisation once the total
reaches the floor (see [releasing pending money](connect-and-payouts.md#releasing-pending-money)).

---

## How each sale is split

Who receives each slice: the platform fee stays on the platform's balance (a
`platform_fee` ledger row); a creator slice goes to that creator's Connect
account; the **organisation slice goes to the organisation's current owner**
([ownership](connect-and-payouts.md#organisation-ownership)).

### One-off purchase of organisation content

- **The content's creator has an active `content_purchase` agreement:** the
  organisation fee is `10000 − share` of the pool; the creator gets the rest.
- **No agreement:** the organisation takes its configured one-off fee (10%
  today) and the creator gets the rest. Owner decision 2026-10-13, "Org default
  fee"; this supersedes the 2026-05-17 note that the organisation keeps
  everything.

Only the uploading creator's agreement applies to their own content; agreements
are never pooled across an organisation's creators for one-off sales.

| £10.00 sale (1000p) | Platform | Organisation | Creator |
|---|---|---|---|
| No agreement | 100 | 90 | 810 |
| Creator has a 70% agreement | 100 | 270 | 630 |
| £4.99 (499p), no agreement | 50 | 45 | 404 |
| £2.00 (200p) with a 50p minimum platform fee | 50 | 18 | 132 |

### One-off purchase of orgless content

A creator selling directly has no organisation slice: the platform takes its
fee and the creator gets the rest — £10.00 → 100 / 0 / 900.

### Course purchase

As for organisation content, using the course creator's `content_purchase`
agreement.

### Organisation subscription invoice

Subscription revenue is pooled at the organisation level and divided by the
organisation's active `subscription` agreements (Σ = the sum of their shares):

- organisation slice = ⌊pool × max(0, 10000 − Σ) / 10000⌋
- each creator's slice = ⌊pool × share / max(Σ, 10000)⌋ (if Σ ever exceeded
  100%, the shares would be scaled down to fit)

**No agreements (or all at 0%):** the organisation fee (15% today) and the
whole remaining creator pool both go to the owner — the pool as a
`creator_payout_to_owner` row.

| £10.00 invoice (1000p; pool 900p) | Platform | Organisation | Creators |
|---|---|---|---|
| No agreements | 100 | 135 + pool 765 → owner | — |
| One creator at 60% | 100 | 360 | 540 |
| One creator at 30% | 100 | 630 | 270 |
| Two creators at 30% and 33.33% | 100 | 330 + 1p remainder = 331 | 270 + 299 |

Which agreements count is decided at the invoice's own time; see
[agreements.md](agreements.md#how-a-share-applies).

### Course subscription invoice

As for a one-off sale, using the subscription organisation fee (15% today) and
the course creator's `subscription` agreement if they have one.

### Rounding remainders

Rounding down on subscription invoices can leave a penny or two over (the last
row above). Owner decision 2026-10-13, "The organisation": the remainder is
added to the organisation slice and recorded with it, so every penny of the
invoice is in the ledger: the organisation's slice is the post-platform pool
minus what the creators take.

### A replayed invoice

Owner decision 2026-10-23, "Keep recorded fee" (`Codex-2hxff.49`). Stripe can
deliver an invoice's payment more than once, and the fees may change in
between. Each slice is recorded once per charge
([the payouts ledger](connect-and-payouts.md#the-payouts-ledger)), and:

- **The platform fee on record wins.** A redelivery that computes a different
  platform fee keeps the one recorded, and logs the difference at warn. A
  charge split with no fee row had a fee of 0 (the fee is written before the
  split, and a 0 fee writes no row), so a redelivery records no fee on it.
- **The rest is split from it.** If no other slice was recorded yet (the first
  delivery died after the platform fee), the pool is the gross minus the
  recorded fee, divided by the rules above with the fees in force now. So the
  slices always sum exactly to the gross, and no transfer exceeds the charge.
- **A split already recorded stands.** If any creator or organisation slice
  exists, every recorded slice is kept, for organisation and course-plan
  invoices alike. Each one the redelivery would have computed differently is
  logged at error for a person to check.
- **A slice missing entirely gets what is left.** A slice the split defines
  but the charge has no row for (a delivery that died between slices) is
  recorded from the gross less every row on the charge, so the slices sum to
  the gross. With nothing left, as after a complete first split, it is not
  added. The rest goes to the organisation's slice when it is among the
  missing, as rounding remainders do: the other missing slices take their
  computed amounts first, as far as it goes. With no organisation slice
  missing, the last missing slice takes the rest. If a first split died
  before writing its owner-pool slice and a replay computes a different payee
  (a backdated agreement), the rest goes to the replay's payee; the first
  split's full shape cannot be known.

| £10.00 invoice, no agreements | Platform | Organisation | Owner pool |
|---|---|---|---|
| First delivery at 10% / 15% | 100 | 135 | 765 |
| It died after the platform fee; the replay runs at 20% / 15% | 100 (recorded) | 135 | 765 |
| The same replay split afresh (what the rule prevents) | 100 (recorded) | 120 | 680, £1.00 short of the gross |

Using the fees in force at the invoice's own time instead waits for fee
effective dates (`Codex-2hxff.33`).

---

## Reporting

Every screen that shows revenue uses the same rules as the split. The owner
decided these on 2026-10-26: "Count everything now", "After refunds", "UTC,
like the rest", "Only what's left" and "One row, real earnings".

- **The headline counts every kind of revenue.**
  - It reads from the payouts ledger, so it covers one-off sales, courses,
    organisation subscriptions and course plans.
  - A per-kind line splits it: One-off · Courses · Subscriptions · Course
    plans. The four sum to the headline.
  - Each payment counts what the organisation keeps, after its standing
    refunds and lost chargebacks.
  - Each payment counts on the UTC day it was first recorded.
- **Billing's "What Codex charged"** is the platform fee on every kind,
  subscriptions included, less its share of those refunds. Purchases and
  Average order stay sales-only (One-off and Courses), because a subscription
  payment isn't an order.
- **Charts** plot one point per UTC calendar day, oldest first, with empty
  days as zero. This holds for the revenue, subscriber and follower series
  alike.
  - A "last N days" window covers exactly N days, today included.
  - "Earned today" is today's UTC date.
  - The dashboard's week-on-week change compares the last 7 days with the
    7 before them.
- **Revenue by creator** has one row per creator: Creator · Earned ·
  Subscription share · Sales share · Last payout · Pending.
  - **Earned** is their cut of the period's sales, sent or not, after refunds.
    The Payouts page's "Earned" stays the money already sent, so the two can
    differ.
  - A creator with no agreement shows "None" for the shares, and a missing
    share shows "—", never 0%.
- **The share bar** plots only what's left after Codex's fee, with no fee
  slice. It warns only when shares pass 100%: "Shares add up to 105% of
  what's left after Codex's fee, 5% more than there is. Amend one or more
  agreements." The creator's page shows the first sentence only.
- **A read that fails says so.** It shows "We couldn't load …" with Retry, and
  never £0 or an empty list.
- Payout totals exclude the platform's own fee rows.
