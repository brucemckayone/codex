# Payment policy drafts — for legal review

> **DRAFTS. Not published, not in force, and not legal advice.** These are
> plain-English drafts of the platform's intended payment rules. A qualified
> UK lawyer has to review them before any of this text is shown to a customer or
> a creator. Owner decision 2026-10-13: "Draft both". Bead `Codex-2hxff.31`.

| Draft | Audience | Where it would be shown |
|---|---|---|
| [customer-refund-policy.md](customer-refund-policy.md) | Buyers and subscribers | Linked from checkout and from the site footer |
| [creator-payout-terms.md](creator-payout-terms.md) | Creators, organisation owners and admins | Accepted before setting up payouts; linked from Studio |

Each draft has two parts:

1. **The text a reader would see.** Short sentences, no jargon, pounds sterling.
2. **Drafting notes, removed before publishing.** Every rule traced to the
   owner decision behind it (the
   [decisions table in status.md](../status.md#decisions)), followed by the
   questions for the lawyer.

The behaviour the drafts describe is the **intended** behaviour in
[docs/payments/](../README.md). Where today's code does not match yet, the
spec marks it with its bead. The drafts must not go live before those beads are
fixed, or they would promise behaviour the platform does not have. The
blocking beads are listed in each draft's notes.

## Placeholders

| Placeholder | Meaning |
|---|---|
| `[Legal entity]` | The company that sells to customers and pays creators: the platform account holder on Stripe. The web app's legal pages still say "Codex" (`legal_terms_lead` in `apps/web/messages/en.json`), while the site's name is "Revelations". |
| `[Company number]`, `[Registered address]` | From Companies House |
| `[support email]` | The support address that receives refund requests |
| `[date]` | Effective date |

## Related

- `Codex-6wkr1` — publish the real Terms of Service and Privacy Policy (both
  placeholders today). The refund policy and creator terms belong next to them.
- `Codex-aqk92` (closed) — the refund policy questions these drafts answer.
