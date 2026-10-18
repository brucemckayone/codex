# Connect and payouts

How creators and organisation owners get paid: their Stripe Connect accounts,
who owns an organisation's money, the payouts ledger, and how pending money is
released.

A **gap** marker means the code does not behave this way yet; see
[status.md](status.md).

---

## Connect accounts

Every person who receives money has **one** Stripe Connect account, whatever
organisations they belong to (`stripe_connect_accounts`, unique per user).

It is created with `accounts.create` using controller properties, which makes it
behave like an Express account:

| Setting | Value | Meaning |
|---|---|---|
| `controller.stripe_dashboard.type` | `express` | The person gets Stripe's Express Dashboard |
| `controller.fees.payer` | `application` | The platform pays Stripe's fees |
| `controller.losses.payments` | `application` | The platform is liable for refunds and disputes |
| `controller.requirement_collection` | `stripe` | Stripe collects identity and bank details |
| Capabilities | `card_payments`, `transfers` | |
| Country | `GB` | |
| Metadata | `codex_user_id`, `codex_env` | |
| Idempotency key | `connect_acct_${userId}` | One account per person, even on retry |

Our row is written before the onboarding link is created, so an abandoned
onboarding never leaves an account we don't know about.

**Status** comes from `account.updated`: `active` when both `charges_enabled`
and `payouts_enabled` are true (**payable**); `disabled` when Stripe gives a
`disabled_reason`; `restricted` when requirements are due; otherwise
`onboarding`. The status is cached per person for 10 minutes and invalidated by
every account event.

## Setting up payouts

| Route | Purpose |
|---|---|
| `POST /connect/me/onboard` | Start or resume onboarding; returns a Stripe onboarding link (`account_onboarding`, collecting `eventually_due` requirements) |
| `GET /connect/me/status` | The caller's own status and outstanding requirements |
| `POST /connect/me/sync` | Re-read the account from Stripe after onboarding returns |
| `POST /connect/me/dashboard` | A single-use login link to the caller's **own** Express Dashboard |

All are `auth: 'required'` and act only on the caller's own account.

## The payout dashboard and bank details

Owner decisions Q1 and Q2 (SEC-01).

- The Express Dashboard — balance, payouts and bank details — opens **only for
  the person who owns that Connect account**, through `POST
  /connect/me/dashboard`. Nobody can open anyone else's.
- Creators **can change their payout bank account** there; Stripe allows it by
  default in the Express Dashboard. They **cannot change their payout schedule**:
  the platform keeps control of it, which leaves room to delay payouts if refunds
  ever need covering (owner decision 2026-10-13, "Bank account only"). In a
  sandbox the login link is the only way in.
- Other organisation members see the organisation's payout **status** only,
  through `GET /connect/organization-status?organizationId=` (any member). It
  returns `isConnected`, `chargesEnabled`, `payoutsEnabled` and `status` — no
  account id, no outstanding requirements, never a login link — and reads only
  the organisation the membership check resolved, never one named elsewhere in
  the request.
- The organisation-level routes (`/connect/onboard`, `/connect/status`,
  `/connect/sync`, `/connect/dashboard` with `?organizationId=`) are retired.
  Until 2026-10-13 `POST /connect/dashboard` checked the organisation in the
  query string but acted on the one in the body, so any organisation owner or
  admin could open any other organisation's payout dashboard (`Codex-2hxff.1`).

## Payout timing

Money reaches a payee's **Stripe balance** when their transfer is made, but moves
from there to their **bank** only after the **14-day refund window** (owner
decision 2026-10-13, "Hold for the window"). That way a refund within the window
can always be clawed back from the Stripe balance. The platform sets every
connected account's payout schedule; creators cannot change it — **gap**:
`Codex-2hxff.29` (today Stripe's default schedule applies).

---

## Organisation ownership

Owner decisions, 2026-10-13: "The proposed ownership model seems perfect to me."

- An organisation has **exactly one owner**: the person who created it. The
  database enforces this.
- **Only the owner can transfer ownership.** Admins cannot make anyone owner,
  including themselves.
- The owner must transfer ownership before they can leave.
- If a transfer is impossible, the platform owner assigns a new owner.
- **The organisation's money always goes to its current owner.** The
  organisation slice of every sale is paid to the current owner's Connect
  account.
- If the new owner has not set up payouts, the organisation's money is kept as
  **pending** in their name and paid once they finish.
- Money earned **before** a transfer stays with the previous owner, including
  anything still pending for them.
- Money earned while the organisation has **no owner** (none was assigned, or
  the owner left) is kept as pending `no_owner` rows with no payee, and goes
  to the **next owner** — the moment ownership moves, in the same transaction
  (owner decision 2026-10-18, "Hold it for the next owner";
  `Codex-2hxff.37`). It is paid once they can be paid, like any pending row.

The `organizations.primary_connect_account_user_id` pin is no longer read or
written; the payee is the owner whose ownership period covers the sale's time
(`resolveOrganisationPayee`). The column itself is dropped by `Codex-2hxff.36`.

**How it is held.** The owner is the single `organization_memberships` row with
`role='owner'` and `status='active'` (the unique index
`uq_org_memberships_one_active_owner` allows no second one). Who is *paid* as
owner, and from when, is `organization_ownership_periods`: one open period per
organisation, written in the same transaction as every change of owner.
Creating an organisation opens its creator's period.

**Transferring ownership** (owner decisions 2026-10-13, see
[status.md](status.md#decisions); the mockup and data design were reviewed on
`Codex-2hxff.2`):

- The owner offers ownership from **Studio → Settings** to an active **admin or
  creator**, and confirms by typing the organisation's name.
- One offer is open at a time. It lasts **7 days**, and the owner can withdraw it
  until it is accepted. The recipient accepts or declines; an offer to someone
  who stops being an admin or creator is withdrawn automatically.
- On acceptance the recipient becomes the owner and the previous owner becomes
  an **admin**. The organisation's money follows whoever owned it **at the time
  of each sale**: the payment time for a purchase, the invoice's creation time
  for a subscription, which are the same instants the
  [agreement resolver](agreements.md#how-a-share-applies) uses.
- An agreement the previous owner holds keeps paying. Without one, their income
  from the organisation's subscriptions stops, because the pool goes to the
  owner. The offer dialog warns them, and the recipient sees every active
  agreement before accepting.
- Emails: the offer goes to the recipient. Acceptance goes to the new owner, the
  previous owner and every other admin. A decline or automatic withdrawal goes to
  the owner. An expired offer sends nothing; it shows on the Ownership card.
- Platform support can reassign ownership through admin-api
  (`auth: 'platform_owner'`). There is no screen yet.
- The members routes cannot make anyone owner, change the owner's role or
  remove the owner (`409 OWNERSHIP_TRANSFER_REQUIRED`): ownership moves only by
  the routes above.

## What needs payouts set up first

| Action | Requires |
|---|---|
| Creating a tier | The owner is payable |
| Subscribing to a tier | The owner is payable |
| Creating a course plan | The owner is payable |
| Subscribing to a course plan | The owner is payable |
| Publishing priced content | The content's creator is payable — **gap**: `Codex-2hxff.14` (only checked when marked purchasable) |

If an account later stops being payable (for example Stripe restricts it for
verification), sales still complete and the affected slices wait as pending
rows.

---

## The payouts ledger

The `payouts` table holds one row for every slice of every sale and invoice.
(The older `pending_payouts` table is no longer written to.)

| Column | Values |
|---|---|
| `payoutType` | `platform_fee`, `organization_fee`, `creator_payout`, `creator_payout_to_owner` |
| `status` | `paid`, `pending`, `failed`, `reversed`, `cancelled_by_refund` |
| `reason` (when not paid) | `connect_not_ready` (no account), `connect_restricted` (an account that cannot take charges), `transfer_failed`, `min_transfer_floor`, `no_owner` (the organisation had no owner at the sale's time — the row has no payee yet); empty on a pending row while its transfer is in flight |
| `sourceType` | `purchase` or `subscription` (course subscriptions use `subscription`) |
| References | the charge (`stripeChargeId`), the transfer once made, the payee, the organisation (empty for orgless sales), the purchase or subscription |

Rules:

- **Exactly one row per slice per charge**, so a replayed webhook cannot add a
  second. The organisation's slices (`organization_fee`,
  `creator_payout_to_owner`) are unique on the charge and slice type whoever
  the payee is; a creator's slice on the charge and the creator; the platform
  fee on the charge.
- **The row comes first.** A writer reserves a slice's row (`pending`) before
  any money moves, transfers, then marks it `paid` — so a replay, at any age,
  finds the row and sends nothing, and money never moves unrecorded. Every
  writer goes through `recordSlice` (`packages/purchase/src/utils/payout-ledger.ts`).
  A replayed purchase webhook re-records the purchase's slices from its stored
  split, adding only a slice the first delivery never wrote — unless the
  purchase has been refunded or disputed since.
- **Nothing is dropped.** A slice that cannot be paid yet is a pending row in
  its payee's name. The organisation's money while it has **no owner** is a
  pending `no_owner` row with no payee (owner decision 2026-10-18, "Hold it for
  the next owner"); it becomes the next owner's — see
  [Organisation ownership](#organisation-ownership). The pennies left by
  rounding creators' shares go to the organisation's slice
  ([fees-and-splits](fees-and-splits.md#organisation-subscription-invoice)).
- **A failed transfer stays payable.** A `failed` row keeps its charge id and is
  retried by the drains.
- **Rows are permanent.** Deleting a user or organisation never deletes ledger
  rows — **gap**: `Codex-2hxff.23` (they cascade today).
- A `paid` or `reversed` row always carries a transfer or charge id and the time
  it was resolved (database check).

### Transfers

- Every transfer passes `source_transaction` = the sale's charge. Stripe
  accepts it immediately and moves the money when the charge's funds become
  available, so nothing has to wait or poll.
- Subscription transfers also carry `transfer_group = sub_${subscriptionId}`.
- Every transfer is GBP, and the currency is asserted before the call. A new
  transfer call site must hard-code GBP, call the assertion, and add a test.
- A transfer and its ledger update never disagree for long. Every transfer
  carries the row's id as `payout_id` metadata. If the row cannot be marked
  `paid` after its transfer, it stays pending, and before re-sending any row
  the drain looks for that transfer in Stripe and settles the row instead.
  Stripe forgets idempotency keys after about 24 hours, so the key alone is
  not enough.

| Transfer | Idempotency key |
|---|---|
| Creator slice of a one-off sale | `${chargeId}_creator` |
| Organisation slice | `${chargeId}_org_fee` |
| Creator slice of a subscription invoice | `${chargeId}_creator_${creatorId}` |
| Creator pool to the owner (no agreements) | `${chargeId}_creator_pool_owner` |
| Draining a pending or failed row | `payout_${payoutId}_${attempt}` |
| Reversing a transfer for a refund | `${transferId}_reversal_${refundId}` |

Never replace a key with something random or time-based "for freshness": that
defeats replay safety. The drain's key changes per **attempt**, not per call:
Stripe replays the first result for a key for about 24 hours, errors included,
so one key per row would block a retry for a day. Each attempt first claims
the row for 10 minutes (no other drain, and no write-time transfer still in
flight, can send it meanwhile) and looks for an earlier attempt's transfer
before sending.

## Releasing pending money

Pending money is kept for its payee **indefinitely and is never forfeited**.
While any is waiting for a creator without a payable account, they are emailed a
reminder once a month with the amount and a link to set up payouts (owner
decision 2026-10-13, "Hold and remind (Recommended)") — **gap**:
`Codex-2hxff.34`.

When a payee becomes payable, **all** their pending rows are paid at once —
from every organisation and from orgless sales.

**What triggers it** — **gap**: `Codex-2hxff.13`:

1. `account.updated`, when the account changes from not payable to payable.
   "Was it payable before?" is read from **our** stored row, not from Stripe's
   `previous_attributes`, which can omit the fields that changed. That makes a
   duplicate event a no-op and handles restricted-then-active correctly. Today
   this trigger only runs for accounts carrying an organisation id in their
   metadata, which accounts created since June 2026 do not have — so nothing
   drains until the hourly sweep.
2. `POST /connect/me/sync`, when it finds the account payable. Today it updates
   the status but releases nothing.
3. **The hourly sweep**, a safety net.

**How a drain works.** A payee's pending and failed rows are grouped by
organisation and source. A group below the minimum transfer waits. Each row is
claimed for one attempt; a transfer Stripe already made for it is found by its
`payout_id` and settles it; the rest are transferred with key
`payout_${payoutId}_${attempt}` and marked `paid`, or `failed` to be retried
next time. Rows held for an open dispute are skipped — **gap**:
`Codex-2hxff.9`. The payee is emailed (`payout-released`) — **gap**:
`Codex-2hxff.13`.

**The sweep.** An ecom-api cron at `0 * * * *`, in production only. It picks
payees with rows pending for more than 15 minutes, checks each payee's account
live with Stripe, and drains those now payable. It works in bounded batches,
takes a lock so two runs cannot overlap, and records each attempt — **gap**:
`Codex-2hxff.13` (unbounded, unlocked, attempts never recorded).

Why hourly, and why minute `0`: Neon bills the time the database is awake, and
the sweep wakes it. At 15 minutes the sweep alone kept the database awake about
8 hours a day; hourly is about 2. Minute `0` shares one wake with media-api's
hourly cron and notifications-api's daily `0 8 * * *` cron.
`packages/constants/src/__tests__/cron-wake-alignment.test.ts` pins the
alignment.

## Reversals

Refunds and disputes reverse paid slices in proportion and adjust pending ones;
see [refunds](purchases.md#refunds) and [disputes](purchases.md#disputes). When
a payee's balance cannot cover a reversal, a `refund_reviews` row records the
debt, and it is deducted from their next payouts until cleared — they are told,
and the debt and each deduction show in their earnings.

If it is never recovered (owner decisions 2026-10-13: "Write off after 12 months
(Recommended)", then a cap of "£50 (Recommended)" with "All of it, after 90 days
(Recommended)"):

| A payee's total open debt | What happens |
|---|---|
| **£50 or less** | Written off by the platform once they have earned nothing for 12 months |
| **More than £50** | Invoiced to them in full if not recovered from earnings within 90 days |

— **gap**: `Codex-2hxff.30`.

## Earnings screens

| Route | Who | Shows |
|---|---|---|
| `GET /subscriptions/me/payouts`, `/me/earnings-summary` | Any signed-in person | Their own rows only (no ids accepted from the client): earned (paid), in transit (pending), needs attention |
| `GET /subscriptions/payouts`, `/payouts/summary`, `/payouts/by-creator` | Organisation owner and admins | The organisation's rows. Totals exclude the platform's own fee rows — **gap**: `Codex-2hxff.15` |

A pending row is the normal state before a drain, not a fault, and is not shown
as a warning.
