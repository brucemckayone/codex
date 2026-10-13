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
- **Tier order is the access hierarchy.** A higher tier (`sortOrder`) includes
  everything in the tiers below it. `sortOrder` is unique within an organisation.
- Creating a tier requires the organisation owner's payouts to be set up (a
  payable Connect account).
- A tier with subscribers who have not cancelled cannot be deleted. Deleting
  is a soft delete that also archives the Stripe Product.
- **Reordering tiers** changes what existing subscribers can see. Studio shows
  how many subscribers would gain or lose access and asks the owner to confirm
  (owner decision P-8, "Warn, then allow") — **gap**: `Codex-2hxff.16`.

Tiers are managed through organisation-api (`/api/organizations/:id/tiers*`,
`TierService`).

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
- the organisation owner's payouts must be set up — for course plans too —
  **gap**: `Codex-2hxff.12` (course checkout skips the check).

The session uses `mode: 'subscription'`, the buyer's single Stripe Customer and
the tier's Price for the chosen interval. Metadata on the session and on
`subscription_data` carries `codex_user_id`, `codex_organization_id`,
`codex_tier_id`, `codex_billing_interval` (or `type: 'course_subscription'` with
the course and plan ids) and `codex_env`. There are
no trials. No `application_fee_percent` or `transfer_data` is passed.

**One live subscription per buyer per organisation** is enforced twice: at
checkout, and again when the subscription is recorded. If a second Stripe
subscription completes anyway (two tabs), it is cancelled and refunded
automatically and nobody is billed for it — **gap**: `Codex-2hxff.15`.

### Recording the subscription

Stripe sends `checkout.session.completed` (subscription mode) to
`/webhooks/stripe/subscription`.

- **Organisation tier:** a `subscriptions` row is written with the status Stripe
  reports (not assumed active) — **gap**: `Codex-2hxff.15`. The buyer becomes a
  `subscriber` member (an existing owner, admin or creator role is kept) and a
  follower. A welcome email is sent and the buyer's library and subscription
  caches are bumped.
- **Course plan:** a `course_subscriptions` row and a `course_subscription`
  entitlement that expires at the end of the paid period.

The success page waits for our row before confirming
([purchases.md](purchases.md#after-payment)).

---

## Lifecycle and access

| Our status | Stripe status | Access |
|---|---|---|
| `active` | `active` | Yes, until the end of the paid period |
| `cancelling` | `active` with `cancel_at_period_end` | Yes, until the end of the paid period |
| `past_due` | `past_due` | **Yes, while Stripe retries the payment** — **gap**: `Codex-2hxff.10` (org tiers cut access immediately; course plans already keep it) |
| `paused` | `paused` | No |
| `cancelled` | `canceled` (or `unpaid`) | No |
| `incomplete` | `incomplete` | No |

Our row always follows Stripe's status, in Stripe's order. A late or replayed
event never brings back a subscription that has ended: deletion leaves a
tombstone that later events respect — **gap**: `Codex-2hxff.15`. The recorded
amount is the subscription's price, never a one-off proration invoice —
**gap**: `Codex-2hxff.15`.

| Event | Effect |
|---|---|
| `checkout.session.completed` | Record the subscription (above) |
| `invoice.payment_succeeded` | Update the period and status; split and pay out the invoice; renewal email on a cycle renewal; clear any streaming block |
| `invoice.payment_failed` | `past_due`; payment-failed email with the next retry date; **access continues** — **gap**: `Codex-2hxff.10` (today the streaming block is written) |
| `customer.subscription.updated` | Mirror status, tier, interval and period |
| `customer.subscription.deleted` | `cancelled`; access ends; streaming block written; tombstone |
| `customer.subscription.paused` / `resumed` | `paused` with access withdrawn / back to `active` |
| `customer.subscription.trial_will_end` | Email only (no trials are configured) |

`customer.subscription.created` and `invoice.paid` are not used: creation is
driven by `checkout.session.completed`, and payment by `invoice.payment_succeeded`.

### Renewals

On `invoice.payment_succeeded` the charge is found from the invoice, the
currency is checked to be GBP **before** anything is written — **gap**:
`Codex-2hxff.6` (today it is checked after the update) — and the invoice is
split and paid out exactly like a sale ([fees-and-splits.md](fees-and-splits.md#organisation-subscription-invoice)).

### Cancelling, reactivating, resuming

| Route | Effect |
|---|---|
| `POST /subscriptions/cancel` | Cancels at the end of the paid period (`cancel_at_period_end`); status `cancelling`; access continues until then. No streaming block is written — the period is paid for. |
| `POST /subscriptions/reactivate` | Undoes a pending cancellation before the period ends |
| `POST /subscriptions/resume` | Resumes a paused subscription without moving the billing date |

There is no immediate cancellation, except that a full refund ends a
subscription (see [refunds](#refunds)).

---

## Changing tier

`POST /subscriptions/preview-tier-change` shows the cost of a change (Stripe's
invoice preview); `POST /subscriptions/change-tier` makes it. The proration date
is issued by the server with the preview and checked when the change is made —
**gap**: `Codex-2hxff.15` (today the client supplies it unchecked).

- **Upgrade** (higher recurring price): takes effect immediately and the
  prorated difference is charged now. If that payment fails, Stripe keeps the
  old tier and the API returns 402 with a plain message — never Stripe's raw
  error text (**gap**: `Codex-2hxff.23`). The idempotency key includes the
  target price — **gap**: `Codex-2hxff.15`.
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
- A price edited in the Stripe Dashboard is logged as drift and is **not**
  applied to any subscriber.

— **gap**: `Codex-2hxff.3`. Today a tier price change moves every subscriber,
on both intervals, to the changed Price at once. Stripe treats an interval
change as an immediate charge and a new billing cycle, so an annual price edit
bills every monthly subscriber for a year. Course plans keep existing
subscribers on their old price for good. The fix uses Stripe subscription
schedules (a new phase at the renewal), the same mechanism that scheduled
downgrades need (`Codex-sing6`).

## Failed payments

Owner decision P-3, "After retries fail".

- A failed renewal makes the subscription `past_due`. The subscriber **keeps
  access** while Stripe retries the card on the retry schedule set in the Stripe
  Dashboard, sees the existing "update your card" banner, and is emailed.
- When the retries are exhausted, Stripe cancels the subscription and access
  ends. An `unpaid` status is treated the same way.

— **gap**: `Codex-2hxff.10`.

## Refunds

Owner decision P-4, "Cancel + end access".

- A **full** refund of the latest subscription payment cancels the subscription
  immediately, ends access and writes the streaming block.
- A **partial** refund leaves the subscription running.
- Either way, the creator and organisation slices are reversed in proportion,
  exactly as for one-off purchases ([purchases.md](purchases.md#refunds)). A
  shortfall on the payee's balance goes to `refund_reviews`, which must be able
  to hold subscription rows (`Codex-in0g4`).

— **gap**: `Codex-2hxff.10` (today a refund moves money only),
`Codex-2hxff.8` (clawback defects).

## Disputes

A disputed subscription invoice follows the dispute rules for purchases
([purchases.md](purchases.md#disputes)): access is paused and the invoice's
creator and organisation slices are reversed in proportion while it is open. If
we win, both are restored. If we lose, the subscription is cancelled and access
ends — **gap**: `Codex-2hxff.9`.

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
| `subscription-tier-price-change` | A price changes — sent at least 30 days before the new price applies (**gap**: `Codex-2hxff.3`) |
| `subscription-cancelled` | The subscription ends |
| `trial-ending-soon` | A trial is about to end (no trials are configured today) |
