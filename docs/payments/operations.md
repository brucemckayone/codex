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

Both run at minute `0` so they share one database wake
([why](connect-and-payouts.md#releasing-pending-money)). The daily bank payout
(`Codex-2hxff.29`) is not a cron of its own: it is the payouts sweep's run whose
London hour is 8, last in that wake.

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
