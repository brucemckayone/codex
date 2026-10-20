# One-off purchases deep-dive (purchases-dive agent, 2026-10-13) — persisted verbatim by lead from PART 1-4/4

Read-only; every claim has a file:line ref. "Confirmed" = traced in code; "suspected" = depends on Stripe behaviour not checkable from the repo; "CONFIRMED [docs]" = checked against Stripe documentation.
Lead re-verification status is tracked in bug-ledger.md (V/D/A markers).

Main finding: two reasonable rules combine into a money-loss path. Services wrap every unknown error as a typed InternalServiceError, and the webhook layer treats every typed error as permanent. So a transient DB or Stripe failure during a purchase, refund or dispute gets a 200, and Stripe never retries. The tests miss it because they mock the service throwing a plain Error, which the real service can never throw.

## 1. End-to-end flow of a content purchase
1. Web → ecom-api. POST /checkout/create runs under procedure({auth:'required', rateLimit:'strict'}) with body createCheckoutSchema (workers/ecom-api/src/routes/checkout.ts:89-118). Body: {contentId uuid, successUrl, cancelUrl}. Redirect URLs must be on an allow-listed domain (packages/validation/src/schemas/purchase.ts:28-72,101-105). Calls ctx.services.purchase.createCheckoutSession(body, ctx.user.id).
2. PurchaseService.createCheckoutSession (packages/purchase/src/services/purchase-service.ts:273-490):
- Loads content where id=contentId AND deletedAt IS NULL (282-287).
- Requires status='published' (304-313) and priceCents>0 (315-319).
- Throws AlreadyPurchasedError if a COMPLETED purchase exists (322-332).
- Loads the user's email (368-379); resolves one Stripe Customer per user through withStaleCustomerRecovery (403-458).
- stripe.checkout.sessions.create (407-450): mode 'payment', payment_method_types ['card'], customer cus_…, one line item price_data {currency 'gbp', unit_amount content.priceCents, product_data {name, description≤500, images}} qty 1, success/cancel URLs, metadata {contentId, customerId, organizationId? (left out when orgless), creatorId, contentTitle} (442-448), client_reference_id=customerId.
- NOT passed: payment_intent_data, transfer_data, application_fee_amount, on_behalf_of, transfer_group, expires_at (Stripe default 24h), idempotency key.
3. Returns {data:{sessionUrl, sessionId}} with 200; the browser redirects to Stripe.
4. checkout.session.completed → POST /webhooks/stripe/booking (workers/ecom-api/src/index.ts:205-209).
- verifyStripeSignature picks the secret by exact path, STRIPE_WEBHOOK_SECRET_BOOKING (middleware/verify-signature.ts:27-37,96-102).
- Runs constructEventAsync (packages/purchase/src/stripe-client.ts:119-138); returns 400/501/401 on failure (85-138).
- Wrapped by createWebhookHandler (utils/webhook-handler.ts:41-84).
5. handleCheckoutCompleted (workers/ecom-api/src/handlers/checkout.ts:84-253):
- Skips mode≠payment (94-100); requires a payment_intent (115-123); kind 'course' goes to the course path (128-131); parses checkoutSessionMetadataSchema (134-147).
- amount_total = amount paid (150-157). The price is server-set, so the client can't tamper with it.
- paymentIntents.retrieve → latest_charge (the charge id) + application_fee_amount; a failure is only a warning (163-180).
- createWebhookDbClient (184); new PurchaseService({db, environment}, stripe) with NO feeConfig and NO mailer (188-194).
- completePurchase(pi, {…, currency:'gbp'}), currency hardcoded (198-206).
- Fire-and-forget: library bump (217-224), receipt email (227-249). finally cleanup (250-252).
6. completePurchase, in one transaction (purchase-service.ts:531-789):
- Idempotency: look up by stripePaymentIntentId; if found return {isNew:false} (533-542).
- Content org/creator lookup with no deletedAt filter (548-561); orgId = metadata.organizationId ?? content.organizationId (567-568).
- Fees (580-593); agreement share (630-637); effective org fee (648-652); calculateRevenueSplit + applyMinPlatformFeeFloor (677-686).
- INSERT purchases status='completed' (723-741); UPSERT content_access, un-deleting a refunded row (750-766); content_purchase entitlement, org-scoped only (773-780).
7. After commit (796-822), only if isNew && stripeChargeId: writePurchasePayouts (1203-1360).
- platform_fee row as paid, ON CONFLICT on uq_payouts_platform_fee_per_charge do nothing (1232-1260).
- Creator: transfers.create({amount, gbp, destination creator acct, source_transaction=chargeId, metadata}) with key `${chargeId}_creator` (1302-1316, 1532-1545).
- Org: same call to the org's primary Connect account, key `${chargeId}_org_fee` (1323-1345).
- Each slice ends paid+stripeTransferId, pending/connect_not_ready, or failed/transfer_failed (1437-1626).

Charge type: SEPARATE CHARGES & TRANSFERS (the code calls it "Option B, platform charge"). Reasoning at 334-353: a destination charge auto-transfers the FULL amount and uses up the source-linked balance, so a second source_transaction transfer fails; an inflated application fee doesn't carve out a third-party slice. Platform charges allow several transfers up to charge.amount. packages/purchase/CLAUDE.md:52 ("destination charge") is stale.

Courses: same pattern (850-981, 996-1176; checkout.ts:263-356). Metadata {kind:'course', courseId, customerId, courseTitle}; the org and creator are re-derived from the courses row. Writes a course_purchase entitlement + autoEnroll (entitlement-writer.ts:78-102), no content_access. Reuses content_purchase agreement terms (1042-1050) and writePurchasePayouts (1143-1150).

## 2. What can be bought, pricing, currency
- Content via POST /checkout/create → completePurchase. Course via POST /checkout/course (routes/checkout.ts:127-141) → completeCoursePurchase. /checkout/course-subscription is recurring (other lane). purchases has a split target, exactly one of content/course (schema/ecommerce.ts:432-437,551-554).
- Price is server-side only: unit_amount comes from the DB (purchase-service.ts:390,415,910,924); the recorded amount is session.amount_total (checkout.ts:150). No discounts, promotion codes or tax.
- The checkout gate is only published + priceCents>0 (304-319, 867-880). It does NOT check isPurchasable, courseOnly, isTeamOnly or isFollowerGated (R8).
- GBP is hardcoded in: session creation (414, 923); completion, ignoring session.currency (checkout.ts:203; test checkout.test.ts:629); transfers (1535); the DB default (ecommerce.ts:447). There is no assertGbpOnly at the purchase transfer site, contrary to docs/payouts/payout-pipeline.md:369-377.
- £0/null price is rejected: ContentNotPurchasableError('free') (315-319), CourseNotPurchasableError('no_price') (876-880). DB price≥0 (schema/content.ts:365-368). Purchasable requires price>0 (content-schemas.ts:426-439). Stripe's GBP minimum charge (I believe £0.30; not checked) is not enforced.

## 3. Fee and revenue maths
- calculateRevenueSplit (revenue-calculator.ts:61-158): platform = ceil(amt×bps/10000) (104-106); org = ceil((amt−platform)×orgBps/10000) (113-115); creator = remainder (118-119); sum and non-negative checks (122-151). Platform and org round up; the creator takes the remainder.
- applyMinPlatformFeeFloor (187-205): raises the platform fee to min(floor, amt), taking the shortfall from the creator first, then the org.
- Which percentages apply (580-652): with the fee service injected, getFeesForCreator(org, creator, 'one_off'), or getFeesPlatform('one_off') when orgless (never injected in production, R2). Without it: {1000, 1000, 0, 0} (constants/src/commerce.ts:88-95). Agreement: orgBps = 10000 − creatorShareBps via proposals.proposedCreatorSharePercent (agreement-share.ts:39-82). Orgless: orgBps forced to 0 and logged (639-668). No agreement: org default 10% of post-platform; test purchase-service.test.ts:2074-2101 asserts org 900 / creator 8100 on £100.
- FeeConfigService (fee-config-service.ts): lookup order override → org → platform → constants (173-190, 519-559, 94-112). The platform row has a path-specific org fee (schema/fee-config.ts:60-65); org/override rows have a single orgFeePercent (122-137). VersionedCache, no TTL (563-586); writes bump version, write an audit row per column, invalidate (216-459, 647-653).
- Stripe processing fees aren't modelled: transfers move the full slices, so the platform's 10% covers Stripe's fee.
- Stored as a snapshot on purchases, protected by check_revenue_split_equals_total (ecommerce.ts:453-457,571-575), plus one payouts row per slice. platformAgreementId / creatorOrgAgreementId are always null (737-739).
- Worked examples (pence):
  - £10, org-scoped, no agreement, production constants: platform 100, org ceil(900×0.10)=90, creator 810. Rows: platform_fee paid (chargeId), organization_fee `${ch}_org_fee`, creator_payout `${ch}_creator`. The platform pays Stripe's fee out of its 100.
  - 70% agreement: org 270, creator 630. Orgless: 100/0/900.
  - £4.99: 50/45/404.
  - 50p floor on £2.00 (only if the fee service were injected): raw 20/18/162 → 50/18/132.
  - Partial refund (test 2462-2589): £20 at 10%/15% → 200/270/1530; a £5 refund reverses floor(1530×0.25)=382 and floor(270×0.25)=67, so the platform absorbs 51p.

## 4. Stripe customer handling
resolveOrCreateCustomer (resolve-customer.ts:81-179):
1. Cached users.stripe_customer_id (live user) (89-100).
2. Otherwise customers.list({email, limit:10}) and take the oldest (108-115).
3. Otherwise customers.create({email, metadata.codex_user_id}) with key `codex:resolve-customer:${userId}` (120-131).
4. Save with a conditional UPDATE WHERE stripe_customer_id IS NULL; on a lost race re-read and use the winner (156-178).
DB guard: partial unique users.stripe_customer_id (schema/users.ts:68-70).

Stale recovery (231-262): resource_missing with param 'customer' (189-193) → clear the cached id, resolve again, retry once. That is the ONLY test/live or deleted-customer protection; there is no account-id or livemode check. stripe-customer-integrity.ts (45-116) is exported (index.ts:121-126) with no production caller.
SUSPECTED:
- Within 24h of creation, the retry reuses the same idempotency key and gets back the deleted customer.
- The email match can adopt another or deleted Codex user's Stripe Customer.

## 5. Choosing the destination Connect account
- Creator: stripe_connect_accounts WHERE userId=content.creatorId (purchase-service.ts:1265-1272); unique per user (schema/subscriptions.ts:272). Only chargesEnabled is checked (1437), not status or payoutsEnabled.
- Org: resolvePrimaryConnect (utils/resolve-primary-connect.ts:38-86) uses the primaryConnectAccountUserId pin, else the earliest-joined ACTIVE owner (54-75), then that user's account. Without an org Connect account the row's userId falls back to resolveOrgOwnerId (1331-1332, 1372-1390).
- Not ready:
  - Checkout is NOT blocked.
  - Publishing is gated only for isPurchasable&&price>0 (or tier) content, on the creator's account, which needs chargesEnabled&&payoutsEnabled (content-service.ts:839-853,192-206).
  - At payout time: status 'pending', reason connect_not_ready, with stripeChargeId set (1437-1453). The sweep later drains these row by row (subscription-service.ts:5264-5266; transferPendingGroup 3719-3795; source_transaction when a charge id exists, 3783-3785). Platform charges make that valid.
  - An org with no Connect AND no active owner gets NO ledger row, only obs.error (1346-1358).
  - The creator-connect-needed email is never sent (mailer not wired, R2).

## 6. Webhooks
Endpoints (index.ts:165-255; secrets verify-signature.ts:27-37):
- /payment → STRIPE_WEBHOOK_SECRET_PAYMENT → handlePaymentWebhook
- /booking → _BOOKING → handleCheckoutCompleted
- /dispute → _DISPUTE (optional; 501 when missing, 96-102) → handlePaymentWebhook
- /customer → log stub
- /dev → _BOOKING, routes all event types (dev-webhook-router.ts:35-67), 404 outside dev (index.ts:242-255)
Required env: index.ts:79-86.

Events:
- checkout.session.completed (payment, content) on /booking → completePurchase (checkout.ts:198)
- the same with kind 'course' → completeCoursePurchase (304)
- subscription mode → skipped (94-100)
- charge.refunded on /payment → reverseSubscriptionPayoutsForCharge, then processRefund (payment-webhook.ts:146-198)
- charge.dispute.created on /dispute → processDispute (200-256)
- dispute updated/closed/funds_*, radar.*, payment_intent.* → log only (286-287)
- async_payment_*, session.expired → not handled (card-only today)

Dedup: no event-id table. It relies on unique purchases.stripe_payment_intent_id (ecommerce.ts:470-472) checked inside the transaction, uq_payouts_platform_fee_per_charge, uq_payouts_stripe_transfer_id, the refunded/disputedAt early returns, the entitlement partial uniques, and Stripe idempotency keys.

Retry (webhook-handler.ts:55-82 + error-classification.ts:43-72): 500 only for errors classified transient; 200 otherwise, INCLUDING every ServiceError (45-47). That means all purchase-service failures get 200 (R1). The handler's own early returns are implicit 200s: metadata (checkout.ts:137-147), payment intent (120-123), amount (151-157).

DB lifecycle: createWebhookDbClient (worker-utils/src/webhook-db-client.ts:55-63) with await cleanup() in finally (checkout.ts:250-252,353-355; payment-webhook.ts:289-291). The waitUntil work does no DB.

## 7. Refunds and disputes
Refunds are only started from the Stripe Dashboard; there is no refunds.create in production code.

processRefund (purchase-service.ts:1959-2064):
1. ensurePurchaseDataPresent (1867-1947). Fast path: look up by payment intent. Slow path: sessions.list({payment_intent}) and parse the CONTENT schema (1877-1902), insert a completed row with a default split, run NO payouts (1911-1933).
2. Already refunded → return (1981-1987).
3. One transaction (1990-2033): status refunded + refundedAt + refundAmountCents (= charge.amount_refunded, CUMULATIVE, payment-webhook.ts:175) + stripeRefundId + refundReason; soft-delete content_access; set revokedAt on entitlements by sourceRef.
4. reversePayoutsForPurchase (2094-2235), errors isolated per row:
- Rows with a transfer: createReversal with key `${transferId}_reversal${_refundId|_amount|''}` (2123-2127, 2158-2171); full amount, or floor(row×refund/paid) on a partial (2106-2118).
- insufficient_funds: the row stays paid and a refund_reviews row is inserted (2185-2196, 2244-2285).
- Pending/failed rows → cancelled_by_refund; paid rows → reversed (2211-2224).
Partial refunds are proportional only in the reversal amounts; status, access and pending-row cancellation all treat them as full (R3). refund_reviews (schema/refund-reviews.ts:34-83) is an ops queue (creator_absorbed / platform_absorbed / manually_reversed) with NO reader.

processDispute (2316-2402): no self-heal; returns early if disputedAt is set. One transaction sets disputedAt/reason/stripeDisputeId, soft-deletes content_access and revokes entitlements. Status stays completed; verifyPurchase excludes disputed rows (1656-1663). The webhook bumps the library and writes AccessRevocation when an org exists (payment-webhook.ts:246-249). No transfer reversal, no payout-row change, no won/lost handling (R5, R5b).

## 8. Purchase history and sales routes
- GET /purchases: auth required, api rate limit (routes/purchases.ts:55-69). Filters customerId=user AND contentId IS NOT NULL, so course purchases are hidden (purchase-service.ts:1708-1711). Manual offset (1722), not the mandated withPagination. Returns a PaginatedResult (1773-1792).
- GET /purchases/:id: filtered by id+customerId (1817-1822); another user gets 404 (the route doc's 403 at purchases.ts:84-87 is wrong). Returns the whole row, fee split included.
- GET /checkout/verify (checkout.ts:227-239): ownership via metadata.customerId (purchase-service.ts:2441-2448); purchase/content filled only for content purchases (2479-2492).
- GET /sales and /sales/stats: auth required + requireOrgManagement (owner or admin) (routes/sales.ts:44-78). Scoped to ctx.organizationId, content only (2637-2640, 2759-2762). disputed maps to disputedAt IS NOT NULL (2642-2646). Exposes customer name and email (2681-2706). Orgless sales never appear. Stats: gross = completed+refunded; net = creator+org on completed only; refunded = sum(refundAmountCents) (2768-2780).

## 9. Entitlements: from purchase to access
- Table (schema/entitlements.ts:44-110): userId text, organizationId NOT NULL, exactly one of contentId/courseId (CHECK). source ∈ content_purchase|course_purchase|course_subscription|grant (CHECK); tier_subscription is derived only. Also sourceRef, expiresAt, revokedAt. Partial uniques uq_entitlement_live_content/_course on (user, resource, source) WHERE revokedAt IS NULL.
- Writes: writeContentPurchaseEntitlement, org-scoped only (entitlement-writer.ts:53-72; call site purchase-service.ts:773-780). writeCoursePurchaseEntitlement + autoEnroll (78-102, 192-208). Both onConflictDoNothing.
- Reads: the paid branch of decidePolicyAccess (access/.../access-decision.ts:311-319) grants on the first of:
  1. verifyPurchase (completed, not disputed)
  2. a stored content entitlement (entitlements-resolver.ts:90-108; content_purchase|grant, live)
  3. an owned course (237-260)
  4. a management role
  The tier branch also accepts a purchase (294-307). The courseOnly, team and followers branches NEVER consult purchases (260-288). Purchase grants survive unpublishing (346-378, 388-402).
- content_access is NEVER read by the access decision (no reader anywhere in @codex/access). The library reads purchases (library.ts:305-361). Orgless access relies on verifyPurchase alone.

## 10. Money invariants, constraints, idempotency keys
Schema:
- purchases:
  - stripe_payment_intent_id UNIQUE NOT NULL (ecommerce.ts:470-472)
  - check_purchase_target_one (551-554)
  - check_purchase_status ∈ pending/completed/refunded/failed; only completed is ever inserted (557-560)
  - amounts ≥0 and check_revenue_split_equals_total (563-575)
  - no unique on (customer, content) (577-579)
  - FKs: content/course/org restrict, customerId CASCADE, agreement ids set null (422-467)
- content_access: UNIQUE(user, content); access_type CHECK; user/content/org cascade (25-85).
- payouts:
  - uq_payouts_stripe_transfer_id (where not null) and uq_payouts_platform_fee_per_charge (payouts.ts:107-146)
  - NO unique on (purchaseId, payoutType) for creator/org rows
  - amount>0; status/reason/type/source CHECKs; at most one source reference; userId required unless platform_fee (148-179)
  - paid/reversed rows need (transferId OR chargeId) AND resolvedAt (184-187)
  - FKs: org/user CASCADE, purchaseId set null (40-63)
- refund_reviews: one open row per payout (partial unique); amount>0; resolution CHECK; resolved-pair CHECK; all FKs restrict (refund-reviews.ts:62-82).
- fee_config_*: bps 0–10000, cents ≥0, singleton id, audit scope coherence (fee-config.ts:85-110,154-171,221-237,283-292).
- entitlements: CHECKs + live partial uniques (entitlements.ts:90-108).
- users: partial unique stripe_customer_id (users.ts:68-70). stripe_connect_accounts: UNIQUE(user_id) (subscriptions.ts:272).

Stripe API calls (call | file:line | key params | idempotency key):
- customers.list | resolve-customer.ts:108 | email, limit 10 | n/a
- customers.create | resolve-customer.ts:120-131 | email, metadata.codex_user_id | `codex:resolve-customer:${userId}`
- checkout.sessions.create (content) | purchase-service.ts:407-450 | payment mode, card, customer, GBP price_data, metadata, client_reference_id | NONE
- checkout.sessions.create (course) | purchase-service.ts:916-947 | same, metadata kind 'course' | NONE
- paymentIntents.retrieve | checkout.ts:47,166 | pi id → latest_charge | n/a
- transfers.create | purchase-service.ts:1532-1545 | amount, gbp, destination, source_transaction=chargeId, metadata | `${chargeId}_creator` / `${chargeId}_org_fee`
- checkout.sessions.list | purchase-service.ts:1877-1880 | payment_intent, limit 1 | n/a
- transfers.createReversal | purchase-service.ts:2158-2171 | transferId, amount, metadata | `${transferId}_reversal${suffix}`
- checkout.sessions.retrieve | purchase-service.ts:2437 | session id | n/a
- billingPortal.sessions.create | purchase-service.ts:2574-2577 | customer, return_url | none
- webhooks.constructEventAsync | stripe-client.ts:133-137 | raw body, signature, secret | n/a
- (sweep, other lane) transfers.create for pending rows | subscription-service.ts:3778-3795 | source_transaction=row.stripeChargeId | `payout_${payout.id}`

## 11. Risks, doc drift, hand-offs

HIGH
- R1 CONFIRMED — transient failures get a 200, so Stripe never retries. handleError → wrapError turns any non-ServiceError into InternalServiceError (service-errors/src/base-service.ts:111-151, base-errors.ts:248-263). isTransientError is false for ServiceError (error-classification.ts:45-47), so 200 (webhook-handler.ts:75-81). Affects completePurchase (825-834), completeCoursePurchase (1166-1175), processRefund (2061-2063) and processDispute (2399-2401).
  - Outcomes: charged with no purchase or access; refund unrecorded and access kept; dispute unrecorded.
  - The docblock at 1865 is false.
  - Tests use a plain Error: checkout.test.ts:379-386, webhook-handler.test.ts:71-95.
  - Payouts after commit are at most once: the reads at 1265-1272, 1284-1288, 1298 and 1332 are unguarded, and a replay has isNew=false.
- R2 CONFIRMED — production ignores DB fee config and never sends the connect-needed email. The webhook PurchaseService has no feeConfig, mailer or webAppUrl (checkout.ts:188-194,299-302; payment-webhook.ts:268-271), and those are the only completion callers. The registry wiring (service-registry.ts:782-793) serves routes only. So one_off_org_fee_percent, the overrides and minPlatformFeeCents have no effect; this contradicts fee-configuration.md:100-101,265-266. subscriptions-dive confirms the same gap at subscription-webhook.ts:217-227, connect-webhook.ts:122 and payouts-sweep.ts:68; only CourseSubscriptionService gets one (subscription-webhook.ts:288).
- R3 CONFIRMED — partial refunds behave like full ones. Any refund sets status refunded and revokes access (1990-2033). Pending/failed rows are cancelled in FULL (2211-2214). Paid rows flip to reversed after only a proportional reversal (2216-2224). A second partial returns early (1981-1987): no reversal of the extra amount, stale refundAmountCents. Sales net goes to 0 (2775).
- R4 CONFIRMED — failed reversals are recorded as successful. A reversal error other than insufficient_funds (or insufficient_funds with a null userId) still sets the row to reversed (2172-2224), and nothing retries.
- R5 CONFIRMED — disputes recover nothing and access never returns. No transfer reversal on dispute.created; closed/won/lost is log-only (payment-webhook.ts:286-287; index.ts:213-218). A won dispute keeps access revoked forever (disputedAt never cleared; verifyPurchase 1661). A lost dispute leaves the platform covering everything while transfers stand; Stripe's Connect docs say the platform is liable under separate charges & transfers. SUSPECTED (subscriptions-dive agrees): the comment at payment-webhook.ts:211-214 that a lost dispute fires charge.refunded is false; the money leaves via charge.dispute.funds_withdrawn.
- R5b CONFIRMED — disputed sales still get paid out. processDispute never touches payout rows, so pending (connect_not_ready) slices stay pending, and the hourly sweep pays them (subscription-service.ts:5264-5266, 3719-3795) once the creator onboards. Refunds avoid this via cancelled_by_refund (2211-2214).

MEDIUM
- R6 CONFIRMED — failed transfers are stranded. Any transfer error writes status failed with no stripeChargeId (1603-1612); the sweep selects pending only.
- R7 CONFIRMED — a payment-intent lookup failure means the creator is never paid: stripeChargeId null, purchase completes, no payouts ever (checkout.ts:172-180; purchase-service.ts:804-822). Error log only.
- R8 CONFIRMED — buyers can pay for content they can't open. Checkout gate is published + price>0 (304-319). The courseOnly (260-264), team (267-272) and followers (280-288) branches ignore purchases. Schemas allow courseOnly+price (content-schemas.ts:426-533). The publish gate uses isPurchasable&&price (content-service.ts:839-841), so isPurchasable=false + price content publishes with no Connect check and is still sold. UI reachability SUSPECTED.
- R9 CONFIRMED — double purchase. No idempotency key or expires_at on the session; the duplicate check runs only at session creation (322-332, 885-894); no DB or completion guard (ecommerce.ts:577-579). Two open sessions mean two charges and two payouts. No check for access via subscription/tier, although the CourseAlreadyOwnedError docblock claims one (errors.ts:112-115).
- R10 CONFIRMED — a course refund that beats completion is dropped (content-only schema at 1892-1902; validation/schemas/purchase.ts:163-168). completeCoursePurchase later grants access and attempts transfers. Whether Stripe rejects those transfers is SUSPECTED.
- R11 CONFIRMED [docs] — refund id and reason are always null. charge.refunds?.data?.[0] (payment-webhook.ts:155) is empty because Stripe stopped auto-expanding refunds in 2022-11-15; the code pins 2025-10-29.clover (stripe-client.ts:31). purchases.stripe_refund_id and refund_reason are never filled. The reversal key falls back to cumulative amount_refunded (2123-2127); the subscription clawback has the same fallback (payment-webhook.ts:163-166).

LOW
- R12 refund_reviews has no reader at all.
- R13 The platform pays Stripe's fee out of its 10%, so cheap items lose money (magnitude SUSPECTED: ~10p fee vs ~20p+ Stripe fee on £1). The floor that would fix it isn't wired.
- R14 Orgless purchases get no entitlement and don't appear in /sales (2638).
- R15 The org slice is stranded when the org has neither Connect nor an active owner (1346-1358).
- R16 The fee-config audit log records changes that never happen: null is accepted as "inherit" (validation/schemas/fee-config.ts:54-57,74-78), but the merge does `?? existing` (fee-config-service.ts:294-302,374-383), while the audit logs 'null' (126-142).
- R17 Admin complimentary grants write only content_access (admin customer-management-service.ts:395), which access never reads.
- R18 The library ignores disputedAt (library.ts:315-320).
- R19 One-off refunds write no AccessRevocation KV key (payment-webhook.ts:191-195), so issued HLS tokens stay valid until they expire.
- R20 Receipt email re-sent on every redelivery (checkout.ts:227-249). Refund email sent with no matching purchase, and with charge.metadata.contentTitle, which is never set (payment-webhook.ts:131). purchasedAt not reused (733 vs 624). Fee reconciliation is dead under the platform-charge model (706-720).
- R21 The handler never checks payment_status; a test pins processing 'unpaid' sessions (checkout.test.ts:692). Safe only while payments are card-only.
- R22 A user hard-delete cascades to purchases and payouts (ecommerce.ts:422-424; payouts.ts:40-47).
- R23 SUSPECTED (other lane): if a sweep transfer succeeds but the UPDATE fails (subscription-service.ts:3797-3804), the row stays pending; the payout_${id} key only lasts 24h.

DOC DRIFT (confirmed unless noted)
- purchase CLAUDE.md: :51 names a nonexistent fee_config_org.one_off_org_fee_percent column; :52 says destination charge; :33 says processRefund "issues" refunds; :94 says fees come from constants, against fee-configuration.md.
- docs/payouts/README.md:34-37 says the org keeps all post-platform; the actual default is org 10% / creator 90% (purchase-service.ts:645-647; test 2074).
- fee-configuration.md:15-16 (stale "at most one request"; SUSPECTED) and :100-101 (one-off resolves through the fee service; not injected).
- payout-pipeline.md:369-377 requires assertGbpOnly at transfer sites; the purchase transfer site has none.
- ecom-api CLAUDE.md: :129 dispute secret "stub only"; :104 refund flow incomplete; :142 "always return {received:true}".
- processDispute docblock (2304-2306) says organizationId NOT NULL.
- routes/purchases.ts:84-87 documents 403; the code returns 404.
- verify-signature.ts:75-77 says 501 stops retries (SUSPECTED false).
- ecommerce.ts:411-414 says Phase 1 org 0%.
- library.ts:262-283: "pending purchase" branches handle a status that is never written.

HAND-OFFS
- Subscriptions: SubscriptionService in webhooks lacks feeConfig; the sweep handles pending only and pays out disputed pending rows (R5b); charge.refunded runs reverseSubscriptionPayoutsForCharge before the purchase path (payment-webhook.ts:163-166), and its unguarded select (subscription-service.ts:4445-4453) can block purchase refunds.
- Frontend/infra: Stripe Dashboard endpoint event subscriptions; missing STRIPE_WEBHOOK_SECRET_DISPUTE → 501; orgless sales missing from views; admin complimentary grants don't grant access; the success page's verifyCheckoutSession fills content purchases only (2479-2492).

Sources: https://docs.stripe.com/changelog/2022-11-15/deprecates-charges-auto-expand ; https://docs.stripe.com/connect/disputes
