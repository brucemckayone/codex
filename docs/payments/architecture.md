# Payments architecture: domains, seams and the order of work

**Status: architecture AGREED by the owner, 2026-10-19.** D1–D4 (§7) were
decided as recommended. The product decisions D-P1–D-P7 are still open; each
blocks only its own WP. It describes how the payments
code should be organised so the remaining work in `Codex-2hxff` lands once, in
one place, instead of once per payment path.

Evidence, snapshotted at `origin/dev` f070a62b:
- [architecture-evidence/code-inventory.md](architecture-evidence/code-inventory.md):
  every payments file, its responsibilities, copies, Stripe call sites and
  dependencies.
- [architecture-evidence/open-work.md](architecture-evidence/open-work.md):
  every open bead in the epic, read in full, mapped to a domain.

Claims below cite them as **[inv §n]** and **[work §n]**.

**Why this exists.** The owner, 2026-10-19:

> "how is our architecture lacking? Is generally the code organization good
> enough, but lacking enough different service layers and coordination between
> those things to meet our needs so that we can, in the remaining tasks and in
> the tasks that we've just implemented associated with the financial layer,
> ensure that our architecture and organisation, code separation, you know,
> single concern that sort of thing is all in place that we were able to
> implement this in a maintainable way"

In the same conversation Claude proposed extracting the ledger and refund seams
**before** the dispute and partial-refund work, "so they're built once", and
drafting this design first. The owner: "Yes, I think that would be a good
idea", and later, "this is the direction that we're going to have to move in
first".

---

## 1. The short answer

The package split is sound:
- money logic sits in `@codex/purchase`, `@codex/subscription` and
  `@codex/agreements`;
- access sits in `@codex/access`;
- routes go through `procedure()` and the service registry.

What is missing is **domain seams inside the money packages**, and **one place
that builds services outside `procedure()`**. Business rules are owned by
*payment paths* (purchase, course purchase, org subscription, course
subscription) instead of by *domains* (split, ledger, clawback). So:

- **Every rule exists once per path.** "Fees, then agreement, then split, then
  ledger slices" is written four times [inv §3.3]. The refund clawback is two
  copies with 71% identical lines [inv §3.1]. The "active agreement at T" query
  is pasted three times [inv §3.5].
- **Every fix lands once per path, and the copies drift.** Codex-2hxff.2 took
  8 files, Codex-2hxff.11 took 4 commits, and the subscription refund was
  cloned from the purchase one in July and has diverged since [inv §7.3].
- **Drift produces bugs we then have to find.** Two recent examples:
  - **Codex-2hxff.51.** PR #592 gave the purchase refund per-row isolation and
    missed the subscription copy.
  - **Codex-2hxff.50, P1.** The course-subscription invoice path never got the
    PaymentIntent fallback the org-subscription path has, so course
    subscriptions most likely record no payouts at all.
- **Hand-built services silently lose dependencies.** Webhooks and crons build
  services by hand in 8 places; only one gets fee configuration. That is why
  configured fees never reach a real one-off sale (Codex-2hxff.7) and why the
  payout emails never send [inv §4.2].

None of this needs a rewrite. It needs the rules pulled out of the paths into
domain modules that every path calls, done one seam at a time, with behaviour
held constant during each extraction.

---

## 2. Domains

A domain owns a set of business rules. Each rule has exactly one
implementation, and every payment path calls it.

| # | Domain | Subdomains | Rules it owns | Today [inv] |
|---|---|---|---|---|
| D1 | **Sale capture** | checkout sessions; purchasability; sale completion; Stripe Customer | what can be sold and to whom; one completed purchase per buyer per item; the sale row and its split snapshot | `PurchaseService` checkout + `completePurchase`/`completeCoursePurchase` (82% identical, §3.2); course and org subscription checkout (§3.12) |
| D2 | **Subscription lifecycle** | state machine following Stripe; tier change; price change; pause/cancel/resume; self-heal | our row mirrors Stripe; tombstones; changes "at next renewal" | `SubscriptionService` (600 LOC of webhook lifecycle), `CourseSubscriptionService`, `pending-price-change.ts` (a good seam) |
| D3 | **Revenue split & fees** | fee resolution at T; split arithmetic; minimum platform fee; rounding; multi-creator fan-out | the split of a sale, every input resolved at one instant | two `calculateRevenueSplit` copies (§3.4); four assemblers (§3.3); `FeeConfigService` with no time dimension (§5.4) |
| D4 | **Agreements** | proposal lifecycle; **resolver at T** | which agreement and share applies to a sale | `@codex/agreements` owns the lifecycle, but no payout path imports it; the resolver is copied (§3.5) |
| D5 | **Payee & payability** | organisation payee at T; creator payee; Connect readiness | who is paid, and whether they can be paid now | `resolveOrganisationPayee` (a good seam); creator lookup inline ×6 (§3.8); "payable" defined 6 ways (§3.9) |
| D6 | **Payout ledger & transfers** | slices; reserve → transfer → settle; drains, leases, retries; held money | money moves only through a ledger row; never twice; never unrecorded | `payout-ledger.ts` (the first seam, PR #592), plus a second transfer implementation in the drain (§3.11) and `no_owner` re-homing in two packages (§3.10) |
| D7 | **Clawback** | refunds; disputes; reversals; debt ledger; platform-initiated refunds | how a refund or dispute takes money back, for every source | two reversal copies (§3.1); disputes share none of it; orchestration in the worker (§7.2); no `refunds.create` anywhere (§4.3) |
| D8 | **Webhook ingestion** | signature; environment filter; retry classification; event dedupe; dispatch | 500 on transient, 200 on permanent; one event, one effect | `webhook-handler.ts` + `error-classification.ts` (good); dispatch and orchestration in 500-line handlers (§7.1) |
| D9 | **Connect** | onboarding; status; payout release trigger | when a payee becomes payable, their money is released | `ConnectAccountService`; the release trigger lives in the worker, keyed on org metadata (§4.5) |
| D10 | **Access & entitlements** | what a sale or subscription buys; revocation | one source of access | `@codex/access`; the "status grants access" predicate copied in 4 places [work §2 C7] |
| D11 | **Reporting** | revenue, payouts, sales and earnings read models | numbers come from the ledger | three independent read models of the same ledger (§7.2) |
| D12 | **Money notifications** | receipts, payout and debt emails, notices | a notice the rules require is sent once, or the move waits | three email patterns; mailers absent in webhooks (§5.7) |
| — | **Cross-cutting rules** | currency; record permanence; idempotency keys; environment tagging; observability | GBP everywhere; money rows never cascade; deterministic keys | GBP checked 5 different ways (§3.14); keys are literals across files (§5.2) |

---

## 3. What is wrong with the structure

1. **One god service.** `SubscriptionService` is 5,097 lines with 11
   responsibility clusters. Two of them are not about subscriptions at all: it
   drains pending payouts for **every** source (purchases included, about 600
   LOC), and it holds 690 LOC of read models [inv §2].
2. **The sale pipeline is per path, not per domain.** Four copies of
   fees → agreement → split → slices, two split algorithms, three fallback fee
   rates (10%, 10%, 15%), and fees resolved "now" while agreements and payee
   are resolved at the sale's time [inv §3.3, §5.4].
3. **Clawback is per path.** Two refund implementations with different partial
   denominators and different error handling. Disputes have no reversal at all.
   `refund_reviews.purchase_id NOT NULL` means a subscription debt cannot even
   be recorded [inv §3.1, §7.5].
4. **No composition root outside `procedure()`.** The service registry builds
   the full graph for routes. Webhooks and crons build their own, by hand, in 8
   places, each missing something. Money dependencies are optional
   (`feeConfig?:`), with silent constant fallbacks [inv §4.2].
5. **Orchestration lives in the worker.** A refund is "subscription service,
   then purchase service, then KV revoke, then email", written inside
   `handleChargeRefunded`. The Connect release drain is started from the
   worker. Nothing above the services coordinates them, so there is no single
   function a test can drive for "a charge was refunded" [inv §7.2].
6. **One rule, many definitions.**
   - "payable": 6 definitions;
   - the GBP guard: 5 behaviours;
   - "subscription status grants access": 4 copies;
   - invoice → charge: 3 resolvers.

   Each divergence is a bug waiting to be found: .50 is one of the
   invoice → charge copies [inv §3.6, §3.9, §3.14].
7. **Packages reach into each other's tables.**
   - `@codex/organization` writes `payouts`;
   - `@codex/admin` aggregates revenue from raw tables;
   - `@codex/access` builds a whole `PurchaseService` to read one row
     [inv §4.1].

---

## 4. Target shape

### 4.1 Layers

```
 workers/ecom-api: webhooks, cron, procedure() routes
   │  verify, filter environment, classify errors, dedupe the event,
   │  build services (ONE factory, §4.3), call ONE use case. No business rules.
   ▼
 Use cases: one per business event
   RecordSale · RecordInvoice · HandleRefund · HandleDispute · IssueRefund
   ReleasePayouts · ChangeSubscription · AssignOwner …
   │  call the domain modules in order; own the transaction boundary and the
   │  "after commit" steps (ledger, emails, cache)
   ▼
 Domain modules: rules, each with one implementation
   splitCalculator · feeResolver(at) · agreementResolver(at) · payeeResolver(at)
   payoutLedger · clawback · subscriptionLifecycle · accessPolicy · purchasability
   │
   ▼
 Infrastructure: Drizzle (dbHttp / dbWs), Stripe client, KV cache, mailer
```

The use cases are the "coordination layer" the owner asked about. Today that
role is played, inconsistently, by the worker handlers and by whichever service
happened to grow the method.

### 4.2 Rules the structure enforces

| # | Rule | Enforced by |
|---|---|---|
| A1 | Money moves only through the payout ledger. No `transfers.create` or `transfers.createReversal` outside `payoutLedger`/`clawback`. | a source-scanning test (comments stripped) that fails on a call elsewhere |
| A2 | Every sale is split by one calculator, with fees, agreements and payee all resolved at one instant `at` (payment time, or `invoice.created`). | `computeSplit({ grossCents, at, … })` is the only producer of slices |
| A3 | One clawback engine for every source type. A refund and a dispute differ only in their cause and amount. | `clawback.reverseCharge(...)` is the only reversal caller |
| A4 | Services are built in one place for routes AND for webhooks and crons. Money dependencies are required, never optional with a fallback. | `createServices(env, ctx)` shared by the registry and the webhook factory; `feeConfig` non-optional in the types |
| A5 | A webhook handler verifies, filters, classifies and dispatches. No business logic. | handlers under ~50 lines; the use case is unit-testable without Hono |
| A6 | One definition per rule: payable, GBP guard, granting statuses, purchasable, invoice → charge, pound formatting. | each exported once; the copies deleted |
| A7 | Every Stripe write has a deterministic idempotency key, listed in one table in code next to the call. | the key table in [connect-and-payouts.md](connect-and-payouts.md#transfers) generated from, or checked against, that code |
| A8 | A package writes only its own tables. Other domains go through the owning module. | `@codex/organization` calls `payoutLedger.assignHeldTo(...)` instead of writing `payouts` |

### 4.3 The modules

| Module | Owns | Replaces | Clusters [work §2] |
|---|---|---|---|
| `createServices` / webhook factory | one service graph for routes, webhooks and crons | 8 hand-built graphs (§4.2) | C1 |
| `invoiceCharge` | invoice → charge id, the one way | 3 resolvers (§3.6) | (.50) |
| `payoutLedger` (exists) | slices, transfers (sale-time AND drain), settle, leases, retries, held money, payability for transfers | the drain's transfer copy, the two `no_owner` re-homers, the inline creator lookup | C6 |
| `clawback` | reverse a charge's slices for any source; partial increments; debt ledger (`refund_reviews` for every source); recovery | both refund copies; dispute reversal (new) | C4 |
| `issueRefund` | platform-initiated refunds (one function; its webhook runs `clawback`) | nothing today (none exists) | C5 |
| `splitCalculator` | pure arithmetic: platform fee, floor, org, creators, rounding to the org | both `calculateRevenueSplit` copies and the fan-out in `executeTransfers` | C2 |
| `feeResolver(at)` | the fee in force at `at` (time-versioned once Codex-2hxff.33 lands) | three fallbacks, "now" lookups | C2 |
| `agreementResolver(at)` | the agreements in force at `at`: deterministic, deduped, live membership | 3 pasted queries | C3 |
| `payeeResolver(at)` | organisation payee (exists) + creator payee + "payable" | 6 inline lookups and definitions | — |
| `subscriptionLifecycle` | one event reducer for org tiers and course plans: Stripe status mirroring, tombstones, "at next renewal" changes | per-kind branches spread over a 500-line handler (.52) | C7 |
| `accessPolicy` | which statuses and entitlements grant access | 4 copies of the status predicate | C7, C9 |
| `purchasability` | `canBeSold(item)`: checkout, publish and access agree | 4 partial gates | C8 |
| `revenueReadModel` | reporting over the ledger | 3 aggregate implementations | C10 |
| `moneyNotices` | money emails with delivery rules and event dedupe | 3 patterns | C11 |

**Use cases** (§4.1) sit above these. They are thin: order the module calls,
own the transaction, and run the after-commit steps.

### 4.4 Where it lives

`@codex/subscription` depends on `@codex/purchase`, so anything both use must sit
in `@codex/purchase` or below it. That is why the ledger is in
`@codex/purchase/src/utils` today.

**Decided 2026-10-19 (§7 D1, D2):**
- Create **`@codex/payments`** below both packages and move the domain modules
  there as each is extracted. Start with `payoutLedger`, `clawback`,
  `splitCalculator`, `feeResolver`, `payeeResolver` and `invoiceCharge`.
- `@codex/purchase` and `@codex/subscription` keep sale capture and the
  subscription lifecycle, and become callers.
- `agreementResolver` goes in `@codex/agreements`, its natural owner, and
  `@codex/payments` depends on it (§7 D2).
- Moving the ledger is one PR of import changes. It is cheaper now than after
  four more modules have been added beside it.

The rejected alternative was to keep everything in
`@codex/purchase/src/domain/`. That avoids a package for now, but leaves
"purchase" as the home of subscription-wide rules.

---

## 5. Order of work

**Two kinds of PR, never mixed:**
- An **extraction** PR moves code behind a seam and changes no behaviour. It
  starts with characterisation tests that pin today's behaviour on every path
  it touches; they must pass before and after.
- A **behaviour** PR implements one bead on a seam that already exists. Every
  test is falsified against the production change, as in PR #592.
- One PR in CI at a time (owner rule).

| WP | Kind | What | Unblocks / absorbs |
|---|---|---|---|
| **WP0** | decision | **Done 2026-10-19.** The owner decided §7 D1–D4, all as recommended. | everything |
| **WP1** | fix | **Codex-2hxff.50**: one `invoiceCharge` resolver used by both subscription kinds; a fixture with only `payment_intent`. Check the sandbox first; plan a replay for missed charges. | P1 money bug; small |
| **WP2** | extraction | **Composition root** (C1): one factory for webhooks and crons, sharing the registry's graph; money deps required. | .7 (wiring half), .13 (mailers), .43, CFG-06 |
| **WP3** | extraction → behaviour | **Clawback engine** (C4): one `reverseCharge` over the ledger for every source, replacing both copies; `refund_reviews` for every source (Codex-in0g4's schema); the refund use case out of the worker. Absorbs .51. | .8 → .10 (refund half) → .9 → .30; .28 after WP6 |
| **WP4** | extraction → behaviour | **Split and resolvers at one `at`** (C2 + C3): `splitCalculator`, `feeResolver(at)`, `agreementResolver(at)` in `@codex/agreements`; one `RecordSale`/`RecordInvoice` path for all four sale kinds. | .7 (floor everywhere), .19, .17, .18, .49, .33, Codex-rtwpv, -itvh8 |
| **WP5** | extraction | **Every transfer through the ledger** (C6): the drain's send moves into `payoutLedger`, plus `no_owner` re-homing and one payability rule; the A1 scanning test. | .13, .48, .47, .34, Codex-k9qpd, -2f3wk, -4r55k/xjxw6 |
| **WP6** | behaviour | **`issueRefund`** (C5), the only platform refund; its webhook runs WP3. | .9 (early-fraud refund), .14 (duplicate purchase), .15 (duplicate subscription), .28 |
| **WP7** | extraction → behaviour | **Subscription lifecycle + access policy** (C7, C9): one reducer for both kinds; one status predicate. | .15, .10, .16, .52, Codex-sing6, -8ntg0, -3wzpl, .21 |
| **WP8** | behaviour | **Purchasability** (C8): one `canBeSold`. | .14, .32, Codex-1g5lh.23, legal L1 if needed |
| **WP9** | extraction → behaviour | **Revenue read model over the ledger** (C10). | .20, .21 (reporting half), Codex-dox8r, -cvx4s, -y76g2, -nm5mb |
| **WP10** | behaviour | **Money notices** (C11) + event dedupe (Codex-257ia). | .34, .40, .43, .8 (PAY-19), .46(k) |

**Independent of the seams, any time:**
- **.25, the signed-webhook test harness: do it early.** It turns every
  behaviour PR's verification into CI, and Codex-chh3e and -vas3y build on it.
- .29 (hold bank payouts for the 14-day window): Stripe settings and a
  backfill. It reduces the debts .30 has to recover.
- The ownership follow-ups (.36, .38, .42, .44, .46): one PR on
  `ownership-transfer.ts` and `organization-service.ts`.
- Config (.24, .41) and record integrity (.23, after decision D-P4).

**Why this order.**
- WP1 is a P1 money bug and small.
- WP2 is small, and every later use case needs it.
- WP3 comes before the refund and dispute behaviour work. That is the
  direction agreed on 2026-10-19, and four P1/P2 beads land on it.
- WP4 is the largest. It touches all four sale paths, so it goes after WP2
  makes the fee configuration reachable.
- WP5 can run after WP3; they share `payoutLedger` but touch different
  functions.

---

## 6. Where each open bead lands

From [work §1], plus .50–.52. A bead that names two WPs needs both.

| Bead | Plain title | WP |
|---|---|---|
| Codex-2hxff.7 | Fee config and the minimum fee apply to every real sale | WP2 + WP4 |
| Codex-2hxff.8 | Partial refunds keep access; each increment clawed back; failed reversals retried | WP3 |
| Codex-2hxff.9 | Disputes pause access, reverse slices, restore on a win | WP3 (+ WP6 for the fraud refund) |
| Codex-2hxff.10 | Access continues during failed renewals; a full refund cancels | WP7 (+ WP3) |
| Codex-2hxff.13 | Pending money released as soon as the payee is payable | WP2 + WP5 |
| Codex-2hxff.14 | Checkout only for what a purchase unlocks; no double purchases | WP8 (+ WP6) |
| Codex-2hxff.15 | Our subscription row follows Stripe; duplicates cancelled and refunded | WP7 (+ WP6) |
| Codex-2hxff.16 | Downgrades at period end; tier reorders warn | WP7 (decision D-P1) |
| Codex-2hxff.17 | An agreement keeps paying after its review date | WP4 |
| Codex-2hxff.18 | Removing a creator ends their agreements | WP4 |
| Codex-2hxff.19 | One agreement resolver for every path | WP4 |
| Codex-2hxff.20 | Revenue screens and agreement emails show real numbers | WP9 |
| Codex-2hxff.21 | Support grants give access; orgless entitlements; course purchases in history | WP7 (access) + WP9 |
| Codex-2hxff.22 | Success pages wait for our record | independent (web; mockup first) |
| Codex-2hxff.23 | Financial records permanent; one Customer per user; GBP everywhere | cross-cutting (decision D-P4) |
| Codex-2hxff.24 | Dev and CI Stripe setup mirrors production | independent (config) |
| Codex-2hxff.25 | CI exercises real signed webhook round trips | independent, **early** |
| Codex-2hxff.28 | Support refunds from an admin screen | WP6 + WP3 (mockup first) |
| Codex-2hxff.29 | Bank payouts held for 14 days | independent |
| Codex-2hxff.30 | Clawback shortfalls recovered from future earnings | WP3 + WP5 |
| Codex-2hxff.32 | Every one-off price at least £1 | WP8 |
| Codex-2hxff.33 | A fee increase applies 30 days after an email | WP4 + WP10 |
| Codex-2hxff.34 | Monthly reminder about waiting money | WP10 (after .13) |
| Codex-2hxff.36 | Drop the retired Connect pin column | independent (ownership) |
| Codex-2hxff.38 | Demote/remove racing an ownership accept | independent (ownership) |
| Codex-2hxff.39 | Ownership-period fallback pays the first owner | **closed 2026-10-19**: superseded by #592 (§8) |
| Codex-2hxff.40 | Course price-change email quotes the old list price | WP10 |
| Codex-2hxff.41 | Secrets script can blank the portal configuration id | independent (config) |
| Codex-2hxff.42 | A failed offer-banner read denies a real owner | independent (ownership) |
| Codex-2hxff.43 | A missing mailer skips the price notice, but the price moves | WP2 + WP10 (decision D-P3) |
| Codex-2hxff.44 | Membership-cache delete swallows failures | independent (ownership) |
| Codex-2hxff.45 | A rejected payout-status query shows "Not connected" | independent (web) |
| Codex-2hxff.46 | PR #589 review follow-ups (13) | ownership; (i) → .23, (k) → WP10 |
| Codex-2hxff.47 | A transfer to a replaced Connect account isn't found | WP5 |
| Codex-2hxff.48 | Failed payout rows retry forever | WP5 (decision D-P2) |
| Codex-2hxff.49 | A replay re-splits with current fees | WP4 |
| Codex-2hxff.50 | Course-subscription invoices record no payouts | **WP1** |
| Codex-2hxff.51 | A subscription refund stops at the first failing row | WP3 |
| Codex-2hxff.52 | Course subscriptions half-wired into the subscription webhook | WP7 |

Related beads outside the epic: Codex-in0g4 (WP3), -rtwpv and -itvh8 (WP4),
-k9qpd, -2f3wk, -4r55k and -xjxw6 (WP5), -sing6, -8ntg0 and -3wzpl (WP7),
-dox8r, -cvx4s, -y76g2 and -nm5mb (WP9), -257ia (WP10), -chh3e and -vas3y
(with .25), -v1io7, -904q0, -gvx03 and -nr7ie (with .23).

---

## 7. Decisions needed

**Architecture (WP0): decided by the owner, 2026-10-19, all as recommended.**

| # | Question | Decision |
|---|---|---|
| D1 | A new `@codex/payments` package for the domain modules, or `@codex/purchase/src/domain/`? | **New `@codex/payments` package** (§4.4). |
| D2 | Where does the payout-time agreement resolver live? | **`@codex/agreements`**, with the payments package depending on it. |
| D3 | Should the split columns on `subscriptions` (overwritten every invoice and by `changeTier`) become reporting-only, with the ledger as the per-charge record? | **Yes.** Stop reading them for money; the ledger already has one row per slice per charge. |
| D4 | Do use cases live in the packages or in the worker? | **In the packages** (`@codex/payments` or the owning package), so they are testable without Hono and callable from any worker. |

Also decided 2026-10-19: the stop-gap guard for Codex-2hxff.51 does **not**
ship separately; WP3's clawback engine retires that code.

**Product, already open [work §3]:**

| # | Bead | Question |
|---|---|---|
| D-P1 | .16, Codex-sing6 | Downgrades through the deferred swap that price changes use, or subscription schedules? |
| D-P2 | .48 | The terminal state for a permanently failed payout, and who reviews it. |
| D-P3 | .43 | May a price move go ahead when its 30-day notice was not sent? |
| D-P4 | .23, Codex-v1io7 | Financial records: block deletes, or anonymise the user? |
| D-P5 | Codex-nm5mb | How portal revenue is attributed. |
| D-P6 | .28, .16, .22, .30 | New UI: HTML mockup + data design reviewed before code. |
| D-P7 | legal L1 | Consent to immediate access at checkout (urgent; may add to WP8). |

---

## 8. Housekeeping found by the survey

- **Closed 2026-10-19**, each re-verified on `origin/dev` f070a62b first (the
  evidence is in each bead's close reason):
  - **.39:** #592 replaced the fallback it describes with the next-owner rule.
  - **Codex-1ilxl:** PR #549 is on dev and main.
  - **Codex-ev3k:** all five of its tasks are closed.
  - **Codex-xymq6:** `pending_payouts` is retired; per-charge dedupe lives on
    `payouts` (migration 0099's unique indexes).
  - **Codex-r8932:** the course-subscription writer goes through
    `recordSlice`/`recordPlatformFee`, `onConflictDoNothing` on those indexes.
  - **Codex-p6sy6:** `procedure()` enforces the default `api` limit, and
    ecom-api has the `RATE_LIMIT_API` binding in every environment.
- **Found while verifying:** Codex-75qf3 (P4). A stale comment in
  `workers/ecom-api/wrangler.jsonc` contradicts the bindings declared below it.
- **Stale descriptions (not yet actioned):**
  - **.32's title:** tiers and course plans already enforce £1.
  - **.16 and Codex-sing6:** still assume subscription schedules.
  - **Codex-2f3wk:** names functions #592 removed.
- **Long-stale `in_progress`:** Codex-vas3y (since 2026-04-29), Codex-xz61z
  (since 2026-05-17).

---

## 9. How to use this document

- **Before starting a WP:** read its row in §5, the clusters it absorbs in
  [work §2], and the code sections it touches in [inv]. Re-find every line
  with `grep -n`; the evidence is a snapshot.
- **When a WP is done:** update §5 and §6, and the behaviour spec
  (`docs/payments/*.md`) for any behaviour PR.
- **A new payments bead** names its WP. If it fits none, that is a design
  question for this document first.
