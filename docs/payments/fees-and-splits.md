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
(`packages/purchase`): one-off purchases, course purchases, organisation
subscription invoices and course subscription invoices, whether reached from a
route, a webhook or the payouts cron — **gap**: `Codex-2hxff.7` (webhook and
cron paths build their services without it, so only the constants apply to real
sales).

Each value is looked up in this order; the first one set wins, column by column:

1. **Creator override** — `fee_config_org_creator` (organisation + creator)
2. **Organisation** — `fee_config_org`
3. **Platform** — `fee_config_platform` (a single row)
4. **Code constants** — `FEES` in `packages/constants/src/commerce.ts`

| Value | Meaning | Constant default |
|---|---|---|
| `platformFeePercent` | Platform's cut of gross | 1000 (10%) |
| `oneOffOrgFeePercent` (platform row) | Organisation's cut of the post-platform pool on one-off sales | 1000 (10%) |
| `subscriptionOrgFeePercent` (platform row) | Organisation's cut of the post-platform pool on subscriptions | 1500 (15%) |
| `orgFeePercent` (organisation and override rows) | One organisation fee that replaces both platform values above | — |
| `minPlatformFeeCents` | [Minimum platform fee](#minimum-platform-fee) | 25 (25p) |
| `minTransferCents` | [Minimum transfer](#minimum-transfer) | 0 |

**Notice.** A fee **increase**, at any level, is emailed to every affected
creator and organisation owner and applies only to sales made 30 or more days
later. A **decrease** applies to the next sale (owner decision 2026-10-13,
"Rises 30 days, cuts now (Recommended)") — **gap**: `Codex-2hxff.33` (today
every change applies to the next sale and nobody is told).

**Changing fees.** Only the platform owner can, through admin-api
(`/api/admin/fees/*`, `auth: 'platform_owner'`):

| Method | Path | Purpose |
|---|---|---|
| `GET` / `PATCH` | `/api/admin/fees/platform` | Read / update the platform row |
| `GET` / `PATCH` / `DELETE` | `/api/admin/fees/org/:orgId` | Read / set / remove an organisation's values |
| `GET` | `/api/admin/fees/org/:orgId/creators` | List an organisation's creator overrides |
| `GET` / `PUT` / `DELETE` | `/api/admin/fees/org/:orgId/creator/:creatorId` | Read / set / remove a creator override |
| `GET` | `/api/admin/fees/audit-log` | Paginated change history |

There is no web screen; a local desktop admin app is planned (`Codex-xyb7v`).
On an organisation or override write, a value left out is kept, and `null`
clears it back to inheriting the level above. Every write bumps the row's
`version`, writes one `fee_config_audit_log` row per column that **actually
changed** (a clear is recorded as old value → `NULL`, and so is each set
value when an organisation's values or an override are removed; setting a
value it already has, or clearing one already clear, records nothing and
writes nothing), and invalidates the cache. In the log, `NULL` on either side
means unset, inheriting the level above. Rows written before migration 0112
hold the string `'null'` instead: from an update, that was a clear that never
took effect (the old merge kept the value, `Codex-2hxff.23`); from removing an
organisation's values or an override, the removal did happen. The current fee
row tells the two apart. Writes are atomic —
**gap**: `Codex-rtwpv`. Fee values are cached in KV with no TTL: a write
invalidates them, and they change too rarely for a TTL to be worth the misses.
A fee is read when each sale is processed; it is never snapshotted on an
agreement. A replayed invoice keeps the platform fee its first delivery
recorded ([below](#a-replayed-invoice)).

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
per transfer, and bank payouts already wait out the 14-day refund window. If it
is ever turned on, the creator payout terms must say so.

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
  platform fee keeps the one recorded, and logs the difference at warn.
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
  added. Several missing slices take their computed amounts in turn, and the
  last takes the rest.

| £10.00 invoice, no agreements | Platform | Organisation | Owner pool |
|---|---|---|---|
| First delivery at 10% / 15% | 100 | 135 | 765 |
| It died after the platform fee; the replay runs at 20% / 15% | 100 (recorded) | 135 | 765 |
| The same replay split afresh (what the rule prevents) | 100 (recorded) | 120 | 680, £1.00 short of the gross |

Using the fees in force at the invoice's own time instead waits for fee
effective dates (`Codex-2hxff.33`).

---

## Reporting

Every screen that shows revenue uses the same rules as the split:

- the revenue headline includes every kind of revenue — one-off, course,
  organisation subscriptions, course subscriptions and orgless sales — **gap**:
  `Codex-2hxff.20` (Studio Billing counts one-off sales only);
- a creator's share is shown as the share they actually have — **gap**:
  `Codex-2hxff.20` (revenue by creator shows it inverted);
- charts plot shares of the post-platform pool, using the fee actually
  configured rather than a hard-coded 10% — **gap**: `Codex-2hxff.20`;
- payout totals exclude the platform's own fee rows.
