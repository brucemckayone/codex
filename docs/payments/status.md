# Status

Where the code does not yet meet this specification, the decisions the
specification rests on, and what is still undecided.

Last reviewed: 2026-10-13.

---

## Gaps

Every rule marked **gap** in these docs is tracked by a child of the epic
`Codex-2hxff` ("Payments correctness"). The evidence for each — file and line
references to today's code — is in
[docs/audits/payments-2026-10-13/bug-ledger.md](../audits/payments-2026-10-13/bug-ledger.md)
under the ledger ids listed on each bead.

The first five carry the label `payments-fix-pr-1` and ship together in one pull
request: the owner asked for the payout-dashboard, ownership and price-change
fixes together ("put all of these fixes in together as one PR"), then agreed to
add the portal lockdown (`.4`) and environment tagging (`.5`) ("Include both").

| Bead | P | What is not true yet | Spec |
|---|---|---|---|
| `Codex-2hxff.1` | P0 | Only the account owner can open a payout dashboard; organisation Connect routes retired | [connect-and-payouts](connect-and-payouts.md#the-payout-dashboard-and-bank-details) |
| `Codex-2hxff.2` | P1 | One owner per organisation, transfer-only; organisation money follows the current owner | [connect-and-payouts](connect-and-payouts.md#organisation-ownership) |
| `Codex-2hxff.3` | P0 | Price changes reach existing subscribers only at their next renewal, after 30 days' notice; Studio-only prices | [subscriptions](subscriptions.md#price-changes) |
| `Codex-2hxff.4` | P1 | The billing portal is locked down by an explicit configuration | [subscriptions](subscriptions.md#billing-portal) |
| `Codex-2hxff.5` | P1 | Each environment tags its Stripe objects and ignores the other's events | [operations](operations.md#environments-and-stripe-accounts) |
| `Codex-2hxff.6` | P0 | Transient webhook failures return 500 so Stripe retries | [operations](operations.md#webhook-error-policy) |
| `Codex-2hxff.7` | P1 | Every sale path uses fee configuration, including the minimum platform fee | [fees-and-splits](fees-and-splits.md#fee-configuration) |
| `Codex-2hxff.8` | P1 | Partial refunds keep access and claw back each increment; failed reversals are retried | [purchases](purchases.md#refunds) |
| `Codex-2hxff.9` | P1 | Disputes pause access, reverse slices, hold pending money, and restore on a win | [purchases](purchases.md#disputes) |
| `Codex-2hxff.10` | P2 | Access continues while a failed renewal is retried; a full refund cancels the subscription | [subscriptions](subscriptions.md#failed-payments) |
| `Codex-2hxff.11` | P1 | One ledger row per slice; no double transfers; failed rows retried | [connect-and-payouts](connect-and-payouts.md#the-payouts-ledger) |
| `Codex-2hxff.12` | P1 | Every slice gets a ledger row, even when its payee cannot be paid yet | [connect-and-payouts](connect-and-payouts.md#the-payouts-ledger) |
| `Codex-2hxff.13` | P2 | Pending money is released as soon as the payee becomes payable | [connect-and-payouts](connect-and-payouts.md#releasing-pending-money) |
| `Codex-2hxff.14` | P1 | Checkout only for content a purchase can unlock; no double purchases | [purchases](purchases.md#checkout) |
| `Codex-2hxff.15` | P1 | Our subscription row always follows Stripe; duplicates are cancelled and refunded | [subscriptions](subscriptions.md#lifecycle-and-access) |
| `Codex-2hxff.16` | P2 | Downgrades at period end; tier reorders warn first | [subscriptions](subscriptions.md#changing-tier) |
| `Codex-2hxff.17` | P1 | An agreement keeps paying after its review date | [agreements](agreements.md#term-and-review-date) |
| `Codex-2hxff.18` | P1 | Removing a creator ends their agreements | [agreements](agreements.md#leaving-an-organisation) |
| `Codex-2hxff.19` | P2 | One agreement resolver for every payment path | [agreements](agreements.md#how-a-share-applies) |
| `Codex-2hxff.20` | P2 | Revenue screens and agreement emails show the real numbers and working links | [fees-and-splits](fees-and-splits.md#reporting) |
| `Codex-2hxff.21` | P1 | Support grants give access; orgless sales get entitlements; course purchases appear in history | [access](access.md#support-grants) |
| `Codex-2hxff.22` | P2 | Success pages wait for our record | [purchases](purchases.md#after-payment) |
| `Codex-2hxff.23` | P2 | Financial records are permanent; one Customer per user; GBP asserted everywhere | [README](README.md#rules-that-always-hold) |
| `Codex-2hxff.24` | P3 | Dev and CI Stripe setup mirrors production; customer stub removed | [operations](operations.md#local-development) |
| `Codex-2hxff.25` | P2 | CI exercises real webhook round trips | [operations](operations.md#testing) |
| `Codex-2hxff.26` | P1 | This documentation (in progress) | — |
| `Codex-2hxff.28` | P2 | Support issues refunds from an admin screen, not the Stripe Dashboard | [purchases](purchases.md#refunds) |

`Codex-2hxff.27` (closed) records the 2026-10-13 repair of production's webhooks.

Related open beads outside the epic: `Codex-aqk92` (refund policy questions),
`Codex-in0g4` (refund reviews for subscriptions), `Codex-rtwpv` (fee writes not
atomic), `Codex-sing6` (tier-change epic), `Codex-1ilxl` (account-wide seed
cleanup), `Codex-xyb7v` (fee admin app), `Codex-gvx03` (raw Stripe error shown in
the portal form), `Codex-chh3e` and `Codex-vas3y` (skipped payout and
subscription E2E tests), `Codex-equ4i` (access gating never exercised),
`Codex-2f3wk` (payout drain residuals), `Codex-ev3k` (webhook hygiene epic).

---

## Decisions

Owner decisions this specification rests on, in the owner's words or the exact
option chosen. All dated 2026-10-13 unless noted.

| Topic | Decision |
|---|---|
| Documentation | "Approve deleting the old payment docs. We should fix the defects before we describe the current behavior. We should describe the behavior we desire. It should be filed as beats [beads]." |
| Payout dashboard (Q1–Q2) | "Yes, the payout dashboard should only be available to the owner." Organisation-level Connect routes retired. |
| Bank details | "We likely would want the creators to be able to update their payout details, yes." |
| Price changes (Q4–Q7) | "For 4B, the correct answer is: they move at the next renewal." Email at the change, applied at the first renewal at least 30 days later; increases and decreases alike; "Studio is the only place." |
| Course plan price changes (P-6) | "Same rule as tiers" |
| Ownership | "I think there should only be one owner, and the only person who can be the owner is the person who makes the organization. The only person who can transfer ownership should therefore be the owner. The proposed ownership model seems perfect to me." Money is held as pending until a new owner sets up payouts; money earned before a transfer stays with the old owner; "No migration concerns here." |
| One pull request | "Yeah, I think we should put all of these fixes in together as one PR, to be honest." Adding the portal lockdown and environment tagging: "Include both" |
| Production on the sandbox | "Right now, production is using the dev sandbox endpoints just so that nobody accidentally buys anything, as we are still testing, and production is not live yet, despite the website being there." "Right now, both production and this local should be receiving the same information from endpoints." |
| Partial refunds (P-1) | "Keep access" |
| Disputes (P-2) | "Creators share it" |
| Failed renewals (P-3) | "After retries fail" |
| Subscription refunds (P-4) | "Cancel + end access" |
| Downgrades (P-5) | "At period end" |
| Small sales (P-7) | "Minimum platform fee" |
| Tier reordering (P-8) | "Warn, then allow" |
| Agreement term (AGR-01) | "Keeps paying"; then, asked whether either side can end an agreement early: "Yes, any time" |
| Leaving an organisation (AGR-09) | "End on removal" |
| One-off sale with no agreement | "Org default fee" — supersedes the 2026-05-17 note that the organisation keeps everything |
| Rounding remainders | "The organisation" |
| Early fraud warnings | "Refund automatically" |
| Payout schedule | "Bank account only" — creators change their bank account, not their schedule |
| Who issues refunds | "Platform support" |
| Docs housekeeping | Payment sections of `CLAUDE.md` files: "Trim to rules + link". Old files: "Delete GEMINI.md only" (`docs/archive` is kept) |
| Refund clawback (earlier, `Codex-13v21`) | Reverse transfers on refund; record a `refund_reviews` debt when the payee's balance is too low |
| Agreements (2026-05-17) | One-off sales use only the uploading creator's agreement; the creator's share is fixed at acceptance while the platform fee is read at each sale; no pro-rating — whoever is active at the invoice gets its full share |
| Cancellation (2026-04-21) | Cancelling keeps access until the end of the paid period |
| Free offers | "We don't do free journeys." — a £0 price is refused |

The customer webhook endpoint was disabled on 2026-10-13 after the owner asked
whether it had a purpose: it has no handler, and stale customers already
recover at checkout.

---

## Open questions

Decisions still needed from the owner:

1. **Refund operations** (`Codex-aqk92`): the refund window, how to keep enough
   platform balance to fund refunds, what happens when a creator's balance stays
   negative, the customer-facing refund policy (UK consumer law for digital
   content), and what the creator terms say about clawbacks. (Who issues refunds
   is decided: platform support.)
2. **Ownership transfer screen**: waiting on an HTML mockup and data design.
