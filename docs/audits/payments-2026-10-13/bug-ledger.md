# Payment system — bug ledger (investigation 2026-10-13)

Every bug noticed during the payments investigation. **Filed 2026-10-13 as epic `Codex-2hxff`** (one child bead per root cause — mapping at the bottom; duplicate search run first against open + closed beads).
Full source reports: report-purchases.md, report-subscriptions.md, report-surfaces.md (pending). Architecture notes: verified-findings.md.

Status: **V** = lead traced in code · **D** = verified against Stripe docs · **A** = agent-traced, lead not re-verified (A2 = both agents independently) · **S** = suspected (depends on Stripe behaviour / ordering).
Severity: **CRIT** money lost / charged-without-access / security · **HIGH** money mis-routed or stranded, wrong access · **MED** latent / narrow · **LOW** data-quality / cosmetic.
IDs are stable — never renumber; append only.

## SECURITY

| ID | Sev | Status | Bug | Evidence | Effect |
|---|---|---|---|---|---|
| SEC-01 | CRIT | V | IDOR: POST /connect/dashboard authorises org from QUERY but acts on BODY org | policy org = URL param → subdomain → `?organizationId` (helpers.ts:466-522; never body); ecom-api host subdomain reserved → query wins. Handler uses body.organizationId (connect.ts:135-137) → createDashboardLink → resolveUserIdForOrg(victim) → accounts.createLoginLink(victim acct) (connect-account-service.ts:581-600). Web always sends query==body (api.ts:2894) — masks it. Org creation needs only self-serve `creator` role (organization-api organizations.ts:72). /onboard (ignores _orgId), /sync (always ctx.user.id), /status (query) NOT exploitable. Not exercised. | Any org owner/admin → logged-in Express Dashboard for ANY other org's payout account: balances, payout history, and (per platform Express settings) bank-account edits = payout diversion |
| SEC-03 | HIGH | V | Org takeover: any ADMIN can promote anyone (incl. self) to owner, then demote/remove the original owner | PATCH /api/organizations/:id/members/:userId is requireOrgManagement (owner OR admin) (organization-api routes/members.ts:207-215); updateMemberRoleSchema allows 'owner' (validation organization.ts:27-28); updateMemberRole has NO actor check — only ensureNotLastOwner (organization-service.ts:962-1006) | Admin self-promotes → 2 owners → demotes founder. Contradicts owner's model "one owner = the creator" |
| SEC-02 | LOW | A | SubscriptionPaymentRequiredError forwards the raw Stripe message in error context | subscription-service.ts:2370; ServiceError context is client-facing (mapper serialises verbatim) | Stripe-internal message text reaches the client |

## One-off purchases (@codex/purchase + ecom-api booking/payment/dispute webhooks)

| ID | Sev | Status | Bug | Evidence | Effect |
|---|---|---|---|---|---|
| PAY-01 | CRIT | V | Transient DB/Stripe failure in a webhook service method acked 200 → Stripe never retries | base-service.ts:111-151; base-errors.ts:248-263; error-classification.ts:45-47; webhook-handler.ts:75-81. completePurchase:833, completeCoursePurchase:1174, processRefund:2062, processDispute:2400. Tests mock raw Error (checkout.test.ts:379-386; webhook-handler.test.ts:71-95) | Buyer charged with no purchase/access; refunds & disputes silently unrecorded |
| PAY-02 | HIGH | V | Webhook PurchaseService built without feeConfig/mailer/webAppUrl | handlers/checkout.ts:188,299; payment-webhook.ts:268 vs service-registry.ts:782-793; fallback purchase-service.ts:580-593,1026-1037 | fee_config_* + /api/admin/fees/* have NO effect on one-off sales (10%/10%/0/0); creator-connect-needed email never sent |
| PAY-03 | HIGH | V | Any partial refund treated as full; 2nd partial refund skipped | purchase-service.ts:1981-1987, 1990-2033; amount = cumulative charge.amount_refunded (payment-webhook.ts:164,171); pending rows cancelled in full (2211-2214) | Access revoked on £1 refund; 2nd clawback never happens; sales net → 0 |
| PAY-04 | HIGH | V | Reversal failure (any code except insufficient_funds) still marks row 'reversed' | purchase-service.ts:2172-2224 | Ledger claims a clawback that never happened; no retry |
| PAY-05 | HIGH | V | Disputes: no transfer reversal; closed/won/lost unhandled; disputedAt never cleared | payment-webhook.ts:277-287; processDispute 2316-2402; verifyPurchase 1655-1661 | Platform absorbs chargeback + fee, creator/org keep slices; WON dispute = permanent access loss |
| PAY-06 | HIGH | V | Disputed purchase's PENDING payout rows still paid out | drain query subscription-service.ts:3559-3576 (no join to purchases); sweep 5264-5266; refunds cancel pending (2211-2214), disputes don't | Creator/org paid for a charged-back sale once Connect activates (S: whether Stripe rejects source_transaction on a disputed charge) |
| PAY-07 | HIGH | V | Failed transfer written status='failed' w/o charge id; drains select only 'pending' | purchase-service.ts:1603-1612; subscription-service.ts:3565, 5264-5266 | Creator money stranded permanently |
| PAY-08 | HIGH | V | paymentIntents.retrieve failure → chargeId null → no payouts written | handlers/checkout.ts:165-180; purchase-service.ts:804-822 | Sale completes, nobody paid, nothing to sweep |
| PAY-09 | HIGH | V/A | Checkout gate = published + price>0 only | purchase-service.ts:304-319, 867-880; [A] access-decision.ts:260-288 courseOnly/team/followers branches ignore purchases; [A] publish gate isPurchasable&&price (content-service.ts:839-841) | Buyer can pay and be denied; isPurchasable=false+price content publishes without Connect check and is still sold |
| PAY-10 | MED | V | Double purchase possible | sessions.create no idempotency key/expires_at (purchase-service.ts:407); dup check only COMPLETED at session-create (322-332); no unique (customer, content) (ecommerce.ts:577-579) | Two tabs → two charges + two payouts |
| PAY-11 | MED | A | Course refund before completion dropped (self-heal uses content-only schema) | purchase-service.ts:1892-1902; validation/schemas/purchase.ts:163-168 | Refund lost; course granted later anyway |
| PAY-12 | LOW | D | charge.refunds not auto-expanded since API 2022-11-15 | payment-webhook.ts:155; Stripe changelog 2022-11-15 | stripeRefundId/refundReason always null; reversal idempotency suffix falls back to amount |
| PAY-13 | MED | A | Platform loses money on cheap items: platform 10% < Stripe fee (SCT ⇒ platform pays Stripe fee); min-fee floor not wired (PAY-02) | revenue-calculator.ts; constants commerce.ts:88-95 | e.g. £1 → 10p platform vs ~20p+ Stripe fee |
| PAY-14 | MED | A2 | Orgless purchases: no entitlement row (entitlements.organizationId NOT NULL) and absent from /sales | entitlement-writer.ts:53-72 (org-scoped only); purchase-service.ts:2637-2640 | Creator-direct revenue invisible in studio sales; access relies on verifyPurchase alone |
| PAY-15 | LOW | A | Org slice stranded when org has neither Connect nor an active owner — no ledger row | purchase-service.ts:1346-1358 | obs.error only |
| PAY-16 | LOW | A | Fee-config audit log records changes that never happen (null accepted as "inherit" but merge does `?? existing`) | validation fee-config.ts:54-57,74-78; fee-config-service.ts:294-302,374-383,126-142 | Misleading audit trail |
| PAY-17 | LOW | A | Library ignores disputedAt | library.ts:315-320 | Disputed content still listed in library |
| PAY-18 | MED | A | One-off refunds write no AccessRevocation KV key | payment-webhook.ts:191-195 | Issued HLS URLs stay valid until expiry after refund |
| PAY-19 | LOW | A | Receipt email re-sent on every redelivery; refund email sent with no matching purchase and reads never-set charge.metadata.contentTitle | checkout.ts:227-249; payment-webhook.ts:131 | Duplicate / malformed emails |
| PAY-20 | LOW | A | Booking handler never checks payment_status (a test pins processing 'unpaid' sessions) | checkout.ts; checkout.test.ts:692 | Safe only while card-only |
| PAY-21 | MED | A2 | User hard-delete cascades purchases AND payouts ledger rows | ecommerce.ts:422-424; payouts.ts:40-47 (org+user CASCADE) | "Immutable" financial ledger destroyable |
| PAY-22 | LOW | S | Customer resolve by email can adopt another/deleted Codex user's Stripe Customer; stale-recovery retry within 24h reuses idempotency key → deleted customer | resolve-customer.ts:108-131, 231-262 | Cross-user customer linkage (suspected) |
| PAY-23 | LOW | A | stripe-customer-integrity.ts exported, no production caller | index.ts:121-126 | Dead code |
| PAY-24 | MED | A | GET /purchases hides course purchases (contentId IS NOT NULL filter); manual offset not withPagination | purchase-service.ts:1708-1711, 1722 | Buyers can't see course purchases in history |
| PAY-25 | LOW | A | No assertGbpOnly at purchase transfer site (doc rule) | purchase-service.ts:1532-1545 | Currency invariant only by hardcoding |

## Subscriptions / Connect / payouts (@codex/subscription + subscription/connect webhooks + sweep)

| ID | Sev | Status | Bug | Evidence | Effect |
|---|---|---|---|---|---|
| SUB-01 | HIGH | V | Webhook/cron SubscriptionService built without feeConfig | subscription-webhook.ts:217; connect-webhook.ts:122; payouts-sweep.ts:68; payment-webhook.ts:272-275. Only course-sub gets one (subscription-webhook.ts:284-296). Never wired (git -S) | Fee tables ignored for org-sub invoices; min floors = 0; changeTier snapshot (DB fees) overwritten by next invoice (constants) |
| SUB-02 | MED | V | Latent double payout in drain: transfer then UPDATE; UPDATE failure leaves 'pending'; key expires ~24h | subscription-service.ts:3778-3804 | Retry after 24h = second real transfer |
| SUB-03 | CRIT | V+D | Tier price change moves EVERY subscriber (both intervals) onto the changed Price | TierService fires per interval (tier-service.ts:518,526,933); both callers drop `interval` (service-registry.ts:1000-1004; subscription-webhook.ts:255-258); propagator filters tier+status only (3955-3967); key includes priceId so a both-prices edit runs twice. Stripe: interval change ⇒ immediate charge + cycle reset | Annual-price edit charges every MONTHLY subscriber a year immediately; monthly-price edit flips annual subs to monthly; DB/Stripe disagree |
| SUB-04 | HIGH | V | No-agreement org with non-chargesEnabled primary Connect: creator pool gets NO transfer and NO ledger row | 4778-4784; pending row = org fee only (~4844-4866); transferCreatorPoolToOwner silent exit (4316-4330); also all-zero-share branch (4949) | £7.65 of every £10 silently retained forever (trigger: Connect restricted after subscribers exist) |
| SUB-05 | HIGH | V | Primary payout drain never fires for per-user Connect accounts | accounts.create metadata codex_user_id only (connect-account-service.ts:235-237) vs required codex_organization_id (connect-webhook.ts:27-29,118); test injects org metadata by default (connect-webhook.test.ts:91) | Payouts wait for hourly cron — production ONLY; dev/staging never drain |
| SUB-06 | HIGH | V path / S freq | Webhook redelivery duplicates pending/failed rows → each drained → double payout | platform_fee guarded (4625-4648); pending/failed inserts no unique/no onConflict; uq transfer_id N/A while NULL; no event dedupe. Course path pre-check skips WHOLE fan-out (course :967-986) → partial first run leaves slices unpaid | Extra real transfers on drain |
| SUB-07 | HIGH | V | Second concurrent subscription billed but never recorded | AlreadySubscribed only at session-create; insert hits uq_active_subscription_per_user_org; re-select by own id misses → rethrow (1200-1214) → non-transient → 200 | Orphan Stripe sub billed every period: no row/access/transfers; user can't cancel via our UI |
| SUB-08 | HIGH | A (pattern V) | Subscription refund clawback defects (twin of PAY-03/04) | reverseSubscriptionPayoutsForCharge 4441-4589: non-insufficient_funds failure still 'reversed' (4534-4573); later refunds skip reversed rows (4481-4483); partial cancels whole pending rows (4560-4563); gross rebuilt from ledger (4461) wrong when SUB-04 dropped a slice; refund_reviews can't hold sub rows (4541-4550). S: Stripe may report 'balance_insufficient' not 'insufficient_funds' | Clawbacks recorded but not done; residual refunds never clawed back |
| SUB-09 | HIGH | V/A | Access after cancellation / wrong state: self-heal inserts ACTIVE regardless of Stripe status; invoice success sets ACTIVE unconditionally; sub.deleted leaves no tombstone | [V] 1160; [A] 1500, 1893-1922 | Late event re-grants access after deletion; cancelling→active flip blocks reactivate |
| SUB-10 | HIGH | V + prod-V | Customer Portal not locked down: no `configuration` passed; STRIPE_PORTAL_CONFIGURATION_ID read nowhere. PROD default portal config bpc_1T92kO7wyGmo4sh6wT8InTS2: subscription_cancel ENABLED (at_period_end), update/pause disabled | purchase-service.ts:2574-2577 | Portal cancel/plan-switch per Stripe DEFAULT config → silent DB drift; plan switch = billed for one tier, entitled to another (mapper keeps metadata tierId, stripe-status-mapper.ts:92) |
| SUB-11 | MED | A | amountCents corruption race (proration invoice amount_paid vs sub.updated unit_amount) | 1489-1507 vs 1838-1840 | Corrupts isUpgrade (2320), MRR (2860-2866), email "old price" |
| SUB-12 | MED | S | Client-controlled prorationDate, no server check vs issued preview; upgrade key ignores target price | validation/subscription.ts:129; 2321-2354 | Possible proration gaming |
| SUB-13 | LOW | A | Resume idempotency key not unique per pause cycle | 2581 | Second resume within 24h replays first response |
| SUB-14 | MED | A | Course-sub gaps: org fee dropped (log only) when no Connect/owner; no Connect check at checkout; failed rows lack charge id/transferGroup (invisible to refund reversal) | course-subscription-service.ts:1110-1115, 566-669, 1239-1248 | Org slice lost; course sales before Connect ready |
| SUB-15 | LOW | A | Sweep: unbounded, sequential, no locks, attemptedAt never bumped, retryCount/lastRetryAt never written | 5258-5352; payouts.ts:95-96 | Scale/subrequest-limit risk; stuck rows re-checked forever |
| SUB-16 | MED | A | Dashboard tier sync-back (product.updated / price.created) wrapped by handleError → transient failure acked 200 | tier-service.ts:810, 942 | Price/product sync lost permanently |
| SUB-17 | LOW | A | UnsupportedCurrencyError thrown AFTER the subscription UPDATE and acked 200 | 1495-1518 | Row updated, no transfers, no ledger |
| SUB-18 | LOW | A | Payout-released email never sent (payoutMailer absent on both drain paths) | 3659-3696 | Creators not notified when parked money is released |
| SUB-19 | LOW | A | Tier/course Stripe create idempotency keys are random UUID per call | tier-service.ts:208-245, 365; course :168-201 | Protects only SDK in-call retries |
| SUB-20 | LOW | A | Misc: resolveOrgOwnerId non-deterministic (4276-4289); 'member'→'subscriber' rewrite then inactive on cancel (1194, 1907-1919); org payout summary counts platform_fee in totalEarned (3149-3176); needsAttention differs creator vs org (3305-3310 vs 3465-3470); rounding pennies unrecorded | as listed | Reporting/membership oddities |
| SUB-22 | HIGH | V | Org payout pin is never re-validated: a removed/demoted owner keeps receiving the org's revenue forever | resolvePrimaryConnect uses the pin with NO membership check (resolve-primary-connect.ts:52) — only the pin-NULL fallback filters status='active' (:54-73); sole writer pinOwnedOrgsToUser sets it only WHERE pin IS NULL, "deliberately never overwritten" (connect-account-service.ts:724-769); nothing clears it on member removal (FK set null only on user hard-delete) | Org fee (+ the whole creator pool in no-agreement orgs) routes to an ex-owner's personal Connect account indefinitely |
| SUB-21 | MED | A | /connect/sync and /me/sync update status but never trigger resolvePendingPayouts | connect-account-service.ts:630-647 | Manual sync doesn't release parked money (compounds SUB-05) |

## Revenue-share agreements (@codex/agreements + /agreements routes + split consumers)

| ID | Sev | Status | Bug | Evidence | Effect |
|---|---|---|---|---|---|
| AGR-01 | HIGH | V | Agreement term is a HARD payout cutoff while status stays 'active' | schema calls term a "soft-lock review window" (ecommerce.ts:216); API forces termMonths 1-120 (validation/agreements.ts:58-69); computeEffectiveUntil (agreement-service.ts:1849-1857) → money predicate requires effectiveUntil > at (agreement-share.ts:62-76; subscription-service.ts:4719-4730); nothing writes 'expired' | At term end the SUBSCRIPTION path finds no agreement → whole creator pool to org owner: co-creator silently drops to £0 (the exact bug the agreements epic fixed) while UI shows "active". Purchases fall back to default org fee |
| AGR-02 | MED | V | Studio/admin "revenue by creator" shows each creator's share INVERTED | analytics-service.ts:1040-1050 reads legacy organizationFeePercentage (=10000−share) as shareBps; comment states the wrong premise; [A] its test encodes the same mistake | 30% creator displayed as 70% |
| AGR-03 | MED | A | fetchExistingActiveShares has no effectiveFrom/effectiveUntil predicate | agreement-service.ts:1810-1840 (reads legacy column, status active + terminatedAt null) | Lapsed (AGR-01) and future-dated rows still consume share headroom → blocks valid new proposals |
| AGR-04 | LOW | A | proposeAgreement takes no lock despite header + README claiming it | agreement-service.ts:268-329 vs :24-29; README.md:161-165 | Concurrent proposes can open two round-1 threads |
| AGR-05 | LOW | A | Purchase/course-sub agreement lookup uses INNER JOIN to proposal (NULL current_proposal_id → silent fallback, no log) and .limit(1) without orderBy | agreement-share.ts:53-56; violates README.md:102-104 (subscription path LEFT JOINs + warns, subscription-service.ts:4702-4750) | Agreement silently ignored on one-off/course paths |
| AGR-06 | LOW | A2 | purchases.creator_org_agreement_id / platform_agreement_id always written NULL | purchase-service.ts:738-739, 1111-1112 | Audit link from sale → agreement never recorded |
| AGR-07 | LOW | A | Active-as-of timestamp differs by path: org subs use invoice.created; purchases/course-subs use processing time `new Date()` | subscription-service.ts:1527-1530; purchase-service.ts:624,1041; course :1007; agreement-share.ts:16-19 header claims pinned timestamp | Delayed webhook can apply a different agreement than was active at sale |
| AGR-08 | LOW | A | Termination emails rebuild share from legacy column; /me peer aggregates computed from legacy column | agreement-service.ts:1001; agreements.ts:440-519 | Correct only while dual-write holds |
| AGR-09 | HIGH | V | Removing a member does NOT end their agreements; payout agreement query has no membership check | no agreement code in packages/organization/src or workers/organization-api/src; subscription-service.ts:4695-4755 (no membership join) | Departed creator keeps their revenue share until term lapse (AGR-01) or manual terminate (policy confirm) |
| AGR-10 | MED | V | Agreement + expiring-soon emails deep-link to a page that doesn't exist on the apex host | link `${webAppUrl}/studio/negotiations/<id>?orgId=` (agreement-service.ts:1491-1494); (platform) routes have no studio/; negotiations only under _creators/ (creators. subdomain); owners get creator-side path | Every agreement email link is dead for both parties |
| AGR-11 | MED | A | Revenue-share pie charts plot post-platform shares as % of gross (and hard-code the platform fee) | studio/monetisation/revenue-share/+page.svelte:199-250; negotiations/[proposalId]/+page.svelte:149-153 | 30% drawn as 30% of gross (real 27%); valid Σ 90–100% shown as over-allocated |
| AGR-12 | MED | S | Creator possibly paid twice on one org-sub invoice during renegotiation (predecessor still countable via terminatedAt > invoice.created; new row effective from PROPOSE time; rows not deduped per creator) | agreement-service.ts:319,643; subscription-service.ts:4738-4755, 5084, 5114-5137 | Double-counted totalShareBps; key collision → pending branch |
| AGR-13 | LOW | S | Σ shares can exceed 10000 under concurrent accepts for different creators (each accept locks only its own proposal) | agreement-service.ts:523, 561-570; payout clamps at subscription-service.ts:4982 | Validation invariant breaks (payout clamps) |
| AGR-14 | LOW | S | Admins see owner actions on revenue-share page but every mutation is owner-only → 403 | revenue-share/+page.svelte:68-79; assertActiveOwner | Confusing UX |

## Web app / studio surfaces (apps/web + admin analytics)

| ID | Sev | Status | Bug | Evidence | Effect |
|---|---|---|---|---|---|
| WEB-01 | MED | V | Content success page declares success on Stripe sessionStatus 'complete' alone and stops polling — never waits for our purchase row | CheckoutSuccess.svelte:40,53 (shouldRetry = !isComplete && …); verifyCheckoutSession attaches purchase only if row exists (purchase-service.ts:2458-2492) | With PAY-01, buyer sees "success" but has no access and no further signal |
| WEB-02 | MED | V | Studio Billing "Revenue" = completed one-off purchases only | analytics-service.ts:122-126 (purchases, org-scoped, COMPLETED) | Subscription / course-sub / orgless revenue excluded from the revenue headline |
| WEB-03 | LOW | A | Player paywall purchase CTA returns to /library?purchase=success — nothing reads the param; no verify, no poll | checkout.remote.ts:45; PreviewPlayer.svelte:320-329 | No confirmation; library may be stale |
| WEB-04 | LOW | S | Content/subscription success pages don't invalidate client collections themselves (rely on version-manifest poll) | B.3; version-manifest.ts:44-55 (missing key ≠ stale) | Library/subscription state may lag after purchase |
| WEB-05 | LOW | A | Purchase-history load swallows errors into an empty list | account/payment/+page.server.ts:51-60 | API failure looks like "no purchases" |
| WEB-06 | LOW | A | openBillingPortal lacks the .stripe.com hostname check that portalSessionForm has | account.remote.ts:391-394 vs :421-425 | Inconsistent redirect guard (URL is server-issued; low risk) |

## Config / infra / tests

| ID | Sev | Status | Bug | Evidence | Effect |
|---|---|---|---|---|---|
| CFG-01 | HIGH (dev) / ? (prod) | V+D | Dev Connect webhook endpoint created WITHOUT `connect: true` | .github/scripts/setup-stripe-dev-webhooks.sh:64-67 (no --connect); Stripe API ref: without connect=true the endpoint gets "only events from your account" | Connected accounts' account.updated never delivered in dev → Connect state only via manual /connect/sync. OWNER CHECK: is the PRODUCTION connect endpoint a "Connected accounts" endpoint in the Stripe Dashboard? If not, account.updated never arrives in prod either |
| CFG-08 | CRIT (go-live) — **REMEDIATED 2026-10-13** | V (Stripe MCP, prod) | PRODUCTION Stripe (= "Codex sandbox" acct_1SMY6J7wyGmo4sh6) event delivery was broken | v2 event destinations: booking, payment, subscription, customer endpoints DISABLED (reason "user", 2026-04-10/16); connect endpoint events_from ["@self"] (never got creators' account.updated); subscription endpoint lacked invoice.payment_succeeded / checkout.session.completed / paused / resumed / product.* / price.* | FIXED: every endpoint recreated with the right scope + event list (see CFG-08b); customer stub disabled (no handler; stale ids self-heal in resolve-customer.ts) |
| CFG-08b | CRIT (go-live) — **REMEDIATED 2026-10-13** | V (prod tail) | Production's stored webhook signing secrets (GitHub env `production`, set 2026-07-14) did NOT match the sandbox endpoints → every delivery 401 | wrangler tail 14:53Z: /subscription 401, /customer 401 "No signatures found matching the expected signature" | FIXED: new endpoints connect we_1UQ71a7wyGmo4sh6qjaGNKFW (connect=true), subscription we_1UQ75i7wyGmo4sh6e12nck3K, booking we_1UQ7HY7wyGmo4sh6BYwlrb80, payment we_1UQ7HZ7wyGmo4sh6x477bv6C, dispute we_1UQ7Ha7wyGmo4sh6CuTHPE8O; secrets set in GitHub `production` env AND live worker ecom-api-production; all old endpoints disabled "RETIRED". VERIFIED: subscription by a real Stripe delivery (200, 14:54:57Z); booking/payment/dispute by self-signed test events (200 + "Webhook signature verified", 15:09Z) with a wrong-secret control → 401. Connect not yet exercised by a real account.updated |
| CFG-10 | LOW | V (prod log) | ecom-api `vars.API_URL` not declared under env.production (wrangler warns "vars configuration is not inherited"); prod logs "Optional env var missing: API_URL" | workers/ecom-api/wrangler.jsonc | Add to env.production vars |
| CFG-09 | MED | V | Production and local dev share ONE Stripe sandbox | owner confirmed 2026-10-13 | Every endpoint receives both environments' events (prod processes local test events → unknown-object self-heal / FK errors acked 200; stripe listen sees prod events); customers.list-by-email can adopt the other env's Customer (PAY-22). Likely why prod endpoints were disabled |
| CFG-02 | LOW | V | Dev webhook router doesn't route product.* / price.* | dev-webhook-router.ts:50,57,63 (subscription/invoice, charge/payment_intent, account. only) | Dashboard tier sync-back never runs under `stripe listen` |
| CFG-03 | LOW | A | Dev endpoint script omits customer.subscription.paused/resumed (subscription) and account.application.deauthorized (connect) | setup-stripe-dev-webhooks.sh:35-40 vs subscription-webhook.ts:507,531; connect-webhook.ts:150 | Those handlers never fire in hosted dev |
| CFG-04 | LOW | V | Lockfile resolves stripe@19.3.1 (agent: npm-deprecated for a Files API timeout bug) | pnpm-lock.yaml:8905 | Bump candidate |
| CFG-05 | LOW | A | `new Stripe(key)` without apiVersion in seeds + e2e helper | seed/commerce.ts:779,894,997; e2e/helpers/subscription.ts:347 | Seeds drift from pinned 2025-10-29.clover on SDK bump |
| CFG-06 | MED | A | WEB_APP_URL declared optional for ecom-api but AgreementService throws without it | src/index.ts:89; agreement-service.ts:232-242; service-registry.ts:847-850 | /agreements 500 if unset |
| CFG-07 | LOW | A | Seeded subscription rows record org fee 0 / creator 90% (not FEES.SUBSCRIPTION_ORG_PERCENT); NO agreements seeded | seed/commerce.ts:869-871,944-947 | Local data doesn't exercise the real split/agreement paths |
| TEST-01 | HIGH | A | No e2e covers a completed checkout or ANY webhook round-trip: purchase completion, success pages, refunds/disputes, payouts/transfers, agreement→payout effect, admin grant; webhook helpers exist only as a comment; 4 specs test.skip on a possibly-stale blocker (Codex-z1wuz) | e2e inventory; helpers/subscription.ts:6-7; 03-subscribe-flow.spec.ts:67-69 aborts Stripe nav | Every money-moving defect above is invisible to CI by construction |

## Cross-cutting / access

| ID | Sev | Status | Bug | Evidence | Effect |
|---|---|---|---|---|---|
| X-01 | MED | A2 | Orgless sales missing from studio /sales | merged into PAY-14 | — |
| X-02 | HIGH | V | Admin complimentary grants write only content_access, which NOTHING in @codex/access reads | customer-management-service.ts:314-405 (insert contentAccess 'complimentary'); grep contentAccess in packages/access/src = 0 hits | Support "grant access" does nothing |
| X-03 | MED | A2 | refund_reviews has no reader (no ops surface) | both agents; surfaces agent verifying | Clawback debts accumulate invisibly |
| X-04 | MED | A2 | Ledger/financial rows destroyable via CASCADE FKs | merged: PAY-21 | — |

## Policy decisions surfaced (NOT bugs — owner to decide; docs must state the current behaviour)
- P-1 Partial refund semantics: today any refund revokes access in full (see PAY-03 for the money bug inside it).
- P-2 Dispute policy: platform absorbs chargebacks (losses.payments='application'); no creator clawback on dispute. Intended? (Codex-13v21 is the open P1 bead on clawback policy.)
- P-3 No dunning grace: past_due denies access immediately.
- P-4 A subscription refund doesn't cancel the subscription or revoke access.
- P-5 Downgrades are immediate (scheduled downgrade = tier-change epic Phase 2, unbuilt).
- P-6 Org tiers PROPAGATE price changes to existing subscribers; course plans GRANDFATHER. Intended asymmetry?
- P-7 Platform 10% must cover Stripe fees under SCT; min-platform-fee floor exists but is unwired (PAY-02/SUB-01).
- P-8 Tier reorder changes existing subscribers' access level (sortOrder = hierarchy).

## Investigation status
- All three agent reports received and persisted (report-purchases.md, report-subscriptions.md, report-surfaces.md).
- Hand-off verdicts: PAY-14 /sales gap CONFIRMED (A2); X-02 admin grants CONFIRMED (V + agent end-to-end); X-03 refund_reviews no reader CONFIRMED (A2); agreement splits DO apply on one-off path — DB fee config is the casualty (PAY-02).
- OWNER CHECKS — ALL ANSWERED 2026-10-13: (1) prod connect endpoint was platform-only (@self) → recreated with connect=true (CFG-08); (2) default Billing Portal config allows cancel (SUB-10); (3) event lists were stale → corrected on recreation (CFG-08); (4) YES — Express connected accounts can change their payout bank account in the Express Dashboard by default (Stripe docs: connect/express-dashboard "They can change their bank account"); accounts are created with controller.stripe_dashboard.type=express (connect-account-service.ts:225); in a sandbox the ONLY way in is a login link (createLoginLink, :587). Owner wants creators able to update payout details → SEC-01 fix must keep a self-scoped login link.

## Bead mapping (filed 2026-10-13, epic Codex-2hxff "Payments correctness")

`payments-fix-pr-1` = ship together in ONE PR (owner). Owner policy answers are recorded in each bead and in `README.md`.

| Bead | P | Root cause | Ledger IDs |
|---|---|---|---|
| Codex-2hxff.1 | P0 | Payout dashboard IDOR — owner-only Express dashboard **[fix-pr-1]** | SEC-01 |
| Codex-2hxff.2 | P1 | One owner per org, transfer-only; org money follows the current owner **[fix-pr-1]** | SEC-03, SUB-22, SUB-20 |
| Codex-2hxff.3 | P0 | Price changes move subscribers at next renewal with notice; Studio-only pricing **[fix-pr-1]** | SUB-03, P-6, SUB-16 |
| Codex-2hxff.4 | P1 | Locked-down Billing Portal configuration **[fix-pr-1]** | SUB-10 |
| Codex-2hxff.5 | P1 | Shared sandbox: tag objects by environment, skip foreign events **[fix-pr-1]** | CFG-09, PAY-22 |
| Codex-2hxff.6 | P0 | Transient webhook failures acked 200 | PAY-01, SUB-16, SUB-17 |
| Codex-2hxff.7 | P1 | Fee config + minimum platform fee ignored on sale paths | PAY-02, SUB-01, PAY-13, P-7, SUB-18, CFG-06 |
| Codex-2hxff.8 | P1 | Partial refunds + reversal failures | PAY-03, PAY-04, PAY-11, PAY-12, PAY-18, PAY-19, SUB-08, X-03, P-1 |
| Codex-2hxff.9 | P1 | Dispute lifecycle | PAY-05, PAY-06, PAY-17, P-2 |
| Codex-2hxff.10 | P2 | Failed-renewal grace + full refund cancels | P-3, P-4 |
| Codex-2hxff.11 | P1 | Payout ledger double-pay / stranded rows | SUB-02, SUB-06, PAY-07, PAY-08 |
| Codex-2hxff.12 | P1 | Splits that write no ledger row | SUB-04, PAY-15, SUB-14 |
| Codex-2hxff.13 | P2 | Pending-payout drains | SUB-05, SUB-21, SUB-15, SUB-18 |
| Codex-2hxff.14 | P1 | Checkout gating + double purchase | PAY-09, PAY-10, PAY-20 |
| Codex-2hxff.15 | P1 | Subscription state drift | SUB-07, SUB-09, SUB-11, SUB-12, SUB-13, SUB-19, SUB-20 |
| Codex-2hxff.16 | P2 | Downgrades at period end + tier-reorder warning | P-5, P-8 |
| Codex-2hxff.17 | P1 | Agreement term = minimum lock, keeps paying | AGR-01, AGR-03 |
| Codex-2hxff.18 | P1 | Member removal ends agreements | AGR-09 |
| Codex-2hxff.19 | P2 | One agreement resolver for every path | AGR-04, AGR-05, AGR-06, AGR-07, AGR-08, AGR-12, AGR-13 |
| Codex-2hxff.20 | P2 | Wrong revenue numbers + dead email links | AGR-02, AGR-10, AGR-11, AGR-14, WEB-02 |
| Codex-2hxff.21 | P1 | Access gaps (grants, orgless, course history) | X-02, PAY-14 (= X-01), PAY-24 |
| Codex-2hxff.22 | P2 | Success pages confirm too early | WEB-01, WEB-03, WEB-04, WEB-05, WEB-06 |
| Codex-2hxff.23 | P2 | Financial record integrity | PAY-16, PAY-21 (= X-04), PAY-22, PAY-23, PAY-25, SEC-02 |
| Codex-2hxff.24 | P3 | Dev/CI Stripe config drift + customer stub removal | CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, CFG-07, CFG-10 |
| Codex-2hxff.25 | P2 | End-to-end webhook round-trip coverage | TEST-01 |
| Codex-2hxff.26 | P1 | Canonical payment docs (desired behaviour) + deletions | — |
| Codex-2hxff.27 | P0 | **CLOSED** — production webhooks 401, repaired 2026-10-13 | CFG-08, CFG-08b |

