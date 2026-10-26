# One-off purchases

Buying a single piece of content or a course outright. Subscriptions are in
[subscriptions.md](subscriptions.md); how a sale is divided is in
[fees-and-splits.md](fees-and-splits.md).

A **gap** marker means the code does not behave this way yet; see
[status.md](status.md).

---

## What can be bought

**Content** can be bought when all of these hold:

- it is published and not deleted;
- it is marked purchasable and has a price of at least £1.00. Validation
  refuses 1p–99p on every price (`PRICE_LIMITS` in `@codex/constants`), and
  checkout refuses an older row priced below £1.00 before it reaches Stripe;
- its access rule honours a purchase. Content that is course-only, team-only
  or followers-only is not sold on its own, nor is orgless content with a tier
  (the access decision denies it to everyone). Checkout refuses these with
  `not_sold_separately`, and the content page shows no Buy: a priced
  course-only item shows a "Part of a course" note instead, like the "Team
  Only" note (owner decisions 2026-10-21/22, `Codex-2hxff.14`).

One rule decides this, `canBeSold` in `@codex/constants`, beside
`isGrantableContent`. Checkout and the content page both read it, and an
`@codex/access` test ties it to the access decision.

**A course** can be bought when it is published and has a price of at least £1.00.

Publishing a priced item requires its creator's payouts to be set up (a
payable Connect account): any price or tier inclusion, whether or not the
content is marked purchasable, and courses too (owner decision 2026-10-22,
"Yes, same rule"). The rule is `requiresPayoutsToPublish`, and the refusal is
the Studio's existing "set up payouts" message. It is checked when content is
published, when a published item is given a price or a tier, by the admin
publish route, and when a course is published.

A buyer who already owns the item cannot start a second checkout for it.
Owning is a completed purchase, or, for a course, a live purchase or support
grant entitlement. A course plan subscriber rents the course, so they may
still buy it outright.

## Checkout

| Route | Product | Policy |
|---|---|---|
| `POST /checkout/create` | Content | `auth: 'required'`, rate limit `strict` |
| `POST /checkout/course` | Course | `auth: 'required'`, rate limit `strict` |

1. The buyer's single Stripe Customer is found or created
   (`resolve-customer.ts`): the cached `users.stripe_customer_id`, otherwise a
   Customer created with `metadata.codex_user_id` under the key
   `codex:resolve-customer:${userId}`. If Stripe reports the cached Customer
   missing, the id is cleared and resolution runs once more. A Customer tagged
   by another environment is never adopted (untagged ones, from before tagging,
   still can be). A Customer is never adopted from another user: a match by
   email is skipped when it is tagged with another `codex_user_id`, or when
   another users row holds it (a deleted user's included), and a new one is
   created instead. After a stale Customer, the new one is created under
   `codex:resolve-customer:${userId}:after:${staleId}`, so Stripe cannot replay
   the stale one.
2. A Checkout Session is created:
   - `mode: 'payment'`, card payments;
   - one line item with inline `price_data` — currency `gbp`, `unit_amount`
     from our database, product name, description and image;
   - metadata: the content id (or `kind: 'course'` and the course id), the buyer
     id, the organisation id (left out for orgless content), the creator id, the
     title, and `codex_env`; `payment_intent_data.metadata` carries `codex_env`
     too, and Stripe snapshots it onto the Charge, so refund and dispute events
     are tagged;
   - an expiry 30 minutes after it is made (owner decision 2026-10-21, "30
     minutes"). Stripe refuses an `expires_at` under 30 minutes after its own
     creation time, so 31 is sent;
   - an idempotency key per reservation (below) and Stripe Customer.
3. Success and cancel URLs must be on an allow-listed host
   (`checkoutRedirectUrlSchema`).

### One checkout at a time

A buyer has at most one open checkout per item (owner decision 2026-10-21,
"Block, then refund"). A second tab or a double click gets the first tab's
Stripe page back, so only one of them can take payment.

- Before calling Stripe, checkout reserves a `checkout_sessions` row for the
  buyer and item, under an advisory lock. A partial unique index on `open`
  rows backs the lock.
- An open row is reused when it was made at today's price and has at least 5
  minutes left. Otherwise it is marked `expired`, its Stripe session is
  expired too, and a new row is reserved. Expiring the old session is best
  effort: if it was paid meanwhile, that payment completes, and a payment on
  the new session is refunded as a duplicate.
- The row stores the expiry, and the key is `checkout_<row id>_<customer>`.
  Two callers on one row therefore send identical parameters under one key,
  and Stripe returns the same session to both. An idempotency key alone could
  not do this: Stripe compares a reused key's parameters, errors when they
  differ (a price change), and forgets keys after 24 hours.
- A Stripe failure frees the row, so the next attempt starts afresh rather
  than replaying the stored failure.
- A 409, or an idempotency error, means another caller (the other tab of a
  double click) is creating that very session. It returns the idempotency
  error when its parameters differ: the content page and the preview player
  send different cancel URLs. This caller waits up to about 3 seconds for the
  other's session and returns it; failing that, the buyer is asked to try
  again in a moment (409).
- A row still without a session after a minute is replaced, not reused: its
  creator failed, and its stored expiry is now under Stripe's floor.
- The booking webhook marks the paid row `completed`. An abandoned row stays
  `open` until the buyer next checks out for the item, and is expired then.
  Nothing sweeps them.

No `transfer_data`, `application_fee_amount` or `on_behalf_of` is passed — the
charge stays on the platform account (see
[how money moves](README.md#how-money-moves)).

## Completing the purchase

Two callers complete a purchase, and both run the same function,
`completeCheckoutSession`:

- **The webhook.** Stripe sends `checkout.session.completed` to
  `/webhooks/stripe/booking`.
- **The success page, the moment the buyer lands** (owner decision
  2026-10-26, "Unlock on arrival"; Stripe's
  [landing-page fulfilment](https://docs.stripe.com/checkout/fulfillment)).
  It calls `POST /checkout/complete`, for content and course purchases alike.
  - The route needs a session and uses the `strict` rate limit.
  - It reads the Checkout Session from Stripe itself and acts only on the
    signed-in buyer's own session in this environment. Another buyer's
    session gets 403; another environment's gets 404.

The webhook stays the backstop. Whichever caller comes second finds the work
done (see [a second payment](#a-second-payment-for-an-owned-item) for the
guards).

1. On the webhook path, the signature is checked against
   `STRIPE_WEBHOOK_SECRET_BOOKING`.
2. Both paths skip the session when:
   - the session is not `mode: 'payment'` (subscription checkouts belong to the
     subscription handler);
   - the session carries another environment's tag (checked for every webhook
     before any handler runs — see
     [operations](operations.md#environments-and-stripe-accounts));
   - `payment_status` is not `paid` (owner decision, `Codex-2hxff.14`).
     Checkout is card-only, and a card session is always `paid` by the time
     it completes. A delayed method (a bank debit) would complete `unpaid`
     and be paid on `checkout.session.async_payment_succeeded`, which nothing
     handles yet: adding such a method means handling that event first.

   The page writes nothing for a skipped session. It reports the session's
   state instead.
3. The charge id is read from the PaymentIntent (`latest_charge`). If that
   lookup fails **temporarily** — an outage, or a Stripe key or permission
   misconfiguration — the webhook returns 500 so Stripe retries
   rather than complete the purchase without it. If it fails permanently (the
   PaymentIntent cannot be read at all), the purchase still completes — the
   buyer has paid — and the unpaid slices are logged as an error for support,
   since no slice can be paid without its charge.
4. In one database transaction:
   - a `purchases` row is inserted with status `completed` and the split
     snapshot (platform, organisation and creator amounts that must sum to the
     amount paid). The unique `stripe_payment_intent_id` makes a redelivered
     event a no-op. The creator's agreement is looked up as it stood when
     the checkout session was **created** (`session.created`, passed as
     `offerAt`), not when the webhook arrives. A buyer who started checkout
     before a creator was removed still completes at the old split (owner
     decision, `Codex-2hxff.64`). `purchasedAt` is still the payment time: the
     event's `created` on the webhook path, and the charge's `created` on the
     page path;
   - an entitlement is written — `content_purchase`, or `course_purchase` plus
     course enrolment — for organisation **and** orgless sales. An orgless
     sale's entitlement has no organisation.
5. After the transaction the split is paid out (see
   [the payouts ledger](connect-and-payouts.md#the-payouts-ledger)). A
   redelivered event re-records the purchase's slices from its stored split:
   the ledger skips those already recorded, so only a missing one is added —
   and none for a purchase refunded in full or disputed since. A partly
   refunded purchase is re-recorded, and its refund is then clawed back from
   the added slices (`Codex-2hxff.68`):
   - a `platform_fee` row, recorded as paid;
   - the creator slice — a transfer to the creator's Connect account with key
     `${chargeId}_creator`;
   - the organisation slice — a transfer to the organisation owner's Connect
     account with key `${chargeId}_org_fee`;
   - a payee who is not payable yet gets a **pending** row instead, drained
     later; an organisation with no owner gets a pending `no_owner` row for
     its next owner. A transfer that fails gets a **failed** row that keeps its
     charge id and is retried.
6. Then, without holding up the response: the buyer's library version is
   bumped, and a receipt email is sent once per purchase, not once per webhook
   delivery (owner decision 2026-10-25, "One receipt per purchase";
   `Codex-mat01`). The first completion to find the purchase completed claims
   `purchases.receipt_sent_at` and sends the receipt. That can be a webhook
   delivery or the success page. A later one finds it claimed and sends
   nothing. A purchase refunded in full before its checkout is recorded
   gets none, and a claim that fails transiently returns 500 so Stripe
   redelivers. A creator whose slice went pending is emailed to finish payouts
   setup — **gap**: `Codex-2hxff.7`.

**Errors.** A transient failure (database connection, Stripe outage) returns
500 and Stripe retries. A failure writing the slices after the purchase has
committed is logged as exactly that, with an errorId; a transient one returns
500 and the redelivery re-records the missing slices. On the page path, a
failure after the commit never reaches the buyer as an error. The purchase is
recorded, the page unlocks it, and the webhook finishes what is left.

### A second payment for an owned item

One open checkout per item makes this rare. It can still happen: a session
opened before this rule, an old tab paid after its replacement, or two
sessions paid at once. The buyer keeps one purchase and the other payment is
refunded in full, automatically (owner decision 2026-10-21, "Block, then
refund").

- **At most one completed purchase per buyer and item**, enforced by partial
  unique indexes on `purchases` (`status = 'completed'`, one for content, one
  for courses). Refunded and failed rows don't count, so a buyer can buy
  again after a refund. Migration 0006 once added a full unique index there,
  and 0007 dropped it for exactly that case.
- **Completion** takes an advisory lock per buyer and item, then looks for a
  completed purchase. (It first looks again for its own PaymentIntent, in case
  a concurrent delivery of the same event, or the success page, wrote it
  meanwhile.) If one exists,
  the new row is a **duplicate**: `duplicate_of_purchase_id` names the purchase
  it repeats. It writes no access row, no entitlement and no payout slice, and
  is not a sale: Sales and its totals leave it out. Its split columns keep what
  the sale would have paid.
- **Its status tells the truth about the money.** A duplicate is written
  `pending` and becomes `refunded` only once Stripe has refunded it, so no
  reader shows money as returned that is not.
- **After the commit**, `issueRefund` (`@codex/payments`, the platform's one
  refund call) refunds the charge in full under
  `refund_duplicate_<PaymentIntent>`. A redelivered event asks again under the
  same key, unless the duplicate is already `refunded`, and
  `charge_already_refunded` counts as done.
- **If Stripe refuses the refund**, the row stays `pending` and the failure is
  logged ("Duplicate payment could not be refunded", with Stripe's `code`). It
  is thrown as retryable whatever the cause, so Stripe redelivers the event
  through its retry window: a refusal such as a low platform balance can clear.
  One that never clears, such as a charge the buyer has disputed, ends with
  the dispute or is held for support (owner decision: a failed refund is held
  for support). Support finds them with `duplicate_of_purchase_id IS NOT NULL
  AND status = 'pending'`.
- **No receipt** is sent for it. Its `charge.refunded` sends the usual refund
  email, naming the item: "You still have {item}. This refunds a second
  payment for it." Every refund email now names the purchase's own item; it
  used to say "Content", because charges carry no title.
- **A refund or dispute of one purchase spares another.** `content_access`
  holds one row per buyer and item, shared by every purchase of it. A refund,
  a dispute or a lost dispute revokes it only when no other completed purchase
  of the item remains. In that case the webhook also writes no org-wide
  streaming block: a buyer who disputes the duplicate charge keeps streaming
  everything they own. Before this, a dispute on an old refunded purchase
  locked a buyer out of the copy they had bought again. Each purchase's own
  entitlement is revoked as before.
- **Self-heal.** When `charge.refunded` arrives before
  `checkout.session.completed` for an item the buyer already owns, the row is
  rebuilt as a duplicate, under the same lock, not as a second completed
  purchase.

**Deploying and rolling back migration 0109.** Its partial unique indexes
assume the new completion code: older code would hit them with a second
payment and drop it, since a unique violation is answered as permanent.
Production held 0 duplicate completed purchases when it was written. To roll
the code back, also run `DROP INDEX uq_purchases_completed_customer_content,
uq_purchases_completed_customer_course;`. The `checkout_sessions` table and
the new column can stay.

## After payment

The buyer lands on a page that confirms against **our** record, not just
Stripe's:

| Return path | What the page does |
|---|---|
| Content: `/checkout/success?session_id=…` (organisation and creator subdomains) | Records the purchase at once (`POST /checkout/complete`), then reads our row via `GET /checkout/verify` |
| Content bought from the player paywall | The same page: the default `successUrl` is `/checkout/success?session_id={CHECKOUT_SESSION_ID}` |
| Course or journey: `…/checkout/success?kind=…` | Records the purchase at once, the same way, then waits for the course entitlement and our row for this session, and redirects to the course |
| Subscription: `/subscription/success` | Waits for our subscription row, which the subscription webhook writes |

Stripe holds the redirect for up to 10 seconds while our webhook answers, so
the purchase is usually recorded before the buyer arrives.
- **While the page records it,** it shows "Payment received ✓ · Unlocking
  your content…", then Start watching.
- **When our record is late,** the page checks again a few times and then
  stops (owner decision 2026-10-26, "Capped, then a button"):
  - about 6 checks over the first minute, at roughly 2, 5, 10, 20, 40 and
    60 seconds, and only while the tab is visible;
  - then it says "Your payment went through. We're still finishing up; check
    again in a minute.", with Check again (one check per click) and Go to
    library.
  - **The page never polls open-endedly**, because every check is a billed
    request. This rule covers the content, course and subscription pages.
- **No email is promised or sent** beyond the one receipt per purchase.
- **A purchase that is no longer active,** refunded or paused by a bank
  dispute, gets one plain notice: "This purchase is no longer active.", with
  See your payment history. The page stops checking.
- **After success** the page refreshes the library collection, and the
  subscription page refreshes the subscription collection.

**A second payment is never confirmed** (Codex-o4jvw; owner decision
2026-10-22, "Say it plainly"). When our row for the session is a duplicate,
the page shows a calm notice instead and keeps the way to the item:

- **Purchase** (content or course): "You already own {item}". "This second
  payment is being refunded in full. You don't need to do anything." Button:
  "Go to {item}".
- **Organisation tier**: "You're already subscribed to {org} ({kept tier})".
  "We've cancelled the second subscription and are refunding it." When the
  duplicate was for another tier: "Want {tier} instead? Use Change plan.",
  linking to `/pricing`. Buttons: "Go to {org}" (and Change plan).
- **Course plan**: "You're already subscribed to {course}", the same body,
  "Go to {course}".

The verify reads say so from the data: `duplicatePayment` on
`GET /checkout/verify` (`duplicate_of_purchase_id`), and `duplicateOf`, the
subscription the user keeps, on `GET /subscriptions/verify` and
`GET /checkout/course-subscription/verify`. A buyer who already held a course
is entitled before this payment's row exists, so the journey page, told the
path by `kind` on its success URL, waits for that row before forwarding.
Without `kind` (a session opened before it), it forwards on the entitlement
alone.

## Purchase history and sales

- `GET /purchases` lists the buyer's content **and** course purchases, paginated
  with `withPagination`; the total counts both. Each item says its `kind`
  (`content` or `course`) and carries that item's id and title; the other pair
  is `null`.
- `GET /purchases/:id` returns 404 for someone else's purchase.
- `GET /checkout/verify` only reveals a session to the buyer who started it,
  and `POST /checkout/complete` acts only on the signed-in buyer's own
  session, in this environment.
- `GET /sales` and `GET /sales/stats` show an organisation's content sales to
  its owner and admins.
- `GET /sales/me` and `GET /sales/me/stats` show a creator their own orgless
  sales: purchases with no organisation, of content they created. They need
  only a session. The rows, filters and totals are the same as `/sales`, and
  the creator sees the buyer's name and email, as an organisation owner does.
  An organisation's sale of the same creator's content is on the
  organisation's ledger, not this one.

---

## Refunds

Refunds are issued by **platform support only** — never by creators, and never
self-served by customers (owner decision 2026-10-13, "Platform support") — from
an admin screen that calls Stripe and then lets the `charge.refunded` webhook do
the rest, so there is one refund path: the Refunds screen in the platform
admin (`(platform)/admin/refunds`, `Codex-2hxff.28`). Support can refund up to **14 days**
after the purchase (owner decision 2026-10-13, "14 days"): 14 × 24 hours from
Stripe's `charge.created`, for a purchase and a subscription invoice alike, so a
renewal's window runs from that renewal (owner decision 2026-10-24, Q1). The
rule is `refundWindow` in `@codex/payments` (`REFUND_WINDOW_DAYS`), checked on
the server's clock before Stripe is called. Only support's screen enforces it:
Dashboard refunds and the platform's own refunds (duplicates, the early-fraud
refund) are not support decisions. `issueRefund` refunds in part or in full;
the screen previews what a refund will take from each slice with the engine's
own rules (`planClawback`), so the preview and the clawback cannot disagree.
The customer-facing refund policy is being drafted for legal review —
`Codex-2hxff.31`.

Stripe sends `charge.refunded` to `/webhooks/stripe/payment`. The clawback
reads the charge's **settled** refunds (succeeded or failed) from Stripe, not
the event's cumulative `amount_refunded`. It records what each refund did to
each slice, one `payout_reversals` row per slice per refund
([design](refund-reversal-record.md)), so a second partial refund claws back
its own share and a redelivery does only what is left. A refund still pending
at Stripe is clawed back once `refund.updated` reports it settled (owner
decision 2026-10-19).

**A refund that fails** (owner decision 2026-10-19, "Hold it for support"). A
refund can fail even after it succeeded, up to 30 days later. Stripe returns
the money to the platform balance, but the customer must still be refunded
some other way. So the clawback stands, and the failure is recorded in
`refunds` (support's queue is its failed rows) and logged with an `errorId`.
Support then settles it one of two ways (owner decisions 2026-10-24, Q5):

- **refunded elsewhere**: the customer was refunded another way, so the
  clawback stands and the row is just resolved;
- **creators re-paid**: the customer is not refunded, so the payees get back
  what the refund took (`repayFailedRefund`, `@codex/payments`). Each step of
  its clawback that took money from a payee, on a slice or on a re-pay row,
  gets one pending re-pay row for its amount, as a won dispute's does
  ([dispute record](dispute-record.md#the-re-pay-a-new-pending-payout-row-per-reversed-slice)).
  The refund then leaves the charge's running refund total, so a refund or
  chargeback clawed back AFTER the settlement is shared as if it had never
  been made, and takes its share off the re-pay rows. That is not
  retroactive: a cause recorded while the failed refund still counted keeps
  the share it got then. Four rules (owner decisions 2026-10-24, 2026-10-25):
  1. **A later cause shared against it refuses the re-pay**
     (`REPAY_BLOCKED_BY_LATER_CAUSE`, 422): a chargeback open or lost on the
     charge, or a refund after it that takes the running total over the
     charge. That cause took less because the failed refund counted, so
     re-paying would overpay the payees. Support settles it by hand or marks
     it refunded elsewhere (`failedRefundRepayBlock`). Both checks run again
     inside the settlement's transaction, from the recorded refunds and
     disputes, because either can be recorded after the first check. What is
     left is a refund or chargeback recorded after that read whose clawback
     runs before the settlement commits: for that moment, under a second, it
     still counts the failed refund. That is two people acting on one charge
     within the same second, the race the refund route already accepts (two
     refunds of one charge in the same second both pass its refund-count
     check).
  2. **A step that can never move money is cancelled, by the settlement.**
     - **Never claimed.** It never reached Stripe.
     - **No retry will run it.** Its delivery died, or Stripe refused it on
       every try. It is checked with Stripe before the settlement's
       transaction opens (`settleUnfinishedRefundSteps`). If Stripe made its
       reversal, it is recorded `done`, and so re-paid, since that is true
       whatever support decides. If not, the settlement cancels it inside its
       transaction, only if the step has not moved since the check. So a
       refused settlement leaves it for a redelivery to finish, and a step a
       redelivery tried again meanwhile is not cancelled unchecked.
     - **Still running.** A step still retrying, held by a delivery right
       now, or moved since the check may yet reach Stripe, so the settlement is
       refused (`REFUND_CLAWBACK_UNFINISHED`): the clawback is still running,
       and support tries again later.
     - **Needs a person.** An unfinished cancellation whose slice is already
       cancelled is one the ledger cannot read, because it cannot tell
       whether that step took the slice. It refuses with
       `REFUND_CLAWBACK_NEEDS_PERSON`, since retrying will not help. **Gap:**
       there is no tool yet for a person to settle it.
     - **Nothing starts after the settlement.** A clawback step cannot start
       once the refund is settled, because its claim reads the refund under a
       lock.
  3. **A debt the payee already paid** (`creator_absorbed`,
     `manually_reversed`) gets a re-pay row too; one the platform wrote off
     (`platform_absorbed`) gets nothing. The refund's open debts close as
     `refund_failed`. A debt with no payee to owe it is cancelled.
  4. **The platform fee's share is cancelled** and the fee slice is `paid`
     again, with no re-pay row: the money is back in the platform's balance.

A purchase it refunded in part stops counting it: `refund.updated` restates
the purchase's refunded amount, id and reason from the refunds still standing
(`restateStandingRefunds`, owner decision 2026-10-24), so Sales and its stats
count only money the buyer got back. A failed full refund keeps the purchase
`refunded` until support settles it.

Support settles a failed refund on the same Refunds screen (`Codex-2hxff.28`). A
`canceled` refund paid nothing out and is never clawed back. A purchase it
refunded in part stops counting it, restated as for a failed refund (owner
decision 2026-10-25, "same as failed"); one it refunded in full stays
refunded, so it is logged for a person to check the buyer's access.

**A full refund** (the whole charge refunded):

- the purchase becomes `refunded` and access ends: the entitlement is revoked,
  so no new stream link is issued. A link already issued plays to its expiry
  (up to 10 minutes), as for every access cut
  ([access.md](access.md#streaming-revocation); owner decision 2026-10-23,
  `Codex-2hxff.61`);
- every paid creator and organisation slice is reversed in full;
- every pending or failed slice becomes `cancelled_by_refund` — first, so
  nothing can mark it paid afterwards. Its transfer may have gone out anyway
  (in flight when the refund came, or made but never recorded), so Stripe is
  then asked; a transfer found is reversed in full and the slice becomes
  `reversed`. A transfer that lands after the cancel is reversed by whoever
  sent it ([the ledger](connect-and-payouts.md#the-payouts-ledger)). Both the
  refund and the sender may find it; Stripe refuses whichever full reversal
  comes second, and that side, seeing the transfer `reversed`, treats it as
  done. Either way the slice ends `reversed`, recording the transfer
  (`Codex-pqsfg`).
- an organisation slice held for no owner is cancelled the same way, and is
  never handed to the next owner.

**A partial refund** (owner decision P-1, "Keep access"):

- the buyer **keeps** access;
- each paid creator and organisation slice is reversed by the same fraction as
  the refund, rounded down. Each refund takes what it adds to the cumulative
  fraction, so refunds that add up to the whole charge reverse each slice's
  gross exactly;
- each pending slice is reduced by the same fraction before it is paid (the
  drain pays its amount less its reductions);
- the platform absorbs its own fee's share of the refund and the rounding.

The purchase stays `completed`, with the amount refunded so far; the refund
that completes the charge makes it `refunded` and ends access. Whether a refund
is full is read from the charge's cumulative `amount_refunded`.

**Reversals.** Each reversal uses the key
`${transferId}_reversal_${refundId}_${attempt}`. The attempt advances only
after Stripe refuses a request, because Stripe replays a stored error for its
key for 24 hours. After an outcome Stripe did not confirm, the same key is
retried, which is what prevents a double reversal.

**The record.** Each refund is a `refunds` row (one per Stripe refund, any
source) with its amount, reason and Stripe status, which only moves forward
(owner decision 2026-10-19, "One refunds table"). `charge.refunded` lists the
charge's refunds from Stripe and records them all; `refund.updated` and
`refund.failed` record each change. The purchase keeps the amount refunded so
far and the newest refund's id and reason.

- If the payee's Connect balance is too low (`insufficient_funds` or
  `balance_insufficient`), a `refund_reviews` row is written recording the
  debt, one per reversal, for purchases and subscriptions alike. This is the chosen policy — reverse on refund, with a debt
  ledger as the fallback (`Codex-13v21`). The debt is **recovered from the
  payee's future earnings** (owner decision 2026-10-13, "From future earnings") —
  **gap**: `Codex-2hxff.30`. Because payouts are held for the 14-day refund window
  ([payout timing](connect-and-payouts.md#payout-timing)), a refund normally finds
  the money still in the payee's Stripe balance; debts mostly come from disputes,
  which can arrive later. Refund reviews need an operations screen — **gap**:
  `Codex-2hxff.73` (no reader today).
- Any other reversal failure is retried, and nothing is marked done until it
  succeeds. A database or Stripe outage makes the webhook return 500, so Stripe
  redelivers. A request Stripe refused is retried by the hourly cron with the
  next attempt's key; after 5 attempts it is left for a person. A slice is
  marked `reversed` once its reversals add up to its whole amount.

Stripe does not return its processing fee on a refund; the platform bears it.

**A refund that arrives before the purchase it belongs to** (`charge.refunded`
before `checkout.session.completed`), for content or a course
(`Codex-2hxff.68`):

- The purchase is rebuilt from its Stripe checkout session, as completion would
  write it: the real split (the configured fees, and the creator's agreement as
  it stood when the session was created), dated at the charge's payment time.
  A session in any currency but GBP is refused first, as completion refuses it
  (PAY-25), and nothing is written. No slice is written yet.
- **A full refund**: the purchase is rebuilt already `refunded`, with the
  refund, in one transaction, and access is never granted. When its
  `checkout.session.completed` arrives, it records nothing more, so no one is
  paid.
- **A partial refund**: the purchase is rebuilt `completed` with its access
  grant, then the refund is recorded on it, and the buyer keeps access (P-1).
  When `checkout.session.completed` arrives, the slices are recorded from the
  stored split and the refund is clawed back from them at once, so each payee
  nets what the same refund after the payout would leave.
- A redelivery of either event moves no more money.

A refund processed after the purchase exists but before its payouts are
recorded is applied the moment they are, through the same reversal as a later
refund, so the net is the same whichever comes first (`Codex-2hxff.67`).

**The refund email.** Each refund is emailed to the buyer once, with that
refund's amount (owner decision 2026-10-19, "One per refund"). The refund's row
is marked emailed (`notified_at`) before the email is sent, so a redelivered
event sends nothing, and an email that then fails to send is not retried. For a
purchase it says whether the buyer keeps access; for a subscription's charge it
says neither. A failed or canceled refund is never emailed, and one waiting on
the customer is emailed once it succeeds.

## Disputes

A dispute (chargeback) is raised by the buyer's bank. Under separate charges and
transfers the platform is liable to Stripe; owner decision P-2 ("Creators share
it") says the creators and organisation share the cost in proportion.

Stripe sends `charge.dispute.created`, `.updated` and `.closed` to
`/webhooks/stripe/dispute`.

| Dispute | Access | Money |
|---|---|---|
| **Opened** | Paused: the purchase is marked disputed and the streaming block is written. The library hides the item. | Paid creator and organisation slices are reversed in proportion to the disputed amount. Pending slices are held and not drained. |
| **Won** | Restored: the disputed mark is cleared. | The reversed slices are paid again; held slices are released. |
| **Lost** | Ends for good. | The reversals stand; held slices are cancelled. |

The platform pays Stripe's dispute fee.

**Early fraud warnings.** When the card issuer reports a charge as likely fraud
(`radar.early_fraud_warning.created`), the charge is **refunded in full
automatically** (owner decision 2026-10-13, "Refund automatically"). That usually
heads off a dispute and its fee. Access ends and the creator and organisation
slices are clawed back, as for any full refund — **gap**: `Codex-2hxff.9` (today
the warning is only logged).

A lost dispute does not produce a `charge.refunded` event, so dispute
handling never relies on one.

The same rules apply to course purchases and to disputed subscription invoices
([subscriptions.md](subscriptions.md#disputes)).

**How it is recorded** ([design](dispute-record.md)). Each dispute is a
`disputes` row, one per Stripe dispute, whose status moves forward only; every
dispute event records it, then acts on the status the record has.

- **A chargeback** is a clawback cause on the charge, with the same records,
  keys, retries and debts as a refund, and its own Stripe key
  `${transferId}_reversal_${disputeId}_${attempt}`. A dispute on a partly
  refunded charge takes only what the refunds left.
- **The hold.** The drain skips a slice whose sale has an open dispute or an
  open inquiry (owner decision Q1: an inquiry takes no money, so the buyer
  keeps access and only the payouts wait).
- **Won.** Each reversed slice is paid back by a new pending payout row that
  the next sweep pays (Q2), linked to its reversal so it is paid once. The
  access the chargeback paused is restored and its streaming block lifted.
- **Lost.** The purchase becomes `refunded` and held slices
  `cancelled_by_dispute` (Q3).
- **Prevented.** Stripe defines `prevented` as a dispute "prevented from
  becoming a formal chargeback", so it closes like an inquiry: nothing to
  restore or re-pay, and its held slices are released. One that has a
  clawback step anyway is alerted at error, with an errorId, for a person to
  settle (`Codex-2hxff.59`): its chargeback handling ran, so the buyer's access
  and the subscription's billing may still be paused too.
- **Missed events.** A dispute webhook that fails for good is answered 200, and
  Stripe stops redelivering after 3 days. So the hourly payouts cron first
  reconciles disputes (`Codex-2hxff.58`), before its drain. It reads Stripe's
  `charge.dispute.*` events from the last 4 days, and acts on any dispute that
  has no row of ours, whose row would move to a later stage (inquiry, then
  chargeback, then closed), or that is an open chargeback. It also retries
  every row of ours whose final status was never applied. Each is re-read
  from Stripe first and handled as it is now.
  - **An open chargeback is re-run while its events are in that window**,
    because nothing records that opening it finished: if pausing access, the
    clawback or the billing pause failed, the re-run completes it. Every step
    is idempotent, and the re-run writes no second streaming block: the
    database pause is what refuses access. A failure opening a chargeback is
    alerted at error with an errorId, and the webhook returns it so a
    transient one is redelivered.
  - A step that keeps failing is retried every hour and alerted at error, with
    an errorId, each time (owner decision 2026-10-23, "Retry hourly, alert").
    More unapplied final disputes than one run retries (50) is alerted too.
  - Another environment's disputes are ignored, as by the webhook.

A later refund of a slice a won dispute paid back takes its share off the
slice's re-pay row while that row is unpaid; only what a paid re-pay row
cannot carry goes to a person (`slice_repaid`) (Codex-2hxff.59; see
[dispute record](dispute-record.md#the-re-pay-a-new-pending-payout-row-per-reversed-slice)).
The dispute endpoint needs `charge.dispute.funds_withdrawn` and
`.funds_reinstated` too, an owner change in Stripe.

## Failure handling at a glance

| Situation | Desired outcome |
|---|---|
| Database or Stripe outage during completion, refund or dispute | 500; Stripe retries; the handler is idempotent |
| Webhook delivered twice | Second delivery is a no-op (unique payment intent; deterministic transfer keys; unique ledger rows) |
| Webhook slow or failing when the buyer returns | The success page records the purchase; the webhook later records nothing twice |
| Payee not payable yet | Pending ledger row; drained when they become payable |
| Transfer fails | Failed row with its charge id; retried by the drains |
| Charge id lookup fails | 500 and retry; never complete without it |
| Event from the other environment | Logged and acknowledged with 200; nothing written |
| Two payments for one item | Second payment refunded automatically |
| Refund before the purchase is recorded | Purchase rebuilt with its real split; the completion pays the unrefunded share |
| Dispute events missed for good | The hourly reconcile settles the dispute; a step that keeps failing alerts every hour |
