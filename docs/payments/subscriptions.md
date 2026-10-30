# Subscriptions

Recurring payments: **organisation tiers** (membership of an organisation) and
**course subscription plans** (access to one course). How each invoice is
divided is in [fees-and-splits.md](fees-and-splits.md).

A **gap** marker means the code does not behave this way yet; see
[status.md](status.md).

---

## Organisation tiers

A tier is an organisation's membership level, with a monthly and an annual price.

- Each tier has one Stripe Product and two Prices (monthly and annual) on the
  **platform** account, created by Studio.
- Prices are in pence: at least £1.00 and at most £100,000.
- **A tier includes exactly the items ticked for it** (Codex-2hxff.91, below).
  There is no hierarchy: a dearer tier does not include a cheaper one's items.
  `sortOrder` is the display order, unique within an organisation.
- Creating a tier requires the organisation owner's payouts to be set up (a
  payable Connect account). It can copy another live tier's items
  ("Include everything from…", `copyAccessFromTierId`).
- A tier with subscribers who have not cancelled cannot be deleted. Deleting
  is a soft delete that also archives the Stripe Product, and removes the tier
  from every item. Items in no other tier need a choice; see below.
- **Reordering tiers** changes only the display order. It no longer changes
  what anyone can see, because access is the ticked set, not the order.

Tiers are managed through organisation-api (`/api/organizations/:id/tiers*`,
`TierService`).

### What a tier includes (plan access)

A film is "subscribers only" (or a paid film "also included in tiers") when
its **tier switch** (`content.is_tier_gated`) is on. The tiers that open it are
its ticks in `content_tier_access` (composite FKs pin the item and the tier to
the row's organisation). Courses use `course_tier_access` the same way.

- **A film behind the switch with no tier ticked is CLOSED, never free.** No
  subscriber reaches it; a buyer, a support grant, a course that includes it
  and the team still do. Without a price it is hidden from public lists (its own
  page still loads); with one it is on sale like any paid item (owner U11).
- **Publishing** subscriber content needs at least one tier ticked
  (`TierRequiredToPublishError`, code `TIER_REQUIRED_TO_PUBLISH`, owner U2).
  Saving it with none is allowed. A paid item may publish with no tier.
- **The access decision and the library read the same ticks** (one
  subscription read with an `IN` over the item's ticks), so the shelf never
  lists what the player would refuse.
- **Where ticks are written** — three writers, one file each:
  - the content editor (`POST/PATCH /api/content`, `includedInTierIds`, a total
    set; absent = leave the ticks alone);
  - the tier checklist (`POST /api/organizations/:id/tiers/:tierId/items`, an
    idempotent delta of at most 200 changes; `PlanAccessService`);
  - `TierService` (create with copy, delete with reassignment).

  A course's ticks are also replaced whole by the course panel
  (`CourseAccessService.setTierAccess`, through ecom-api).
- **One lock order for every writer** (the `tier-service.ts` file header):
  tier rows by id first (FOR UPDATE to delete, FOR NO KEY UPDATE to reorder or
  move the recommended flag, FOR SHARE to tick), then the films and courses by
  id (FOR NO KEY UPDATE), then the ticks. So two writers never deadlock: the
  second waits, then reads the first's commit (a deleted tier is refused, an
  item that became only-here is counted).
- **Deleting a tier** whose items are in no other tier needs
  `?onlyHere=keep` (they stay in no tier: subscribers-only films become closed,
  paid films stay for sale, courses are in no tier) or
  `?onlyHere=move&moveTo=<ids>` (they are added to those tiers first). Without
  a choice the delete is refused (`TierHasOnlyItemsError`, 409, code
  `TIER_HAS_ONLY_ITEMS`, with the film and course counts) and nothing changes.
  `GET …/tiers/:tierId/delete-impact` previews it.
- **No payouts check on a copy or a move** (owner U7): the items are already in
  a tier. Adding a PUBLISHED item from the checklist checks its creator's
  payouts, as the editor does.
- `GET …/tiers/access-summary` gives each tier's film and course counts, and
  for each active tier the items a cheaper active tier has and it lacks.
  `GET …/tiers/:tierId/items` is the checklist page. Both are Studio-only and
  never cached.
- **Phase 1-2 compatibility.** The old column `content.included_in_tier_id`
  (drizzle `legacyIncludedInTierId`) is dual-written with the lowest ticked
  tier, and kept for a closed item. Every content read still carries it as
  `includedInTierId`, and the old single-tier input is accepted and expanded to
  "that tier and every dearer one" (an unchanged resend leaves the ticks
  alone). Removed in the cleanup release.
- **An organisation's hard delete** removes its items' ticks
  (`trigger_sweep_tier_access_on_org_change`); without that trigger the delete
  would fail on the composite FK. The items keep their switch, so they stay
  denied, never free.

## Course subscription plans

A course can have one live plan with a monthly and an annual price.

- Each plan has its own Stripe Product and two Prices on the platform account.
- Prices are at least £1.00, as for tiers.
- Creating a plan requires the organisation owner's payouts to be set up.
- Studio routes: `PUT` / `DELETE /studio/courses/:courseId/subscription-plan`.
  Deactivating keeps the row and archives the Product.
- A course can also be included in chosen tiers (`PUT
  /studio/courses/:courseId/tier-access`, an exact set of tiers). Subscribers to
  those tiers get the course.

---

## Subscribing

| Route | Product | Policy |
|---|---|---|
| `POST /subscriptions/checkout` | Organisation tier (monthly or annual) | `auth: 'required'`, rate limit `strict` |
| `POST /checkout/course-subscription` | Course plan | `auth: 'required'`, rate limit `strict` |

Before a Checkout Session is created:

- the tier (or plan) must be active and belong to the organisation;
- the buyer must not already have a live subscription to that organisation (or
  course): `active`, `past_due` or `cancelling`;
- the organisation owner's payouts must be set up — for course plans too.

The session uses `mode: 'subscription'`, the buyer's single Stripe Customer and
the tier's Price for the chosen interval. Metadata on the session and on
`subscription_data` carries `codex_user_id`, `codex_organization_id`,
`codex_tier_id`, `codex_billing_interval` (or `type: 'course_subscription'` with
the course and plan ids) and `codex_env`. There are
no trials. No `application_fee_percent` or `transfer_data` is passed.

**One live subscription per buyer per organisation** (and per course plan) is
enforced twice: at checkout, and again when the subscription is recorded.

- **At checkout**, as for purchases: one open payment page per buyer per
  organisation or course plan. A second tab gets the same page; another tier or
  billing interval replaces it; a page expires after 30 minutes.
- **If a second Stripe subscription completes anyway** (two pages paid before
  either subscription existed), the first one recorded stays (owner decision
  2026-10-22, "Keep the first"). The newcomer is recorded as a duplicate
  (`duplicate_of_subscription_id`, or `duplicate_of_course_subscription_id`),
  `cancelled`, and grants, pays and emails nothing. It is cancelled at Stripe at
  once, without proration, and every payment it took is refunded in full.
- **The buyer gets one email**, the refund's: "You were already subscribed to
  {org}. We cancelled the second subscription and refunded it.", plus "You can
  switch to {tier} with Change plan." when the tiers differ. There is no
  "subscription cancelled" email and no streaming block for it.
- A refund Stripe refuses leaves `duplicate_settled_at` NULL, and the event is
  retried. What never settles is held for support:
  `duplicate_of_subscription_id IS NOT NULL AND duplicate_settled_at IS NULL`
  (likewise on `course_subscriptions`).

### Recording the subscription

Stripe sends `checkout.session.completed` (subscription mode) to
`/webhooks/stripe/subscription`.

- **Organisation tier:** a `subscriptions` row is written with the status Stripe
  reports (not assumed active). The buyer becomes a `subscriber` member (an
  existing owner, admin, creator or `member` role is kept, owner decision
  2026-10-22) and a follower. A welcome email is sent and the buyer's library and subscription
  caches are bumped.
- **Course plan:** a `course_subscriptions` row and a `course_subscription`
  entitlement that expires at the end of the paid period.

The success page waits for our row before confirming
([purchases.md](purchases.md#after-payment)). For a duplicate it confirms
nothing: it names the subscription the user keeps and says the second one is
cancelled and refunded, with Change plan when the tiers differ (Codex-o4jvw).

---

## Lifecycle and access

| Our status | Stripe status | Access |
|---|---|---|
| `active` | `active` | Yes, until the end of the paid period |
| `cancelling` | `active` with `cancel_at_period_end` | Yes, until the end of the paid period |
| `past_due` | `past_due` | **Yes, while Stripe retries the payment** |
| `paused` | `paused` | No |
| `cancelled` | `canceled` (or `unpaid`, which the status mapper turns into `cancelled`) | No |
| `incomplete` | `incomplete` | No |

Our row always follows Stripe's status, in Stripe's order. A late or replayed
event never brings back a subscription that has ended:

- **Deletion leaves a tombstone** (`ended_at`), written even when the deletion
  arrives before the subscription was recorded. No later event changes an ended
  row or its access. A late invoice for a real charge is still paid out.
- **Ending is per subscription.** The membership change, the streaming block
  and the "subscription cancelled" email follow only the first end of the
  buyer's current subscription. A course plan's grant is revoked by its own
  subscription, so ending an old one never touches a new one.
- **`unpaid`, then paid, is not an end.** Paying the open invoice restores
  access, for tiers and course plans alike (owner decision 2026-10-22, "Yes,
  like tiers").
- **The recorded amount is the subscription's price**, never a one-off
  proration invoice; transfers still use each invoice's own amount.

| Event | Effect |
|---|---|
| `checkout.session.completed` | Record the subscription (above) |
| `invoice.payment_succeeded` | Update the period and status; split and pay out the invoice; renewal email on a cycle renewal; clear any streaming block |
| `invoice.payment_failed` | `past_due` (only from `active`: a failed first payment stays `incomplete`); payment-failed email with the next retry date; **access continues**, no streaming block |
| `customer.subscription.updated` | Mirror status, tier, interval, period and price. Stripe `canceled` withdraws access at once; the end (tombstone, cancelled email) is recorded by deletion, or at once for a course plan, which has no email to send |
| `customer.subscription.deleted` | `cancelled` with a tombstone (`ended_at`); on the first end of the buyer's current subscription, access ends, the streaming block is written and the cancelled email goes |
| `customer.subscription.paused` / `resumed` | `paused` with access withdrawn / back to the status Stripe reports; never for an ended row |
| `customer.subscription.trial_will_end` | Email only (no trials are configured) |

Every event for a duplicate settles it (cancel and refund, if not done yet) and does nothing else.

`customer.subscription.created` and `invoice.paid` are not used: creation is
driven by `checkout.session.completed`, and payment by `invoice.payment_succeeded`.

### Renewals

On `invoice.payment_succeeded` the charge is found from the invoice, the
currency is checked to be GBP **before** anything is written — a non-GBP
invoice is rejected (and acknowledged, as a permanent error) with the row
untouched — and the invoice is
split and paid out exactly like a sale ([fees-and-splits.md](fees-and-splits.md#organisation-subscription-invoice)).

### Cancelling, reactivating, resuming

| Route | Effect |
|---|---|
| `POST /subscriptions/cancel` | Cancels at the end of the paid period (`cancel_at_period_end`); status `cancelling`; access continues until then. No streaming block is written — the period is paid for. |
| `POST /subscriptions/reactivate` | Undoes a pending cancellation before the period ends |
| `POST /subscriptions/resume` | Resumes a paused subscription without moving the billing date |

There is no immediate cancellation, except that a full refund ends a
subscription (see [refunds](#refunds)).

When a course is taken off sale because its creator was removed, each live
course subscription to it is set to cancel at period end, with Stripe
idempotency key `course_off_sale_cancel_{id}`. Up to 50 are cancelled at once
and the rest by the hourly ecom-api sweep (see
[agreements](agreements.md#what-comes-off-sale)).

---

## Changing tier

`POST /subscriptions/preview-tier-change` shows the cost of a change (Stripe's
invoice preview); `POST /subscriptions/change-tier` makes it. The proration date
is issued by the server with the preview and checked when the change is made:
it must be at most 10 minutes old and inside the current period (owner decision
2026-10-22, "10 min, then review again"). An older one is refused with
`TIER_CHANGE_PREVIEW_EXPIRED` (409), and the subscriber is shown a fresh
preview to confirm.

- **Upgrade** (higher recurring price): takes effect immediately and the
  prorated difference is charged now. If that payment fails, Stripe keeps the
  old tier and the API returns 402 with a plain message — never Stripe's raw
  error text, which is logged with an errorId instead. The idempotency key includes the
  target price and the proration date; a downgrade's does too.
- **Downgrade** (lower recurring price): takes effect at the **end of the paid
  period**; the subscriber keeps the higher tier until then (owner decision
  P-5, "At period end") — **gap**: `Codex-2hxff.16` (today it is immediate).
- **Switching interval** is classified the same way, by recurring price.

A change made in our UI is the only way to change tier — see
[the billing portal](#billing-portal).

## Price changes

Owner decisions Q4–Q7 and P-6. They apply to **organisation tiers and course
plans alike**.

- Studio is the only place a price is set.
- New subscribers pay the new price straight away.
- Existing subscribers on **that interval** move to the new price at their
  **first renewal at least 30 days after** they are emailed about the change.
  Annual subscribers move at their annual renewal.
- There is no immediate charge and no proration. Increases and decreases are
  treated the same.
- **Notice first, then move** (owner decision D-P3, 2026-10-27,
  `Codex-2hxff.43`): a subscriber's move is scheduled only once the
  notifications worker has accepted their notice. If it isn't accepted
  (refused, skipped, no address, or an unknown outcome), they are not moved
  and support gets an error alert with an errorId and their ids, then retries.
  "No mailer" cannot happen: the services require one in their types
  (`Codex-2hxff.55`). A notified subscriber whose move then fails is alerted
  the same way.
- "Not moved" means today's price, **unless** an earlier accepted change is
  still pending on the subscription: that one still lands, and the alert says
  so.
- A price edited in the Stripe Dashboard is logged as drift and is **not**
  applied to any subscriber.

**How it works.** Studio creates a new Stripe Price for the changed interval
and points the tier (or plan) at it; new checkouts use it at once. Existing
subscribers on that interval are then each handled by `schedulePriceChange`
(`packages/subscription/src/services/pending-price-change.ts`), in batches of
8 after the response, with one notice time for the whole fan-out:

- It reads the live subscription and works out the move and the renewal that
  first bills the new price. It then sends the notice and waits for the answer
  (`sendEmailToWorkerAwaited` in `@codex/worker-utils`). Only a 2xx whose body
  says `success: true` is accepted; anything else writes nothing to the
  subscription.
- The alert names the reason, the tier or plan, the interval, the new Price,
  any earlier pending change, and the subscription, user and organisation ids.
  - It says "not sent" only when that is certain: a 4xx refusal, a skip, or
    no address.
  - A 5xx, a timeout (5 seconds), a transport failure or an unreadable 2xx is
    "outcome unknown": the email may have gone out, so check notifications'
    email audit log before re-sending.
- A Stripe failure is alerted with the same ids, naming the step that failed.
  Every Stripe call in the fan-out gives up after 3 seconds, with no retry.
  - The read fails: "could not read the Stripe subscription; not notified and
    not moved".
  - A same-amount write fails (the silent Price-id switch, or clearing a
    pending change): "same-amount write failed". Nobody is notified, since the
    amount does not change, but an earlier pending change may still land: the
    alert names it, so check the Stripe subscription and clear it if it is
    still there.
  - After an accepted notice: the alert adds the kind (`applied` or
    `pending`), the notice time and the date the email quoted.
    - A definite refusal (a 4xx other than 409 or 429) means the move was not
      made.
    - Anything else (a 5xx, a timeout, a 409 or a 429) is "outcome unknown":
      check the Stripe subscription before retrying.
- **The 30-second limit.** The fan-out runs after the response, on
  `waitUntil`, which Cloudflare cancels 30 seconds after the response. So no
  batch starts after 17 seconds (`PRICE_FAN_OUT_BUDGET_MS`): the last one
  then needs at most a 3-second read, the 5-second notice and a 3-second
  write, so it is done by 28 seconds. A start line (with the total) and an end
  summary bracket each run, for tiers and course plans alike.
- Every subscriber not reached is reported in ONE error alert after the end
  summary, with one errorId on every line ("ran out of time"):
  - first, a line with how many were not reached;
  - then up to 300 of them by id, at most 200 to a line;
  - then, for any beyond 300, "and N more: find them with the Stripe query in
    docs/payments/subscriptions.md". Cloudflare keeps at most 256 KB of logs
    per request, and a tier's monthly and annual fan-outs share one request.
- If their next renewal is already at least 30 days after the email, their
  subscription is switched to the new Price **now** with
  `proration_behavior: 'none'`. A same-interval switch keeps the billing dates
  and charges nothing; the next renewal simply bills the new price.
- Otherwise the new Price is recorded on the Stripe subscription's metadata
  (`codex_pending_price_id`, `codex_pending_price_from` = the email + 30 days).
  Stripe sends `customer.subscription.updated` at every renewal; once the next
  renewal is on or after that date, the switch is made as above.
- Past-due and paused subscribers are only marked pending, and move when they
  are active again. A subscriber already paying the new amount is not emailed.
- The other interval's subscribers are never touched: switching a monthly
  subscription onto an annual Price would reset its cycle and bill a year.
- A second change before the first has landed **replaces** it (owner decision
  2026-10-13, "Latest wins"): one move, to the newest price, at the first
  renewal at least 30 days after the newest email.
- A tier change clears a pending price change; cancelling and reactivating
  keep it.
- The notice (`subscription-tier-price-change`) gives the date of the renewal
  that first bills the new price. The "from" figure is what that subscriber is
  billed today, not the previous list price: a tier quotes the subscription's
  own snapshot, a course plan its live Stripe item (`Codex-2hxff.40`).
- A Price created in the Stripe Dashboard is logged as drift
  (`TierService.recordStripePriceDrift`); the tier keeps its own Price and no
  subscriber moves.

### Held and unreached subscribers

The alerts are log lines, and Workers Logs keeps them for about 7 days. After
that, Stripe is the record. No marker is written for a held subscriber, so the
only way to find one is to compare each subscription with what it should be on.

A subscriber on the repriced interval needs a move when **all** of these hold:

- the item's Price is not the tier's (or plan's) current Price for that
  interval;
- `metadata.codex_pending_price_id` is absent, or names a different Price
  (an earlier change that was superseded);
- the item's `unit_amount` differs from the current price. A same amount needs
  only the silent Price-id switch.

To list them:

1. Read the current Price ids and amounts from our database:
   - tiers: `subscription_tiers.stripe_price_monthly_id` /
     `stripe_price_annual_id`, with `price_monthly` / `price_annual`;
   - course plans: the same columns on `course_subscription_plans`.
2. List the subscriptions in Stripe with Search. Tier subscriptions carry
   `codex_tier_id` and course subscriptions `codex_plan_id`:
   - `metadata['codex_tier_id']:'<tier id>' AND -status:'canceled' AND -status:'unpaid' AND -status:'incomplete_expired' AND -status:'incomplete'`
   - `metadata['codex_plan_id']:'<plan id>' AND -status:'canceled' AND -status:'unpaid' AND -status:'incomplete_expired' AND -status:'incomplete'`

   These are the subscriptions the fan-out moves. It selects our rows that are
   `active`, `cancelling`, `past_due` or `paused`; Stripe's `canceled`,
   `unpaid` and `incomplete_expired` are `cancelled` in our database, and
   `incomplete` is `incomplete` (`resolveStatus`, stripe-status-mapper.ts).
3. Keep the ones on the interval (`items.data[0].price.recurring.interval`)
   that meet the three conditions above.

The list also includes anyone who opened checkout on the old Price and paid
after the change. The fan-out never saw them, since their subscription did not
exist yet. They need a notice and a move too, but they are neither held nor
unreached, so no alert names them.

The metadata keys are the ones `pending-price-change.ts` writes:
`codex_pending_price_id` and `codex_pending_price_from` (unix seconds). A
subscription with no `codex_pending_price_*` keys is not necessarily held: one
moved "now" carries none either, but it is already on the current Price.

**A retry needs an engineer today.** Propagation runs only when Studio creates
a new Price (`TierService.updateTier`, tier-service.ts:647; the same in
`savePlanPrices`), so re-saving the same price retries nothing. There is also no
supported way to re-send one subscriber's notice. The fixes are filed:

- `Codex-2hxff.85`: a support tool that re-sends the notice and moves one
  subscription.
- `Codex-2hxff.86`: move the fan-out off `waitUntil`, so the 30-second limit
  no longer applies.

The mechanism is this deferred switch, not Stripe subscription schedules (owner
decision 2026-10-13): schedules would have had to take over cancel, reactivate
and tier change. Scheduled downgrades (`Codex-2hxff.16`) will still need them.

## Failed payments

Owner decision P-3, "After retries fail".

- A failed renewal makes the subscription `past_due`. The subscriber **keeps
  access** while Stripe retries the card on the retry schedule set in the Stripe
  Dashboard, sees the existing "update your card" banner, and is emailed.
- When the retries are exhausted, Stripe cancels the subscription and access
  ends. An `unpaid` status is treated the same way.
- This relies on the Stripe Dashboard: "If all retries for a payment fail"
  must be set to **cancel the subscription** (or mark it unpaid). If Stripe
  leaves it past-due, access never ends — see
  [operations.md](operations.md#stripe-dashboard-settings).

## Refunds

Owner decision P-4, "Cancel + end access".

- A **full** refund of the payment for the **current billing period** cancels
  the subscription immediately and ends access.
- A **partial** refund leaves the subscription running.
- A full refund of an **earlier** period's payment, or of a payment that
  bought no period (an upgrade's proration invoice), leaves it running too
  (owner decision 2026-10-20, "Current period's payment").
- Either way, the creator and organisation slices are reversed in proportion,
  exactly as for one-off purchases ([purchases.md](purchases.md#refunds)). A
  shortfall on the payee's balance goes to `refund_reviews`, which holds
  subscription debts as well as purchase ones (one row per reversal).
- The order of Stripe's events does not change that. A refund handled before
  its invoice's payout reverses nothing then, and is clawed back as soon as
  the invoice's slices are recorded, so the payees net the same either way
  (`Codex-2hxff.67`).

The current period's payment is the newest **paid** invoice Stripe raised to
buy a period (`billing_reason` `subscription_create` or `subscription_cycle`),
compared with the invoice the refunded charge paid. Stripe's `latest_invoice`
is not used: after an upgrade it is the proration invoice, and while a renewal
is retried it is the unpaid one. The cancel is applied here at once, as for
`customer.subscription.deleted` (which re-applies it when it lands). Tier and
course subscriptions are handled alike, except for the streaming block: a
tier subscription's is written, while a course plan's grant is revoked
instead, as on deletion — the org-wide block would also stop the subscriber's
purchases and tier content (owner decision 2026-10-20).

If the cancel fails, the webhook raises an alert with an `errorId` (check the
subscription at Stripe and the subscriber's access by hand) and Stripe
redelivers the event when the failure is transient.

Known limit: a full refund that later **fails** has still cancelled the
subscription; the customer subscribes again, and support settles the failed
refund as for a purchase (the failed-refund alert says so).

## Disputes

A disputed subscription invoice follows the dispute rules for purchases
([purchases.md](purchases.md#disputes)), and the money is handled the same way
(the clawback acts on both sources). The subscription itself
([subscription-disputes.md](subscription-disputes.md), owner decisions Q-A and
Q-B):

- **Chargeback opened:** access is paused (`disputed_at`, which every granting
  query reads; for a course subscription, its stored grant) and so is billing
  (`pause_collection` set to `void`), so no renewal is charged while access is
  paused.
- **Won:** access and billing are restored, unless another chargeback on the
  same subscription is still open.
- **Lost:** the subscription is cancelled at Stripe at once, with no proration;
  `customer.subscription.deleted` then ends it here and sends the usual
  cancellation email.
- **Inquiry:** nothing changes for the subscriber.

The subscriber is told why access is paused (`Codex-2hxff.60`): the content
page says "Access paused" with no Buy button, and the account page shows a
"Paused: payment dispute" badge and hides Change Plan. A course lesson paused
by a dispute shows the same notice (owner decision 2026-10-24, "Notice for
courses too"). The detail is in [subscription disputes](subscription-disputes.md).

## Billing portal

The Stripe Billing Portal (`POST /checkout/portal-session`) is for updating
payment methods and viewing invoices only. Every portal session passes an
explicit configuration with cancelling, plan switching and pausing turned off,
so our database and Stripe can never disagree about a subscription. The id comes
from `STRIPE_PORTAL_CONFIGURATION_ID`; without it the portal **refuses to open**
(`STRIPE_NOT_CONFIGURED`) rather than fall back to the account's default
configuration, which allows cancelling.

---

## Emails

| Template | When |
|---|---|
| `subscription-created` | The subscription is recorded |
| `subscription-renewed` | A cycle renewal is paid |
| `payment-failed` | A renewal fails (with the next retry date) |
| `subscription-tier-price-change` | A price changes — sent at least 30 days before the new price applies, and before the move is scheduled: no accepted notice, no move (`Codex-2hxff.43`). Says the subscription "renews at the new price from {{effectiveDate}}"; migration `0098` rewrote the old "on the next billing cycle" sentence on existing rows (`Codex-2hxff.35`) |
| `subscription-cancelled` | The subscription ends |
| `course-no-longer-offered` | A course subscription is cancelled because the course was taken off sale; gives the date access ends |
| `trial-ending-soon` | A trial is about to end (no trials are configured today) |
