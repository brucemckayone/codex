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
- it is marked purchasable and has a price above £0;
- its access rule honours a purchase. Content that is course-only, team-only
  or followers-only is not sold on its own — **gap**: `Codex-2hxff.14`
  (checkout gating).

**A course** can be bought when it is published and has a price above £0.

Publishing priced content requires the seller's payouts to be set up (a payable
Connect account), whether or not it is marked purchasable — **gap**:
`Codex-2hxff.14`.

A buyer who already owns the item (a completed purchase of the content, or a
live course entitlement) cannot start a second checkout for it.

## Checkout

| Route | Product | Policy |
|---|---|---|
| `POST /checkout/create` | Content | `auth: 'required'`, rate limit `strict` |
| `POST /checkout/course` | Course | `auth: 'required'`, rate limit `strict` |

1. The buyer's single Stripe Customer is found or created
   (`resolve-customer.ts`): the cached `users.stripe_customer_id`, otherwise a
   Customer created with `metadata.codex_user_id` under the key
   `codex:resolve-customer:${userId}`. If Stripe reports the cached Customer
   missing, the id is cleared and resolution runs once more. A Customer is never
   adopted from another user or another environment — **gap**:
   `Codex-2hxff.5`, `Codex-2hxff.23` (today a match by email can adopt one).
2. A Checkout Session is created:
   - `mode: 'payment'`, card payments;
   - one line item with inline `price_data` — currency `gbp`, `unit_amount`
     from our database, product name, description and image;
   - metadata: the content id (or `kind: 'course'` and the course id), the buyer
     id, the organisation id (left out for orgless content), the creator id, the
     title, and `codex_env` — **gap**: `Codex-2hxff.5` (environment tag);
   - an idempotency key per buyer and item, and an expiry, so two open tabs can
     never both take payment — **gap**: `Codex-2hxff.14` (double purchase).
3. Success and cancel URLs must be on an allow-listed host
   (`checkoutRedirectUrlSchema`).

No `transfer_data`, `application_fee_amount` or `on_behalf_of` is passed — the
charge stays on the platform account (see
[how money moves](README.md#how-money-moves)).

## Completing the purchase

Stripe sends `checkout.session.completed` to `/webhooks/stripe/booking`.

1. The signature is checked against `STRIPE_WEBHOOK_SECRET_BOOKING`.
2. The handler skips the event when:
   - the session is not `mode: 'payment'` (subscription checkouts belong to the
     subscription handler);
   - the session's objects carry another environment's tag — **gap**:
     `Codex-2hxff.5`;
   - `payment_status` is not `paid` — **gap**: `Codex-2hxff.14`.
3. The charge id is read from the PaymentIntent (`latest_charge`). If that
   lookup fails, the webhook returns 500 so Stripe retries; a purchase is never
   completed without its charge id — **gap**: `Codex-2hxff.11`.
4. In one database transaction:
   - a `purchases` row is inserted with status `completed` and the split
     snapshot (platform, organisation and creator amounts that must sum to the
     amount paid). The unique `stripe_payment_intent_id` makes a redelivered
     event a no-op;
   - an entitlement is written — `content_purchase`, or `course_purchase` plus
     course enrolment — for organisation **and** orgless sales — **gap**:
     `Codex-2hxff.21` (orgless sales get none).
5. After the transaction, for a new purchase only, the split is paid out (see
   [the payouts ledger](connect-and-payouts.md#the-payouts-ledger)):
   - a `platform_fee` row, recorded as paid;
   - the creator slice — a transfer to the creator's Connect account with key
     `${chargeId}_creator`;
   - the organisation slice — a transfer to the organisation owner's Connect
     account with key `${chargeId}_org_fee`;
   - a payee who is not payable yet gets a **pending** row instead, drained
     later. A transfer that fails gets a **failed** row that keeps its charge
     id and is retried — **gap**: `Codex-2hxff.11`.
6. Then, without holding up the response: the buyer's library version is
   bumped, a receipt email is sent once per purchase (not once per webhook
   delivery) — **gap**: `Codex-2hxff.8` — and a creator whose slice went
   pending is emailed to finish payouts setup — **gap**: `Codex-2hxff.7`.

**Errors.** A transient failure (database connection, Stripe outage) returns
500 and Stripe retries — **gap**: `Codex-2hxff.6`. If a buyer is charged twice
for an item they already own, the second payment is refunded automatically —
**gap**: `Codex-2hxff.14`.

## After payment

The buyer lands on a page that waits for **our** record, not just Stripe's:

| Return path | Waits for | Today |
|---|---|---|
| Content: `/checkout/success?session_id=…` (organisation and creator subdomains) | our purchase row, via `GET /checkout/verify` | stops at Stripe's `complete` — **gap**: `Codex-2hxff.22` |
| Content bought from the player paywall | the same verifying page | goes to `/library?purchase=success`, which nothing reads — **gap**: `Codex-2hxff.22` |
| Course or journey: `…/checkout/success` | the course entitlement, then redirects to the course | meets the spec |
| Subscription: `/subscription/success` | our subscription row | meets the spec |

Polling is bounded. When it runs out, the page says the payment is still being
processed and that we will email the buyer. After success the page refreshes
the library and subscription collections itself — **gap**: `Codex-2hxff.22`.

## Purchase history and sales

- `GET /purchases` lists the buyer's content **and** course purchases, paginated
  with `withPagination` — **gap**: `Codex-2hxff.21` (course purchases hidden).
- `GET /purchases/:id` returns 404 for someone else's purchase.
- `GET /checkout/verify` only reveals a session to the buyer who started it.
- `GET /sales` and `GET /sales/stats` show an organisation's content sales to
  its owner and admins. A creator's orgless sales are shown to that creator —
  **gap**: `Codex-2hxff.21`.

---

## Refunds

Refunds are issued by **platform support only** — never by creators, and never
self-served by customers (owner decision 2026-10-13, "Platform support") — from
an admin screen that calls Stripe and then lets the `charge.refunded` webhook do
the rest, so there is one refund path — **gap**: `Codex-2hxff.28` (today refunds
can only be started in the Stripe Dashboard). The refund window, how the platform
stays able to fund refunds and the customer-facing policy are still open in
`Codex-aqk92` (refund policy).

Stripe sends `charge.refunded` to `/webhooks/stripe/payment`. Each event is
handled for the amount **newly** refunded — the charge's cumulative
`amount_refunded` minus what has already been processed — so a second partial
refund claws back its own increment — **gap**: `Codex-2hxff.8` (partial
refunds).

**A full refund** (the whole charge refunded):

- the purchase becomes `refunded` and access ends — the entitlement is revoked
  and the streaming block is written so issued stream URLs stop working
  ([access.md](access.md#streaming-revocation)) — **gap**: `Codex-2hxff.8`
  (no block written for one-off refunds);
- every paid creator and organisation slice is reversed in full;
- every pending slice becomes `cancelled_by_refund`.

**A partial refund** (owner decision P-1, "Keep access"):

- the buyer **keeps** access;
- each paid creator and organisation slice is reversed by the same fraction as
  the refund (rounded down);
- each pending slice is reduced by the same fraction before it is paid;
- the platform absorbs its own fee's share of the refund and the rounding.
  — **gap**: `Codex-2hxff.8` (today any refund removes access).

**Reversals.** Each reversal uses the key `${transferId}_reversal_${refundId}`,
so the refund id and reason are recorded on the purchase (`charge.refunds` must
be expanded — Stripe stopped including it by default in API version
2022-11-15) — **gap**: `Codex-2hxff.8`.

- If the payee's Connect balance is too low, a `refund_reviews` row is written
  for manual settlement: `creator_absorbed`, `platform_absorbed` or
  `manually_reversed`. This is the chosen policy — reverse on refund, with a
  debt ledger as the fallback (`Codex-13v21`). Refund reviews need an operations
  screen — **gap**: `Codex-2hxff.8` (no reader today).
- Any other reversal failure is retried. A row is marked `reversed` only once
  the reversal succeeds — **gap**: `Codex-2hxff.8`.

Stripe does not return its processing fee on a refund; the platform bears it.

A refund that arrives before the purchase it belongs to is recorded (courses as
well as content) and applied when the purchase completes — **gap**:
`Codex-2hxff.8` (course refunds are dropped). The refund email is sent once,
with the right details — **gap**: `Codex-2hxff.8`.

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

— **gap**: `Codex-2hxff.9` (disputes: today only `created` is handled, no
transfer is reversed, a won dispute never restores access, and held slices
still pay out).

## Failure handling at a glance

| Situation | Desired outcome |
|---|---|
| Database or Stripe outage during completion, refund or dispute | 500; Stripe retries; the handler is idempotent |
| Webhook delivered twice | Second delivery is a no-op (unique payment intent; deterministic transfer keys; unique ledger rows) |
| Payee not payable yet | Pending ledger row; drained when they become payable |
| Transfer fails | Failed row with its charge id; retried by the drains |
| Charge id lookup fails | 500 and retry; never complete without it |
| Event from the other environment | Logged and acknowledged with 200; nothing written |
| Two payments for one item | Second payment refunded automatically |
