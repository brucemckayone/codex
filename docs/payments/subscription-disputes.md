# Subscription disputes: pause, restore, cancel

**Status: AGREED by the owner, 2026-10-19 (§7 Q-A and Q-B decided, both as recommended).** This is the data design for Codex-2hxff.9's second PR. The money side shipped in the first: reversals, the hold, the re-pay and the cancel all act on subscription invoices already ([dispute-record.md](dispute-record.md)).

---

## 1. What is decided

- **A disputed subscription invoice pauses access while the chargeback is open.** A win restores it. A loss cancels the subscription and ends access ([subscriptions.md](subscriptions.md#disputes), owner decision P-2).
- **An inquiry keeps access** (dispute-record.md Q1).

## 2. Before this design

A chargeback on a subscription invoice moved the money, but the subscriber kept watching. If the dispute was lost, the subscription kept renewing.

## 3. Why the subscription's status cannot carry the pause

- **Access is granted for `active` and `cancelling`.** That check is in five queries in `@codex/access`. A failed renewal blocks access by becoming `past_due`.
- **Our status mirrors Stripe's on every subscription event** (`stripe-status-mapper.ts`). A pause written into `status` would be overwritten at the next renewal or update.
- **The KV streaming block cannot carry it either.** It lasts 20 minutes and is read only when a streaming URL is issued, where the database already refuses a paused subscription. A URL issued before the pause plays until it expires. Our own billing pause also fires `customer.subscription.updated`, whose `active` status clears the block.

## 4. What Stripe does (verified in Stripe's documentation, 2026-10-19)

- **A disputed subscription keeps renewing.** Stripe: "the subscription continues to cycle, which can create more disputed charges."
- **Stripe can cancel it for us.** The Dashboard setting "Manage disputed payments" can cancel at once or at period end. That conflicts with "a win restores it", so it must stay off (an owner check, §6).
- **Billing can be paused without changing the status.** With `pause_collection` set to `void`, the subscription stays `active`, and each new invoice is voided, not charged. Unsetting it resumes billing from the next renewal. Nothing in the codebase uses `pause_collection` today.
- **Cancelling** is immediate by default. It fires `customer.subscription.deleted`, which our webhook already handles: access ends, and the usual `subscription-cancelled` email is sent.

## 5. Design

### Records

- **`subscriptions.disputed_at` and `course_subscriptions.disputed_at`** (nullable): set while a chargeback on one of the subscription's invoices is open. They mirror `purchases.disputed_at`.
- **`disputes.subscription_id` and `disputes.course_subscription_id`** (nullable): the subscription the disputed invoice belongs to, so later events find it directly.
  - It is found from the charge's payout rows: every invoice writes at least its platform-fee row, with the charge id.
  - If there are no payout rows, it is found from Stripe (the invoice paid by the charge's payment intent).

### Access

- **The five tier-subscription access queries add `disputed_at IS NULL`.** The library then hides the subscription's items, as it does for `past_due`.
- **A course subscription's stored grant** (`entitlements.source = 'course_subscription'`) is paused while the buyer has a course subscription to that course that is disputed and has not ended: `disputed_at` set and `ended_at` null. The check is in the resolver, not on the grant, because the grant is rewritten by the subscription's own lifecycle: a revoked grant would be re-granted by the next subscription event, including the one our own billing pause fires.
  - It matches the buyer and the course, not the grant's `source_ref` (Codex-2hxff.59). A grant that outlived its subscription (for example, after a lost `customer.subscription.deleted`) can be carried on by the next one without its `source_ref` changing, and a dispute on that next one still pauses it.
  - An ended subscription never pauses: a lost dispute leaves `disputed_at` set on the cancelled row, and the buyer's re-subscription must not be paused by it.
  - A duplicate subscription (Codex-2hxff.15) grants nothing, so its dispute does not pause the buyer's real one.

### Events

| Event | What happens to the subscription |
|---|---|
| Inquiry | Nothing (Q1) |
| Chargeback opened | `disputed_at` set; the streaming block written; library caches cleared. Billing paused: `pause_collection = { behavior: 'void' }` (Q-A) |
| Won | `disputed_at` cleared and billing resumed (`pause_collection` unset), unless another chargeback on the same subscription is still open, or lost (it is being cancelled); the block cleared. A course subscription's grant moves to the current period end: renewals voided during the pause never moved it |
| Lost | Cancelled at Stripe at once, with no proration: the bank has already returned the money. The existing `customer.subscription.deleted` handling then ends access and sends the cancellation email |

A subscription that is already cancelled when the event arrives gets no Stripe call. Only its access marker changes.

### Retries

- Every step can run twice safely:
  - `disputed_at` is set only when it is null;
  - each Stripe call carries an idempotency key built from the dispute id;
  - a cancel accepts a subscription that is already cancelled.
- A failed Stripe call throws, so Stripe redelivers the event.
- `outcome_applied_at` is set only after the subscription step succeeds, so a lost dispute keeps its hold until then.

## 6. Owner checks (no code)

- **Stripe Dashboard → Billing → Subscriptions → "Manage disputed payments"** must be set to do nothing. If it cancels, a won dispute cannot be restored.

## 7. Owner decisions (2026-10-19, both as recommended)

- **Q-A: billing is paused while a chargeback is open.** `pause_collection` with `void`: the subscription stays `active` and no renewal is charged while access is paused. A win resumes billing from the next renewal; a loss cancels the subscription. This replaces "no Stripe change" in dispute-record.md §5.
- **Q-B: no new notice in this PR.** The subscriber sees locked content while the account page still says Active. A notice is filed, to be mocked up first: Codex-2hxff.60.

## 8. Known limits (from review, 2026-10-19)

These are accepted for now; each is rare. The first is tracked in Codex-2hxff.59, the second in Codex-2hxff.61. (An inherited course grant is now paused too: §5, Access.)

- **A chargeback that ends `prevented` is treated as a closed inquiry.** Nothing is restored, re-paid or resumed, and `outcome_applied_at` stops any later event. Stripe's API lists `prevented` but does not say whether an open chargeback can reach it; we have not seen it happen.
- **Streaming URLs already issued keep playing until they expire.** The HLS proxy checks only its token, not the revocation block (Codex-2hxff.61). This applies to every access cut, not only disputes.
