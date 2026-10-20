# Subscriptions / Connect / Payouts deep-dive (subscriptions-dive agent, 2026-10-13) — persisted verbatim by lead from PART 1-7/7

Method: read-only. All production code in scope read in full, including all 5,364 lines of subscription-service.ts; test describe/it names skimmed. No tests, migrations or dev server run. CONFIRMED = traced in code. SUSPECTED = depends on event ordering or on Stripe behaviour not tested. All line refs are files under /Users/brucemckay/development/Codex; bare `:NNNN` = packages/subscription/src/services/subscription-service.ts unless noted.
Lead re-verification status is tracked in bug-ledger.md (V/D/A markers).

## PART 1 — Summary + verification of lead's points (a)–(d)

TOP RISKS (detail in PART 6)
- R1 CONFIRMED. Creator pool silently stranded. Applies to an org with no agreements (or all-zero shares) whose primary Connect account is missing or not chargesEnabled. transferCreatorPoolToOwner returns early with no ledger row (:4328-4330). Its docstring (:4311-4314) wrongly says the org-fee pending row covers this; that row is only the 15% org slice (:4778-4783, :4880-4893). At default fees that strands 765p per £10 invoice, permanently.
- R2 CONFIRMED. status='failed' (transfer_failed) rows are never retried. Both drains only select status='pending' (:3565, :5265).
- R3 CONFIRMED. Tier price propagation ignores billing interval. Both propagator thunks drop args.interval (packages/worker-utils/src/procedure/service-registry.ts:1000-1004; workers/ecom-api/src/handlers/subscription-webhook.ts:255-259). The service filters only tier+status+org (:3956-3967), so ALL subscribers on the tier, monthly and annual, are moved to the changed price.
- R4 CONFIRMED. Primary payout drain is dead for every Connect account created since #273 (commit 6bde7b87, 2026-06-01). accounts.create metadata is {codex_user_id} only (connect-account-service.ts:235-237). connect-webhook requires a UUID codex_organization_id (workers/ecom-api/src/handlers/connect-webhook.ts:27-29, 107-116), else WARN and skip. Only the hourly, production-only cron drains.
- R5 CONFIRMED. FeeConfigService is not injected on any webhook/cron money path (details in (a) below).
- R6 CONFIRMED path, frequency SUSPECTED. Webhook redelivery duplicates pending/failed ledger rows, which the drain then pays twice. No unique index on non-paid rows, no event-id dedup, no pre-check in executeTransfers (:4622-4626).
- R7 CONFIRMED path. A duplicate concurrent subscription (two checkout tabs) gets billed with no DB row, no access, no transfers, and the webhook acks 200.
- R8 CONFIRMED. Refund clawback marks rows 'reversed' even when the reversal FAILED (any error other than code 'insufficient_funds'). A second partial refund claws back nothing.
- R9 CONFIRMED in code, not exercised. IDOR on POST /connect/dashboard: the org is authorised from query/subdomain but the handler acts on body.organizationId, so it can mint an Express login link for another org's settlement account.
- R10 Disputed charges: pending payout rows survive a chargeback and the hourly sweep later PAYS them (confirmed jointly with purchases-dive).

(a) CONFIRMED. subscription-webhook.ts:217-227 builds SubscriptionService with {db, environment, cache, waitUntil, mailer, webAppUrl} and NO feeConfig. The same omission is at connect-webhook.ts:122-125, workers/ecom-api/src/handlers/payouts-sweep.ts:68 and workers/ecom-api/src/handlers/payment-webhook.ts:272-275. Trace:
- computeSubscriptionSplit (:690-709) → resolvePayoutFees (:648-679). With no feeConfig it returns {platformFeePercent: FEES.PLATFORM_PERCENT=1000, orgFeePercent: orgless?0 : subscription? FEES.SUBSCRIPTION_ORG_PERCENT=1500 : FEES.ORG_PERCENT=1000, minPlatformFeeCents:0, minTransferCents:0} (:653-668; constants at packages/constants/src/commerce.ts:88-95).
- Per-creator fees inside executeTransfers (:5014-5018) and the drain's group floor (:3737-3741) hit the same fallback. So fee_config_* overrides, minPlatformFeeCents and minTransferCents NEVER apply to org-subscription invoices, the connect drain or the sweep. min_transfer_floor rows are never written on the subscription path.
- Only the registry instance (service-registry.ts:966, used by routes such as changeTier) and the course-sub instance in the webhook (subscription-webhook.ts:284-296) get feeConfig. Result: changeTier writes a split snapshot from DB config (:2404-2420) that the next invoice overwrites with the constants split (:1489-1507).
- git log -S "feeConfig" on these handlers shows only 89df7913 (course path), so this was never wired, not a regression.

(b) CONFIRMED with nuance. BaseService.handleError rethrows ServiceErrors and wraps everything else via wrapError into ConflictError ('unique constraint' in message) or InternalServiceError (packages/service-errors/src/base-service.ts:111-151; base-errors.ts:248-263). isTransientError returns false for any ServiceError (workers/ecom-api/src/utils/error-classification.ts:44-47), so the webhook acks 200 (workers/ecom-api/src/utils/webhook-handler.ts:75-81).
Which methods end in handleError (subscription package):
- subscription-service.ts: createCheckoutSession :919, verifyCheckoutSession :1031, previewTierChange :2237, changeTier :2458, cancelSubscription :2509, resumeSubscription :2611, reactivateSubscription :2660, propagateTierPriceToActiveSubscriptions :4121.
- tier-service.ts: createTier :327, updateTier :536, deleteTier :623, reorderTiers :738, applyStripeProductUpdate :810, applyStripePriceCreated :942.
- connect-account-service.ts: createAccountForUser :299.
- course-subscription-service.ts: createPlan :238, savePlanPrices :463, deactivatePlan :555, createCheckoutSession :667.
NOT wrapped (raw errors propagate, so transient classification works): every SubscriptionService webhook handler (handleSubscriptionCreated/Updated/Deleted/Paused/Resumed, handleInvoicePaymentSucceeded/Failed, handleTrialWillEnd), executeTransfers, resolvePendingPayouts, sweepUnresolvedPayouts, ConnectAccountService.handleAccountUpdated/Deauthorized, and all CourseSubscriptionService webhook handlers.
Consequences:
- (i) The webhook-path TierService.applyStripeProductUpdate/applyStripePriceCreated ARE wrapped. A transient DB/Stripe failure during Dashboard sync-back becomes InternalServiceError, which is acked 200, so the price/product sync is lost permanently.
- (ii) ServiceErrors thrown directly inside handleInvoicePaymentSucceeded are acked 200 even where the code assumes a retry. ensureSubscriptionDataPresent's 'row missing after insert' InternalServiceError (:1224-1229) has a comment saying it "surfaces as 5xx (Stripe retry)", which is wrong. The same applies to the course ensureDataPresent (course-subscription-service.ts:758-763). UnsupportedCurrencyError (:1514-1518) is thrown AFTER the subscription UPDATE (:1495-1507) and acked 200, so there are no transfers and no ledger rows.
- (iii) executeTransfers swallows its own Stripe and ledger-insert errors (it logs, and money or obligations are lost with only a log line; e.g. :4820-4833, :4856-4863, :5186-5196). Its unwrapped DB reads (resolvePrimaryConnect :4660, agreements :4695, creator connects :4965) throw raw errors, so a transient failure gives 500, Stripe retries, and partially-written pending rows get duplicated (R6).
- (iv) resolvePendingPayouts runs in waitUntil after the connect webhook has already returned, with errors caught by .catch (connect-webhook.ts:126-144), so its failures never affect the HTTP status. Per-row errors are isolated (:3811-3822).
- (v) The raw unique-violation in ensureSubscriptionDataPresent (:1201-1215) is not a ServiceError, but its message has no transient pattern, so it is acked 200 as well (R7).

(c) CONFIRMED. Subscription-path transfer failures write status='failed', reason='transfer_failed': org fee :4842-4855, creator-pool-to-owner :4386-4399, per creator :5125-5136, course sub course-subscription-service.ts:1239-1248. The course row also lacks stripeChargeId and transferGroup, so it is invisible to refund reversal. resolvePendingPayouts (:3565) and the sweep (:5264-5266) select only 'pending'. No other retry path exists: grep for retryCount/lastRetryAt/'failed' updates finds only schema/migrations, and admin-api has no payouts retry route. retryCount and lastRetryAt (packages/database/src/schema/payouts.ts:95-96) are never written. Purchase 'failed' rows behave the same per purchases-dive (purchase-service.ts:1603-1612, also without stripeChargeId).

(d) CONFIRMED and the drift is broad: the doc describes the pre-ledger design throughout. Line-by-line list in PART 7.

## PART 2 — §1 Data model, §2 Tier management, §3 Subscribe flow and charge model

§1 DATA MODEL
- subscription_tiers (packages/database/src/schema/subscriptions.ts:28-87): org-scoped, FK cascade (:32-34).
  - priceMonthly/priceAnnual in pence (:39-40). One Stripe Product + monthly + annual Price ids (:43-45). isActive, isRecommended (:47-48), soft delete deletedAt (:58).
  - sortOrder is unique per org among non-deleted rows (:69-71) and IS the access hierarchy (higher = more access).
  - uq(id, organization_id) is a composite-FK target (:77-80). CHECKs: prices >= 0, sortOrder > 0 (:83-85).
  - Validation: price min 100p, max 10,000,000p (packages/validation/src/schemas/subscription.ts:61-67).
- subscriptions (:100-208):
  - userId FK cascade, organizationId FK cascade, tierId FK RESTRICT (:104-113). stripeSubscriptionId UNIQUE (:115-117).
  - Status CHECK: active | past_due | cancelling | cancelled | incomplete | paused (:174-177). billing_interval CHECK month|year (:178-181). churn_reason CHECK (:185-188).
  - Split snapshot amountCents = platformFee + organizationFee + creatorPayout (CHECK :203-206).
  - One live sub per user+org: partial unique WHERE status IN (active, past_due, cancelling) (:169-171).
  - Relationship: user → org → tier. Stripe-side linkage is metadata codex_user_id / codex_organization_id / codex_tier_id (subscription-service.ts:887-893).
- Billing-interval vocabularies (memory note CONFIRMED): wire/DB/Stripe use 'month'|'year' (billingIntervalEnum validation/subscription.ts:34; DB CHECK :180), while tier/plan columns use priceMonthly/priceAnnual. Mapping happens at checkout (:831-834).
- stripe_connect_accounts (:225-280): ONE per user (unique uq_stripe_connect_user :272).
  - stripeAccountId UNIQUE (:240-242). userId cascade (:236-238). organizationId nullable and vestigial, SET NULL (:233-235).
  - Status CHECK onboarding|active|restricted|disabled (:275-278). chargesEnabled/payoutsEnabled booleans.
- organizations.primaryConnectAccountUserId → users, SET NULL (packages/database/src/schema/organizations.ts:40-42) is the org→settlement-account link. The comment at :37-38 saying it "accrues to pending_payouts" is stale.
- pending_payouts (:289-330) is LEGACY. Per schema/payouts.ts:29-31 it gets no new inserts; migration 0064 moved rows to payouts (transfer_failed → status 'failed').
- payouts ledger (schema/payouts.ts:33-189) and the course tables: see PART 5 constraints table and §5.

§2 TIER MANAGEMENT (packages/subscription/src/services/tier-service.ts)
- Create (:187-329):
  - requireActiveConnect: primary connect must be chargesEnabled && payoutsEnabled (:192, :1018-1023).
  - nextSortOrder includes soft-deleted rows (:197-205).
  - products.create + 2 prices.create with idempotency keys from crypto.randomUUID() per call (:208-245), so they protect only the SDK's in-call retries, not client retries.
  - isRecommended single-ness is enforced in a transaction (:264-273).
  - Orphan cleanup: archive product if the DB insert fails (:281-313).
- Update (:338-538): a price change creates a NEW Price on the same Product and archives the old one, monthly (:369-390) and annual (:392-412).
  - Product name/description update (:416-426). DB update; on failure rollbackStripePriceChanges archives the new prices and re-activates the old (:474-496, :1033-1135).
  - After commit, firePropagation once per changed interval, passing {tierId, newStripePriceId, organizationId, interval} (:517-532, :129-150).
- EXISTING SUBSCRIBERS: they are moved to the new Price by SubscriptionService.propagateTierPriceToActiveSubscriptions (:3946-4123).
  - Scope: tier + status IN (active, cancelling) + optional org (:3956-3967). Batches of 8 with 50ms gaps (:3951-3953, :4016-4095).
  - Per sub: subscriptions.retrieve, then subscriptions.update({items:[{id,price}], proration_behavior:'create_prorations'}), key tier-price-propagate:${subRowId}:${newPriceId} (:4020-4039). Then a price-change email (:4159-4269).
  - The DB row is reconciled by the customer.subscription.updated webhook, not written directly.
  - BUG R3: interval is dropped by both thunks (service-registry.ts:1000-1004; subscription-webhook.ts:255-259), so annual subs get the monthly price and vice versa. If both intervals change, two waitUntil runs race and the last write wins. The email shows the tier's annual column for annual subscribers (:4205-4208) while Stripe now bills the monthly price. No test covers interval filtering.
- Delete (:551-625): blocked if any sub on the tier has status NOT IN ('cancelled') (:556-568).
  - One transaction soft-deletes (deletedAt, isActive=false, isRecommended=false) and clears content.includedInTierId (:574-595). products.update active:false after commit (:600-604).
- Reorder (:672-740): must include every tier; two-phase temp-offset update in a transaction. NOTE: reordering changes sortOrder, which changes existing subscribers' access level.
- Dashboard sync-back (via the subscription webhook):
  - product.updated → applyStripeProductUpdate mirrors name/description (:759-812).
  - price.created → applyStripePriceCreated adopts an active recurring price with codex_organization_id metadata as canonical for that interval, archives the old, propagates (:838-944).
  - price.updated is log-only (subscription-webhook.ts:673-691).
  - Both are wrapped by handleError (:810, :942), so transient failures are acked 200 and the sync is lost.
- Archived-tier semantic: getTierForAccessCheck has no deletedAt filter (:964-974). The access decision likewise looks up the content tier without a deletedAt filter (packages/access/src/services/content-access/access-decision.ts:233-238).

§3 SUBSCRIBE FLOW AND CHARGE MODEL
- web → POST /subscriptions/checkout (auth required, rateLimit strict; workers/ecom-api/src/routes/subscriptions.ts:109-126) → SubscriptionService.createCheckoutSession (:773-921):
  1. Tier active, not deleted, in org (:782-797).
  2. No active/cancelling/past_due sub for user+org (:800-818). This check only runs at session creation.
  3. resolvePrimaryConnect(orgId) must be chargesEnabled && payoutsEnabled (:824-828).
  4. Pick the monthly or annual price id (:831-841).
  5. withStaleCustomerRecovery resolves one unified Stripe Customer per user (users.stripe_customer_id, self-heals stale ids) (:852-902).
  6. stripe.checkout.sessions.create (:875-894): mode 'subscription', customer, line_items [{price, quantity 1}], success_url/cancel_url (allow-listed by checkoutRedirectUrlSchema, packages/validation/src/schemas/purchase.ts:51-63), metadata {codex_user_id, codex_organization_id, codex_tier_id, codex_billing_interval}, subscription_data.metadata {user, org, tier}.
     - NO application_fee_percent, transfer_data or on_behalf_of.
     - NO trial, NO payment_method_types (so Dashboard dynamic payment methods apply), NO idempotency key.
- Stripe → checkout.session.completed (subscription-webhook.ts:355-405) → subscriptions.retrieve → handleSubscriptionCreated (:1272-1331) → ensureSubscriptionDataPresent (:1065-1253):
  - One transaction: INSERT subscription with status HARD-CODED ACTIVE (:1160), regardless of Stripe status or session payment_status.
  - amountCents from latest_invoice.amount_paid (:1129-1136). Split from computeSubscriptionSplit (:1146).
  - Follower row onConflictDoNothing (:1172-1175). Membership upsert role 'subscriber' preserving owner/admin/creator (a 'member' becomes 'subscriber') (:1179-1197).
  - Then welcome email (:1318-1324) and cache invalidation (:1328).
  - customer.subscription.created is NOT handled (falls to the default case, subscription-webhook.ts:718-721).
- The success page polls GET /subscriptions/verify (routes :135-147; service :940-1033; ownership via session.metadata.codex_user_id :961-966) until the row exists.
- Charge model: SEPARATE CHARGES AND TRANSFERS. The invoice charge lands on the platform account; on each invoice.payment_succeeded the platform makes several transfers.create calls with source_transaction=chargeId and transfer_group=sub_${subId} (§7).
  - WHY (docs/stripe-connect-subscription-reference.md:46-59): direct and destination charges support only one connected account, and each payment has three parties (platform, org, creators).
  - Consequence: Stripe processing fees are debited from the platform's balance (ref doc :61-77). At the £1.00 minimum tier the platform's 10p fee is below the ~21.5p UK card fee, and the minPlatformFeeCents floor that would fix it is not applied on the webhook path (R5).

## PART 3 — §4 Lifecycle, §5 Course subscriptions, §6 Stripe Connect

§4 LIFECYCLE
State diagram (DB status):
  [checkout.session.completed / self-heal] --inserts ACTIVE always (:1160)--> ACTIVE
  ACTIVE --cancel route (:2472-2511) or sub.updated with cancel_at_period_end--> CANCELLING
  CANCELLING --reactivate route (:2619-2662)--> ACTIVE
  CANCELLING --sub.deleted at period end (:1879-1951)--> CANCELLED
  ACTIVE --invoice.payment_failed (:1625-1631)--> PAST_DUE
  PAST_DUE --invoice.payment_succeeded (sets ACTIVE unconditionally :1500)--> ACTIVE
  PAST_DUE --sub.deleted (dunning exhausted, per Dashboard setting)--> CANCELLED
  ACTIVE --sub.paused (:1979-2014)--> PAUSED
  PAUSED --sub.resumed webhook (:2046-2092) or POST /resume (:2549-2613)--> ACTIVE
  any --invoice.payment_succeeded--> ACTIVE   (includes CANCELLING, and CANCELLED if the event lands late)
- Stripe → DB mapping, resolveStatus (packages/subscription/src/services/stripe-status-mapper.ts:39-63): active → cancelling if cancel_at_period_end; past_due; canceled → cancelled; incomplete; paused. trialing / unpaid / incomplete_expired keep the PRIOR DB status.
  - mapStripeSubscriptionStatus takes amountCents from price.unit_amount (:91) and tierId from metadata codex_tier_id (:92), NOT from the price.
- Access per state: only active|cancelling AND currentPeriodEnd > now grant access (access-decision.ts:220-228; entitlements-resolver.ts:53-56, 145-150). past_due, paused and cancelled deny immediately; there is no dunning grace.
  - Access-reducing events also write a KV revocation key, TTL 1200s (subscription-webhook.ts:66-100; packages/access/src/services/access-revocation.ts:51): deleted, paused, payment_failed, sub.updated status 'unpaid' (:442-444).
  - Access-restoring events clear it: sub.updated status 'active' (:460-462), resumed (:546), invoice succeeded (:599), reactivate/resume routes (routes/subscriptions.ts:280, :322).
- Tier change: previewTierChange (:2155-2239) uses invoices.createPreview with always_invoice and proration_date=now. changeTier (:2266-2460):
  - isUpgrade = newRecurringPrice > sub.amountCents (:2316-2320).
  - Upgrade: proration_behavior 'always_invoice' + payment_behavior 'error_if_incomplete', key upgrade_${sub.id}_${prorationDate} (:2325-2354). On 402 → SubscriptionPaymentRequiredError, and Stripe reverts (:2355-2384).
  - Downgrade: 'create_prorations', effective IMMEDIATELY (scheduled downgrade = Phase 2, not built :2255-2259; matches memory project_tier_change_epic).
  - Metadata codex_tier_id is updated (:2343-2347). The DB mirrors tier/interval/amount/split best-effort (:2404-2435).
  - prorationDate is client-supplied (validation/subscription.ts:129, positive int, no bound).
  - Interval change uses the same path. Monthly→annual compares the annual price to the monthly amount, so it counts as an "upgrade".
- Cancel = subscriptions.update cancel_at_period_end:true, no idempotency key (:2481-2483), DB CANCELLING with reason + churnReason (:2485-2493). Reactivate = cancel_at_period_end:false (:2632-2634), requires DB status CANCELLING (:2626-2630). There is no immediate-cancel API.
- Pause/resume: user resume = subscriptions.resume(billing_cycle_anchor 'unchanged'), key resume_${stripeSubId} (:2578-2582); DB ACTIVE (:2584-2590).
- Payment failure / dunning: invoice.payment_failed self-heals then sets PAST_DUE (:1610-1636) and sends a payment-failed email with next_payment_attempt (:1640-1659). Retries/final action are Stripe Dashboard settings; 'unpaid' maps to the prior status (past_due).
- Customer portal: PurchaseService.createPortalSession passes NO `configuration` (packages/purchase/src/services/purchase-service.ts:2574-2577). STRIPE_PORTAL_CONFIGURATION_ID appears only in the go-live runbook (commit b02fd432) and is read nowhere. Portal lockdown therefore depends entirely on the Stripe account's DEFAULT portal configuration. The memory note feedback_stripe_portal_lockdown is stale: it claims this env var is used and that a /admin/subscriptions/reconcile route exists (there is no workers/ecom-api/src/routes/admin.ts). [Lead: memory corrected 2026-10-13.]

§5 COURSE SUBSCRIPTIONS (packages/subscription/src/services/course-subscription-service.ts)
- Separate Stripe Product per course (:168-178) with monthly+annual Prices (:180-201) on the PLATFORM account, recorded in course_subscription_plans.
  - One live plan per course (schema/course-commerce.ts:38-75, uq :68-70). Plan creation requires the primary Connect to be ready (:149-155).
  - upsertPlan (:291-300) = create or savePlanPrices (:326-465). Re-pricing creates new Prices and archives the old with rollback; existing subscribers are GRANDFATHERED (:313-315). Org tiers do the opposite: they propagate.
  - deactivatePlan keeps the row and archives the Product (:518-557).
- course_subscriptions (course-commerce.ts:81-147): planId RESTRICT (:91-93), org SET NULL (:96-98), stripeSubscriptionId UNIQUE, one live per user+course (:134-136), same status/interval CHECKs (:138-145). It is never an org subscriptions row and never creates org membership.
- Checkout (:566-669): published course, live plan, no live course sub, metadata {type:'course_subscription', user, course, plan, org} on session + subscription_data (:630-650). No Connect readiness check at checkout. No idempotency key.
- Webhook routing: same /webhooks/stripe/subscription endpoint, discriminated by metadata.type (:677-681; subscription-webhook.ts:378, 412, 475, 561-581).
  - Course ensureDataPresent DOES use resolveStatus (:718-722), unlike the org path.
  - Access = STORED entitlement source 'course_subscription' with expiresAt=currentPeriodEnd (:778-784). Refreshed per invoice (:826-830). Revoked on 'unpaid' (:886-891) and on deletion (:918-921).
  - Read by entitlements-resolver COURSE_GRANT_SOURCES (packages/access/src/services/content-access/entitlements-resolver.ts:69-73).
- Org-tier → course access is DERIVED live: course_tier_access exact tier (not "tier or higher") JOIN subscriptions active|cancelling and currentPeriodEnd > now (entitlements-resolver.ts:129-150, 197-219). Cross-org grants are impossible thanks to composite FKs (course-commerce.ts:178-187). Exact tier sets are written by CourseAccessService.setTierAccess (packages/access/src/services/course-access-service.ts:58-125).
- Payouts: writeCoursePayouts (:939-1117).
  - Fees: feeConfig.getFeesForCreator(org, creator, 'subscription'), which IS injected on the webhook path. An active creator agreement share overrides the org fee: org% = 10000 - share (:988-1013). Split via calculateRevenueSplit + min-fee floor (:1015-1023).
  - Platform-fee row (:1043-1070). Creator transfer, key ${charge}_creator (:1073-1091). Org-fee transfer, key ${charge}_org_fee (:1094-1116). All with source_transaction.

§6 STRIPE CONNECT (packages/subscription/src/services/connect-account-service.ts)
- Account type: Accounts v1 stripe.accounts.create with CONTROLLER properties, i.e. Express-equivalent (:222-240).
  - controller: stripe_dashboard 'express', fees.payer 'application', losses.payments 'application', requirement_collection 'stripe'. Capabilities card_payments + transfers. Country GB.
  - metadata {codex_user_id} ONLY (:235-237). Idempotency key connect_acct_${userId} (:239).
- ONE account per USER, confirmed (uq_stripe_connect_user, schema/subscriptions.ts:272).
- Onboarding: createAccountForUser (:188-301).
  - Resumes an existing incomplete account with a fresh link (:195-211).
  - Orphan-safe: the DB row is inserted BEFORE the link, onConflictDoNothing on userId (:255-268).
  - accountLinks.create type account_onboarding, collection_options.fields 'eventually_due', return/refresh URLs allow-listed (:828-859; validation connectMeOnboardSchema :315-318).
  - Platform-not-enabled maps to ConnectPlatformNotConfiguredError (:291-298).
- Readiness: handleAccountUpdated (:480-541) status = active (charges && payouts) | disabled (requirements.disabled_reason) | restricted (currently_due non-empty) | onboarding (:487-500). onboardingCompletedAt is reset to null on any non-active event (:508).
- Pin: pinOwnedOrgsToUser sets organizations.primaryConnectAccountUserId for every org the user is an ACTIVE owner of where the pin is still NULL. First owner to onboard wins; it is never overwritten (:724-769); it runs on every account.updated.
- Resolution: resolvePrimaryConnect = pin, else the earliest-created active owner (packages/purchase/src/utils/resolve-primary-connect.ts:52-75). If the pinned user has no account it returns undefined; there is NO owner fallback in that case (:77-85).
- Status cache: getStatusForUser via VersionedCache, TTL 600s, keyed by userId (:414-427). Invalidated on account.updated/deauthorized (:540, :575). The live Stripe requirements are fetched on cache miss (:782-826).
- Webhook (workers/ecom-api/src/handlers/connect-webhook.ts):
  - account.updated: wasActive from the DB row BEFORE update (:91-94); isNowActive from the payload (:95). handleAccountUpdated (:97). On the inactive→active transition it requires a UUID codex_organization_id in metadata (:27-29, :107-116) → waitUntil(resolvePendingPayouts(orgId, acct)) using a new SubscriptionService WITHOUT feeConfig (:119-144).
  - account.application.deauthorized → disabled (:150-166). The pin is left in place.
- What blocks monetisation until Connect is ready: tier creation (tier-service.ts:192), org-sub checkout (subscription-service.ts:824-828), course-plan creation (course-subscription-service.ts:149-155). NOT course-sub checkout.
- /connect/me/* routes are self-scoped (workers/ecom-api/src/routes/connect.ts:157-232). /connect/* org routes use requireOrgManagement, with the IDOR described in R9 (PART 6).
- Sync fallback: POST /connect/sync and /me/sync call accounts.retrieve then handleAccountUpdated (:630-647) but do NOT trigger resolvePendingPayouts.

## PART 4 — §7 Revenue split, §8 Payout pipeline, §9 Earnings + route auth, §10 Webhooks

§7 REVENUE SPLIT
- Pure math, calculateRevenueSplit (packages/subscription/src/services/revenue-split.ts:31-70): platform = ceil(gross×p/10000); org = ceil(post×o/10000); creators = remainder; sum asserted equal to gross.
  - Default (FEES, commerce.ts:88-95): £10.00 → platform 100, post 900, org 135, pool 765. Then applyMinPlatformFeeFloor (subscription-service.ts:704-708), which is a no-op on webhook paths (floor 0, R5).
- At invoice time, executeTransfers (:4605-5221):
  1. platform_fee ledger row: status 'paid', no transfer, ON CONFLICT DO NOTHING on uq_payouts_platform_fee_per_charge (:4627-4656).
  2. Primary Connect via resolvePrimaryConnect (:4660).
  3. Agreements active at invoice.created: revenueType 'subscription', status active OR terminated after the invoice, effectiveFrom <= invoice, effectiveUntil null or > invoice; share = accepted proposal's proposedCreatorSharePercent (:4695-4732). Rows with a null share are skipped with a warn (:4738-4755).
  4. Effective split with agreements (total share > 0): orgFee = floor(post × max(0, 10000 - Σshare)/10000) (:4778-4784); creator_i = floor(post × share_i / max(Σshare, 10000)) (:4982-4986).
     - Example: one creator at 6000 bps → org 360, creator 540.
     - The subscriptions row snapshot keeps the fee-config numbers (:1501-1504), NOT these effective numbers.
  5. Org-fee transfer to orgConnect if chargesEnabled, key ${charge}_org_fee (:4787-4864). Otherwise a pending row for orgConnect.userId or resolveOrgOwnerId (:4865-4906). resolveOrgOwnerId has no orderBy (:4276-4289), unlike resolvePrimaryConnect.
  6. No agreements or all zero → transferCreatorPoolToOwner sends the whole pool to the PRIMARY connect user as 'creator_payout_to_owner', key ${charge}_creator_pool_owner (:4316-4412, :4908-4959). R1: no row at all if that account isn't chargesEnabled.
  7. Per creator: amount <= 0 → skip (:4995-5006); < minTransferCents → pending 'min_transfer_floor' (:5014-5063; never on webhook paths, floor 0); creator connect chargesEnabled → transfer, key ${charge}_creator_${creatorId} (:5067-5148); else pending 'connect_restricted' / 'connect_not_ready' (:5166-5219).
- Transfers are made per invoice (invoice.payment_succeeded), each with source_transaction=chargeId and transfer_group sub_${subId} (:4614).
- Charge resolution: resolveInvoiceCharge = inline payments → invoices.retrieve(expand payments) → paymentIntents.latest_charge → charges.list (:1401-1432). No charge (e.g. a £0 invoice) → return BEFORE the period/status update (:1461-1468).
- Rounding residue from the floors stays on the platform balance with no ledger row.

§8 PAYOUTS PIPELINE
Ledger: payouts (schema/payouts.ts:33-189).
- status: paid | pending | failed | reversed | cancelled_by_refund (:149-152).
- reason: connect_not_ready | connect_restricted | transfer_failed | min_transfer_floor (:153-156).
- payoutType: platform_fee | organization_fee | creator_payout | creator_payout_to_owner (:157-160).
- sourceType: purchase | subscription (:161-164; course subs use 'subscription').
Sequence:
  invoice.payment_succeeded → handleInvoicePaymentSucceeded (:1444-1587)
    → resolveInvoiceCharge → ensureSubscriptionDataPresent (self-heal :1475-1480) → subscriptions.retrieve (periods :1483-1486)
    → UPDATE sub: periods, status ACTIVE, amountCents = invoice.amount_paid, split (:1489-1507)
    → assertGbpOnly (:1514-1518, AFTER the write) → executeTransfers (:1531-1539) → renewal email if billing_reason subscription_cycle (:1549-1575) → invalidate (:1580-1584)
    → ledger rows: paid (transfer id) | pending (connect_*/floor) | failed (transfer_failed)
  DRAIN A, "primary": connect-webhook account.updated inactive→active + org UUID metadata → waitUntil resolvePendingPayouts(orgId, acct) (connect-webhook.ts:106-146). Effectively dead for post-#273 accounts (R4).
  DRAIN B, insurance: cron "0 * * * *" in env.production ONLY (workers/ecom-api/wrangler.jsonc:201-203) → dispatchScheduled → runScheduledPayoutsSweep (createDbClient HTTP) → runPayoutsSweep → new SubscriptionService({db, environment}) without feeConfig (payouts-sweep.ts:68, :93-147)
    → sweepUnresolvedPayouts(15) (:5245-5363): SELECT DISTINCT (organizationId, userId) FROM payouts WHERE status='pending' AND attemptedAt < now-15m (:5258-5266)
       → userId null → skip (:5294-5297) → connect row BY userId (:5306-5322) → live stripe.accounts.retrieve (:5327-5336)
       → charges && payouts enabled → resolvePendingPayouts(group.organizationId, acct) (:5338-5341). Per-group errors isolated (:5343-5351).
  resolvePendingPayouts (:3522-3699): connect row by stripeAccountId → userId (:3537-3549). Rows WHERE userId AND status='pending' AND (org = X OR org IS NULL); X null → only orgless (:3559-3577).
    → group by (org|orgless):(purchase|subscription) (:3599-3619) → transferPendingGroup (:3719-3826):
      group-sum floor (:3744-3762) → per row assertGbp (:3769-3774) → transfers.create{amount, currency, destination, source_transaction: row.stripeChargeId if present, metadata}, key payout_${row.id} (:3778-3795)
      → UPDATE status 'paid', resolvedAt, stripeTransferId (:3797-3804). Per-row errors isolated (:3811-3822).
    → payout-released email if creator rows were paid; payoutMailer is absent on both drain paths, so it is never sent in practice (:3659-3696).
Pipeline properties:
- Orgless rows (organizationId NULL) are drained by both paths.
- check_payouts_user_required: only platform_fee may have a NULL userId (payouts.ts:176-179).
- No FOR UPDATE, no claim column, no LIMIT/batching. retryCount/lastRetryAt are never written. Concurrency safety relies solely on payout_${id} (Stripe keys live 24h). attemptedAt is never bumped, so a stuck row is re-checked on every cron run forever.
- No Connect account yet → pending row; paid out once ready via the sweep (hourly).
- Refund → payment-webhook charge.refunded → reverseSubscriptionPayoutsForCharge(charge.id, {refundAmountCents: charge.amount_refunded (cumulative), stripeRefundId}) (workers/ecom-api/src/handlers/payment-webhook.ts:163-166; service :4441-4589):
  - rows WHERE stripeChargeId AND sourceType 'subscription' (:4445-4453);
  - gross = Σrows (:4461); partial ratio floor (:4464-4473);
  - createReversal key ${transferId}_reversal_${refundId | amount} (:4501-4515);
  - pending/failed → cancelled_by_refund, paid → reversed (:4560-4573).
- Dispute → nothing in this pipeline (R10).

§9 CREATOR EARNINGS + ROUTE AUTH
- /subscriptions/me/payouts and /me/earnings-summary: service filters eq(payouts.userId, ctx.user.id) + payoutType IN (creator_payout, creator_payout_to_owner) (subscription-service.ts:344-347, 2990-2999, 3194-3263, 3271-3319). No client userId/orgId is accepted (routes/subscriptions.ts:469-513).
  - Earned = status 'paid' (windowed by createdAt, not resolvedAt). In transit = pending. Needs attention = pending + failed INCLUDING min_transfer_floor (:3305-3310); the org rail EXCLUDES the floor (:3465-3470).
- Org surfaces (/payouts, /payouts/summary, /payouts/by-creator, /stats, /subscribers) use ctx.organizationId from requireOrgManagement (routes :335-458). getPayoutSummary sums ALL types including platform_fee rows (they carry organizationId :4633) into totalEarned (:3149-3176). Ambiguous labelling.
- Route table (all procedure()). Bindings RATE_LIMIT_STRICT / RATE_LIMIT_API exist (wrangler.jsonc:60-77; the comment at :24-29 claiming none is stale):
  POST /subscriptions/checkout | auth required | strict (:109-126)
  GET /subscriptions/verify, /current, /mine | auth required | api (:135-179)
  POST /subscriptions/preview-tier-change, /change-tier | auth required | strict (:189-230)
  POST /subscriptions/cancel, /reactivate, /resume | auth required | api (:236-329)
  GET /subscriptions/stats, /subscribers, /payouts, /payouts/summary, /payouts/by-creator | auth + requireOrgManagement | api (:335-458)
  GET /subscriptions/me/payouts, /me/earnings-summary | auth required (self) | api (:469-513)
  POST /connect/onboard, /connect/sync | requireOrgManagement | strict (connect.ts:36-55, 86-120)
  GET /connect/status, POST /connect/dashboard | requireOrgManagement | api (:65-79, 126-140)
  POST /connect/me/onboard, /me/sync | auth required | strict (:157-174, 204-216)
  GET /connect/me/status, POST /me/dashboard | auth required | api (:181-191, 222-232)
  PUT, DELETE /studio/courses/:courseId/subscription-plan; PUT /tier-access | requireOrgManagement (?organizationId=), course re-resolved by (id, org) | strict (course-monetisation.ts:86-177). The two null-returning routes declare no successStatus 204.

§10 WEBHOOKS
- Endpoints: /webhooks/stripe/subscription and /webhooks/stripe/connect, each with verifyStripeSignature → createWebhookHandler (workers/ecom-api/src/index.ts:175-189).
- Policy (webhook-handler.ts:55-82): 200 unless isTransientError → 500. Transient = StripeAPIError 5xx, StripeConnectionError, StripeRateLimitError, or a message containing ECONN*/ENOTFOUND/ETIMEDOUT/connection/timeout/socket hang up/fetch failed (error-classification.ts:16-72).
- NO event-id dedup (no webhook_events table anywhere).
- Event → effect:
  checkout.session.completed (subscription mode): course branch, or handleSubscriptionCreated (insert ACTIVE + follower + membership, email, invalidate) (subscription-webhook.ts:355-405)
  customer.subscription.updated: course branch, or self-heal + mapper update; unpaid → revoke; active → clear (:407-468)
  customer.subscription.deleted: course revoke, or transaction CANCELLED + subscriber membership inactive; revoke; email (:470-505; service :1893-1922)
  customer.subscription.paused / resumed: PAUSED + revoke / mapped status + clear (:507-552)
  customer.subscription.trial_will_end: email only (:608-628); no trials are configured anyway
  invoice.payment_succeeded: course branch (by subscription_details.metadata.type) or org path above; clear; email (:554-606)
  invoice.payment_failed: self-heal → PAST_DUE; revoke; email (:693-716)
  product.updated / price.created / price.updated: tier sync-back / adopt + propagate / log (:630-691)
  account.updated / account.application.deauthorized: connect-webhook.ts:74-166
  NOT handled: customer.subscription.created, invoice.paid, subscription_schedule.*, charge.dispute.* (handled elsewhere without subscription effects)
- Ordering resilience: invoice succeeded/failed and sub.updated self-heal via ensureSubscriptionDataPresent (:1065-1253). sub.deleted does NOT, and leaves no tombstone.
- Cache: the service's invalidateIfConfigured bumps COLLECTION_USER_LIBRARY(userId) + COLLECTION_USER_SUBSCRIPTION(userId, orgId) through waitUntil (:736-765; subscription-invalidation.ts:96-137). Sync-back bumps the org version (subscription-webhook.ts:321-352). The course path bumps the library only (:302-312). Connect bumps the status cache (connect-account-service.ts:690-700).

## PART 5 — §11 Stripe API calls + idempotency keys; money-relevant DB constraints

§11a STRIPE API CALLS (call | file:line | key params | idempotency key)
- checkout.sessions.create (org sub) | subscription-service.ts:875-894 | mode subscription, customer, price, metadata ×2 | NONE
- checkout.sessions.create (course sub) | course-subscription-service.ts:642-650 | same shape + type metadata | NONE
- checkout.sessions.retrieve | subscription-service.ts:956 | verify | n/a
- subscriptions.retrieve | :1090, :1483, :2193, :2307, :4020; subscription-webhook.ts:374, :569 | self-heal/periods/item id | n/a
- invoices.retrieve | :1134, :1314, :1408 (expand payments); course :1276 | amount_paid / charge | n/a
- paymentIntents.retrieve / charges.list | :1418 / :1426 | latest_charge fallback | n/a
- invoices.createPreview | :2209-2216 | always_invoice, proration_date | n/a
- subscriptions.update (upgrade) | :2325-2354 | always_invoice, error_if_incomplete, proration_date, metadata | upgrade_${sub.id}_${prorationDate} (does not include the target price)
- subscriptions.update (downgrade) | :2325-2354 | create_prorations | NONE
- subscriptions.update (cancel / reactivate) | :2481-2483 / :2632-2634 | cancel_at_period_end | NONE
- subscriptions.update (price propagation) | :4030-4039 | items price swap, create_prorations | tier-price-propagate:${subRowId}:${newPriceId}
- subscriptions.resume | :2578-2582 | billing_cycle_anchor unchanged | resume_${stripeSubscriptionId} (same for every pause cycle)
- transfers.create (org fee) | :4789-4802 | amount, gbp, destination, source_transaction, transfer_group sub_${id} | ${chargeId}_org_fee
- transfers.create (pool → owner) | :4332-4345 | same | ${chargeId}_creator_pool_owner
- transfers.create (creator) | :5071-5085 | same | ${chargeId}_creator_${creatorId}
- transfers.create (drain) | :3778-3795 | source_transaction if row has charge id; NO transfer_group | payout_${payoutRowId}
- transfers.create (course creator / org) | course-subscription-service.ts:1180-1193 | source_transaction, no transfer_group | ${chargeId}_creator / ${chargeId}_org_fee
- transfers.createReversal | subscription-service.ts:4501-4515 | proportional amount | ${transferId}_reversal_${refundId | amount | ''}
- products.create (tier) | tier-service.ts:211-221 | metadata codex_organization_id, codex_type | tier-product-${randomUUID}
- prices.create (tier) | tier-service.ts:225-244, :370-379, :393-402 | gbp, recurring month/year | tier-price-*-${uuid}, tier-update-price-*-${uuid} (random per call)
- prices.update / products.update (archive, restore, rename) | tier-service.ts:295, :385, :407, :420, :601, :909, :1053-1117 | active flag | NONE
- products.create / prices.create (course) | course-subscription-service.ts:168-201, :382-391, :401-410 | per-course product | course-plan-*-${uuid}
- products/prices.update (course) | :223, :378, :394, :413, :483, :492, :540 | archive / relist | NONE
- accounts.create | connect-account-service.ts:222-240 | controller express-equivalent, card_payments + transfers, GB, metadata codex_user_id | connect_acct_${userId}
- accountLinks.create | :834-842 | account_onboarding, eventually_due | NONE
- accounts.createLoginLink | :587 | Express login | NONE
- accounts.retrieve | :638, :796; subscription-service.ts:5327 | readiness / requirements | n/a
- customers (via withStaleCustomerRecovery, @codex/purchase) | subscription-service.ts:871-902 | unified customer | deterministic key `codex:resolve-customer:${userId}` (confirmed by purchases-dive, resolve-customer.ts:120-131)
Note: Stripe idempotency keys expire after 24h; Stripe retries webhooks for up to 3 days in live mode.

§11b MONEY-RELEVANT DB CONSTRAINTS
subscriptions (schema/subscriptions.ts):
- stripe_subscription_id UNIQUE (:115-117)
- uq_active_subscription_per_user_org (user, org) WHERE status IN (active, past_due, cancelling) (:169-171)
- check_subscription_status (:174-177); check_billing_interval (:178-181); check_churn_reason (:185-188)
- amount and the three split columns >= 0 (:189-201); check_sub_revenue_split_equals_total (:203-206)
- FKs: user CASCADE, org CASCADE, tier RESTRICT (:104-113)
subscription_tiers: uq (org, sortOrder) WHERE deletedAt IS NULL (:69-71); uq (id, org) (:77-80); prices >= 0, sortOrder > 0 (:83-85); org CASCADE (:32-34)
stripe_connect_accounts: uq user (:272); stripe_account_id UNIQUE (:240-242); check_connect_status (:275-278); org SET NULL, user CASCADE (:233-238)
organizations.primary_connect_account_user_id → users SET NULL (organizations.ts:40-42)
payouts (schema/payouts.ts):
- uq_payouts_stripe_transfer_id WHERE NOT NULL (:107-109)
- uq_payouts_platform_fee_per_charge (stripe_charge_id) WHERE payout_type='platform_fee' (:144-146)
- idx_payouts_pending (:120-122)
- check_payouts_amount_positive (:148); check_payouts_status (:149-152); check_payouts_reason (:153-156); check_payouts_type (:157-160); check_payouts_source (:161-164)
- check_payouts_source_ref_one: at most one of subscription/purchase/courseSubscription (:170-173)
- check_payouts_user_required (:176-179)
- check_payouts_paid_invariant: paid/reversed needs (transfer id OR charge id) AND resolvedAt (:184-187)
- FKs: org CASCADE (:40-42), user CASCADE (:45-47), subscription/purchase/courseSubscription SET NULL (:48-63)
- MISSING: no unique constraint on non-paid rows per (charge, user, payoutType). That is the root of R6.
pending_payouts (legacy): amount > 0, reason CHECK, all FKs CASCADE (:289-330)
course_subscription_plans: uq courseId WHERE deletedAt IS NULL (course-commerce.ts:68-70); prices >= 0 (:72-73)
course_subscriptions: stripe_subscription_id UNIQUE (:101-103); uq (user, course) on active/past_due/cancelling (:134-136); status + interval CHECKs (:138-145); plan RESTRICT (:91-93); org SET NULL (:96-98); user/course CASCADE
course_tier_access: PK (course, tier); composite FKs (course, org) and (tier, org) CASCADE (:166-187)

## PART 6 — §12 Risks / gaps

R1 CONFIRMED — Creator pool stranded with no ledger row.
Trigger: no subscription agreements (the default single-creator org) or all-zero shares, AND the primary Connect is missing or chargesEnabled=false (e.g. restricted for KYC after the subscribers signed up).
Code: transferCreatorPoolToOwner returns silently (:4328-4330), called from :4912-4920 and :4949-4957. The docstring (:4311-4314) claims the org-fee pending row covers it; that row is effectiveOrgFeeCents only (:4778-4783, :4880-4893). Defaults: 765p of every 1,000p invoice is never recorded and never drained. No test covers it.

R2 CONFIRMED — 'failed' rows are never retried.
Written at :4842-4855, :4386-4399, :5125-5136 and course :1239-1248 (the course row also lacks stripeChargeId/transferGroup). Purchases do the same (purchase-service.ts:1603-1612, per purchases-dive). Drains select status='pending' only (:3565, :5265).
Typical cause: the destination lacks an active transfers capability while chargesEnabled is true.

R3 CONFIRMED — Interval-blind price propagation.
Interval dropped at service-registry.ts:1000-1004 and subscription-webhook.ts:255-259. No interval filter at :3956-3967. Every active/cancelling subscriber on the tier is swapped onto the changed interval's Price with create_prorations (:4030-4039): annual subscribers silently move to monthly billing (or the reverse).
Two changed intervals means two concurrent waitUntil runs, last write wins. Emails quote the annual column to annual subscribers (:4205-4208). Customer-facing billing error.
[Lead D: Stripe docs — an interval change on update ⇒ immediate charge for the new price + billing-cycle reset.]

R4 CONFIRMED — Primary drain dead for new Connect accounts.
Metadata has only codex_user_id since 6bde7b87 (connect-account-service.ts:235-237). The webhook requires codex_organization_id (connect-webhook.ts:27-29, 107-116) → WARN + skip. Drains then wait for the hourly production-only cron (wrangler.jsonc:201-203); dev/test never drain.
connect-webhook.test.ts:91 injects org metadata by default, which masks this. Even for legacy accounts, the webhook drain uses the onboarding-origin org, so rows for other orgs wait for the sweep (:3570-3575).

R5 CONFIRMED — Fee config not applied on money paths. See PART 1 (a).
Economic impact: the £1.00 tier gives the platform 10p against ~21.5p in Stripe fees, and the minPlatformFeeCents floor is never applied.

R6 CONFIRMED path / frequency SUSPECTED — Double payout from duplicate deliveries.
No pre-check (:4622-4626), no unique index on pending/failed rows (payouts.ts:107-146), no event dedup (webhook-handler.ts:55-82). Each duplicate pending row gets its own key payout_${id} (:3794), so it is paid twice.
Concrete trigger: a transient DB error on the creator-connect SELECT (:4965) after the org pending insert (:4880) → 500 → Stripe retries → second pending row. Also Stripe's at-least-once duplicates and operator "Resend".
Separately, keys expire after 24h while Stripe retries for 3 days, so a late retry after a partial run can re-transfer slices that were already paid (SUSPECTED, low).
Course path: the pre-check (course :967-986) skips the WHOLE fan-out if any row exists, so a partial first run leaves the creator/org slices unpaid.

R7 CONFIRMED path — Duplicate subscription billed, nothing recorded.
AlreadySubscribed check only at session creation (:800-818); no checkout idempotency key (:875).
When the second session completes, the insert violates uq_active_subscription_per_user_org (subscriptions.ts:169-171). The re-select by stripeSubscriptionId finds nothing and rethrows (:1201-1215), which is not transient, so it is acked 200 (error-classification.ts:43-72).
Every invoice of that subscription repeats this: customer charged, no access, no transfers, no ledger, no alert beyond a warn log.

R8 CONFIRMED — Refund clawback defects (reverseSubscriptionPayoutsForCharge :4441-4589).
(a) skipStatusFlip is set only for code 'insufficient_funds' (:4534-4552). Any other reversal failure (5xx, rate limit, network) still flips the row to 'reversed' (:4558-4573): ledger says clawed back, money is still with the creator, never retried.
SUSPECTED: Stripe reports insufficient connected-account balance as 'balance_insufficient', in which case the insufficient_funds branch never matches.
(b) After a partial refund flips rows to 'reversed', later refunds skip them (:4481-4483). Cumulative amount_refunded is passed (payment-webhook.ts:163-166), so the rest of a refund is never clawed back.
(c) A partial refund cancels whole pending/failed rows (:4560-4563).
(d) Gross is rebuilt from ledger rows (:4461), so it is wrong when R1 dropped a slice.
(e) Unresolved obligations are only logged; refund_reviews can't hold subscription rows (:4541-4550).
(f) A partial reversal flips the entire row to 'reversed', so earnings under-report the creator's kept remainder.
Also: a subscription refund does not cancel the subscription or revoke access (payment-webhook.ts:187-193 comment).

R9 CONFIRMED in code, not exercised — IDOR on POST /connect/dashboard.
procedure resolves the authorised org from URL param → subdomain → ?organizationId=, never the body (packages/worker-utils/src/procedure/helpers.ts:470-523). The handler uses ctx.input.body.organizationId (connect.ts:133-137) → createDashboardLink(bodyOrg) → login link for that org's primary user's Express Dashboard (connect-account-service.ts:598-604, 581-592).
Attack: owner/admin of org A sends ?organizationId=A with body {organizationId: B}. The web client always sends both equal (apps/web/src/lib/server/api.ts:2894).
/connect/sync passes ctx.user.id, so it stays user-scoped (connect.ts:96-99). /connect/onboard ignores orgId. Safe.

R10 CONFIRMED (joint with purchases-dive) — Disputes.
handleChargeDisputeCreated calls only PurchaseService.processDispute (payment-webhook.ts:200-254). There is no subscription transfer reversal, no subscription access revocation, and pending payouts rows for the disputed charge stay 'pending', so the hourly sweep (:5258-5341) PAYS them later.
The comment that a lost dispute "fires charge.refunded" (:211-214) is SUSPECTED false. Platform liability is losses.payments 'application' (connect-account-service.ts:227).

R11 CONFIRMED path, ordering SUSPECTED — Access after cancellation / wrong state.
Self-heal inserts ACTIVE regardless of Stripe status (:1160). Invoice success sets ACTIVE unconditionally (:1500). sub.deleted writes no tombstone (:1893-1922).
Results:
- deleted → late checkout.session.completed or invoice.payment_succeeded re-grants access until currentPeriodEnd.
- A proration invoice paid after cancel_at_period_end flips cancelling → active, and reactivate then refuses (:2626-2630).
- checkout.session.completed ignores payment_status, and no payment_method_types is set (:875-894), so delayed methods could grant access before funds clear (SUSPECTED).

R12 CONFIRMED — Portal unlocked (purchase-service.ts:2574-2577, no `configuration`).
If the default portal allows plan switching, the price changes but metadata codex_tier_id doesn't, and the mapper keeps the old tierId (stripe-status-mapper.ts:92; :1834): billed for one tier, entitled to another. Portal "pause collection" is not modelled. Hand-off: the code lives in @codex/purchase.

R13 CONFIRMED race — amountCents corruption.
The invoice handler writes the proration invoice's amount_paid into amountCents (:1489-1507); the outcome depends on order versus sub.updated's unit_amount (:1838-1840). This corrupts isUpgrade (:2320; a misread upgrade takes the deferred-payment downgrade path), MRR (:2860-2866) and the "old price" in emails (:4223).

R14 SUSPECTED (Stripe-validation dependent) — Client-controlled prorationDate.
No server check that it matches an issued preview (validation:129; :2321-2334). If Stripe accepts any date within the current period, a user can choose dates that maximise downgrade credit or minimise upgrade cost. The upgrade key ignores the target price (:2351).

R15 CONFIRMED (low likelihood) — Resume key not unique per cycle.
resume_${stripeSubId} (:2581). A second pause/resume within 24h replays the cached first response while the DB is set ACTIVE (:2584-2590).

R16 CONFIRMED — Course-sub gaps.
- The org fee is dropped with only a log when no Connect/owner resolves (course :1110-1115). The org path, by contrast, falls back to the owner.
- No Connect check at checkout (:566-669).
- The whole-fan-out pre-check (:967-986), see R6.
- Failed rows have no charge id (:1239-1248).

R17 CONFIRMED — Ledger history destroyable.
payouts.userId and organizationId FKs CASCADE (payouts.ts:40-47), contrary to the "immutable ledger" comment (:54-59).

R18 CONFIRMED — Sweep scale and locking.
Unbounded, sequential, one live accounts.retrieve per (org, user) group every hour (:5258-5352). No locks. attemptedAt is never updated. A large backlog risks the Worker subrequest/wall limits (SUSPECTED); it is idempotent so the next run resumes.

R19 CONFIRMED — Ack-200 on wrapped errors. Dashboard sync-back (tier-service.ts:810, :942) and the InternalServiceError 'row missing' (:1226; comment :1224-1225 wrongly says 5xx). See PART 1 (b).

R20 CONFIRMED minor:
- resolveOrgOwnerId is non-deterministic (:4276-4289).
- 'member' is rewritten to 'subscriber' and then made inactive on cancel (:1194, :1907-1919).
- The org summary includes platform_fee in totals (:3149-3176).
- needsAttention semantics differ between the creator hub (:3305-3310) and the org rail (:3465-3470).
- GBP guard runs after the DB write (:1495-1518).
- SubscriptionPaymentRequiredError context forwards the raw Stripe message to the client (:2370).
- Rounding pennies are unrecorded (:4780-4786, :4984-4986, :4472).
- Purchase drain caveat (purchases-dive): if transfers.create succeeds but the UPDATE (:3797-3804) fails, the row stays pending; it is safe only within the 24h key window.

## PART 7 — §13 Doc-vs-code drift, §14 Hand-offs, key files

§13a docs/payouts/payout-pipeline.md — the doc describes the pre-ledger (pending_payouts) design and the per-(user, org) Connect model throughout.
- :25-26 TL;DR 5 "writes a pending_payouts row". Code writes to `payouts` (pending OR failed) (subscription-service.ts:4842-5219; schema/payouts.ts:29-31 says pending_payouts gets no new inserts).
- :19-20 TL;DR 3 "DB-configurable fee chain (FeeConfigService)". Not injected on the webhook/drain/sweep paths (PART 1 a).
- :27-29 and :174-177 "primary drain". Gated on codex_organization_id metadata that no account created since #273 carries (R4).
- :53-54 the executeTransfers signature omits platformFeeCents and invoiceCreatedAt (actual :4605-4613). There is no mention of the platform_fee row (:4627-4656), agreement-driven effective org fee (:4768-4784) or creator_payout_to_owner (:4316-4412).
- :91 "On Stripe error → pendingPayouts row transfer_failed". Actually a payouts status='failed' row that is NEVER drained (R2).
- :92-93 "pendingPayouts connect_not_ready". Now payouts status 'pending'.
- :103-106 min-floor "pendingPayouts ... next invoice payment re-evaluates against the accumulated amount". False: executeTransfers evaluates only the current amount; aggregation happens only in transferPendingGroup (:3744). The floor is 0 on webhook paths anyway.
- :120-151 Stage 3 documents the pending_payouts schema, columns and indexes (the real table is payouts, idx_payouts_pending payouts.ts:120-122).
- :142 "connect_restricted | reserved (legacy)". It is actively written (:5170-5172).
- :144 says min_transfer_floor is set by resolvePendingPayouts. It isn't; the drain skips, it doesn't write.
- :199-202 resolvePendingPayouts looks up the connect row "by (stripeAccountId, organizationId)" and filters "organizationId = orgId AND resolvedAt IS NULL". Actual: by stripeAccountId only (:3537-3541); status='pending' AND (org = X OR org IS NULL) (:3559-3577).
- :206-208 a per-row min-transfer guard. Actual: a group-sum floor per (org scope, source) (:3599-3619, :3744-3762).
- :213-214 "UPDATE pending_payouts SET resolvedAt...". Actual: UPDATE payouts SET status='paid', resolvedAt, stripeTransferId (:3797-3804).
- :299-302 sweep SQL "FROM pending_payouts WHERE resolvedAt IS NULL AND createdAt < threshold". Actual: payouts WHERE status='pending' AND attemptedAt < threshold (:5258-5266).
- :304-306 connect row "for that pair". Actual: by userId only (:5306-5310).
- :318-324 "unique constraint on stripe_connect_accounts is (userId, organizationId)". Actual: unique(userId) (schema/subscriptions.ts:272).
- :342-345 replay table "UPDATE pending_payouts ...".
- :363-364 the currency default is named for pendingPayouts. payouts.currency also defaults to 'gbp' (payouts.ts:72), so the substance is right but the table name is wrong.
- :411-449 Emergency SQL queries pending_payouts (it will show NO stuck money) and stripe_connect_accounts.organization_id (vestigial, null for new accounts).
- :458-459 the operator fix path verifies via pending_payouts. :485-486 reference schema: pendingPayouts in subscriptions.ts.
- Missing entirely: refund reversal, the dispute gap, failed rows, course-subscription payouts, the interval and fee-config wiring gaps.
- Accurate: the hourly cron + production-only (:226-266), the wasActive-from-DB rationale (:179-193), the idempotency key shapes (:332-336), assertGbpOnly sites (:58-74).

§13b packages/subscription/CLAUDE.md
- :60 and :79-95 describe customer.subscription.created as the create handler. Creation comes via checkout.session.completed (subscription-webhook.ts:355-405); customer.subscription.created is unhandled.
- :40 "Idempotency keys on all Stripe create calls — safe to retry". Keys are a random UUID per call (tier-service.ts:208, :365).
- :142 "MUST use idempotency keys for Stripe API calls". Violated by checkout, cancel, reactivate, downgrade and products/prices.update.
- :104 "sweepUnresolvedPayouts — safety-net drain (15-min cron)". Hourly, production only.
- :120 "One account per user per org". One per user.
- :75 says defaults are overridable via the DB fee model. Not true on the webhook path.
- The Payout pipeline section (:97-112) inherits the payout-pipeline.md drift.

§13c docs/stripe-connect-subscription-reference.md (a pre-implementation design reference)
- accounts.create example uses metadata codex_organization_id + business_profile (:107-148). Code: codex_user_id only.
- Example split 20%/80% (:40-43). Code: 15%/85%.
- Recommends listening to customer.subscription.created (:847-862). Unhandled.
- Proposes a webhook_events dedup table (:1253-1277) and failed_transfers retry queue (:1361-1369). Neither exists.
- Portal config example ENABLES subscription_cancel and subscription_update (:1156-1215), contrary to the lockdown rule.
- Architecture choice (separate charges & transfers, :46-59) and controller properties (:79-148) still match the code.

§13d Other drift
- docs/subscription-cache-audit/README.md:3 "Status: Planning". Implemented: paused/resumed/trial_will_end handlers, orchestrator (subscription-service.ts:736-765), revocation (TTL 1200s, access-revocation.ts:51).
- workers/ecom-api/wrangler.jsonc:24-29 says there is no ratelimits binding and that procedure doesn't enforce rateLimit. Contradicted by :37-41 and :60-77.
- packages/database/src/schema/organizations.ts:37-38 refers to pending_payouts.
- connect-account-service.ts:714-718 says the owner fallback is non-deterministic. resolve-primary-connect.ts:69-73 now orders by createdAt.
- subscription-service.ts:1224-1225 says an InternalServiceError "surfaces as 5xx". It is acked 200.
- payment-webhook.ts:211-214 says a lost dispute fires charge.refunded (SUSPECTED false).
- Memory notes:
  - feedback_stripe_portal_lockdown claims STRIPE_PORTAL_CONFIGURATION_ID is used and a reconcile route exists. Neither is true. [Lead: corrected 2026-10-13.]
  - project_payouts_audit claims the DB fee model is live. True for the registry/course paths only.
  - project_tier_change_epic: Phase 2 (scheduled downgrades) still unbuilt, matches the code.
  - feedback_billing_interval_two_vocabularies: confirmed.
  - project_connect_onboarding_orphan_fix: the orphan hardening is present (connect-account-service.ts:239, 255-268).

§14 HAND-OFFS
- To purchases-dive (sent; they replied and confirmed): PurchaseService also built without feeConfig/mailer/webAppUrl (checkout.ts:188-194, :299-302; payment-webhook.ts:268-271), constants fallback at purchase-service.ts:580-593, :1026-1037; purchase charges are platform charges so drain per-row source_transaction (:3783-3785) is sound; purchase 'failed' rows lack stripeChargeId (:1603-1612); processDispute (:2316-2402) never touches payouts.
- To agreements/frontend/infra: the portal configuration (R12) and web client calls (apps/web/src/lib/server/api.ts:2872-2950) send identical query and body org ids, hiding R9 in normal use.

KEY FILES: subscription-service.ts, tier-service.ts, connect-account-service.ts, course-subscription-service.ts, stripe-status-mapper.ts (packages/subscription/src/services/); worker-utils procedure/service-registry.ts + helpers.ts; ecom-api handlers subscription-webhook.ts, connect-webhook.ts, payouts-sweep.ts, payment-webhook.ts; routes connect.ts, subscriptions.ts; schema payouts.ts, subscriptions.ts; docs/payouts/payout-pipeline.md.
END OF REPORT (7/7).
