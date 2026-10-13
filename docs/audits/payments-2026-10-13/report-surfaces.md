# Agreements · Frontend/admin · Config deep-dive (surfaces-dive agent, 2026-10-13) — persisted by lead from PART 1-5/5

Read-only. No tests/dev server/migrations/seeds. No env/.dev.vars opened deliberately (one recursive grep over scripts/ incidentally printed one comment line from scripts/.env.dev — no secret, unused). CONFIRMED = traced in code; SUSPECTED otherwise. Paths relative to repo root.
Lead re-verification status is tracked in bug-ledger.md.

Headline insights:
- An agreement's creator share is basis points of the POST-PLATFORM pool. The validator caps Σshares ≤ 10000 of that pool; the platform fee is not part of the check. Several UI/analytics readers get this wrong.
- An agreement only replaces the ORG leg. Platform fee, min-platform-fee and min-transfer always come from fee config (constants on webhook paths).
- Agreement rows store the share twice: authoritative on the accepted proposal (proposed_creator_share_percent), and legacy organization_fee_percentage = 10000 − share. Much of the drift is a reader picking the legacy one.

## (A) REVENUE-SHARE AGREEMENTS

### A.1 What an agreement is
- Parties: an organization, represented by any ACTIVE owner, and one named creator who must be an active org member (agreement-service.ts:273-282, :1734-1753). The creator can hold any role, including an owner proposing to themselves (:1729-1733).
- Ownership resolved via organization_memberships role='owner' status='active'; no organizations.owner_id column (:1657-1726).
- Two revenue types: subscription and content_purchase; ≤1 ACTIVE agreement per type per (org, creator), via partial unique uq_creator_org_agreement_active_per_type (schema/ecommerce.ts:399-401).
Schema:
- agreement_proposals (ecommerce.ts:185-284): immutable negotiation log. Self-FK parent_proposal_id ON DELETE SET NULL (:199-202), round_number, proposed_by_role owner|creator, proposed_creator_share_percent 0–10000 CHECK (:271-274), proposed_term_months NULL or >0 (:279-282), proposed_effective_from, note, status, responded_at/responded_by_user_id, decline_reason; thread / creator+status / org+status indexes (:243-257).
- creator_organization_agreements (ecommerce.ts:302-403): LEGACY organization_fee_percentage NOT NULL (:316); revenue_type; status active|terminated|expired; terminated_at/by/reason with CHECK status='terminated' ⇔ terminated_at IS NOT NULL (:382-385); current_proposal_id FK SET NULL (:331-334); effective_from/effective_until; expiring_soon_email_sent_at (:345-347); legacy NON-partial unique (creator, org, effective_from, revenue_type) (:391-396).
- purchases.creator_org_agreement_id audit FK (ecommerce.ts:464-465) is ALWAYS written NULL (purchase-service.ts:738-739, :1111-1112).

### A.2 State machine (packages/agreements/src/services/agreement-service.ts)
| Action | Who may act | Transition | Side effects | Lines |
|---|---|---|---|---|
| propose | Active org owner only; target active member; no open/countered proposal for same (org, creator, type) | none → open, round 1, role owner | share validated; email agreement-proposed-by-owner to creator | 268-352; guard 1765-1790 |
| counter | counterparty (named creator if parent owner-proposed, else any active owner) | parent open → countered; child open, round+1, role flipped | child inherits parent effective_from (443-446); share re-validated; email agreement-countered-by-{creator,owner} | 366-495 |
| accept | counterparty | open → accepted | (a) sibling open/countered → superseded (585-597); (b) previous ACTIVE agreement → terminated 'Superseded by accepted proposal' (599-622); (c) new active agreement inserted with dual write organization_fee_percentage = 10000 − share (632-649); (d) both parties emailed agreement-accepted | 518-717 |
| decline | counterparty | open → declined | decline_reason stored; both emailed | 721-820 |
| withdraw | proposing side (any active owner for owner rows; named creator for creator rows) | open → withdrawn | no email | 824-886 |
| terminate | named creator or any active owner | agreement active → terminated | OTHER party emailed; share rebuilt from legacy column (1001) | 890-1017 |
Notes:
- SELECT … FOR UPDATE on target proposal/agreement in counter, accept, decline, withdraw, terminate (1871-1908). proposeAgreement takes NO lock (268-329) although service header (24-29) and README.md:161-165 claim it does.
- Only round 1 can be opened, only by an owner (316).
- 'expired' is never written (only type union types.ts:56).
- Expiring-soon cron IS implemented: notifications-api daily 0 8 * * *, prod only (workers/notifications-api/wrangler.jsonc:169-175) → scheduled (notifications-api/src/index.ts:155-164) → handlers/agreement-expiring-sweep.ts:247-318, DEFAULT_DAYS_AHEAD=30 (:38); uses findExpiringAgreements / markExpiringSoonSent (agreement-service.ts:1177-1256). README.md:447-451, :520, :575-576 still say DEFERRED (Codex-tugez).
- findExpiringAgreements comment claims soft-deleted users filtered (1169-1170); query has no users.deletedAt predicate (1193-1214). SUSPECTED minor.
- Lifecycle emails after commit via waitUntil; failures logged+swallowed (1552-1586); mailer optional (1600-1605); all 7 templates exist.
- Email deep link `${webAppUrl}/studio/negotiations/${threadId}?orgId=…` (1491-1494), same link to owner and creator (1633-1636) — see R10.

### A.3 validateProposedShare (agreement-math.ts)
- proposedSharePercent integer in [0, 10000]; each existing share bounds-checked; violations → ShareExceedsAvailableError (422) (:117-138).
- proposed ≤ 10000 − Σ(existingActiveShares), inclusive (filling pool exactly is legal; org residual 0) (:140-152).
- Platform fee deliberately NOT a parameter; shares are bps of POST-PLATFORM pool (:1-15, :80-82).
- Called at propose, counter, accept, excluding target creator's own rows (agreement-service.ts:295-305, :408-417, :561-570).
- Existing shares from fetchExistingActiveShares (1810-1840): reads LEGACY organization_fee_percentage (share = 10000 − fee); status='active' AND terminatedAt IS NULL; NO effectiveFrom/effectiveUntil predicate (expired/future rows consume headroom).
API schemas (packages/validation/src/schemas/agreements.ts): sharePercentSchema int 0–10000 (:49-53); termMonthsSchema REQUIRED int 1–120 (:65-69) — NULL (indefinite) not accepted at API though service supports it (:20-24, :60-64), used at propose :127 and counter :161; note/reason trimmed ≤500 (:71-81); effectiveFrom z.coerce.date().optional() no bounds (:134), never sent by web; creatorId uses userIdSchema (:121-124).

### A.4 Split precedence
| Revenue stream | Agreement lookup | Split with agreement | Without | Lines |
|---|---|---|---|---|
| Org-tier subscription invoice | ALL org `subscription` agreements; LEFT JOIN proposal; NULL proposal skipped w/ warn | org = floor(post × max(0, 10000 − Σ)/10000); creator_i = floor(post × share/max(Σ,10000)) (oversum clamped); fee org slice overridden when Σ>0 | org keeps fee slice; creator pool → org owner ('empty_agreements' / 'zero_share') | subscription-service.ts:4695-4785, 4908-4986 |
| Content purchase, org content | ONLY uploader's (content.creatorId) `content_purchase` agreement via findActiveCreatorAgreementShare (INNER JOIN, .limit(1), no orderBy) | orgFee% = 10000 − share | fees.orgFeePercent | purchase-service.ts:630-652; agreement-share.ts:39-82 |
| Content purchase, orgless | not queried | – | org leg 0 | purchase-service.ts:648-668 |
| One-off course purchase | course creator's `content_purchase` terms | 10000 − share | fees.orgFeePercent | purchase-service.ts:1039-1060 |
| Course subscription | course creator's `subscription` terms | 10000 − share | fees.orgFeePercent | course-subscription-service.ts:1001-1013 |
Platform fee, min-platform-fee floor and min-transfer always from the fee resolver (purchase-service.ts:682-686). Agreement only replaces the ORG leg.
Lead's question — agreement splits on one-off purchases given webhook PurchaseService lacks feeConfig: YES they apply (lookup gated only on organizationId inside the purchase tx, :630-637 content, :1042-1050 course). What is lost is DB fee config (constants 10/10/0/0; purchase-service.ts:580-593, :1026-1037; FEES commerce.ts:88-95). Registry PurchaseService (service-registry.ts:782-793) injects feeConfig but completePurchase/completeCoursePurchase are only called from the webhook handlers. Mailer also omitted → creator-connect-needed email (purchase-service.ts:1279-1283, :1484-1494) never fires. Org-subscription webhook SubscriptionService also lacks feeConfig (subscription-webhook.ts:217-227) → resolvePayoutFees constants (10% platform / 15% org) (subscription-service.ts:648-669); only CourseSubscriptionService gets one (subscription-webhook.ts:284-296). docs/agreements/README.md:186-188, :290-303 ("platform fee read from current org config at invoice time") is drift.

### A.5 Effective dating
- Split computed once at webhook processing; purchases store an immutable snapshot (ecommerce.ts:405-410); nothing recomputes.
- `at` differs by path: org subscription = Stripe invoice.created (subscription-service.ts:1527-1530); content + course purchase = new Date() (purchase-service.ts:624, :1041); course subscription = new Date() (course-subscription-service.ts:1007). agreement-share.ts:16-19 claims a pinned purchase/invoice timestamp — true only for org subs.
- Active-as-of predicate: (status='active' OR (status='terminated' AND terminatedAt > at)) AND effectiveFrom ≤ at AND (effectiveUntil IS NULL OR effectiveUntil > at) (agreement-share.ts:62-76; agreement-service.ts:1054-1070; subscription-service.ts:4719-4730).
- Accepted agreement effective_from = proposal's proposedEffectiveFrom, defaulting to PROPOSE time (agreement-service.ts:319, :643).
- effectiveUntil = effectiveFrom + termMonths (:1849-1857); termMonths required at API ⇒ every UI-created agreement has a hard money cutoff while status stays 'active' (R3).

### A.6 Agreement routes (workers/ecom-api/src/routes/agreements.ts, mounted /agreements, index.ts:155). No route declares rateLimit → 'api' preset (100/min); enforced (helpers.ts:608-633); RATE_LIMIT_API bound (wrangler.jsonc:69-76). Mutations not on 'strict'.
| Method + path | Policy | Scoping / authz | Lines |
|---|---|---|---|
| POST /propose?organizationId= | required + requireOrgMembership | orgId from ctx (query), never body; owner check in service | 96-122 |
| POST /:proposalId/counter (201) | required | counterparty check in service | 136-155 |
| POST /:proposalId/accept (201) | required | counterparty check in service | 168-183 |
| POST /:proposalId/decline | required | service | 191-207 |
| POST /:proposalId/withdraw | required | proposing party check | 215-229 |
| POST /:agreementId/terminate | required | creator OR active owner | 242-258 |
| GET / | required + requireOrgManagement | getActiveAgreements(ctx.organizationId); revenueType filter in route; synthetic single-page envelope | 277-304 |
| GET /threads/:creatorId?revenueType= | required + requireOrgManagement | org's thread | 319-335 |
| GET /pending?proposedByRole= | required + requireOrgManagement | open proposals on org; MISSING from README route table (README.md:367-379) | 355-375 |
| GET /me | required | caller's rows + anonymised peers {count, aggregateSharePercent} per (org, type), from legacy column | 440-519 |
| GET /me/threads/:proposalId | required | via caller's own proposals (open/countered/accepted); 404 otherwise | 543-615 |
| GET /me/portfolio | required | {active, pendingActionRequired, pendingWaitingOnOrg, past (90d, cap 50)} | 693-913 |
- Proposal-id mutations return 403 (not 404) for non-parties → confirms a proposal UUID exists. Low risk, SUSPECTED.
- Owner-side mutations require OWNER (assertActiveOwner); admins can read via requireOrgManagement but get 403 on mutations.

### A.7 Memory notes
- feedback_pending_proposals_no_agreement_row — CONFIRMED (agreement row only inserted by acceptProposal, :632-649; portfolio unions both tables, agreements.ts:716-739).
- feedback_agreement_proposal_ondelete_setnull — CONFIRMED for schema (ecommerce.ts:331-334) and subscription payout LEFT JOIN + warn (subscription-service.ts:4702-4708, 4738-4750). NOT followed in purchase/agreement-share.ts:53-56 (INNER JOIN), violating README.md:102-104 — NULL proposal silently falls back to fee constants for purchases/course-subs, no log.
- project_revenue_share_agreements Open Question #1 ("Default: ALL") superseded — uploader-only rule (purchase-service.ts:630-636), matching README Q1 (:268-283).

## (B) FRONTEND & ADMIN MONEY JOURNEYS
How the web calls workers: createServerApi → request() resolves URL via buildServiceUrl, forwards session cookie (buildAuthForwardingCookie), 10 s AbortController timeout (apps/web/src/lib/server/api.ts:354-398). Paths below under apps/web/src.

### B.1 Journeys
| Actor / journey | Route | Remote / server fn | Worker endpoint (api.ts line) | Effect / display |
|---|---|---|---|---|
| Buyer: buy content from detail page | routes/_org/[slug]/(space)/content/[contentSlug] | form action ?/purchase (+page.server.ts:189-197) | POST ecom /checkout/create (2074) | Stripe redirect → /checkout/success?session_id={CHECKOUT_SESSION_ID}&contentSlug= |
| Buyer: buy from player paywall CTA | lib/components/player/PreviewPlayer.svelte:320-329 | createCheckout form (lib/remote/checkout.remote.ts:72-85) | same | default successUrl ${origin}/library?purchase=success (checkout.remote.ts:45); nothing reads the param; no verify/poll (R11) |
| Buyer: buy content on creators subdomain | routes/_creators/[username]/content/[contentSlug] | action (+page.server.ts:218) | same | _creators/checkout/success (CheckoutSuccess) |
| Buyer: course/journey purchase, course-sub or tier | (space)/journeys/[journeySlug]/checkout (+page.server.ts:77 offer) | startJourneyCheckout form (lib/remote/journey-checkout.remote.ts:60-139); only slug + offerId cross the wire; offer re-resolved server-side | GET /courses/:id/offer (2173) → POST /checkout/course (2098) / POST /checkout/course-subscription (2120) / POST /subscriptions/checkout (2652) (dispatch :149-202) | successUrl …/checkout/success?session_id= (:105) |
| Buyer: subscribe to org tier | (space)/pricing (+page.server.ts:69; +page.svelte:445-468) | createSubscriptionCheckoutSession (lib/remote/subscription.remote.ts:93-126) | POST /subscriptions/checkout | /subscription/success?session_id= (:115-118); cancel → /pricing |
| Buyer: tier change | pricing (+page.svelte:1537-1590 preview dialog) | previewSubscriptionTierChange (:149) → changeSubscriptionTier (:166), prorationDate threaded | POST /subscriptions/preview-tier-change (2705), /change-tier (2716) | proration preview in GBP |
| Buyer: cancel/reactivate/resume | (platform)/account/subscriptions (+page.svelte:17-23); pricing | cancelSubscription (:198), reactivateSubscription (:219), resumeSubscription (:244) | POST /subscriptions/{cancel,reactivate,resume} (2725-2744); GET /subscriptions/mine (2696) for load (+page.server.ts:31-39) | invalidate('account:subscriptions') + invalidateCollection('library'/'subscription') (account/subscriptions/+page.svelte:142-144, 190-192, 239-241; pricing/+page.svelte:498-503, 538-542, 655-659) |
| Buyer: payment methods | account/payment (+page.svelte:116-123); studio/billing (+page.svelte:368-372); AccessRevokedOverlay.svelte:158; SubscribeButton.svelte:252; pricing :678; account/subscriptions :258 | portalSessionForm (lib/remote/account.remote.ts:381-407; .stripe.com hostname check :391-394) / openBillingPortal (:421-425, no check) | POST /checkout/portal-session (2080) | Stripe customer portal |
| Buyer: purchase history | account/payment (+page.server.ts:40) | server load | GET /purchases (726-728) | status filter (:24); load swallows errors into empty list (:51-60) — R14 |
| Buyer: library | (platform)/library, (space)/library | getUserLibrary (lib/remote/library.remote.ts:51) | content-api /api/access/user/library (1088) | purchases-based (packages/access/.../library.ts:351-370) |
| Creator: Connect onboarding | _creators/studio/earnings; (platform)/become-creator StepPayouts (steps/StepPayouts.svelte:16, 43-45) | connectMeOnboard (:599), syncMyConnect (:625), getMyConnectDashboard (:635), getMyConnectStatus (:612) | POST /connect/me/onboard (2924), GET /connect/me/status (2934), POST /connect/me/sync (2941), POST /connect/me/dashboard (2950) | ?connect=success triggers syncMyStatus in load (earnings/+page.server.ts:42-61; become-creator/+page.server.ts:46) |
| Creator: earnings / payouts | earnings (+page.server.ts:73-111, streamed) | server load | GET /subscriptions/me/earnings-summary (2858), GET /subscriptions/me/payouts?status=all&source=all (2847) | read-only, user-scoped; orgless payout rows included (subscription-service.ts:3194-3252) |
| Creator: revenue-share negotiation | _creators/studio/negotiations (+page.svelte:30) and /[proposalId] (+page.svelte:36) | getMyAgreementPortfolio (agreements.remote.ts:154), getMyAgreementThread (:167), accept/counter/decline/withdraw/terminate (:196-246) | /agreements/me/portfolio (3048), /agreements/me/threads/:id (3111), mutations (3150-3194) | .refresh() after each command (+page.svelte:111-137; [proposalId] :226-291) |
| Org owner: tiers, Connect, subscription toggle | _org/[slug]/studio/monetisation (+page.svelte:41-53) | listTiers (:54), createTier (:274), updateTier (:296), deleteTier (:313), updateSubscriptionFeature (:335), getSubscriptionStats (:351), connectOnboard (:373), getConnectStatus (:385), getConnectDashboardLink (:552), syncConnectStatus (:569) | organization-api /api/organizations/:id/tiers* (2602-2638); ecom /connect/{onboard,status,dashboard,sync}?organizationId= (2870-2905); /subscriptions/stats (2755) | tiers create Stripe Products/Prices in organization-api (deploy-production.yml:301-311) |
| Org owner: revenue share | studio/monetisation/revenue-share (settings/revenue-share 308-redirects, settings/revenue-share/+page.ts:8) | listActiveAgreements (agreements.remote.ts:92), listPendingProposals (:110), getAgreementThread (:127), proposeAgreement (:183) + mutations; getOrgMembers | GET /agreements (2976), /agreements/pending (2996), /agreements/threads/:id (3013), POST /agreements/propose (3132) | page admits owner OR admin (+page.svelte:68-79); pie :209-250 — R2 |
| Org owner: course pricing | page-builder PagePricingPanel / monetisation store (lib/page-builder/monetisation-store.svelte.ts:31-35) | updateCourseMonetisation (lib/remote/journeys.remote.ts:869-918; Stripe leg first, then tier access), updateJourneyOffer (:465), getCourseOffer (:838) | PUT/DELETE /studio/courses/:id/subscription-plan (2207, 2226), PUT …/tier-access (2248) | 422 copy when Connect not ready (:924-934) |
| Org owner: billing | studio/billing (owner-only guard :64-79) | getOrgRevenue, getTopContent (lib/remote/billing.remote.ts:34-72) | admin-api /api/admin/analytics/revenue (2278), /top-content (2295) | Revenue = completed one-off PURCHASES only (analytics-service.ts:122-126); portal card = owner's PERSONAL buyer portal (+page.svelte:350-392) |
| Org owner: sales | studio/sales (+page.svelte:32) | listSales, getSalesStats (lib/remote/sales.remote.ts:29-71) | GET /sales (2778), /sales/stats (2788) | org-scoped AND content-only (D1) |
| Org owner: subscribers | studio/subscribers (+page.svelte:39) | listSubscribers (:422), getSubscriptionStats, getConnectStatus, listTiers | GET /subscriptions/subscribers (2767), /stats | MoneySetupPrompt / MoneyStatBand via moneyReadiness (lib/utils/connect-readiness.ts:102-145) |
| Org owner: payouts | studio/payouts (+page.svelte:43) | listPayouts (:474), getPayoutSummary (:497), getPayoutsByCreatorBreakdown (:528) | GET /subscriptions/payouts, /payouts/summary, /payouts/by-creator (2802-2831) | CreatorBreakdownRail |
| Org owner: customers | studio/customers (+page.svelte:25) | getCustomers (lib/remote/admin.remote.ts:384), getCustomerDetail (:486), grantContentAccess (:518; BulkGrantAccessDialog) | admin-api /api/admin/customers (2530), /customers/:id (2567), POST /customers/:id/grant-access/:contentId (2587) | grant has NO effect on access (D2) |
| Org owner: analytics | studio/analytics (+page.svelte:31) | getAnalyticsRevenue (:150), TopContent (:184), Subscribers (:212), RevenueByCreator (:313), DashboardStats (:38) | admin-api /api/admin/analytics/* with auth required + requireOrgMembership + requireOrgManagement (workers/admin-api/src/index.ts:119-258) | CreatorRevenueTable split INVERTED (R1) |
| Platform owner | NONE | NONE | /api/admin/fees/* auth:'platform_owner' (admin-api/src/index.ts:537-690) | no web UI (:525-529); admin "revenue analytics" is org-scoped, not platform — root CLAUDE.md drift (R19) |

### B.2 Success-page confirmation
- CONTENT (org: (space)/checkout/success/+page.server.ts:25-56; creators: _creators/checkout/success/+page.server.ts:22-40): reads session_id → GET /checkout/verify (api.ts:2134); error → verification:null (:49-56). verifyCheckoutSession (purchase-service.ts:2431-2493) retrieves session, checks metadata.customerId, attaches purchase only if row exists (:2458-2492). CheckoutSuccess.svelte treats sessionStatus==='complete' alone as success (:40); retries invalidate('checkout:verify') every 3 s up to 10 ONLY while not complete (:50-59) → can show success before the webhook wrote the purchase, then stops polling (R12).
- SUBSCRIPTION ((space)/subscription/success/+page.server.ts:27-48; +page.svelte:31-54): success = complete AND subscription row exists; retries every 3 s up to 10. Correct.
- COURSE / JOURNEY (journeys/[journeySlug]/checkout/success/+page.server.ts:10-77; +page.svelte:20-34): ignores Stripe session (session_id presence-checked only, :75); polls offer.entitled via depends('journey:entitlement') every 2 s up to 15; 303 to dashboard once entitled (:60-67). Fail-closed. Correct.

### B.3 Client-side access refresh
- Library collection localStorage-backed (lib/collections/library.ts); both library pages call loadLibraryFromServer() on mount ((space)/library/+page.svelte:78-80; (platform)/library/+page.svelte:50-68).
- Subscription collection localStorage, keyed by orgId (lib/collections/subscription.ts:85-92, 110-160); unknown statuses normalised to 'active' (:82).
- Version manifest: org layout re-runs readOrgVersions via invalidate('cache:org-versions') on tab visibility (60 s cooldown) and activity-gated 5-min poll (routes/_org/[slug]/+layout.svelte:337-377); stale keys → collection targets (:257-274; lib/client/version-manifest.ts:88-121); stored at :129-140; a key MISSING from stored manifest is NOT stale (version-manifest.ts:44-55).
- Org layout loads subscription on mount only if not cached (+layout.svelte:397-399); invalidateCollection('subscription') reloads only orgs already in the collection (lib/collections/hydration.ts:149-154).
- Webhooks bump library/subscription versions server-side (e.g. handlers/checkout.ts:215); same-device mutations invalidate directly; CheckoutSuccess and subscription success pages do not invalidate collections themselves — SUSPECTED gap (R13).

### B.4 Price/currency formatting
- formatPrice (pence → £12.34) and formatPriceCompact (£1,234) hard-wired to Intl 'GBP' (lib/utils/format.ts:8-10, 66-83); course offers use formatCleanPrice (lib/page-builder/offer-paths.ts:99-101); PriceBadge uses formatPrice (PriceBadge.svelte:21, 78-91).
- Stripe objects/transfers use 'gbp' (CURRENCY commerce.ts:97-101; subscription-service.ts:4792; seed commerce.ts:814, 821).
- No USD formatting in apps/web/src; e2e asserts £ and no $ (journeys/sell-page-purchase.spec.ts:128-130).

## (C) CONFIGURATION DECLARED IN CODE (names only)

### C.1 Inventory
| Name | Kind | Declared | Consumed |
|---|---|---|---|
| RATE_LIMIT_STRICT (20/60s), RATE_LIMIT_API (100/60s) | ratelimit bindings; ns ids per env (dev 104x / test 204x / prod 304x) | workers/ecom-api/wrangler.jsonc:60-77 (dev), 116-133 (test), 211-228 (prod) | procedure enforcement (helpers.ts:608-633); presets packages/constants/src/limits.ts:147-211 (AUTH 5/15m DO, STRICT, STREAMING, API, WEB) |
| AUTH_SESSION_KV, CACHE_KV | KV | wrangler.jsonc:79-93, 135-145, 230-239 | sessions (index.ts:63 health); CACHE_KV (18 uses) |
| HYPERDRIVE, HYPERDRIVE_UNCACHED | Hyperdrive, prod only | wrangler.jsonc:171-174 | service-registry selectHyperdrive |
| ENVIRONMENT, DB_METHOD, WEB_APP_URL, API_URL; AUTH_WORKER_URL (prod) | vars | wrangler.jsonc:96-101, 109-114, 204-209 | ENVIRONMENT gates /webhooks/stripe/dev: only 'development'/'staging' (src/utils/dev-env-guard.ts:10-12). WEB_APP_URL listed OPTIONAL (src/index.ts:89) but AgreementService throws without it (agreement-service.ts:232-242; service-registry.ts:847-850) → effectively REQUIRED for /agreements |
| DATABASE_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET_BOOKING / _PAYMENT / _SUBSCRIPTION / _CONNECT | required secrets | src/index.ts:76-86 | signature map src/middleware/verify-signature.ts:32-34 (dev route reuses BOOKING); types packages/shared-types/src/worker-types.ts:212-242 |
| STRIPE_WEBHOOK_SECRET_CUSTOMER, _DISPUTE | optional secrets | src/index.ts:87-97 | customer stub; dispute → handlePaymentWebhook (index.ts:220-224) |
| WORKER_SHARED_SECRET | secret (not in ecom env validation) | – | mailers via sendEmailToWorker |
| R2_BUCKET_MEDIA / _ASSETS / _PLATFORM / _RESOURCES | deploy-time --var | .github/workflows/deploy-production.yml:183-186 | – |
| STRIPE_SECRET_KEY on organization-api | secret | deploy-production.yml:301-318 | TierService Stripe Product/Price writes |
- wrangler.jsonc:259-267 "Required Variables" comment lists only 3 secrets — stale vs src/index.ts:79-86.
- wrangler.jsonc:24-29 "No ratelimits binding … annotations are not enforced (Codex-4fsfd)" — contradicted by :38-42, :60-77, helpers.ts:608-633.

### C.2 Routes, crons, webhooks
- Prod route: custom domain ecom-api.revelations.studio (wrangler.jsonc:240-245); workers_dev false (:14).
- Payouts sweep cron 0 * * * *, prod only (wrangler.jsonc:201-203) → scheduled: dispatchScheduled (src/index.ts:270-273) → handlers/payouts-sweep.ts:133 (DEFAULT_OLDER_THAN_MINUTES=15 at :33).
- Agreement-expiry cron 0 8 * * *, prod only, in notifications-api (its wrangler.jsonc:173-175).
- Webhook mounts (src/index.ts): /webhooks/stripe/payment :165-169, /subscription :175-179, /connect :185-189, /customer :195-199, /booking :205-209, /dispute :220-224, /dev :242-255 (404 unless dev/staging).

### C.3 Stripe SDK / API version
- stripe ^19.2.0 in access, test-utils, purchase, subscription, workers/ecom-api; ^19.3.1 in database. pnpm-lock resolves stripe@19.3.1 (npm-deprecated: "major bug where the Files API times out").
- Pinned apiVersion 2025-10-29.clover (packages/purchase/src/stripe-client.ts:31, 54-56; backfill-stripe-customer-ids.ts:54, 118).
- new Stripe(key) WITHOUT apiVersion in seed/commerce.ts:779, 894, 997 and apps/web/e2e/helpers/subscription.ts:347.

### C.4 Constants (packages/constants/src/commerce.ts)
STRIPE_EVENTS (:1-31) incl. product.updated, price.created, price.updated; PURCHASE_STATUS (:33-38); SUBSCRIPTION_STATUS (:40-47); CHURN_REASON (:60-67); BILLING_INTERVAL; CONNECT_ACCOUNT_STATUS; FEES (:88-95): PLATFORM 1000, ORG 1000 (one-off), SUBSCRIPTION_ORG 1500; CURRENCY (:97-101). limits.ts: PAGINATION + RATE_LIMIT_PRESETS; no money amounts.

### C.5 Seeds and scripts (code only; test mode)
- seed/stripe-subscription.ts: assertTestModeKey rejects sk_live_/rk_live_ (:38-52); classifyStripeKey (:61-70); createOrFindStripeCustomer (:107-140); tok_visa default PM (:152-180); createOrFindStripeSubscription (:207-268).
- seed/commerce.ts: cleanupStripeSeedObjects archives codex_seed Products/Prices >24h and lists seed Connect accounts (:57-111); runs only with STRIPE_SECRET_KEY after assertTestModeKey (:765-782); Product + monthly/annual GBP Prices per tier (alphaStandard, alphaPro, betaStandard, bonesSoulPath) with codex_tier_id metadata (:785-830); activates test Connect accounts (:171-226, 285-339); seeded subscription rows real test-mode subs when key present else SYNTHETIC ids (:878-951); rows record organizationFeeCents 0 and 90% creator (:869-871, 944-947), not FEES.SUBSCRIPTION_ORG_PERCENT.
- seed/tiers.ts:16-73 inserts DB tiers; prices seed/constants.ts:357-390 (£4.99 / £9.99 / £6.99 / £15.00 monthly).
- NO agreements seeded (only TRUNCATE lists seed-data.ts:45-46, reset-data.ts:37-38; CASCADE seed-data.ts:96).
- backfill-stripe-customer-ids.ts: oldest Customer per email; --dry-run/--force/--reset; refuses live keys (:110).

### C.6 Test utilities (packages/test-utils/src)
- createMockStripe (stripe-mock.ts:53-238): products, prices, accounts, accountLinks, checkout.sessions, subscriptions (incl. resume), transfers, paymentIntents, invoices, charges. NO webhooks/constructEventAsync, billingPortal, customers.
- seedPurchaseWithAccess (purchase-helpers.ts:57); tier/subscription/Connect factories + mock Stripe sub/invoice/account objects (subscription-factories.ts:24-192); agreement table cleanup order (database.ts:196-227).

### C.7 CI and local webhooks
- CI injects test-mode secret NAMES only: testing.yml:364-371, 687-696 (matrix needs_stripe :481-549), 835-864; e2e-api-fast.yml:131-166, 184-190; e2e-debug.yml:111-133, 170, 199-200; deploy-production.yml:194-200 (ecom), 318 (org-api). NO workflow runs the Stripe CLI.
- Local webhook paths: (1) stripe listen --forward-to http://localhost:42072/webhooks/stripe/dev with all STRIPE_WEBHOOK_SECRET_* = CLI secret (ecom-api CLAUDE.md; docs/agreements/README.md:547-548); routeDevWebhook dispatches by type prefix (src/utils/dev-webhook-router.ts:35-95). (2) Cloudflare tunnel ecom-api-local.revelations.studio → localhost:42072 (infrastructure/cloudflare-tunnel/config.yml:11-12). (3) Hosted dev endpoints via .github/scripts/setup-stripe-dev-webhooks.sh (base URL :31, endpoint→event map :35-40, test-mode check :43-48, stripe webhook_endpoints create :64). workers/ecom-api/scripts/test-local.sh:37-38 still points at port 8787 (stale).
- Dev-router gap: product.updated / price.created / price.updated not routed (handled in subscription-webhook.ts:630-673) → Dashboard tier sync-back never runs under stripe listen. CONFIRMED.
- setup-stripe-dev-webhooks.sh gaps: subscription endpoint omits customer.subscription.paused/resumed (handled subscription-webhook.ts:507, 531); connect endpoint omits account.application.deauthorized (connect-webhook.ts:150); connect endpoint created without Connect flag (:37, :64) [Lead D: confirmed via Stripe API ref — without connect=true only platform-account events are delivered].

### C.8 E2E coverage (apps/web/e2e)
- agreements/: propose-accept.spec.ts:40; counter-propose.spec.ts:36 (30%→40% counter→accept); decline.spec.ts:40 (decline + re-propose); terminate.spec.ts:73, :149 (owner/creator); pie-math.spec.ts:30 (3 creators sum 100%).
- subscription/: 01-studio-connect-onboarding.spec.ts:98-226; 02-studio-tier-crud.spec.ts:134, :208; 03-subscribe-flow.spec.ts:51 (Stripe navigation ABORTED :67-69).
- account-subscription-cancel.spec.ts:95-207; subscription-cross-device.spec.ts:98; account/payment.spec.ts:17-144; studio/analytics.spec.ts:32-193; journeys/sell-page-purchase.spec.ts:45-226 (offer renders, GBP; contains fixme).
- test.skip with "Codex-z1wuz synthetic stripeSubscriptionId" BLOCKER: pricing-reactivate.spec.ts:53-56, subscription-paused-resumed.spec.ts:52-55, streaming-revocation.spec.ts:70-73, progress-save-access-gate.spec.ts:50-53. Seed now creates REAL test-mode subs when a key is present (seed/commerce.ts:891-930) → blocker may be stale (SUSPECTED).
- Webhook-driven helpers (postForgedWebhookEvent, waitForSubscriptionRow, triggerStripeCliEvent, cancelAnyActiveSubscriptions) exist only as a comment (helpers/subscription.ts:6-7). CONFIRMED.
- GAPS — no e2e covers: completed Stripe checkout or any webhook round-trip; content/course purchase completion; any success page; refunds/disputes; payouts/transfers; agreement → payout effect; agreement withdraw; expiry cron; admin grant-access.
- Unit/integration: agreements agreement-math.test.ts (23), agreement-service.test.ts (81); ecom agreements-routes.test.ts; notifications agreement-expiring-sweep.test.ts. Concurrency test is single-row only (agreement-service.test.ts:425-430).

## (D) HAND-OFF VERDICTS
- D1 Orgless sales missing from /sales: CONFIRMED. /sales requireOrgManagement scoped to ctx.organizationId (routes/sales.ts:46-50); listSales eq(purchases.organizationId, orgId) AND isNotNull(contentId) (purchase-service.ts:2637-2640); getSalesStats org filter (:2760). Course sales excluded by design (:2633-2636). Admin revenue analytics org-scoped too (analytics-service.ts:122-126). Orgless sales surface only in the creator payout ledger (GET /subscriptions/me/payouts, subscription-service.ts:3194-3252; payout rows written orgId null purchase-service.ts:1211-1238) — amounts only, no gross/buyer detail; no orgless sales ledger anywhere.
- D2 Admin complimentary grants give NO access: CONFIRMED end to end. Route POST /api/admin/customers/:customerId/grant-access/:contentId (auth required + requireOrgMembership + requireOrgManagement, admin-api/src/index.ts:498-509) → AdminCustomerManagementService.grantContentAccess (customer-management-service.ts:324-422) writes ONLY content_access 'complimentary' upsert (:394-412); no purchase, no entitlement; returns true. Access decision (access-decision.ts:241-323) reads purchases (verifyPurchase), entitlements (content_purchase|grant, entitlements-resolver.ts:63, 90-108), course entitlements, subscriptions, followers, management membership. No non-test code in packages/access/src reads content_access (comment at access-decision.ts:348 wrongly says it does). Library purchases-based (library.ts:351-370). UI (BulkGrantAccessDialog → admin.remote.ts:518) reports success. content_access is write-only for access purposes (written by completion :751-760; soft-deleted by refund/dispute :2005-2014, 2358-2367). Fix direction: write entitlements source='grant'.
- D3 refund_reviews has no reader: CONFIRMED. Only INSERT in refund path (purchase-service.ts:2254-2276) + warn log (:2270); zero readers in packages/*/src, workers/*/src, apps/web/src, packages/database/scripts; no studio/admin surface or resolve endpoint.
- D4 Agreement splits on one-off purchases DO apply; DB fee config is the casualty (see A.4).

## RISKS / GAPS / DRIFT
Money correctness
- R1 CONFIRMED — revenue-by-creator split INVERTED: getRevenueByCreator selects organizationFeePercentage as shareBps (analytics-service.ts:1046-1050) → splitPercent = shareBps/100 (:1176) → CreatorRevenueTable.svelte:121. Column holds 10000 − share since WP-1 (agreement-service.ts:637-639). No status/revenue-type filter (:1059-1072) → terminated rows + per-type duplicates appear. Integration test pins the old meaning (analytics-revenue-by-creator.integration.test.ts:159, :217). "Revenue" = SUM(purchases.creatorPayoutCents) (:1109).
- R2 CONFIRMED — pie charts mix units: owner pie studio/monetisation/revenue-share/+page.svelte:201, 209-250; creator pie negotiations/[proposalId]/+page.svelte:149-153. Both plot post-platform shares against 10000 − FEES.PLATFORM_PERCENT → a 30% share drawn as 30% of gross instead of 27%; Σ 9000–10000 renders over-allocated though backend accepts. Platform fee hard-coded (TODO :199-200). Propose/counter dialogs correctly say "of post-platform revenue" (ProposeAgreementDialog.svelte:100, 174).
- R3 CONFIRMED — effectiveUntil is a HARD money cutoff (agreement-share.ts:73-76; subscription-service.ts:4727-4730; agreement-service.ts:1067-1070); status 'active' forever; termMonths mandatory (validation agreements.ts:65-69); README.md:157-159 calls it "a review-by date, not a hard expiry". After expiry subscription pools fall back to org owner; purchases fall back to fee constants (90% creator); dead share still consumes validation headroom (agreement-service.ts:1816-1821) and is hidden from owner list (:1067-1070).
- R4 SUSPECTED — creator paid twice on one org-sub invoice during renegotiation: new agreement effective_from = propose time (:319, :643); predecessor countable via terminatedAt > invoice.created; if invoice.created between propose and accept and webhook runs after accept, both rows match; not deduped by creator (subscription-service.ts:4738-4755) → totalShareBps double-counted. Same idempotency key ${chargeId}_creator_${creatorId} (:5084): same amount dedupes; different amounts → Stripe rejects key reuse → pending-payout branch (:5114-5137).
- R5 SUSPECTED — Σ shares > 10000 under concurrent accepts for different creators (each accept locks only its own proposal :523, 561-570; payout clamps :4982 but invariant breaks). Two concurrent proposeAgreement can both pass assertNoOpenThread (no lock, :268-329).
- R6 CONFIRMED — inconsistent `at` (purchase-service.ts:624, 1041; course-subscription-service.ts:1007 vs invoice.created).
- R7 CONFIRMED — purchases.creator_org_agreement_id always NULL (:738-739, 1111-1112).
- R8 CONFIRMED — removing a member doesn't end their agreements; no agreement code in packages/organization/src or workers/organization-api/src; payout queries don't check membership → departed creator keeps being paid until terminated.
- R9 CONFIRMED — README.md:246-247, 276-278 "org keeps 100% when no agreement"; code falls back to fee orgFeePercent (10% org / 90% creator) (purchase-service.ts:648-652).
- R9b CONFIRMED — webhook paths ignore DB fee config for one-off, course purchases, org subs; skip purchase mailer.
- R9c CONFIRMED — purchase/agreement-share.ts INNER JOIN (:53-56) contra README.md:102-104; NULL proposal silently ignored.
Web journeys
- R10 CONFIRMED (traced) — agreement emails deep-link ${WEB_APP_URL}/studio/negotiations/<id>?orgId= (agreement-service.ts:1491-1494); prod WEB_APP_URL apex https://revelations.studio (ecom wrangler.jsonc:207; notifications wrangler.jsonc:179); apex passes paths unrewritten (apps/web/src/hooks.ts:57-63); no routes/(platform)/studio; negotiations only under _creators via creators. subdomain (hooks.ts:66-73). Owners get the creator-side path. Expiring-soon emails affected.
- R11 CONFIRMED — PreviewPlayer purchases → /library?purchase=success, no verify/poll.
- R12 CONFIRMED — content success page declares success on Stripe complete, stops polling (CheckoutSuccess.svelte:40, 53).
- R13 SUSPECTED — after a FIRST subscription to an org, badges can stay stale until full reload (version-manifest.ts:44-55; hydration.ts:151-153; +layout.svelte:397-399). UI only.
- R14 CONFIRMED — account/payment swallows load errors into empty state (+page.server.ts:51-60) and renders raw portal error (+page.svelte:122-123, from account.remote.ts:399-405); studio billing masks it (billing/+page.svelte:374-388).
- R15 SUSPECTED — admins can open revenue-share page and see owner actions (+page.svelte:68-79) but mutations are owner-only → 403s.
- R16 CONFIRMED — openBillingPortal lacks .stripe.com hostname check (account.remote.ts:391-394 vs 421-425). Low risk.
Config / docs drift
- R17 CONFIRMED — local dev drops webhooks (dev router no product/price; setup script omits pause/resume/deauthorized; connect endpoint lacks connect flag).
- R18 CONFIRMED — stale comments: wrangler.jsonc:24-29, :259-267; test-local.sh:37-38 (8787); pricing-reactivate.spec.ts:133 labels 42075 as organization-api.
- R19 CONFIRMED — CLAUDE.md drift: root CLAUDE.md marks admin-api analytics platform_owner (actually org-management, admin-api/src/index.ts:122-126); ecom-api CLAUDE.md route tables omit /checkout/course, /checkout/course-subscription, /subscriptions/{verify,preview-tier-change,resume,payouts*,me/*}, /sales, /courses, /studio/courses, /agreements; lists WEB_APP_URL optional; dispute secret "(stub only)".
- R20 CONFIRMED — docs/agreements/README.md drift: expiry cron "deferred"; claims proposeAgreement locks; GET /agreements/pending missing; owner path /studio/settings/revenue-share (now 308); "use leftJoin everywhere".
- R21 CONFIRMED — seed/SDK drift: no agreement fixtures; seeded subs 0% org fee; Stripe clients without apiVersion in seed + e2e; lockfile stripe@19.3.1 deprecated; backfill can't run against live.
- R22 SUSPECTED — 4 e2e specs skipped on possibly stale Codex-z1wuz; no e2e drives a webhook or completes a payment.
- R23 SUSPECTED — findExpiringAgreements doesn't filter soft-deleted users (agreement-service.ts:1169-1170 vs 1193-1214).
