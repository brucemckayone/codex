# Refunds and cancellations — DRAFT for legal review

> Not published. Not legal advice. See [README.md](README.md).

---

## Refunds and cancellations

*Effective [date].*

When you buy on Revelations, you are buying from **[Legal entity]**
([Company number], [Registered address]). We take your payment and pay the
creators and organisations whose work you buy. All prices are in pounds
sterling (£).

### What you can buy

- **A one-off purchase** of a video, an audio piece or a course. You keep access
  for as long as it is available on Revelations.
- **A subscription** to an organisation or to a course. It renews automatically
  each month or year until you cancel it.

### Asking for a refund

Refunds are handled by **Revelations support**, not by the creator. Email
**[support email]** within **14 days** of the payment and tell us what you
bought and why you would like a refund.

We will reply as soon as we can. If we agree to a refund, it goes back to
the card or account you paid with. Your bank may take a few days to show it.

### What a refund means for your access

| Refund | What happens |
|---|---|
| **Full refund** of a one-off purchase | Your access to that item ends. |
| **Partial refund** of a one-off purchase | You keep your access. |
| **Full refund** of a subscription payment | Your subscription is cancelled straight away and your access ends. |
| **Partial refund** of a subscription payment | Your subscription carries on as normal. |

### Cancelling a subscription

You can cancel at any time in your account. Cancelling stops the next renewal.
**You keep access until the end of the period you have already paid for**, and
you are not charged again. Until that period ends, you can change your mind and
keep the subscription.

### If a renewal payment fails

We will email you and try your card again over the following days. You keep
access while we retry, and you can update your card at any time. If every retry
fails, your subscription ends and so does your access.

### Price changes

If the price of your subscription changes, we will email you first. The new
price applies from your **first renewal at least 30 days after that email**.
This is the same for increases and decreases. If you do not want to pay the new
price, cancel before that renewal.

### If you dispute a payment with your bank

If you ask your bank to reverse a payment (a "chargeback"), your access to what
you bought is **paused** while the bank decides. If the bank decides in our
favour, your access comes back. If it decides in yours, access ends. Please
contact us first; we can usually sort it out faster.

### Payments that look fraudulent

If your card issuer tells us a payment looks fraudulent, we refund it in full
straight away. Access to what was bought ends.

### Your legal rights

This policy does not affect your statutory rights. **[Lawyer: wording for the
Consumer Rights Act 2015 digital-content remedies, and for the cancellation
right — see notes L1 and L2.]**

---

## Drafting notes — remove before publishing

### Where each rule comes from

| Rule | Decision ([status.md](../status.md#decisions)) | Spec |
|---|---|---|
| Platform support issues refunds; customers and creators cannot | "Platform support" | [purchases.md → Refunds](../purchases.md#refunds) |
| 14-day refund window | "14 days" | same |
| No promised reply time | "No promise" | — |
| Partial refund keeps access | P-1 "Keep access" | same |
| Full refund ends access | P-1 (the other side of it) | same |
| Full subscription refund cancels and ends access; partial carries on | P-4 "Cancel + end access" | [subscriptions.md → Refunds](../subscriptions.md#refunds) |
| Cancelling keeps access to the end of the paid period | Cancellation (2026-04-21) | [subscriptions.md → Cancelling](../subscriptions.md#cancelling-reactivating-resuming) |
| Access kept during card retries; ends when retries fail | P-3 "After retries fail" | [subscriptions.md → Failed payments](../subscriptions.md#failed-payments) |
| Price change: email, then the first renewal ≥ 30 days later; up and down alike | Price changes (Q4–Q7) | [subscriptions.md → Price changes](../subscriptions.md#price-changes) |
| Chargeback pauses access; won → restored; lost → ends | P-2 "Creators share it" (the access side) | [purchases.md → Disputes](../purchases.md#disputes) |
| Fraud warning → automatic full refund | "Refund automatically" | same |
| No £0 offers | Free offers: "We don't do free journeys." | — |

### Must be fixed before this goes live

This policy promises behaviour the code does not have yet:

| Promise | Bead |
|---|---|
| Support can refund from an admin screen | `Codex-2hxff.28` |
| Partial refund keeps access | `Codex-2hxff.8` |
| A full subscription refund cancels and ends access | `Codex-2hxff.10` |
| Access is kept during retries and ends when they fail | `Codex-2hxff.10` |
| A chargeback pauses access, and a won dispute restores it | `Codex-2hxff.9` |
| A fraud warning triggers an automatic refund | `Codex-2hxff.9` |
| Price changes wait for the 30-day renewal | `Codex-2hxff.3` |
| Customers cannot cancel in the Stripe portal behind our back | `Codex-2hxff.4` |

### Questions for the lawyer

- **L1 — the 14-day cancellation right for digital content.** The Consumer
  Contracts (Information, Cancellation and Additional Charges) Regulations 2013
  give consumers 14 days to cancel a digital-content purchase. Our reading,
  **for the lawyer to confirm**, is that this right ends once streaming starts
  only if the buyer has expressly agreed to immediate access and acknowledged
  losing the right. **Checkout collects no such consent today.** Stripe Checkout
  is created with no `consent_collection`, `terms_of_service` or `custom_text`,
  and the web app shows no cancellation wording. Questions: what wording and
  what consent step are needed, and does the discretionary 14-day refund window
  above sit alongside the statutory right or replace it?
- **L2 — Consumer Rights Act 2015.** Digital content must be of satisfactory
  quality, fit for purpose and as described, with statutory remedies. What must
  the policy say, and does "support decides" conflict with those remedies?
- **L3 — subscriptions under the Digital Markets, Competition and Consumers Act
  2024.** Its subscription-contract rules (reminder notices, a cooling-off
  period on renewals, easy exit) were not yet in force when this was written.
  Most published sources put the start at spring 2027, after the government's
  April 2026 consultation response; one unconfirmed source says January 2027.
  Which will apply to us, and from when?
- **L4 — partial refunds that keep access.** Is a partial refund with continued
  access a "price reduction" remedy under the Consumer Rights Act, and does the
  wording need to say so?
- **L5 — chargebacks.** Can we pause access while a chargeback is open, and end
  it when we lose?
- **L6 — the selling entity.** We are the merchant of record: we charge the
  buyer and pay creators separately. Is it right to tell buyers they are buying
  from us, and what does that mean for VAT on digital services?
- **L7 — prices and VAT.** Are displayed prices VAT-inclusive, and must the
  policy say so?
