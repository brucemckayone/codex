# Payments

How money and paid access work on Codex: what can be bought, how each sale is
split, how creators get paid, and who can see what.

**This folder is a specification.** It describes the behaviour Codex is meant
to have, as decided by the owner. Where today's code does not behave this way
yet, the rule ends with a **gap** marker naming the bead that fixes it, for
example — **gap**: `Codex-2hxff.14` (checkout gating). [status.md](status.md)
lists every gap in one table. Evidence for today's behaviour, with file and
line references, is in [docs/audits/payments-2026-10-13/](../audits/payments-2026-10-13/README.md).

Last reviewed: 2026-10-13.

| Read this | For |
|---|---|
| [purchases.md](purchases.md) | One-off purchases of content and courses: checkout, completion, refunds, disputes |
| [subscriptions.md](subscriptions.md) | Organisation tiers and course plans: subscribing, renewals, tier and price changes, failed payments, cancellation |
| [fees-and-splits.md](fees-and-splits.md) | Fee configuration and exactly how each sale is divided |
| [agreements.md](agreements.md) | Revenue-share agreements between an organisation and its creators |
| [connect-and-payouts.md](connect-and-payouts.md) | Stripe Connect accounts, organisation ownership, the payouts ledger and how money reaches creators |
| [access.md](access.md) | What grants access to paid content, how it is taken away, and how caches keep up |
| [operations.md](operations.md) | Environments, webhooks, secrets, the Stripe Dashboard settings, local development and testing |
| [release-checklist.md](release-checklist.md) | Read-only production checks to run before and after a `dev` → `main` release that moves payments data or money |
| [status.md](status.md) | Every rule the code does not meet yet, the owner decisions behind this spec, and open questions |
| [policy-drafts/](policy-drafts/README.md) | Drafts of the customer refund policy and the creator payout terms, for legal review — not published |

---

## What can be bought

| Product | Sold by | Price set in | Billing | Stripe objects |
|---|---|---|---|---|
| Content (a video, audio or written piece) | An organisation, or a creator directly (orgless) | Studio | One-off | Checkout Session with inline `price_data` |
| Course (journey) | An organisation | Studio | One-off | Checkout Session with inline `price_data` |
| Organisation tier (membership) | An organisation | Studio | Monthly or annual | One Product per tier, one Price per interval |
| Course subscription plan | An organisation | Studio | Monthly or annual | One Product per course, one Price per interval |

Prices are in GBP (£) and always greater than £0 — Codex never offers anything
for free. The price charged always comes from our database, never from the
browser.

## Who is involved

| Party | Role in money |
|---|---|
| **Buyer** | Pays. Has one Stripe Customer per environment. |
| **Creator** | Makes content. Receives their slice of each sale into their own Stripe Connect account. |
| **Organisation owner** | Exactly one per organisation: the person who created it. Receives the organisation's slice. Only the owner can transfer ownership. |
| **Organisation admins and members** | Manage or contribute to the organisation. They never receive the organisation's money and never open its payout dashboard. |
| **Co-creator with an agreement** | A creator whose share of the organisation's revenue is set by a [revenue-share agreement](agreements.md). |
| **Platform (Codex)** | Merchant of record. Takes the platform fee, pays Stripe's processing fees, and is liable to Stripe for refunds and disputes. |
| **Platform owner** | Sets fee configuration and can assign a new organisation owner when a transfer is impossible. |

## How money moves

Codex uses Stripe's **separate charges and transfers** model.

1. The buyer is charged on the **platform's** Stripe account. Codex is the
   merchant of record.
2. The platform keeps its fee.
3. The platform pays every other party with its own `transfers.create` call,
   each linked to the original charge with `source_transaction`. Stripe moves
   the money when the charge's funds become available.

```
buyer pays £10.00 ──► platform account
                        ├─ platform fee            stays on the platform balance
                        ├─ organisation slice  ──► the owner's Connect account
                        └─ creator slice(s)    ──► each creator's Connect account
```

**Why this model.** A sale can have three or more parties: the platform, the
organisation and one or more creators. Direct charges and destination charges
can each pay only one connected account, so neither can split a sale three ways.

**What follows from it.**

- Stripe's processing fee is taken from the platform's balance, so the
  platform fee must cover it — hence the [minimum platform fee](fees-and-splits.md#minimum-platform-fee).
- The platform is liable to Stripe for refunds and chargebacks
  (`controller.losses.payments = application`). It recovers the creators' and
  organisation's share by reversing their transfers — see
  [refunds](purchases.md#refunds) and [disputes](purchases.md#disputes).
- Every slice is a separate ledger row, so every penny of a sale is traceable —
  see [the payouts ledger](connect-and-payouts.md#the-payouts-ledger).

## Rules that always hold

1. **GBP only.** Every amount is in pence; every Stripe call passes `gbp`.
   Every transfer site asserts the currency before calling Stripe — **gap**:
   `Codex-2hxff.23` (one-off transfer site has no assertion).
2. **Studio is the only place prices are set.** A price edited in the Stripe
   Dashboard is recorded as drift and never applied to anyone.
3. **No £0 offers.** A price of £0 is refused when it is written.
4. **Every penny is accounted for.** Each sale stores its split, and every
   slice that is owed to someone has a row in the payouts ledger — paid, or
   pending until it can be paid. Nothing is dropped with only a log line.
5. **Financial records are permanent.** Purchases, subscriptions, payouts and
   refund reviews are never hard-deleted or cascade-deleted — **gap**:
   `Codex-2hxff.23` (user deletion cascades).
6. **Money-moving Stripe calls are idempotent.** Each uses a deterministic
   idempotency key built from the charge and the slice, and the slice's ledger
   row is reserved before the transfer, so a retried webhook can never pay
   twice.
7. **Webhooks are retried on transient failure.** A database or Stripe outage
   returns 500 so Stripe retries; only a permanent problem is acknowledged
   with 200.
8. **One of each per person.** One Stripe Customer per user per environment;
   one Stripe Connect account per user.
9. **Each environment ignores the other's events.** Production and local
   development share one Stripe sandbox until launch. Every object we create
   is tagged with its environment, and handlers skip events about objects from
   another environment.
10. **Access comes from purchases, entitlements and subscriptions** — see
    [access.md](access.md). The legacy `content_access` table is never an
    access source.

## Where it lives in code

| Concern | Code |
|---|---|
| One-off checkout, completion, refunds, disputes, fee config, customer resolution | `packages/purchase` (`PurchaseService`, `FeeConfigService`, `resolve-customer.ts`, `entitlement-writer.ts`, `revenue-calculator.ts`) |
| Tiers, subscriptions, course plans, Connect, payouts ledger, drains | `packages/subscription` (`TierService`, `SubscriptionService`, `CourseSubscriptionService`, `ConnectAccountService`) |
| Revenue-share agreements | `packages/agreements` (`AgreementService`, `agreement-math.ts`) and `packages/purchase/src/services/agreement-share.ts` |
| Access decisions, entitlements, streaming revocation | `packages/access` |
| HTTP routes, Stripe webhooks, payouts cron | `workers/ecom-api` |
| Fee configuration API, analytics, customer support grants | `workers/admin-api`, `packages/admin` |
| Tier management routes | `workers/organization-api` |
| Schema | `packages/database/src/schema/` — `ecommerce.ts`, `subscriptions.ts`, `payouts.ts`, `entitlements.ts`, `fee-config.ts`, `refund-reviews.ts`, `course-commerce.ts` |
| Fee constants, Stripe event names, statuses | `packages/constants/src/commerce.ts` |

## Glossary

| Term | Meaning |
|---|---|
| **Basis points (bps)** | Hundredths of a percent. 10000 bps = 100%; 1000 bps = 10%. |
| **Post-platform pool** | What is left of a sale after the platform fee. Organisation and creator shares are fractions of this pool, never of the gross. |
| **Slice** | One party's part of one sale: the platform fee, the organisation slice, or a creator slice. |
| **Payable** | A Connect account with both `charges_enabled` and `payouts_enabled`. |
| **Pending row** | A ledger row for a slice that is owed but not yet transferred, usually because the payee is not payable yet. |
| **Drain** | Transferring a payee's pending rows once they become payable. |
| **Sweep** | The hourly production job that drains anything the webhook-triggered drain missed. |
| **Entitlement** | A stored grant of access to one piece of content or one course. |
| **Review date** | The end of an agreement's term. It prompts a review; it does not end the agreement. |
