# Status

Where the code does not yet meet this specification, the decisions the
specification rests on, and what is still undecided.

Last reviewed: 2026-10-20.

How the remaining work should be organised in the code, and in what order, is
in [architecture.md](architecture.md) (agreed by the owner 2026-10-19).

---

## Gaps

Every rule marked **gap** in these docs is tracked by a child of the epic
`Codex-2hxff` ("Payments correctness"). The evidence for each — file and line
references to today's code — is in
[docs/audits/payments-2026-10-13/bug-ledger.md](../audits/payments-2026-10-13/bug-ledger.md)
under the ledger ids listed on each bead.

`Codex-2hxff.1`–`.5` (label `payments-fix-pr-1`) were fixed in one pull request,
#589, merged to `dev` on 2026-10-14, and so are not listed below: the owner
asked for the payout-dashboard, ownership and price-change fixes together ("put
all of these fixes in together as one PR"), then agreed to add the portal
lockdown (`.4`) and environment tagging (`.5`) ("Include both"). Follow-ups:
`Codex-2hxff.35` (production's price-change email wording — fixed by migration
`0098`), `Codex-2hxff.36` (dropping the retired Connect pin column), and the
pre-merge review's findings, `Codex-2hxff.37`–`.46`. Of those, `.37` (an
organisation with no active owner had no payee, so its slice was dropped) was
fixed by PR 2 below. The production checks to run around these releases
(R1–R7) are in [release-checklist.md](release-checklist.md).

| Bead | P | What is not true yet | Spec |
|---|---|---|---|
| `Codex-2hxff.16` | P2 | Downgrades at period end; tier reorders warn first | [subscriptions](subscriptions.md#changing-tier) |
| `Codex-2hxff.20` | P2 | Revenue screens and agreement emails show the real numbers and working links | [fees-and-splits](fees-and-splits.md#reporting) |
| `Codex-fazy6` | P3 | The web app shows a creator's share from the accepted proposal, not the legacy column | [agreements](agreements.md#what-an-agreement-is) |
| `Codex-mat01` | P3 | A redelivered checkout event sends no second receipt | [purchases](purchases.md) |
| `Codex-2hxff.22` | P2 | Success pages wait for our record | [purchases](purchases.md) |
| `Codex-2hxff.24` | P3 | Dev and CI Stripe setup mirrors production; customer stub removed | [operations](operations.md#local-development) |
| `Codex-2hxff.25` | P2 | CI exercises real webhook round trips | [operations](operations.md#testing) |
| `Codex-2hxff.28` | P2 | Support issues refunds from an admin screen, not the Stripe Dashboard, within 14 days | [purchases](purchases.md#refunds) |
| `Codex-2hxff.29` | P2 | Creators' bank payouts are held for the 14-day refund window | [connect-and-payouts](connect-and-payouts.md#payout-timing) |
| `Codex-2hxff.30` | P2 | A clawback shortfall is recovered from the creator's future earnings | [connect-and-payouts](connect-and-payouts.md#reversals) |
| `Codex-2hxff.33` | P2 | A fee increase applies 30 days after an email; a decrease at once | [fees-and-splits](fees-and-splits.md#fee-configuration) |
| `Codex-2hxff.34` | P3 | Creators are reminded monthly about money waiting for them | [connect-and-payouts](connect-and-payouts.md#releasing-pending-money) |
| `Codex-2hxff.52` | P2 | Pausing, resuming, a failed payment and a trial ending work for course subscriptions as for tiers | [subscriptions](subscriptions.md#lifecycle-and-access) |
| `Codex-2hxff.55` | P2 | A service built without its money dependencies (fee configuration) cannot compile | [architecture](architecture.md) |
| `Codex-2hxff.60` | P3 | A subscriber is told when a dispute pauses their access | [subscription disputes](subscription-disputes.md) |

`Codex-2hxff.27` (closed) records the 2026-10-13 repair of production's webhooks.

`Codex-2hxff.13`, `.19`, `.23`, `.48` and `.61` (the money fixes) are fixed in
one pull request with migrations `0111` and `0112`, and so are not listed above:
- the database refuses to delete a user, organisation or course with money
  history, and account deletion keeps anonymising (owner, "Keep them,
  anonymise");
- a Customer is never adopted from another user;
- every payment path asserts GBP;
- no raw Stripe text reaches a client;
- a cleared fee is really cleared, and its audit row says so;
- one lock and one share source for every agreement path, with the agreement
  recorded on the purchase or slice;
- pending money is released across all of a payee's organisations as soon as
  they are payable, and on a manual sync;
- a payout Stripe keeps refusing stops after a permanent refusal or the fifth
  and waits for support (owner, "Stop, flag for support"; only refusals count;
  release by a documented step, R7);
- our own dispute pause no longer clears the streaming block, and the docs say
  plainly that a link already issued plays to its expiry (owner, option c).
`Codex-2hxff.47`, `.49`, `.58`, `.59` and `.68` (the ledger edges) are fixed in
one pull request with migration `0113`, and so are not listed above:
- a transfer to a creator's replaced Connect account is still found: a trigger
  keeps every account a user had (owner, "Keep account history");
- a replay keeps the platform fee already recorded and splits the rest so the
  slices sum to what was paid, a missing slice included (owner, "Keep recorded
  fee"); course plans split once, as tiers do;
- missed dispute events are settled by an hourly reconcile (owner, "Retry
  hourly, alert");
- the dispute edge cases: a later refund on re-paid money, a refund under a
  full chargeback, a slice cut to nothing, an inherited course grant, and a
  slice recorded while its sale is disputed (held, not sent);
- an early partial refund no longer under-pays the creator, and a course refund
  that arrives before its purchase is recorded too.

The web app's agreement pages still read the legacy share column (the API now
also returns `creatorSharePercent`): `Codex-fazy6`.

`Codex-2hxff.7` (fee configuration on every sale path, including the 25p
minimum), `.8` (partial refunds) and `.9` (disputes) were merged to `dev` and
released to production on 2026-10-20 (#617), so are not listed above; the
dispute follow-ups are `.58`–`.61`. `Codex-2hxff.32` (every one-off price at
least £1.00) and `.10` (a failed renewal keeps access while Stripe retries; a
full refund of the latest payment cancels) are fixed together in one pull
request. `.26` (this documentation) and `.31` (the policy drafts) are done.
`.17` (an agreement keeps paying after its review date), `.18` (removing a
creator ends their agreements) and `.65` (a buyer still opens a course taken
off sale) are merged to `dev`. `.64` (removing a creator takes everything of
theirs off sale; see [agreements](agreements.md#what-comes-off-sale)) is fixed
in its own pull request.

`Codex-2hxff.6`, `.11`, `.12` and `.37` (label `payments-fix-pr-2`) are fixed in
payments fix PR 2 and so are not listed above: webhooks answer 500 for a
transient failure inside a service; every slice of every sale is one ledger row,
reserved before its transfer, so nothing is paid twice or dropped; failed
transfers are retried; an organisation's money while it has no owner is held for
the next owner (owner decision 2026-10-18, "Hold it for the next owner", and
"All four in one PR"); a refund freezes an unpaid slice and reverses any
transfer that went out for it anyway. Its migration `0099` adds unique
indexes, so production must hold no duplicate slices first: `db:migrate`
checks this before applying anything and stops if it finds any — see the
release checklist (R5). Failed rows written before PR 2 are not retried; they
are reconciled by hand (R6).

Follow-ups from its review: `Codex-2hxff.47` (a transfer to a replaced Connect
account is not found), `Codex-2hxff.48` (failed rows retry forever) and
`Codex-2hxff.49` (a replay re-splits with the current fees). The architecture
survey of 2026-10-19 found `.50`–`.52` (rows above).

Related open beads outside the epic: `Codex-in0g4` (refund reviews for subscriptions), `Codex-rtwpv` (fee writes not
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
| Price-change mechanism | "Deferred swap (Recommended)": the pending price rides on the Stripe subscription's metadata and is switched in, without proration, once the next renewal is at least 30 days after the email — not subscription schedules |
| Two price changes in a row | "Latest wins (Recommended)": a second change replaces a pending one; one move, to the newest price |
| Ownership | "I think there should only be one owner, and the only person who can be the owner is the person who makes the organization. The only person who can transfer ownership should therefore be the owner. The proposed ownership model seems perfect to me." Money is held as pending until a new owner sets up payouts; money earned before a transfer stays with the old owner; "No migration concerns here." |
| Ownership transfer | Recipient "An admin or creator"; "Yes, they accept"; the previous owner becomes "Admin"; started from "Studio settings"; an offer lasts "7 days"; emails "Both + other admins"; support reassignment "Support API, no screen". Mockup review: "Card on Settings (Recommended)", "Type the org name (Recommended)", no email on expiry "No — show on next visit (Recommended)", and the previous owner's subscription income "Agreements decide (Recommended)" — an agreement they hold keeps paying; one without is warned that it stops (`Codex-2hxff.2`) |
| One pull request | "Yeah, I think we should put all of these fixes in together as one PR, to be honest." Adding the portal lockdown and environment tagging: "Include both" |
| Production on the sandbox | "Right now, production is using the dev sandbox endpoints just so that nobody accidentally buys anything, as we are still testing, and production is not live yet, despite the website being there." "Right now, both production and this local should be receiving the same information from endpoints." |
| Partial refunds (P-1) | "Keep access" |
| Disputes (P-2) | "Creators share it" |
| Failed renewals (P-3) | "After retries fail" |
| Subscription refunds (P-4) | "Cancel + end access" |
| Downgrades (P-5) | "At period end" |
| Small sales (P-7) | "Minimum platform fee"; the floors: "£1 price, 25p min fee (Recommended)" |
| Minimum transfer | "Keep it off (Recommended)" — `minTransferCents = 0` |
| Fee changes | "Rises 30 days, cuts now (Recommended)" |
| Tier reordering (P-8) | "Warn, then allow" |
| Agreement term (AGR-01) | "Keeps paying"; then, asked whether either side can end an agreement early: "Yes, any time" |
| Leaving an organisation (AGR-09) | "End on removal" |
| One-off sale with no agreement | "Org default fee" — supersedes the 2026-05-17 note that the organisation keeps everything |
| Rounding remainders | "The organisation" |
| Early fraud warnings | "Refund automatically" |
| Payout schedule | "Bank account only" — creators change their bank account, not their schedule |
| Who issues refunds | "Platform support" |
| Refund window | "14 days" |
| Funding refunds | "Hold for the window" — bank payouts wait out the 14-day refund window |
| Clawback shortfalls | "From future earnings"; if never recovered, "Write off after 12 months (Recommended)", amended by the owner — "perhaps there should be a limit on the level of absorption we would be willing to take before we invoice the creator" — to "£50 (Recommended)" and "All of it, after 90 days (Recommended)" |
| Unclaimed money | "Hold and remind (Recommended)" — never forfeited, monthly reminder |
| Policy text | "Draft both" — customer refund policy and creator payout terms, for legal review |
| Refund reply time | "No promise" |
| Billing portal configuration | "Create it now" → `bpc_1UQ9QH7wyGmo4sh6hXwkCS1s` |
| Docs housekeeping | Payment sections of `CLAUDE.md` files: "Trim to rules + link". Old files: "Delete GEMINI.md only" (`docs/archive` is kept). Their generator script and the Stripe skill reference: "Yes, add to #585 now" |
| Refund clawback (earlier, `Codex-13v21`) | Reverse transfers on refund; record a `refund_reviews` debt when the payee's balance is too low |
| Agreements (2026-05-17) | One-off sales use only the uploading creator's agreement; the creator's share is fixed at acceptance while the platform fee is read at each sale; no pro-rating — whoever is active at the invoice gets its full share |
| Cancellation (2026-04-21) | Cancelling keeps access until the end of the paid period |
| Free offers | "We don't do free journeys." — a £0 price is refused |
| Subscription drift (2026-10-22, `Codex-2hxff.15`) | A second subscription: "Keep the first", cancel the newcomer at once and refund its whole payment, one plain email, no cancelled email or streaming block. Checkout blocks early "same as purchases". Course plan unpaid then paid: "Yes, like tiers". Tier-change preview: "10 min, then review again". An invited `member` who subscribes: "Yes, keep the role" |
| Checkout (2026-10-21/22, `Codex-2hxff.14`) | Paying twice: "Block, then refund". Session expiry: "30 minutes". Checkout only for items a purchase opens; any priced item, courses included ("Yes, same rule"), needs payouts to publish; only a paid session completes. A priced course-only item shows a "Part of a course" note instead of Buy |

The customer webhook endpoint was disabled on 2026-10-13 after the owner asked
whether it had a purpose: it has no handler, and stale customers already
recover at checkout.

---

## Open questions

Still needed:

1. **Legal review** of the [policy drafts](policy-drafts/README.md)
   (`Codex-2hxff.31`): questions L1–L7 in the refund policy and P1–P7 in the
   creator terms. The most urgent is L1: checkout collects no consent to
   immediate access today, so a buyer's statutory 14-day cancellation right for
   digital content may still apply after they start watching.

Every owner decision the drafts needed was taken on 2026-10-13 (rows above).

The refund-policy questions in `Codex-aqk92` were all answered on 2026-10-13 and
that bead is closed.
