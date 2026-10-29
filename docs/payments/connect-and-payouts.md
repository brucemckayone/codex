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
| `POST /connect/me/sync` | Re-read the account from Stripe after onboarding returns; if it is payable, release the caller's pending money after the response ([Releasing pending money](#releasing-pending-money)) |
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
decision 2026-10-13, "Hold for the window"; 2026-10-27, Q1: manual payouts and a
daily payout job; `Codex-2hxff.29`). That way a refund within the window can
always be clawed back from the Stripe balance. The platform sets every connected
account's payout schedule; creators cannot change it.

- **Manual payouts, bank debit off.** Every connected account has
  `settings.payouts.schedule.interval: 'manual'` and
  `debit_negative_balances: false`, set at `accounts.create`
  (`connect-account-service.ts`) and, for older accounts, by the backfill below.
  Stripe's own default on our accounts is daily with a 7-day delay, and bank debit
  ON (test-mode probe, 2026-10-27). `delay_days` cannot do the hold: it applies
  only to `on_behalf_of` and direct charges, never to our `source_transaction`
  transfers. Bank debit is off because Stripe holds a negative balance and takes
  it from later earnings (`Codex-2hxff.30`, Q2), never from the creator's bank.
- **The daily bank payout** (`runBankPayouts`, `packages/payments/src/bank-payouts.ts`)
  runs inside the hourly ecom-api cron, on the one run whose London hour is 8
  (08:00 UTC in winter, 07:00 UTC in summer), last in the wake: a reversal the
  clawback retry made that hour has landed, and an old sale the drain released
  goes the same morning. No new cron, no new database wake. It takes the accounts
  flagged in `connect_balances` (switched), least recently checked first and
  any on a failing streak last, at most 1,000 a run (`BANK_PAYOUT_ACCOUNT_LIMIT`,
  sized to the invocation's 10,000-subrequest budget, which the wake's other
  sweeps share: the arithmetic is beside the constant). Reaching it is an error
  alert with the flagged count, and the rest go first the next morning. If
  Cloudflare's "Too many subrequests" comes first (many transfer pages, say),
  the run stops at it with one error alert naming the accounts done and left,
  and the rest go first the next morning too. Four at a time, for each:
  1. reads the balance on the account and records it (available, pending, and a
     negative episode: see [Reversals](#reversals)). This includes a current
     account Stripe has payouts off on: its balance can still go below zero.
     Nothing is paid while the account's total available is zero or below,
     whatever one pot holds, or while payouts are off (a replaced account is
     still paid, S5's 90 days);
  2. lists the platform's transfers to it created in the last 14 × 24 h, each
     with its charge. `young` is the net (amount less reversed) of the transfers
     whose **charge** is under 14 × 24 h old. The list stops at 10,000 transfers:
     an account with more is not paid that day, and support gets an error alert
     with its `stripeAccountId`;
  3. pays out `available − held`, where `held = young − pending` (pending money
     has not settled, and settlement is always inside 14 days, so it is all
     young). If pending is more than young, it holds all of `young` and warns:
     old money can go a day late, young money never goes early;
  4. calls `payouts.create` with the key
     `bank_payout_<acct>_<London date>_<source type>`.

  **Each pot separately** (owner, HIGH-1: "Pay each pot separately"). Stripe
  keeps an account's balance in one pot per source type and a payout draws on
  one (`source_type`; the default is `card`), so steps 1 to 4 run per pot: each
  pot's own available and pending, against the young transfers that landed in
  it (`Transfer.source_type`; none given is `card`), one payout per pot with
  money to pay. Past the total's gate (step 1), a debt in one pot is not netted
  against another's payout: Stripe recovers each from its own later earnings. In GBP there is **one pot today**: Stripe's
  `card` covers cards and non-legacy bank debits, Bacs included; `bank_account`
  is legacy US ACH and `fpx` Malaysian (test-mode probe, 2026-10-28: the
  platform's whole GBP balance is `card`). Paying per pot is the guard that a
  second pot can never strand money: a balance with no source-type breakdown is
  all `card`, and even a pot this code has no name for is asked for, so a
  refusal reaches support through the 3-day alert. Studio's next payout, the
  covered chargeback and `bankOn` read the account's totals, which is exact
  with one pot.

  A transfer is judged by its sale's charge, never by its own time: a drain on
  day 40 of a day-1 sale goes at the next run. A re-pay (a won chargeback's, or
  support's Re-pay) has no `source_transaction`, is never young, and goes at the
  next run after it.
- **When Stripe says no.** Each pot's payout is judged on its own.
  `balance_insufficient` skips that pot for the day and is never retried in the
  same run; it is also recorded as a refusal, since Stripe holding money our
  figures say is there means money is stuck. `idempotency_error` means the
  day's payout already exists. A refusal (including `balance_insufficient`) is
  recorded on the account (`last_error_code`, `failing_since`), even when
  another pot was paid that morning; once Stripe has refused an account for 3
  days (London dates), one error alert goes to support, naming the pot's
  source type. A balance read Stripe refuses (access lost) counts into the
  same streak and alert, and sends the account to the back of the order, since
  a read that fails writes no `checked_at`; an outage or a timeout doesn't.
  Deauthorizing the platform (`account.application.deauthorized`) takes the
  account off the job. A day that ends the
  streak (nothing to pay, the balance below zero, payouts off) clears it, so a
  later refusal starts a new streak and can alert again. An outage or a timeout is
  a warning: the payout may exist, and the next day's balance read decides. A
  payout Stripe made whose database write then fails is logged as an error with
  the payout's id, and counted as paid.
- **What creators see.** On Studio → Earnings each paid sale says "Goes to your
  bank on {date}" (`bankOn`: the first 08:00 London run 14 × 24 h after the sale
  and strictly after its transfer), and the account card shows the next bank
  payout and any chargeback the balance is covering (`GET /connect/me/balance`,
  cached 10 minutes). The `payout-released` email names the bank date or
  dates. Only the cron's own drain runs ahead of the bank payout in the 08:00
  wake, so only its email names that morning's payout; any other drain
  (`account.updated`, `/connect/me/sync`) may transfer after the job read the
  account, so it names the next. Studio reads the date later from the row,
  which can't say which drain paid it, so its date is never early: a sale the
  cron's drain paid at 08:00 shows the next morning. Nothing goes to the bank
  while the balance is below zero, so a date that fell inside the last episode
  that ended (`cleared_since` up to `cleared_at`) moves to the run that saw it
  clear: that run records its snapshot and then pays what is above zero.
  **Known limits:** only the last episode is kept, so a date inside an earlier
  one still shows the day it would have gone; and a payee with a replaced
  account has the latest episode of either account applied to all their rows.
- **What went towards a take-back, sale by sale** (amendment 3, owner
  2026-10-29: "Exact amounts, oldest first"). Money leaves a Stripe balance
  oldest first, by our bank payout or by covering a take-back, so
  `towards = (what should be in Stripe) − (what is)`, clamped to [0, what
  should be], is shared over the unsent sales oldest first (sale date, then
  id); each sale's share is at most its net, and the rest goes to the bank.
  One function, `towardsTakeBack` (`packages/payments/src/bank-payouts.ts`),
  serves Studio's covering card, the Earnings rows and Org Payouts, from the
  person's own ledger rows (`ledgerSalesSince`: every organisation and their
  own, paid or since reversed). Each sale is valued at the reading T is from:
  what the drain sent (the amount less the reductions made before sending,
  `pendingReductionsFor`, the drain's own definition) less the take-backs that
  moved money by then. So a refund after an episode cleared leaves that
  episode's figures as they were.

  | Case | Should be in Stripe | Is in Stripe |
  |---|---|---|
  | No episode (the covering card) | the sales no run has paid yet | live available + pending |
  | Below zero | the sales due from `negative_since` (or the first run that pays nothing) | live available + pending, below zero: all of it went towards |
  | The last episode that ended | the sales due from `cleared_since`, sent by the clearing run's reading, valued then | `cleared_balance_cents`, written by the clearing |

  The clearing run's reading includes its wake's earlier steps: the dispute
  reconcile and the cron's own drain run before the job reads any account
  (`runReadingEnd`, the run plus 15 minutes).

  A sale counts as unsent only until the earliest run that could have paid it
  (a transfer in the 08:00 wake may have gone that morning), so `towards` is
  never overstated. Like the job, it judges a sale by its charge's time:
  - The young transfers Studio already lists reach 16 days back, so they give
    it for the sales due at the next run.
  - A row due inside an episode by its own date, sent before the episode, is
    asked for in one list around its transfer (`chargeTimesWanted`). A failed
    read is a 503, as the balance's is.
  - Where Stripe doesn't have it, the row's date stands in. That date is
    never earlier than the charge.

  `GET /connect/me/balance` carries it as `towards.live` and
  `towards.lastEpisode`, per payout id, inside its 10-minute cache. Each also
  carries `causeType`, so a row can say "the chargeback" or "the refund"
  (`towardsKind`). It is the one kind among the take-backs that moved the
  person's money in its window, which runs up to its reading. Every window
  starts as far back as its unsent sales were sent (16 days before its first
  run), or at the episode's start if that is earlier, because a take-back
  before the episode can have used their money. It is null when the
  take-backs are mixed, when none is on record, or when there are 20 or
  more. A window wider than it needs to be can make it null, but never the
  wrong kind.

  Worst case per 10-minute cache miss:
  - Stripe: the balance read; the main transfer list (16 days, paged); and
    at most two bounded lists, each about 17 days, for the running episode
    and the last ended one. Only rows needing a charge time cause a bounded
    list.
  - Database: the `connect_balances` row; the ledger's three queries (rows,
    reductions, steps); and up to three take-back queries (the below-zero
    causes, and `causeType` for live and for the last episode).

  **Known limits:**
  - Episodes before the last one aren't shared, and keep their stored bank
    days.
  - The rows don't record which account was paid, so "should be in Stripe"
    is scoped to the current account by time only. Only rows sent after that
    account's switch to manual payouts count (`connect_balances` is per
    account, and a new account is created on manual payouts), which leaves out
    what an old account was paid. The exception is a transfer an earlier
    attempt made to a replaced account but recorded only after the switch
    (Codex-2hxff.47). It counts against the current balance, so it can read as
    having gone towards a take-back.
  - A transfer or take-back from outside the cron, landing in the clearing
    wake after the job read the account, is counted as in the reading.
- **Creators cannot change it.** In the Stripe Dashboard (Connect → Express
  dashboard settings) payout-schedule editing, self-serve manual payouts and
  Instant Payouts are off: an owner action, which no API can check
  ([operations.md](operations.md)). `account.updated` flags an account in
  `connect_balances` once Stripe reports both settings and the live account,
  asked again, does not say otherwise (if Stripe can't be asked, the event is
  trusted: an unflagged manual account would never be paid). If a flagged
  account is later reported otherwise (an edit in the Dashboard), it leaves the job and
  support gets an error alert, but only once the live account, asked again, still
  says so: a late or replayed event changes nothing. The heal is in
  [operations.md](operations.md#payout-schedule-backfill).
- **Switching existing accounts** is
  `packages/database/scripts/backfill-payout-schedule.ts`: a dry run by default,
  then `--apply --confirm <checksum>` (and `--live` in production), only with
  the owner's OK. The runbook is in [operations.md](operations.md). At the switch,
  money from the last 14 days that Stripe's old schedule would have paid that week
  waits until its day 14. Earnings says so for 14 days after the switch (owner,
  OQ5).

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
  the owner left) goes to the **next owner**, never a former one (owner
  decision 2026-10-18, "Hold it for the next owner"; `Codex-2hxff.37`):
  - if an owner has been assigned since the sale, the slice is theirs;
  - if not, it is kept as a pending `no_owner` row with no payee, handed to
    the next owner the moment ownership moves, in the same transaction. The
    admin reassignment response says how much was handed over
    (`heldPayoutsReleased`). A held row written while that transaction was
    committing is missed by it; the hourly sweep re-homes it.
  - It is paid once they can be paid, like any pending row. A refund of the
    sale cancels it, and a cancelled row is never handed over.
  - Every such slice is logged as an error when recorded, and every sweep
    warns about each organisation still holding some: only support can
    release it, by assigning an owner.

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
| Publishing priced content (any price or tier, purchasable or not; also the admin publish route) | The content's creator is payable (`requiresPayoutsToPublish`, `Codex-2hxff.14`) |
| Giving published content a price or tier, or marking it purchasable | The content's creator is payable. A save that changes nothing a buyer could pay into, or removes a price or tier, is never refused |
| Publishing a priced course (a price, an active course plan, or a tier) | The course's creator is payable (owner decision 2026-10-22, "Yes, same rule") |
| Giving a live course a price or a tier | The course's creator is payable |

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
| `status` | `paid`, `pending`, `failed`, `reversed`, `cancelled_by_refund`, `cancelled_by_dispute` |
| `reason` (when not paid) | `connect_not_ready` (no account), `connect_restricted` (an account that cannot take charges), `transfer_failed`, `min_transfer_floor`, `no_owner` (the organisation had no owner at the sale's time — the row has no payee yet); empty on a pending row while its transfer is in flight, or while a dispute holds its sale ([below](#releasing-pending-money)) |
| `sourceType` | `purchase` or `subscription` (course subscriptions use `subscription`) |
| References | the charge (`stripeChargeId`), the transfer once made, the payee, the organisation (empty for orgless sales), the purchase or subscription; on an organisation subscription invoice's creator slice, the agreement it was split by (`creator_org_agreement_id`, `Codex-2hxff.19`) |
| Failures | `last_error_code` and `last_error_type` (Stripe's, from the last failed transfer), `failure_count` (Stripe refusals only), `needs_review_at` (set when the row waits for support) — see [When Stripe keeps refusing a payout](#when-stripe-keeps-refusing-a-payout) |

Rules:

- **Exactly one row per slice per charge**, so a replayed webhook cannot add a
  second. The organisation's slices (`organization_fee`,
  `creator_payout_to_owner`) are unique on the charge and slice type whoever
  the payee is; a creator's slice on the charge and the creator; the platform
  fee on the charge.
- **The row comes first.** A writer reserves a slice's row (`pending`) before
  any money moves, transfers, then marks it `paid` — so a replay, at any age,
  finds the row and sends nothing, and money never moves unrecorded. Every
  writer goes through the ledger (`packages/payments/src/payout-ledger.ts`):
  `recordSlice`, or `recordSplitOnce` for a whole split.
  A replayed purchase webhook re-records the purchase's slices from its stored
  split, adding only a slice the first delivery never wrote — unless the
  purchase has been refunded or disputed since.
- **A subscription invoice is split once**, an organisation's or a course
  plan's (owner decision 2026-10-21, "Keep its first split", `Codex-2hxff.62`;
  course plans since `Codex-2hxff.49`). Its slices past the platform fee are
  reserved together, in one transaction that holds a lock on the charge
  (`recordSplitOnce`). A redelivery that finds any of them keeps every slice
  recorded, and logs at error each one it would have computed differently.
  It adds only a slice the split defines that is missing entirely, from what
  the charge has left (the gross less every row recorded on it); with nothing
  left, it adds nothing. So a redelivery after a creator accepts an agreement
  backdated to before the invoice pays that creator nothing: the owner's first
  split already took the whole charge, and the creator is paid from the next
  invoice. Only a delivery that died between slices, under the per-slice
  writers before `Codex-2hxff.49`, leaves a slice missing; its redelivery
  records it, so nothing owed is left without a row. A slice that was reserved
  but never sent is paid by the drains.
- **A replay keeps the platform fee on record** (owner decision 2026-10-23,
  "Keep recorded fee", `Codex-2hxff.49`). Fees are read when an invoice is
  processed, so they can change between a delivery and its redelivery. If the
  first delivery recorded the platform fee and died before the split, the
  redelivery splits the rest of the charge (the gross minus the fee recorded)
  by the fees in force now, so the slices still sum exactly to the gross. That
  is logged at warn. See
  [fees-and-splits](fees-and-splits.md#a-replayed-invoice).
- **Nothing is dropped.** A slice that cannot be paid yet is a pending row in
  its payee's name. The organisation's money while it has **no owner** is a
  pending `no_owner` row with no payee (owner decision 2026-10-18, "Hold it for
  the next owner"); it becomes the next owner's — see
  [Organisation ownership](#organisation-ownership). The pennies left by
  rounding creators' shares go to the organisation's slice
  ([fees-and-splits](fees-and-splits.md#organisation-subscription-invoice)).
- **A failed transfer stays payable.** A `failed` row keeps its charge id and is
  retried by the drains, until Stripe has refused it for good or five times:
  then it waits for support ([below](#when-stripe-keeps-refusing-a-payout)).
  Not a row the write paths before `Codex-2hxff.11` marked failed: they
  recorded no attempt (`last_retry_at` empty), and the transfer they called
  failed may have landed under metadata no lookup can match. Those are
  reconciled by a person before the release (release checklist R6).
- **A refund freezes the row, then asks Stripe.** A row is `pending` while
  its transfer is in flight, and stays so if the transfer landed but the row
  could not be marked paid; a `failed` row's transfer may have landed despite
  the error. So a refund first cancels a pending or failed row — nothing can
  mark it paid afterwards — then looks for a transfer Stripe made for it, on
  any account the payee has had ([replaced accounts](#transfers)), and
  reverses that like a paid row's. A transfer that lands after the cancel is
  reversed by whoever sent it: its row is no longer payable, so nothing would
  ever account for the money. Both the refund and the sender may find it;
  Stripe refuses whichever full reversal comes second, and that side, seeing
  the transfer `reversed`, treats it as done. Either way the row ends
  `reversed`, recording the transfer (`Codex-pqsfg`). That includes a transfer whose call failed
  without an answer from Stripe: the sender looks it up by its `payout_id` and
  reverses it, and if it cannot be found, logs an error with the row and the
  transfer's idempotency key for a person to check. Stripe does not reverse
  transfers when a charge is refunded.
- **Rows are permanent.** Deleting a user or organisation never deletes ledger
  rows: the database refuses a hard delete of anyone a payout row names
  (`ON DELETE RESTRICT`, migration 0111, `Codex-2hxff.23`), and deleting an
  account anonymises the person instead ([README](README.md)).
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
- **A replaced Connect account is still searched** (owner decision
  2026-10-23, "Keep account history", `Codex-2hxff.47`). Transfers are looked
  up by their destination, so a transfer sent to an account the payee no
  longer has would not be found, and the drain would send the row again. A
  database trigger records the old account, for its old user, in
  `stripe_connect_account_history` whenever a `stripe_connect_accounts` row is
  deleted, its `stripe_account_id` changes, or it is moved to another user
  (`user_id` changes), so a manual support edit is caught too. The history
  starts at migration 0113: an account replaced before 0113 is not in it, and
  cannot be added later. The lookup (`findTransfersForPayouts`) searches the
  current account for every row, then each replaced account, newest first,
  for the rows that have an attempt on record (`last_retry_at`). A row never
  attempted has no transfer anywhere, so a payee with no history, or no
  attempted row, costs the one Stripe search it always did. A row found on
  two of the payee's accounts was paid twice: that is logged at error with
  both transfers, and the current account's settles it. The drain and a
  refund's cancel both use it (`payeeAccountIds`). The app itself never
  replaces an account.

| Transfer | Idempotency key |
|---|---|
| Creator slice of a one-off sale | `${chargeId}_creator` |
| Organisation slice | `${chargeId}_org_fee` |
| Creator slice of a subscription invoice | `${chargeId}_creator_${creatorId}` |
| Creator pool to the owner (no agreements) | `${chargeId}_creator_pool_owner` |
| Draining a pending or failed row | `payout_${payoutId}_${attempt}` |
| Reversing a transfer for a refund | `${transferId}_reversal_${refundId}_${attempt}` (the attempt advances only after Stripe refuses) |
| Reversing a transfer that landed on a row a refund had cancelled | `${transferId}_reversal_surplus` |

Never replace a key with something random or time-based "for freshness": that
defeats replay safety. The drain's key changes per **attempt**, not per call:
Stripe replays the first result for a key for about 24 hours, errors included,
so one key per row would block a retry for a day. Each attempt first claims
the row for 10 minutes (no other drain, and no write-time transfer still in
flight, can send it meanwhile) and looks for an earlier attempt's transfer
before sending. The claim is renewed just before each send: a drain whose
group outlived the lease, and lost a row to another drain, does not send it.

## Releasing pending money

Pending money is kept for its payee **indefinitely and is never forfeited**.
While any is waiting for a creator without a payable account, they are emailed a
reminder once a month with the amount and a link to set up payouts (owner
decision 2026-10-13, "Hold and remind (Recommended)") — **gap**:
`Codex-2hxff.34`.

When a payee becomes payable, **all** their pending rows are paid at once —
from every organisation and from orgless sales
(`SubscriptionService.resolvePendingPayoutsForAccount`, `Codex-2hxff.13`). The
payee is found from the Connect account alone, so nothing depends on the
account's metadata.

**What triggers it:**

1. `account.updated`, when the account changes from not payable to payable.
   "Was it payable before?" is read from **our** stored row, not from Stripe's
   `previous_attributes`, which can omit the fields that changed. That makes a
   duplicate event a no-op and handles restricted-then-active correctly: each
   return to payable drains again. The drain runs after the webhook answers.
2. `POST /connect/me/sync`, whenever it finds the account payable, after the
   response. A repeat is harmless: a row already paid is not drainable, and
   one another drain has claimed is skipped.
3. **The hourly sweep**, a safety net.

**How a drain works.** A payee's pending and failed rows are grouped by
organisation and source, so each group is paid at its own organisation's fees.
A group below the minimum transfer waits. Each row is claimed for one attempt;
a transfer Stripe already made for it is found by its `payout_id`, on the
payee's current account or one they have replaced, and settles it; the rest
are transferred with key `payout_${payoutId}_${attempt}` and marked `paid`, or
`failed` to be retried next time. One group's failure never stops the next.
Rows waiting for support are skipped (`isDrainablePayout`), and so are rows
held by a dispute ([disputes](purchases.md#disputes)):

- A row is held while its sale has an open dispute or inquiry, or a lost one
  whose loss is not applied yet. A won or closed one releases it.
- A re-pay row (a won dispute paying a reversal back) has no charge of its
  own. It is held through the slice it re-pays, while that slice's charge has
  such a dispute: a second dispute of the same charge, which Stripe allows
  (`Codex-2hxff.59`). It is also held while the dispute that re-paid it is
  `won` but its outcome is not applied yet (`outcome_applied_at`): the win's
  follow-up, which takes a refund's share off the re-pay row, may have failed
  and be waiting for the reconcile to retry it. Paid in full first, that
  share would become a debt for a person to collect.
- A re-pay row for a failed refund support settled as `creators_repaid`
  (`Codex-2hxff.28`) is held the same way, through the slice it re-pays. No
  outcome waits on it, so it is otherwise paid by the next drain.
- A slice recorded while a dispute holds its sale is not sent at write time
  either. It is reserved `pending` (no reason, no attempt) and paid by the
  drains once the dispute is won or closed (owner decision Q1, "the sale's
  pending slices held"). A payee who cannot be paid yet keeps their own
  reason, as before.

The payee then gets **one** `payout-released` email, with what was actually
paid to their creator slices in this drain, whatever the number of
organisations.

**The sweep.** An ecom-api cron at `0 * * * *`, in production only. Each run
claims at most 50 payees whose rows have waited more than 15 minutes since
they were last checked, least recently checked first. The claim is one
`UPDATE … SET attempted_at` over `SELECT … FOR UPDATE SKIP LOCKED`: it bounds
the run, keeps two overlapping runs on different payees, and records the
check, so a payee who cannot be paid yet goes to the back of the queue
instead of being asked about first every hour. No session lock is used: the
database pooler may give each statement a different connection. The sweep
then checks each claimed payee's account live with Stripe and drains those
now payable. An ownerless organisation's held rows are claimed the same way
and re-homed if it has an owner again. Only payees with a Connect account row
(onboarded, or onboarding) are claimed: someone who never started onboarding
has nothing to check, so their rows wait, untouched, and cannot crowd payable
payees out of the batch. A drainable row with neither payee nor organisation
cannot be claimed by anyone; each run logs how many there are, at error.

Why hourly, and why minute `0`: Neon bills the time the database is awake, and
the sweep wakes it. At 15 minutes the sweep alone kept the database awake about
8 hours a day; hourly is about 2. Minute `0` shares one wake with media-api's
hourly cron and notifications-api's daily `0 8 * * *` cron.
`packages/constants/src/__tests__/cron-wake-alignment.test.ts` pins the
alignment.

### When Stripe keeps refusing a payout

Owner decision 2026-10-23 (D-P2, "Stop, flag for support"; `Codex-2hxff.48`).
A failed transfer records Stripe's `code` and error type on its row
(`last_error_code`, `last_error_type`). What happens next depends on why it
failed (`classifyTransferFailure` in `packages/payments/src/payout-ledger.ts`):

| Failure | Uses an attempt | What happens |
|---|---|---|
| Stripe could not answer: a connection error, a 5xx, a rate limit, a lock or key conflict | No | Retried by the next drain; a warning |
| The platform's side: `balance_insufficient`, the platform's keys or Connect setup, or a fault of ours | No | Retried by the next drain. A warning per row and **one error per drain run** (for the hourly sweep, one per sweep), because a person may need to act (top up the balance, fix a key). The error is raised at the run's first platform failure, with its errorId, code and message, so a run cut short still alerts; the end of the run logs a summary at warn under the same errorId (row count, total pence, codes, the first message). The write path's own attempt is an error at once (`Codex-r094t`) |
| A refusal no retry can fix: `transfers_not_allowed`, or `resource_missing` on the `destination` (the payee's account no longer exists) | No | **Flagged at once** |
| Any other refusal | Yes (`failure_count`) | Retried; the **fifth** (`MAX_PAYOUT_FAILURES`, the same cap as refund clawbacks) flags it |

A **flagged** row has `needs_review_at` set. Every drain and the sweep skip it,
and exactly one error is logged for it, with an `errorId`, by the call that
flagged it. Its status stays `failed`, so the money is still owed: earnings
still count it, and a refund or a lost dispute still cancels it.

The list of refusals that flag at once is kept short on purpose: an unlisted
code still flags the row after five refusals. A destination without the
`transfers` capability is not on it, because Stripe documents no code for it and
the account can still gain it.

**Releasing a flagged payout.** There is no screen yet (an admin button comes
with the admin app). Support finds the queue — served by the partial index
`idx_payouts_needs_review` — with:

```sql
SELECT id, user_id, organization_id, amount_cents, last_error_code,
       last_error_type, failure_count, needs_review_at
FROM payouts
WHERE needs_review_at IS NOT NULL AND status = 'failed'
ORDER BY needs_review_at;
```

Once the cause is fixed (for example the payee has reconnected their account,
or Stripe has lifted a restriction), release the row:

```sql
UPDATE payouts
SET needs_review_at = NULL, failure_count = 0, updated_at = now()
WHERE id = '<payout id>' AND status = 'failed';
```

It must report `UPDATE 1`; `UPDATE 0` means the row was paid or cancelled
meanwhile, and nothing is released. A released row is paid by the next drain
that reaches its payee: the hourly sweep (once the row's `attempted_at` is 15
minutes old), or the payee's own `/connect/me/sync`. `account.updated` drains
only when the account changes from not payable to payable, so it does not
pay a released row for a payee who is already payable.

**Releasing many at once.** One platform-side incident can flag every payout it
touches, though nothing is wrong with any payee: for example a deploy with the
other mode's Stripe key (each transfer is refused with `resource_missing` on
the `destination`), or the platform losing the right to make transfers
(`transfers_not_allowed`). Once the cause is fixed, count the rows the incident
flagged, then release them together, with the incident's code and time window:

```sql
SELECT count(*), sum(amount_cents)
FROM payouts
WHERE status = 'failed'
  AND needs_review_at IS NOT NULL
  AND last_error_code = '<code>'
  AND needs_review_at >= '<incident start>'
  AND needs_review_at <  '<incident end>';

UPDATE payouts
SET needs_review_at = NULL, failure_count = 0, updated_at = now()
WHERE status = 'failed'
  AND needs_review_at IS NOT NULL
  AND last_error_code = '<code>'
  AND needs_review_at >= '<incident start>'
  AND needs_review_at <  '<incident end>';
```

The `UPDATE` must report the count the `SELECT` gave. Rows flagged outside the
window, or for another code, are left for review one by one.

## Reversals

Refunds and disputes reverse paid slices in proportion and adjust pending ones;
see [refunds](purchases.md#refunds) and [disputes](purchases.md#disputes). What
each refund did to each slice is one `payout_reversals` row
([design](refund-reversal-record.md)); the `payouts` row is never rewritten.

**When a payee's balance cannot cover a take-back, Stripe holds the debt**
(owner decision 2026-10-27, Q2; `Codex-2hxff.30`). Stripe takes the reversal
anyway and the payee's Stripe balance goes below zero. Stripe recovers it from
their next earnings by itself, and bank payouts pause until the balance is back
above zero (Stripe blocks them, and so does the daily payout job). Bank debit is
off, so Stripe never takes it from their bank. Nothing in our ledger nets it:
the take-back is a `done` step like any other.

- **The daily payout job records each episode** in `connect_balances`: the first
  morning it sees the balance below zero (`negative_since`), the last morning
  before that it was at or above zero (`negative_after`; the take-back lies
  between), and how it ended (`cleared_at`, `cleared_reason`). An episode of 180
  days or more (London dates, so a clock change cannot move it) is read as Stripe
  collecting it from the platform
  (`stripe_collected`), otherwise as `recovered`; that only changes an email's
  wording. The payee is emailed when it goes below zero and when it clears
  (notifications-api's daily money sweep), and Studio → Earnings shows a live card.
- **Q4, on what is owed NOW** (owner decisions 2026-10-13 and 2026-10-27; studio
  S1, option A), on the person's total across organisations:

  | What they owe | What happens |
  |---|---|
  | **£50 or less** | Written off when Stripe collects it from the platform, 180 days below zero |
  | **More than £50** | "To invoice" 90 days after it first went below zero |

  If Stripe collects a debt over £50 from the platform first (180 days below
  zero), it is still support's to invoice: the clearing write adds it to
  `collected_owed_cents` (keeping the first `collected_at`) and support gets an
  error alert, `bank_payout.debt_collected`, with the `stripeAccountId` and the
  amount. A later episode never touches those two columns; only the P6
  follow-up clears them (amendment 2, 2026-10-29).

  The invoice itself (and the top-up transfer that brings their balance back to
  zero once it is paid, so Stripe does not also take it from their earnings)
  ships after the lawyer's P6 answer, as a follow-up: support will send it with
  one button (OQ1). Until then "To invoice" is a state on the Creator debts tab,
  counted in the Support badge.
- **A take-back Stripe REFUSES** (`insufficient_funds` or `balance_insufficient`,
  which the probe has not seen on our platform) still writes a `refund_reviews`
  debt, kept for that case. It never moved the balance, so the two never
  overlap. Support settles it by hand.
- **Support sees both in Admin → Queue → Creator debts, one row per person**
  (`Codex-2hxff.73`): the live Stripe balance (read for the page, 5 s each, the
  morning snapshot when Stripe can't be read), what has come back so far, the
  take-backs that took them below zero, any refused debts, and the Q4 clock. The
  badge counts only the people who need a person: a refused debt, or "To
  invoice" (OQ2). A balance Stripe is recovering by itself is listed, not counted.
  A known limit: the badge reads the 08:00 snapshot and the tab the live
  balance, so for someone owing close to £50 the two can disagree for up to a
  day. When Stripe refuses admin-api's key the balance (no Balance: Read on
  connected accounts), the tab shows the snapshot and raises an error alert.

Each step of a clawback is claimed under a lease, so one delivery works on it
at a time. A delivery that outlives its lease never changes a step another path
has settled since: support's re-pay of a failed refund, or a won dispute's re-pay
(owner decision 2026-10-27, "Never overwrite; hold for support",
`Codex-2hxff.72`). If its reversal lands anyway, the payee has lost money nothing
will re-pay. The reversal's id is recorded on the step, and nothing else on it
changes. One error alert, with an `errorId`, names the payee, the amount, and the
refund or dispute, and the case is queued for support as a `payee_credits` row:
every late case, the unconfirmed ones as "Check Stripe again" (Q10, OQ3).
Support settles it in Admin → Queue → **Owed to creators**, or on the charge page
("Taken after it was settled. £X owed back to {name}"): Re-pay what Stripe
actually took (a pending re-pay payout the next run pays, Q9), Count it against
the share's own open debt when Stripe took exactly that (Q11), or Not owed with a
note. Nothing is re-paid automatically, and a credit is never netted against
another debt ([design](refund-reversal-record.md), §4 step 7). An unpaid slice
cancelled under a settled step is queued the same way, unless a transfer had
gone out for it that Stripe refused to reverse: the payee still holds that
transfer, so its alert says NOT to re-pay, the slice is reconciled instead, and
its row is born closed as not owed.

A clawback step whose delivery died after it may have cancelled its slice is
settled by the system, on refunds and disputes alike (owner decision Q6,
`Codex-2hxff.71`; [design](refund-reversal-record.md), §8 rule 2), including a
slice the drain marked `reversed` after the cancel (`Codex-2hxff.88`). A case the
ledger cannot attribute is "Check in Stripe, then decide" in Owed to creators:
support re-pays or marks it not owed, with a note saying what Stripe showed.

## Earnings screens

| Route | Who | Shows |
|---|---|---|
| `GET /subscriptions/me/payouts`, `/me/earnings-summary` | Any signed-in person | Their own rows only (no ids accepted from the client): earned (paid), in transit (pending), needs attention |
| `GET /subscriptions/payouts`, `/payouts/summary`, `/payouts/by-creator` | Organisation owner and admins | The organisation's rows. Totals exclude the platform's own fee rows, and "needs attention" counts stuck charges, not rows |

A pending row is the normal state before a drain, not a fault, and is not shown
as a warning.
