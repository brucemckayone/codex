# Operations

Running the payment system: environments, webhooks, secrets, the Stripe
Dashboard settings it depends on, local development and testing.

A **gap** marker means the code does not behave this way yet; see
[status.md](status.md).

---

## Environments and Stripe accounts

| Environment | Stripe account | Secrets live in |
|---|---|---|
| **Production** | "Codex sandbox", `acct_1SMY6J7wyGmo4sh6`, **test mode** | GitHub environment `production`, uploaded to the worker at deploy |
| **Local development** | The same sandbox | Each developer's local worker config (never committed) |
| **CI** | Test-mode keys | GitHub Actions secrets used by the testing workflows |

Production deliberately runs on the test-mode sandbox until launch, so nobody
can be charged real money while the site is being tested. At launch it moves to
a live-mode account and every endpoint, Product, Price and portal configuration
is recreated there (see [docs/deployment/production-go-live.md](../deployment/production-go-live.md)).

**The shared sandbox.** Production and local development receive **every**
event from the sandbox, by design. Each environment ignores events about
objects it did not create:

- Every object we create carries `metadata.codex_env` — the worker's
  `ENVIRONMENT` (`production`, `development`, `test`): Customers, Checkout
  Sessions and, through `payment_intent_data` / `subscription_data`, their
  PaymentIntents (whose Charges inherit it) and Subscriptions (whose Invoices
  snapshot it in `parent.subscription_details.metadata`), Connect accounts,
  Products, Prices and transfers.
- `createWebhookHandler` reads the tag before any handler runs and acknowledges
  (200) an event whose object names another environment, writing nothing.
- An **untagged** object is processed. Everything created before tagging began —
  every existing subscription among them — has no tag, and skipping it would
  stop production renewals. Subscription charges, disputes and Connect
  deauthorisations carry none of our metadata, so they are always processed;
  they fail harmlessly on unknown rows.
- Customer resolution by email never adopts another environment's Customer.

Seed scripts clean up Stripe objects across the **whole** sandbox, so a local
seed can archive Prices that production uses — `Codex-1ilxl` (in progress).

## Webhook endpoints (production)

Base URL: `https://ecom-api.revelations.studio`. Each endpoint has its own
signing secret.

| Path | Events | Secret | Handler | Endpoint |
|---|---|---|---|---|
| `/webhooks/stripe/booking` | `checkout.session.completed` | `STRIPE_WEBHOOK_SECRET_BOOKING` | `handleCheckoutCompleted` (payment mode only), through `completeCheckoutSession`, which the success page's `POST /checkout/complete` also runs | `we_1UQ7HY7wyGmo4sh6BYwlrb80` |
| `/webhooks/stripe/payment` | `charge.refunded`, `refund.updated`, `refund.failed` | `STRIPE_WEBHOOK_SECRET_PAYMENT` | `handlePaymentWebhook` | `we_1UQ7HZ7wyGmo4sh6x477bv6C` |
| `/webhooks/stripe/dispute` | `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated`, `radar.early_fraud_warning.created` | `STRIPE_WEBHOOK_SECRET_DISPUTE` | `handlePaymentWebhook` | `we_1UQ7Ha7wyGmo4sh6CuTHPE8O` |
| `/webhooks/stripe/subscription` | `checkout.session.completed`, `customer.subscription.updated`, `.deleted`, `.paused`, `.resumed`, `.trial_will_end`, `invoice.payment_succeeded`, `invoice.payment_failed`, `product.updated`, `price.created`, `price.updated` | `STRIPE_WEBHOOK_SECRET_SUBSCRIPTION` | `handleSubscriptionWebhook` (subscription mode only) | `we_1UQ75i7wyGmo4sh6e12nck3K` |
| `/webhooks/stripe/connect` | `account.updated`, `account.application.deauthorized` — **connected-accounts** endpoint | `STRIPE_WEBHOOK_SECRET_CONNECT` | `handleConnectWebhook` | `we_1UQ71a7wyGmo4sh6qjaGNKFW` |

- Both booking and subscription receive `checkout.session.completed`; each
  ignores the other's mode, so a session is processed once.
- The connect endpoint must be created as a **connected accounts** endpoint
  (`connect: true`). A platform-only endpoint never receives creators'
  `account.updated`. The scope cannot be changed after creation.
- `/webhooks/stripe/customer` is a log-only stub with no handler, and its
  endpoint is disabled. It is to be removed with its secret — **gap**:
  `Codex-2hxff.24`. A Customer deleted in Stripe needs no webhook: checkout
  clears the stale id and retries.
- `/webhooks/stripe/dev` exists for local development only and returns 404 in
  production.

### Webhook error policy

| Response | When |
|---|---|
| 400 | No `stripe-signature` header |
| 401 | The signature does not match the endpoint's secret |
| 501 | The secret or Stripe key is not configured |
| **500** | A **transient** failure: database connection or timeout, Stripe 5xx, rate limit, network error, or a Stripe authentication or permission error (a key or account misconfiguration — redelivery succeeds once it is fixed). Stripe retries (for up to 3 days in live mode). |
| 200 `{ received: true }` | Processed, skipped (wrong mode, another environment, unknown type), or failed **permanently** (bad data, unknown object) |

Errors wrapped as `ServiceError` by a service are classified by their cause,
so a database outage inside a service returns 500. A service never lets a raw
error out: `handleError` wraps it as `InternalServiceError` and keeps the
original on the standard `cause` (never serialised into a response), and
`isTransientError` (`workers/ecom-api/src/utils/error-classification.ts`)
follows the cause chain. A `ServiceError` thrown on purpose (not found,
validation, conflict) has no cause and stays permanent; so does an unrecognised
bug, so a broken handler cannot start a retry storm. Retryable Postgres states
(class `08`, `40001`, `40P01`, `53300`, `57P01`–`57P03`, `57014`) count as
transient by their SQLSTATE, whatever their message says — and any other
SQLSTATE is permanent, whatever its message says (a constraint named after a
timeout must not retry for three days). Drizzle's query error is judged by the
driver error it wraps, never by its message: that is the SQL and its bound
values, user data. The log line names the innermost error and its code, never
the query.

There is no event-id table; safety on redelivery comes from unique keys
(payment intent, ledger rows) and deterministic idempotency keys.

## Secrets and configuration (ecom-api)

| Name | Kind | Notes |
|---|---|---|
| `DATABASE_URL` | secret | |
| `STRIPE_SECRET_KEY` | secret | Also needed by organization-api, which creates tier Products and Prices. The daily bank payout (`Codex-2hxff.29`) needs, on connected accounts, Balance read, Payouts write and Transfers read: list them if ecom-api ever moves to a restricted key |
| `STRIPE_WEBHOOK_SECRET_BOOKING`, `_PAYMENT`, `_DISPUTE`, `_SUBSCRIPTION`, `_CONNECT` | secret | One per endpoint |
| `STRIPE_WEBHOOK_SECRET_CUSTOMER` | secret | To be removed — **gap**: `Codex-2hxff.24` |
| `STRIPE_PORTAL_CONFIGURATION_ID` | secret | The locked billing-portal configuration — `bpc_1UQ9QH7wyGmo4sh6hXwkCS1s` in the sandbox. Optional at boot; without it the billing portal refuses to open. The deploy uploads it only when it is set and is a `bpc_` id; otherwise the run warns (unset) or errors (wrong shape) and keeps the current value (`Codex-2hxff.41`) |
| `ENVIRONMENT` | var | `production` disables the dev webhook route |
| `WEB_APP_URL` | var | Required — agreement emails need it — **gap**: `Codex-2hxff.7` (declared optional) |
| `API_URL` | var | Must be declared under `env.production` — **gap**: `Codex-2hxff.24` |
| `RATE_LIMIT_STRICT`, `RATE_LIMIT_API` | rate-limit bindings | A route's preset needs its binding, or it fails open |

**Production secrets** are stored only in the GitHub environment `production`
(none at repository level). The deploy workflow uploads them to the worker
(`.github/scripts/upload-worker-secrets.sh`, `wrangler secret bulk`). To change
one without a deploy, set it in **both** places:

```bash
printf '%s' "$VALUE" | gh secret set NAME --env production
cd workers/ecom-api && printf '%s' "$VALUE" | npx wrangler secret put NAME --env production
# must print: Creating the secret for the Worker "ecom-api-production"
```

Never commit a secret or write one into a document.

## Recreating a webhook endpoint

An endpoint's signing secret is only shown when it is created, and its
connected-accounts scope cannot be changed. When a secret is lost or wrong, or
the scope is wrong:

1. Create a new endpoint with the same URL and the events in the table above;
   copy its signing secret from the response.
2. Set the secret in the GitHub `production` environment **and** on the live
   worker (above).
3. Disable the old endpoint and describe it as retired, naming its replacement.
4. Verify a delivery (below). A green response from Stripe's API proves nothing
   about our worker.

All six production endpoints were recreated this way on 2026-10-13, after every
delivery had been failing with 401 because the stored secrets matched none of
them (`Codex-2hxff.27`).

### Verifying delivery

Watch the production worker's log in one terminal:

```bash
npx wrangler tail ecom-api-production --format json
```

The tail prints nothing until a request arrives. Then trigger an event:

- **subscription:** edit the metadata of a test Product in the sandbox
  (`product.updated`);
- **booking, payment, dispute:** these have no harmless real trigger, so sign an
  inert event with the endpoint's secret — Stripe's scheme is HMAC-SHA256 over
  `"<timestamp>.<body>"`:

```js
import { createHmac } from 'node:crypto';
const [path, secret] = process.argv.slice(2);
const t = Math.floor(Date.now() / 1000);
// booking ignores sessions that are not mode 'payment'; payment/dispute log unknown types
const body = JSON.stringify({
  id: `evt_check_${t}`, object: 'event', type: 'codex.signature_check', livemode: false, created: t,
  data: { object: { id: 'cs_check', object: 'checkout.session', mode: 'setup' } },
});
const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
const res = await fetch(`https://ecom-api.revelations.studio/webhooks/stripe/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body,
});
console.log(path, res.status);
```

Success is a 200 **and** the log line `Webhook signature verified`. Also send one
event signed with a wrong secret and confirm it gets 401, which proves the check
is real.

## Stripe Dashboard settings

These live in Stripe, not in the repository. Check them in every environment,
and again when moving to live mode.

| Area | Setting |
|---|---|
| Webhook endpoints | Exactly the endpoints and events above; connect as a connected-accounts endpoint |
| Billing customer portal | A configuration with cancelling, plan switching, pausing and profile edits **off**: `bpc_1UQ9QH7wyGmo4sh6hXwkCS1s` (created 2026-10-13; deliberately not the account default). Its id goes in `STRIPE_PORTAL_CONFIGURATION_ID`. The account default still allows cancelling, so every portal session passes the id |
| Billing → Subscriptions → Manage disputed payments | **Do nothing** (Stripe's default). Our dispute webhook pauses billing while a chargeback is open and cancels on a loss; if Stripe cancelled on a dispute instead, a won dispute could not restore the subscription ([subscription-disputes.md](subscription-disputes.md)) |
| Billing → Subscriptions and emails → Manage failed payments | The retry schedule Stripe follows while a subscriber is `past_due`, with "If all retries for a payment fail" set to **cancel the subscription**, so access ends when retries run out (owner decision P-3). `past_due` keeps access, so "leave as past-due" would keep it for ever. Found set to "leave as past-due" on 2026-10-20; the owner set it to "cancel the subscription" the same day. Check each test-mode account matches |
| Connect Express Dashboard features | Creators can change their payout bank account (Stripe's default) but **not** their payout schedule: payout-schedule editing, self-serve manual payouts and Instant Payouts all **off** (owner decision "Bank account only"; `Codex-2hxff.29`). No API can check these: after changing them, log in to one test Express account and look. The schedule itself is set per account by our code: manual payouts, paid by the daily bank payout job 14 days after each sale, with bank debit off ([Payout timing](connect-and-payouts.md#payout-timing)). Editing either on an account in the Stripe Dashboard takes it off the daily payout, with an alert: [heal](#payout-schedule-backfill) |
| Connect branding | Platform name and icon shown during onboarding and in the Express Dashboard |

If a creator cannot pass Stripe's check when changing bank details, the platform
can generate an external-account update code from the connected account's page
(live mode only; the platform takes on liability for the change).

## Scheduled jobs

| Job | Worker | Schedule | Environment |
|---|---|---|---|
| Payouts sweep | ecom-api | `0 * * * *` | Production only |
| Agreement review reminders | notifications-api | `0 8 * * *` | Production only |
| Fee notices (the daily fee step, after the agreement and money sweeps) | notifications-api | `0 8 * * *` | Production only |

Both run at minute `0` so they share one database wake
([why](connect-and-payouts.md#releasing-pending-money)). The daily bank payout
(`Codex-2hxff.29`) is not a cron of its own: it is the payouts sweep's run whose
London hour is 8, last in that wake. The price-move step (`Codex-2hxff.86`)
rides the same sweep, on every run but that one
([held price moves](#held-price-moves)).

## Changing fees

Fees change only through admin-api's `/api/admin/fees/*` routes
([Fees and splits](fees-and-splits.md#changing-fees)). **Never edit
`fee_changes`, `fee_config_versions`, `fee_change_notices` or the old
`fee_config_*` tables with SQL**, not even to fix a typo: a SQL edit skips the
notice a rise owes the people it pays less, breaks the dated history a replayed
invoice is split by, and is not in the audit log. To undo a waiting rise, save
the old value again (or `POST /api/admin/fees/changes/:changeId/cancel`):
everyone already told is emailed that it's off.

**After saving a rise.** The answer's `change` has `kind: 'rise'` and
`effectiveFrom: null`: it waits. The next 08:00 run (UTC) makes its list and
emails everyone it pays less. The date is set the first morning nobody on the
list is still waiting, to the first UK midnight at least 30 days after the last
of them was told. Until then, Admin › Queue › Fee notices shows the rise's
card (what moves, who is told, the earliest date) and each person whose email
didn't go through.

**Each morning.** notifications-api logs `fee step completed` with the counts
(lists made, sent, failed, unknown, joiners, dated). When someone needs a
person, it raises one error alert, `fee step: people not yet told about a fee
rise`, naming up to 50 notice and user ids; the queue is the lasting record,
so a missed alert loses nothing. A send that failed outright (refused, skipped,
no address) is named at once, and tried again the next morning. One with no
answer (a 5xx, a timeout) may have gone, so the next run first looks in
`email_audit_logs` and only sends again if nothing is there. It is named only
after three such mornings, or at once when its rise starts within three days,
since the mornings themselves usually mend it. A follow-up email
(made smaller, cancelled) holds nothing: it is dropped after three failed
mornings with a warning, and never reaches the queue.

**Told another way.** If support reaches someone another way (the phone,
their other address), they press Told another way on that row and say how in
the note. That counts as the person's notice from then. When they were the
last person the rise waited for, the same transaction sets the date, and the
answer says so. A second press answers 409 `FEE_NOTICE_ALREADY_TOLD`, which
the page reads as done; a rise cancelled meanwhile answers 409
`FEE_CHANGE_NOT_WAITING`. A joiner's row is tagged Joined later: it never
holds the date, but they still need telling.

**If a rise must start later or not at all**, cancel it and save it again
later. Nothing moves a date earlier: the 30 days count from the last person
told.

**Rollback.** Migration `0123` stays if the workers roll back. The old
workers read the old `fee_config_*` rows. Every admin save keeps them at the
values in force then, and the 08:00 fee step writes a dated rise into them on
the morning it starts, so sales keep the right fee. Before rolling back,
check that they agree (R14 in [the release checklist](release-checklist.md)):
a level whose rise started since midnight disagrees until the 08:00 run. The
fee step and the queue tab stop until the roll forward, so a waiting rise
never starts, and one whose date falls in the rollback starts only at the
roll forward. Don't change fees while rolled back: the old routes write only
the old tables, and the new resolver never sees those writes. Save them again
through the new route after rolling forward.

## Held price moves

A new tier or course-plan price emails every subscriber first, and moves each
one only after their own email is accepted; their 30 days count from it.
ecom-api's hourly run does this, up to 1,125 people a run, skipping the 08:00
London run, which belongs to the bank payout ([Subscriptions](subscriptions.md)).
Admin › Queue › Price moves (`Codex-2hxff.85`) lists the people it couldn't
move. The record is the source of truth, not the alerts: the run names at most
50 people per run in its alert lines.

**Held.** After three hourly tries, a person is held, listed with why, and kept
on their old price. Each row has one action:

- **Retry**, when no email went through (refused, skipped, no address, or no
  record that it went). Fix the cause first, for example the address on their
  account. The next run emails them again, with three fresh tries, and their
  move is scheduled 30 days after the new email.
- **Retry the move**, when the email went through and Stripe then refused the
  move or never answered. The next run asks Stripe again for the date they
  were told, or their next renewal if that date has passed (later than told,
  never earlier), and sends no second email.

Both are database writes for the next run: admin-api can't send email or
change a subscription. The answer gives that run (`nextRunAt`: the next top of
the hour, or the one after when that is the 08:00 London run), and the row
shows Queued until the run finishes with it, so come back after it. A support
retry gets three tries of its own; a row the run holds again says who retried
it.

**Close…** takes a row off the list without a retry, as moved by hand (told,
then changed in Stripe) or not needed (cancelled, refunded or replaced), with a
note. Closing moves nobody. Move someone by hand only once they have been told
the new price and the date.

**409 `PRICE_MOVE_NOT_HELD`** means there is nothing to retry or close, and
`details.reason` says why:

- `superseded`: a newer price for the plan replaced this one, and they are
  emailed about that instead;
- `moved`: the run got there first;
- `skipped`: the run set it aside (they are moving to another plan, for
  example);
- `subscription_ended`: Retry only; close it as not needed;
- `resolved`: it is closed already;
- `queued`: it is already queued, which is also what a second press after a
  lost answer gets;
- `in_progress`: the run is still working on it, and it was never held.

**A stopped price change.** If every email in a change's first batch is
refused with a 4xx (a missing template, a bad worker secret), the run stops the
whole change with one alert, and nobody is emailed or moved. The queue shows
one card for it, with the cause and the error id that joins the alert line.
Fix the cause, then press Restart: the next run sets the change running again
and carries on where it stopped. A Restart pressed before a later stop doesn't
count, so press it again. A change that isn't stopped answers 409
`PRICE_CHANGE_NOT_STOPPED`.

**The badge** counts held people not closed, and stopped changes nobody has
restarted. A Retry or a Restart takes its row off the badge at once; the list
keeps it, queued, until the run takes it.

**Waiting for a chargeback** (owner D1, `Codex-2hxff.70`). A queued row whose
member has an open chargeback on that subscription (`disputed_at`) waits for it:
the run moves it a day on each time, sends no email and writes nothing at
Stripe, so a queued time that keeps moving is expected. A held one would wait
the same way once retried. Both say so (`waitsForDispute`); an ended
subscription's or a closed row doesn't. Nothing needs doing: once the
chargeback ends, the next run treats them as anyone else.

## Late wins

A chargeback lost and then decided for us after all (a "late win",
`Codex-2hxff.70`) is undone automatically: the buyer gets the item back (unless
they bought it again, the payment was a duplicate, refunds still cover it, or
another chargeback holds it), the creators are paid back by new payouts, a
buyer who bought it again has their first payment refunded, a duplicate
payment is refunded (owner, "Refund it"), and a buyer whose access came back
is emailed once. A subscription the loss cancelled stays ended
and its subscriber isn't emailed. The webhook does it when Stripe's event
arrives; the hourly reconcile catches one whose events were missed, from
Stripe's events of the last 4 days and, on every run but the 08:00 London one,
by re-checking our lost chargebacks of the last 12 months
([dispute record](dispute-record.md)).

**On the charge page.** The chargeback row says when it was lost and when it
was won (`lostOn`, `lateWonOn`), and its history lines say the loss date and
each step's kind. While the creators are being paid back (`settling`: won, its
outcome not yet applied, a normal win's included), refunds are refused with 422
`CHARGEBACK_SETTLING`, "This payment's chargeback was decided for us, and the
creators are still being paid back. Refunds wait until that finishes; a step
that fails is retried every hour.", on the form, the preview and the route
alike. It promises no time, since a refund Stripe won't make outlasts any
(review cycle 1, M3). It usually lasts seconds; about an hour
while a step is retried. That includes the wait for the late win's own refund
while it is pending at Stripe, which only the next hourly run finishes. Until
then a `refund.updated` for that refund is answered 500 and logged as a
transient error, as expected. A refund Stripe won't make holds it until support
settles it (below).

**No 14-day limit** (owner Q7, "Lift the limit for it"). A late-won payment
stays refundable from the charge page whenever the buyer asks, and the refund
is taken back from the creators like any other. Nothing about it is automatic.
The charge's refund window says so with `liftedByLateWin`: `isOpen` is true,
and `closesAt` keeps the 14-day date, which has passed. Anything that reads
`isOpen` or `closesAt` must allow for it.

**Refunded outside Stripe** (owner decision 2026-11-08, "Block it in code"). A
charge whose buyer was refunded outside Stripe has `refunded_outside_stripe_at`
set, and is never refunded through Stripe again. Three things set it:

- a charge settled by hand
  ([below](#settling-a-late-win-refund-stripe-wont-make));
- the late win's own failed refund settled in Failed refunds as refunded
  elsewhere, unless the charge's SUCCEEDED Stripe refunds already cover it
  (support refunded it again through Stripe first). Without the mark the
  charge would stay refundable for good, since Stripe doesn't count the failed
  refund and the late win lifts the 14-day window. That is owner decision 5's
  rule, applied in review cycle 2. A re-refund still pending doesn't count, so
  the charge is marked: if it then fails, the charge is already blocked; if it
  succeeds, the buyer was refunded once, through Stripe, and only the charge
  card's "refunded outside Stripe on {date}" is then slightly off;
- by hand, with the owner's OK, for a buyer refunded another way that the
  settle never saw: a canceled late-win refund (below), or one settled while
  rolled back
  ([R19 (b)](release-checklist.md#r19--before-any-workers-rollback-late-wins-still-being-undone)).

No date is ever overwritten. The runbook step runs only on a charge with no
refund recorded, so it never meets a set date, and the other two guard with
`refunded_outside_stripe_at IS NULL`. The form shows the block; the preview
and the route refuse it with 422 `REFUNDED_OUTSIDE_STRIPE`, whatever the window
says, and nothing lifts its window. The detail's `refundable.blocked` is
`refunded_outside_stripe`, with `refundedOutsideStripeOn`, and the charge
card's amount reads "refunded outside Stripe on {date}", since Stripe lists no
standing refund for it.

**Alerts** (ids, codes and counts only; Q6). A late win that works logs
"Late win: loss undone" at info and alerts nobody. Each of these is an error
with an `errorId`, unless it says otherwise:

| Alert | What it means | What to do |
|---|---|---|
| Late win: Stripe refused the refund of a payment the buyer made twice… / Late win: a payment the buyer made twice (bought again, or a duplicate) could not be refunded… | The late win's refund of a first payment (a buyer who bought it again) or of a duplicate payment wasn't made. "Refused": Stripe refused the request itself (`stripeType` `StripeInvalidRequestError`). "Could not be refunded": anything else, such as an outage, a rate limit or a key without refund rights. `stripeCode`, `stripeType` and `stripeStatusCode` say which; each is empty when Stripe gave none. Nothing is marked, the creators' pay-back stays held, and it is retried: on each of Stripe's redeliveries, then every hour, one alert per try. Stripe replays an answer for 24 hours under the same idempotency key, so a cause that clears (a low balance, a fixed key) is only tried again a day after the first answer | Read the three fields. A "could not be refunded" usually clears by itself once the outage passes or the key is fixed. One Stripe will never make: settle it by hand ([below](#settling-a-late-win-refund-stripe-wont-make)). **Never refund the buyer another way first** |
| Late win: the refund of the payment failed at Stripe, so the buyer was not refunded; it is in Failed refunds | The late win's refund was made, but Stripe reports it `failed` (`refundId`, `status`). The late win counts as settled and its outcome is marked. As with any failed refund, its clawback stands: the creators gave the first payment back off their held re-pay rows. The buyer has not been refunded | Refund the buyer another way, or first refund it again through Stripe on the charge page, then settle the refund in Failed refunds as refunded elsewhere. Settled after a refund another way, the charge is marked refunded outside Stripe and the charge page blocks any further Stripe refund: Stripe doesn't count the failed refund and the late win lifts the 14-day window, so it would otherwise offer the whole amount again, for good ([above](#late-wins)). So a Stripe refund comes first or not at all. "Re-pay payees" (creators re-paid) is refused for it, 422 `LATE_WIN_REFUND_NOT_REPAYABLE` (owner decision 2026-11-08, "Block it in code"): the buyer is still owed this money, so its clawback stands |
| Late win: Stripe canceled the refund of the payment, so the buyer was not refunded. Support must settle it by hand | Settled as for a failed refund, but the Failed refunds queue lists only `failed` ones, so this alert is how support finds it (owner decision 2026-11-05). It took nothing from the creators | Settle it with the owner; the buyer has not been refunded. If the owner refunds the buyer another way, record it with the UPDATE in [R19 (b)](release-checklist.md#r19--before-any-workers-rollback-late-wins-still-being-undone): a canceled refund never reaches Failed refunds, so nothing else marks the charge refunded outside Stripe, and the charge page would offer a Stripe refund again for good |
| A won dispute was reported lost: nothing changed, check it in Stripe | Stripe now says lost a dispute we hold as won. Nothing was changed | Check the dispute in Stripe's Dashboard |
| The hourly late-win check read its page limit of Stripe's disputes | More than 300 disputes since our oldest lost one: the older ones weren't re-checked this run | None by itself; if it repeats, the check needs a wider limit |
| The hourly late-win check could not read a page of Stripe's disputes / could not re-check lost disputes for a late win | A Stripe or database read failed; the next run retries | None unless it repeats |
| WEB_APP_URL is not set: the late win's access-restored email… | The buyer's email had no working link, so it wasn't sent | Set `WEB_APP_URL` on ecom-api |
| Late win: the buyer's access-restored email could not be claimed, so it was not sent, and it is not retried | The send-once claim's database write failed, after the outcome was marked, so nothing comes back to it (`disputeId`, `userId`). Their access is back | None for the money. Tell the buyer another way, if you want them told |
| Late win: the buyer's access-restored email was not sent: the charge has no email address (warning) | The charge has no billing or receipt address. Not retried; their access is back (`disputeId`, `userId`, never an address) | As above |
| Late win: the buyer's access-restored email was not sent: the item's title could not be read (warning) | The item's title couldn't be read for the email. Not retried; their access is back (`disputeId`, `userId`) | As above |
| Dispute lost run found it no longer lost (a late win overtook it): its outcome is left for the late win to mark (warning, no `errorId`) | A retry of an unfinished loss ran while the dispute was won late. It marked nothing, so the late win's undo still restores, re-pays and refunds | None |

A late-win step that fails otherwise raises the reconcile's existing "A dispute
could not be settled by the hourly reconcile; the next run retries it"
(`disputeId`, `status`, `error`, and `cause`: the innermost error's name,
message and code, which for a Stripe failure is Stripe's own message), and is
retried every hour. A refund Stripe didn't make is the exception: its own
alert above has already fired, so the reconcile logs one warning instead of a
second error, "A late win's settle stopped at its refund, which the refund
step has already alerted; the next run retries it" (`disputeId`, `purchaseId`,
`chargeId`, no `errorId`). So each try raises one error, by the webhook or the
hourly run alike. A
late win settled by hand before the release is recorded as applied by
[release step R18](release-checklist.md#r18--lost-chargebacks-already-settled-by-hand),
so nothing runs again for it.

### Settling a late-win refund Stripe won't make

A late-win refund that Stripe keeps refusing is retried every hour, with no
end (owner decision 2026-10-23). The row stays won and unapplied: the alert
repeats, the creators' pay-back stays held, and every support refund of the
charge is refused with `CHARGEBACK_SETTLING`. Once Stripe will clearly never
make it, a person settles it (owner decision 2026-11-08, "Runbook step, you OK
each"): the hourly retry is stopped, the payment is taken back from the
creators as the refund would have taken it, their pay-back is released, and the
buyer is refunded another way.

**Never refund the buyer another way while the retry is running.** If the
cause clears, the next hourly run refunds them through Stripe as well, and they
are paid twice. Refund another way only once step 3 below has shown the retry
has stopped.

Do it only with the owner's OK, for each case. Run the SQL in the Neon console's
SQL Editor, with the dispute's id (`du_…`, from the alert) in place of `du_…`.

1. **Read the case** (read-only). In the first result, the row must be `won`,
   with `late_won_at` set and `outcome_applied_at` and `late_win_refund_id`
   empty. The purchase must be `refunded`, `amount_cents` must equal
   `amount_paid_cents`, and `refunds_recorded` must be 0. In Stripe's
   Dashboard, the charge must have no refund. The second result lists the
   sale's slices, and every `verdict` must be `held` or `platform`. A duplicate
   payment lists no slices. Any `STOP`, or anything else above, and the case
   isn't this step's: take it to the owner.
2. **Settle it** (writes; the owner's OK first). Run it between :20 and :50 past
   the hour, so the hourly run isn't partway through the row. Run it only once
   Stripe has no delivery of the dispute's event still to retry (the event's
   webhook attempts in the Dashboard). It runs as one block:
   - it checks step 1 again, under a lock on the dispute;
   - it cancels each held re-pay row (`cancelled_by_refund`, never sent): the
     creators give back the first payment, as the refund would have taken it;
   - it marks the outcome applied: the retry stops, and the hold on the pay-back
     is released, with nothing left in it to pay;
   - it records `refunded_outside_stripe_at`: from then on, the only way to
     refund this charge is outside Stripe. Support's refund route refuses it
     (`REFUNDED_OUTSIDE_STRIPE`), and the charge page says so.

   Anything not as expected raises an error and writes nothing. It ends with
   "Settled du_…: N re-pay row(s) cancelled, outcome applied".
3. **Check that the retry has stopped** (read-only), once the next hourly run
   (:00) has passed. `outcome_applied_at` and `refunded_outside_stripe_at`
   must be set, `late_win_refund_id` still empty, and every re-pay row
   `cancelled_by_refund` with no transfer. In Stripe, the charge must still have
   no refund, and no late-win refund alert (either wording above) can have
   named the dispute since step 2. If `late_win_refund_id` is set, or Stripe shows a
   refund, a run already in flight refunded the buyer after all. **Don't refund
   them another way**, and take it to the owner. That refund's clawback finds
   the re-pay rows cancelled and records `slice_repaid` debts for a person.
   They aren't owed, because step 2 already took those shares.
4. **Refund the buyer another way**, for the charge's amount. Write down, with
   the case:
   - the dispute id;
   - the last alert's `errorId`;
   - step 2's line;
   - how and when the buyer was refunded.

Step 2's changes differ from a real refund in bookkeeping only. There's no
`refunds` row, so the charge page lists no refund. The re-pay rows carry no
refund step, since there is no refund id to name. The purchase keeps the
refund fields the undo restated: `refunded`, with no refund amount, as it showed
while it was stuck.

Step 1:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT d.stripe_dispute_id, d.stripe_charge_id, d.purchase_id, d.status,
       d.amount_cents, pu.amount_paid_cents, pu.status AS purchase_status,
       pu.duplicate_of_purchase_id, d.late_won_at, d.outcome_applied_at,
       d.late_win_refund_id,
       (SELECT count(*) FROM refunds rf
         WHERE rf.stripe_charge_id = d.stripe_charge_id) AS refunds_recorded
  FROM disputes d
  JOIN purchases pu ON pu.id = d.purchase_id
 WHERE d.stripe_dispute_id = 'du_…';
SELECT s.id AS slice, s.payout_type, s.status AS slice_status,
       s.amount_cents AS slice_cents, r.kind, r.status AS step_status,
       r.amount_cents AS step_cents, p.id AS repay, p.status AS repay_status,
       p.amount_cents AS repay_cents,
       CASE
         WHEN s.payout_type = 'platform_fee' THEN 'platform'
         WHEN r.status = 'done' AND r.amount_cents = s.amount_cents
          AND p.status = 'pending' AND p.amount_cents = r.amount_cents
          AND p.stripe_transfer_id IS NULL AND p.last_retry_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM payout_reversals o
                           WHERE o.payout_id = p.id)
           THEN 'held'
         ELSE 'STOP'
       END AS verdict
  FROM disputes d
  JOIN payouts s ON s.purchase_id = d.purchase_id
  LEFT JOIN payout_reversals r
         ON r.payout_id = s.id AND r.cause_type = 'dispute'
        AND r.cause_id = d.stripe_dispute_id
  LEFT JOIN payouts p ON p.id = r.repaid_by_payout_id
 WHERE d.stripe_dispute_id = 'du_…'
   AND NOT EXISTS (SELECT 1 FROM payout_reversals x
                    WHERE x.repaid_by_payout_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM payee_credits c
                    WHERE c.repay_payout_id = s.id)
 ORDER BY s.payout_type, s.id;
ROLLBACK;
```

Step 2:

```sql
DO $$
DECLARE
  dispute_id constant text := 'du_…';
  held int;
  stops int;
  cancelled int;
  marked int;
BEGIN
  -- Still the stuck late-win refund, in the simple shape, and locked.
  PERFORM 1
     FROM disputes d
     JOIN purchases pu ON pu.id = d.purchase_id
    WHERE d.stripe_dispute_id = dispute_id
      AND d.status = 'won' AND d.late_won_at IS NOT NULL
      AND d.outcome_applied_at IS NULL AND d.late_win_refund_id IS NULL
      AND pu.status = 'refunded' AND d.amount_cents = pu.amount_paid_cents
      AND NOT EXISTS (SELECT 1 FROM refunds rf
                       WHERE rf.stripe_charge_id = d.stripe_charge_id)
      FOR UPDATE OF d;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a stuck late-win refund of the simple shape: nothing written';
  END IF;

  -- Step 1's verdicts again, under the lock.
  SELECT count(*) FILTER (WHERE v.verdict = 'held'),
         count(*) FILTER (WHERE v.verdict = 'STOP')
    INTO held, stops
    FROM (
      SELECT CASE
               WHEN s.payout_type = 'platform_fee' THEN 'platform'
               WHEN r.status = 'done' AND r.amount_cents = s.amount_cents
                AND p.status = 'pending' AND p.amount_cents = r.amount_cents
                AND p.stripe_transfer_id IS NULL AND p.last_retry_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM payout_reversals o
                                 WHERE o.payout_id = p.id)
                 THEN 'held'
               ELSE 'STOP'
             END AS verdict
        FROM disputes d
        JOIN payouts s ON s.purchase_id = d.purchase_id
        LEFT JOIN payout_reversals r
               ON r.payout_id = s.id AND r.cause_type = 'dispute'
              AND r.cause_id = d.stripe_dispute_id
        LEFT JOIN payouts p ON p.id = r.repaid_by_payout_id
       WHERE d.stripe_dispute_id = dispute_id
         AND NOT EXISTS (SELECT 1 FROM payout_reversals x
                          WHERE x.repaid_by_payout_id = s.id)
         AND NOT EXISTS (SELECT 1 FROM payee_credits c
                          WHERE c.repay_payout_id = s.id)
    ) v;
  IF stops > 0 THEN
    RAISE EXCEPTION '% slice(s) are not the simple shape: nothing written', stops;
  END IF;

  -- Take the first payment back from the creators, as the refund's clawback
  -- takes a re-pay row in full: cancelled before it is ever sent.
  UPDATE payouts p
     SET status = 'cancelled_by_refund',
         resolved_at = COALESCE(p.resolved_at, now()),
         updated_at = now()
    FROM payout_reversals r
   WHERE r.repaid_by_payout_id = p.id
     AND r.cause_type = 'dispute' AND r.cause_id = dispute_id
     AND p.status = 'pending' AND p.stripe_transfer_id IS NULL
     AND p.last_retry_at IS NULL;
  GET DIAGNOSTICS cancelled = ROW_COUNT;
  IF cancelled <> held THEN
    RAISE EXCEPTION 'Cancelled % re-pay rows, expected %: nothing written', cancelled, held;
  END IF;

  -- Stop the retry and release the hold: the outcome is applied. From now
  -- on the charge is refunded outside Stripe only: support's refund route
  -- refuses it (REFUNDED_OUTSIDE_STRIPE).
  UPDATE disputes
     SET outcome_applied_at = GREATEST(now(), late_won_at),
         refunded_outside_stripe_at = now()
   WHERE stripe_dispute_id = dispute_id
     AND status = 'won' AND late_won_at IS NOT NULL
     AND outcome_applied_at IS NULL AND late_win_refund_id IS NULL;
  GET DIAGNOSTICS marked = ROW_COUNT;
  IF marked <> 1 THEN
    RAISE EXCEPTION 'Marked % disputes, expected 1: nothing written', marked;
  END IF;

  RAISE NOTICE 'Settled %: % re-pay row(s) cancelled, outcome applied', dispute_id, cancelled;
END $$;
```

Step 3:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT d.status, d.outcome_applied_at, d.late_won_at, d.late_win_refund_id,
       d.refunded_outside_stripe_at
  FROM disputes d
 WHERE d.stripe_dispute_id = 'du_…';
SELECT p.id AS repay, p.status, p.stripe_transfer_id
  FROM payout_reversals r
  JOIN payouts p ON p.id = r.repaid_by_payout_id
 WHERE r.cause_type = 'dispute' AND r.cause_id = 'du_…';
ROLLBACK;
```

## Payout schedule backfill

`packages/database/scripts/backfill-payout-schedule.ts` moves Connect accounts
made before manual payouts (`Codex-2hxff.29`) to `interval: 'manual'` with
`debit_negative_balances: false`, and flags them for the daily bank payout. In
production it writes to live Stripe, so it runs only with the owner's OK, after
the deploy:

1. Deploy. New accounts are manual from creation; the job only pays flagged
   accounts.
2. The owner turns off the three Express Dashboard features above.
3. In **test mode**, dry run and then apply on one production-shaped account
   (`requirement_collection: 'stripe'`), and check Stripe accepted both settings.
4. Production dry run (writes nothing; set `DATABASE_URL` and the live
   `STRIPE_SECRET_KEY` in the shell; no env file is read for production):

   ```text
   pnpm --filter @codex/database exec tsx scripts/backfill-payout-schedule.ts --env production
   ```

   One line per account (our row id, never an email): its `codex_env` tag,
   schedule, bank debit, GBP balance and the action (`switch`, `already manual +
   debit off`, `skip: env tag differs`, `skip: deauthorized`, `skip: Stripe error
   <code>`), then the counts and a checksum of the accounts to switch.
5. The owner reads it and gives the OK. Then apply, with the dry run's checksum:

   ```text
   … --env production --apply --confirm <checksum> --live
   ```

   It refuses if the set to switch changed since the dry run, updates each under
   `codex_manual_payouts_<acct>`, checks what Stripe returns, and only then flags
   the account. A re-run skips the done ones.
6. The next 08:00 London run pays out the money older than 14 days.

**An account that leaves the daily payout.** If someone changes an account's
payout schedule or bank debit in the Stripe Dashboard, its `account.updated`
takes it off the daily bank payout (Stripe's own schedule pays it from then on)
and raises an error alert, `Connect payout settings were changed in Stripe`, with
the `stripeAccountId`. Before it clears the flag it asks Stripe for the live
account, so a late or replayed event does not drop an account whose settings are
right; if Stripe cannot be asked, the flag stays and a different alert says so.
To heal, either put back manual payouts with bank debit off on that account in
Stripe (its next `account.updated` flags it again), or re-run this backfill:
the dry run lists the account as `switch`, and `--apply` switches it and flags
it. An account already back on both settings is listed as
`already manual + debit off` and is flagged without a Stripe write.

## Local development

- `stripe listen --forward-to http://localhost:42072/webhooks/stripe/dev`, with
  every `STRIPE_WEBHOOK_SECRET_*` set to the secret the CLI prints. The dev route
  dispatches each event to the right handler by type. It must route every event
  production handles — **gap**: `Codex-2hxff.24` (no `product.*` or `price.*`).
- Hosted dev endpoints are created by `.github/scripts/setup-stripe-dev-webhooks.sh`.
  Its endpoint list mirrors the production table above: the same endpoints,
  events and connected-accounts scope. Change both together. The script creates
  endpoints and does not update existing ones, so an endpoint made by an older
  copy needs its events edited, or the endpoint recreated. No hosted dev
  environment is deployed today (`ecom-api.dev.revelations.studio` does not
  resolve).
- A Cloudflare tunnel (`ecom-api-local.revelations.studio` → `localhost:42072`)
  can receive real endpoint deliveries locally.
- Seeds refuse live keys. Seeded data should exercise the real fee split and
  include agreements — **gap**: `Codex-2hxff.24`.
- Run the dev stack with `pnpm dev` from the repository root.

## Testing

Continuous integration should exercise the money paths end to end, delivering
signed webhook events (the scheme above) so the handlers run for real.

**What CI proves today** (`e2e/tests/12-purchase-refund-round-trip.test.ts`,
in the E2E API job; owner decision 2026-10-27, "Purchases and refunds"). The
PaymentIntent, its charge and the refunds are real test-mode objects, tagged
`codex_env: test` so production ignores their events. Each event is signed
with the secret of the route production uses. The expected amounts are this
spec's, to the penny:

- **one-off purchase completion → entitlement → payouts**:
  `checkout.session.completed` on `/webhooks/stripe/booking` records the
  purchase and its split and grants the entitlement. It writes one payout row
  per slice, keyed on the charge (`latest_charge`), summing to the price;
- **a full refund**: `charge.refunded` on `/webhooks/stripe/payment` makes the
  purchase `refunded` and ends access. It cancels the unpaid slices and retains
  the platform fee;
- **a partial refund**: access stays, and each slice is reduced by its share,
  rounded down, with the rounding left to the platform.

The creator's Connect account cannot take charges, so the slices are pending:
no transfer is made and none is reversed. A paid slice and its transfer
reversal are still not exercised in CI. Tests 04, 05 and 06 still deliver
invented PaymentIntent ids, so they prove the purchase and its access, and
write no payout rows.

Still **gap** (`Codex-2hxff.25`, later batches):

- a dispute opened and closed;
- subscription created, renewed, cancelled, and its payment failing;
- pending payouts drained when a Connect account becomes payable;
- an agreement changing a split;
- a support grant giving access.

Constraints: one pull request in CI at a time, no sharding of E2E Web, no paid
Neon plan.
