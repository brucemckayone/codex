# Payment system — verified findings (lead session, 2026-10-13)

Legend: [V] = traced by lead in code; [A] = agent-traced, not re-verified by lead; [D] = verified against Stripe docs.

## Architecture (verified)
- Charge model: SEPARATE CHARGES & TRANSFERS ("Codex-h69cg Option B"). Platform is merchant of record.
  One-off Checkout: mode=payment, inline price_data from DB priceCents, no transfer_data/application_fee/on_behalf_of
  (purchase-service.ts:407-445). Slices paid via transfers.create(source_transaction=chargeId). [V]
- Idempotency keys (one-off): `${chargeId}_creator`, `${chargeId}_org_fee`; reversal `${transferId}_reversal${suffix}`. [V]
- Subscriptions: `${chargeId}_org_fee`, `${chargeId}_creator_${creatorId}`, `${chargeId}_creator_pool_owner`, `payout_${payoutId}`,
  upgrade `upgrade_${subId}_${prorationDate}`, resume `resume_${stripeSubId}`, tier price propagate `tier-price-propagate:${rowId}:${priceId}`. [V grep]
- Connect: accounts.create with controller props, key `connect_acct_${userId}`; ONE account per user (uq_stripe_connect_user);
  org -> organizations.primary_connect_account_user_id. [V]
- Ledger: `payouts` (schema/payouts.ts) replaced `pending_payouts` (no prod writers remain). [V]
- Stripe API version pinned 2025-10-29.clover, SDK ^19.2.0 (stripe-client.ts:31). [V]
- Webhook error policy: ServiceError -> 200 ack; only raw Stripe 5xx/conn/ratelimit + network msg patterns -> 500. [V]

## Confirmed defects — one-off purchases
1. [V] Transient DB/Stripe failures acked 200 -> Stripe never retries. handleError wraps all unknown errors into
   InternalServiceError (base-service.ts:111-151, base-errors.ts:248-263); isTransientError false for ServiceError
   (error-classification.ts:45-47); webhook-handler.ts:75-81 returns 200. completePurchase(833), completeCoursePurchase(1174),
   processRefund(2062), processDispute(2400) all end in handleError. => charged buyer with no purchase/access; lost refunds/disputes.
2. [V] Webhook PurchaseService constructed WITHOUT feeConfig/mailer (handlers/checkout.ts:188,299; payment-webhook.ts:268)
   -> purchase-service.ts:580 falls back to DEFAULT_* constants. fee_config_* tables + /api/admin/fees/* have NO effect on one-off sales;
   creator-connect-needed email never sent. Registry wiring (service-registry.ts:782-793) only reaches routes.
3. [V] Any partial refund = full: status refunded + access revoked (purchase-service.ts:1990-2033); 2nd partial refund hits
   "already refunded" early return (1981-1987) -> no further reversal. refundAmountCents = charge.amount_refunded (cumulative).
4. [V] Reversal failure with any code other than insufficient_funds still flips payouts row to 'reversed' (2172-2224) — ledger claims clawback that never happened; no retry.
5. [V] Disputes: only charge.dispute.created handled (payment-webhook.ts:277-287); processDispute revokes access/entitlements but
   never reverses transfers -> platform absorbs chargeback + fee. disputedAt never cleared -> won dispute = permanent access loss
   (verifyPurchase filters isNull(disputedAt), 1655-1661).
6. [V] Transfer failure writes status='failed' (1603-1612); sweep drains only status='pending' (subscription-service.ts:5264-5266) -> stranded.
7. [V] paymentIntents.retrieve failure -> stripeChargeId null -> purchase completes, payouts pipeline no-op (handlers/checkout.ts:165-180).
8. [V partial] Checkout gate = published + priceCents>0 only (purchase-service.ts:304-319); ignores isPurchasable/courseOnly/isTeamOnly/isFollowerGated. [A] access-decision.ts:260-288 branches don't consult purchases -> pay-and-denied possible.
9. [V] Double purchase possible: sessions.create no idempotency key; dup check only on COMPLETED at session-create time; no unique (customer, content) (ecommerce.ts:577-579).
10. [A] Course refund arriving before completion: self-heal parses with content-only schema (1892-1902) -> refund dropped, course granted later.
11. [D] charge.refunds not auto-expanded since API 2022-11-15 (Stripe changelog) -> payment-webhook.ts:155 latestRefund always undefined
    -> stripeRefundId/refundReason always null; reversal idempotency suffix absent. (Contingent on webhook endpoint API version >= 2022-11-15.)

5b. [V] Disputed purchase's PENDING payout rows still get paid: processDispute never touches payouts; the drain
    (subscription-service.ts:3559-3576) selects userId + status='pending' + org scope with NO join to purchases
    (no disputedAt/refunded check). Connect activation (primary drain) or hourly sweep pays the creator/org for a
    charged-back sale. Refunds avoid it (pending -> cancelled_by_refund, purchase-service.ts:2211-2214).
    Unverified: whether Stripe rejects a source_transaction transfer against a disputed charge.
2b. [V] feeConfig ALSO missing on the subscription side: subscription-webhook.ts:217 (has cache/waitUntil/mailer, no feeConfig),
    connect-webhook.ts:122, payouts-sweep.ts:68. [A] only the course-sub service gets one.
    => drain/sweep resolvePayoutFees (min-transfer floor) also falls back to constants.

12. [V] Latent DOUBLE PAYOUT in drain: transfers.create (key payout_${id}) then UPDATE status='paid'
    (subscription-service.ts:3778-3804); if the UPDATE throws, catch counts failed, row stays 'pending'.
    Retry <24h = safe (Stripe returns cached transfer). Stripe prunes idempotency keys after ~24h, so a retry
    after that creates a SECOND real transfer. Needs persistent update failure / sweep gap >24h — low probability,
    no other guard (transfer metadata.pending_payout_id exists but is never checked before re-sending).

## Hand-offs noted by purchases agent [A]
- SubscriptionService in subscription-webhook.ts:217-227 also built without feeConfig.
- Orgless sales missing from /sales; admin complimentary grants write content_access which access-decision never reads; refund_reviews has no reader.

## Doc drift (verified)
- docs/payouts/payout-pipeline.md: describes pending_payouts + (user,org) connect unique — both superseded.
- packages/purchase/CLAUDE.md:52 "destination charge" — wrong (SCT). Also "INSERT contentAccess" flow omits entitlements/payouts.
- packages/subscription/CLAUDE.md:120 "one account per user per org" — wrong (per user).
- workers/ecom-api/CLAUDE.md: route tables omit /agreements, /sales, /courses, /studio/courses, /connect/me, /subscriptions/me; config table says dispute "stub only" contradicting its own endpoint table.
- schema/payouts.ts:181-183 comment "destination-charged creator-payouts" — stale; organizations.ts:38 "accrues to pending_payouts" — stale.
- ecommerce.ts:411-414 purchases comment "Organization: 0%" — stale.
- docs/payouts/fee-configuration.md: claims fee config drives one-off path — false in practice (finding 2).
- 23 GEMINI.md files frozen 2026-01-20 (a4cabe9d), no consumers; docs/archive/README.md already calls them frozen duplicates.
- docs/stripe-connect-subscription-reference.md last touched 2026-04-06 — predates fee config, payouts ledger, per-user Connect, agreements.
