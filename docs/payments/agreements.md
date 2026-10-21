# Revenue-share agreements

An agreement gives one creator a share of an organisation's revenue. This page
covers what an agreement is, how it is negotiated and ended, and how it changes
a split. The split formulas themselves are in
[fees-and-splits.md](fees-and-splits.md).

A **gap** marker means the code does not behave this way yet; see
[status.md](status.md).

---

## What an agreement is

- It is between an **organisation** (acting through its owner) and **one
  creator** who is an active member of that organisation.
- It covers one **revenue type**: `subscription` (the organisation's tier
  revenue) or `content_purchase` (one-off sales of that creator's own content and
  courses).
- A creator has at most **one active agreement per revenue type** per
  organisation.
- The **share** is in basis points of the **post-platform pool**. A "30% share"
  means 30% of what is left after the platform fee, not 30% of the sale. The
  platform fee is set separately in [fee configuration](fees-and-splits.md#fee-configuration)
  and is always the one current at the time of the sale.
- An agreement replaces only the **organisation's** part of the split. The
  platform fee, minimum platform fee and minimum transfer always come from fee
  configuration.
- The active shares of one revenue type in one organisation never add up to more
  than 100% of the pool. What the creators don't take is the organisation's.

**Storage.** Proposals live in `agreement_proposals`, an append-only negotiation
log. An accepted proposal produces a `creator_organization_agreements` row,
which points at it through `current_proposal_id`. The share is read from the
accepted proposal (`proposed_creator_share_percent`). The legacy column
`organization_fee_percentage` holds `10000 − share` and is still written; new
code must not read it — **gap**: `Codex-2hxff.19`, `Codex-2hxff.20` (several
readers still do).

## Negotiating

| Action | Who can do it | Result |
|---|---|---|
| **Propose** (round 1) | The organisation owner | A new `open` proposal; the creator is emailed |
| **Counter** | The other side of the open proposal | The proposal becomes `countered` and a new `open` proposal is added with the next round number; the other side is emailed |
| **Accept** | The other side | The proposal becomes `accepted`; every other open or countered proposal in the thread becomes `superseded`; any earlier active agreement of that type is `terminated`; a new active agreement is created; both sides are emailed |
| **Decline** | The other side | `declined`, with a reason; both sides are emailed |
| **Withdraw** | The side that made the proposal | `withdrawn`; no email |

Only one thread can be open per organisation, creator and revenue type. Every
action locks the row it changes, including a new proposal, so two people acting
at once cannot both succeed — **gap**: `Codex-2hxff.19` (proposing takes no
lock). Admins can see an organisation's agreements but only the owner can act;
the screen shows admins only what they can do — **gap**: `Codex-2hxff.20`.

A round-1 proposal exists **only** as a proposal row. There is no agreement row
until acceptance, so anything that lists "this creator's agreements" must also
read open proposals (`getProposalsForCreator`), or a creator following an email
link to a pending offer gets a 404.

## Term and review date

Owner decision AGR-01, "Keeps paying", clarified as "Yes, any time".

- An agreement is a **soft lock**: either side can terminate it **at any time**.
- The term (1–120 months) sets a **review date**. It is a reminder, not an
  expiry. When it passes, the agreement **keeps paying** until one side ends it
  or a renegotiated agreement replaces it.
- Thirty days before the review date both sides are emailed a reminder
  (`agreement-expiring-soon`, notifications-api cron `0 8 * * *`, production
  only), worded as a review reminder. Migration 0106 rewrote the live
  templates, unless an organisation had edited its own copy.

`effective_until` stores the review date. Only the reminder scan
(`findExpiringAgreements`) reads it. Payments, Studio, the 100% limit and the
admin revenue view all treat an agreement past its review date as active.

## Ending an agreement

- **Termination** by either side takes effect immediately; the other side is
  emailed.
- **No pro-rating.** Whoever holds an active agreement at the moment of a sale
  or invoice receives that sale's full share. An agreement terminated before an
  invoice gets nothing from it. The termination dialog and email say so,
  including the date of the next invoice.

### Leaving an organisation

Owner decision AGR-09, "End on removal". When a creator is removed from an
organisation, their agreements there are **terminated at that moment**
(`terminateAgreementsOnDeparture`, in the same transaction as the membership
change). The creator is emailed `agreement-terminated` after the commit. Their
agreements in other organisations are untouched.

Nothing new can start for them either. Their open proposals there are
withdrawn in the same transaction (`withdrawProposalsOnDeparture`), and
accepting or countering any proposal requires the creator to still be an
active member. That check takes a share lock on the membership row, so a
removal and an acceptance at the same moment serialise: either the removal
also ends the new agreement, or the acceptance is refused.

Money earned before the removal is still paid to them. The resolver reads the
termination time, not the membership. A webhook for an earlier invoice that
lands, or is retried, after the removal still finds the agreement. A check on
the membership as it is *now* would wrongly drop that share, so there is none.
A creator who deletes their own account is treated the same way, in every
organisation at once (owner decision: "End them like a removal"). Their
agreements end and their open proposals are withdrawn in the same transaction
as the deletion, with the reason "The creator deleted their account". No email
is sent, because the address is scrubbed by the deletion.

`removeMember` and account deletion are the only ways a creator leaves today.
Any new way out must call `withdrawProposalsOnDeparture` and
`terminateAgreementsOnDeparture` too.

## How a share applies

| Revenue | Agreements consulted | Without an agreement |
|---|---|---|
| Organisation subscription invoice | Every active `subscription` agreement in the organisation, pooled | Organisation fee and creator pool both go to the owner |
| One-off purchase of organisation content | Only the uploading creator's `content_purchase` agreement | The organisation's default one-off fee; the creator gets the rest |
| Course purchase | The course creator's `content_purchase` agreement | As above |
| Course subscription invoice | The course creator's `subscription` agreement | The default subscription organisation fee; the creator gets the rest |
| Orgless sale | None | No organisation slice |

One resolver decides which agreements apply, for every path
(`agreementsInForce` in `@codex/agreements`) — **gap**: `Codex-2hxff.19` for
the two items marked "today":

- it uses the sale's own time: the invoice's creation time for subscriptions and
  the payment time for purchases (today purchases use the time the webhook is
  processed);
- an agreement counts if it is active at that time, or was terminated after it,
  and it had taken effect by then (the review date is not read);
- a missing proposal link is logged and skipped, never silently dropped, and
  that creator gets no share rather than a newer agreement's;
- results are ordered deterministically and counted once per creator, even
  mid-renegotiation: the older agreement was the one in force;
- the purchase or invoice records which agreement it used (today
  `creator_org_agreement_id` is always empty).

## Who sees what

| Viewer | Sees |
|---|---|
| Organisation owner and admins | Every creator's share, name and thread |
| A creator | Their own share, plus anonymous totals for their peers in each revenue type (`peers: { count, aggregateSharePercent }`) — never a peer's identity |

Subscription and content-purchase peers are never combined. Route tests pin the
anonymisation.

## Routes

All under `/agreements` on ecom-api, `auth: 'required'`. Owner-side mutations
also require the caller to be an active owner.

| Route | Purpose |
|---|---|
| `POST /propose?organizationId=` | Owner proposes (organisation membership required) |
| `POST /:proposalId/counter`, `/accept`, `/decline`, `/withdraw` | Negotiate |
| `POST /:agreementId/terminate` | Either side ends an agreement |
| `GET /`, `GET /threads/:creatorId`, `GET /pending` | Organisation view (owner or admin) |
| `GET /me`, `GET /me/threads/:proposalId`, `GET /me/portfolio` | Creator view |

## Emails

| Template | Sent to |
|---|---|
| `agreement-proposed-by-owner` | The creator |
| `agreement-countered-by-creator` / `agreement-countered-by-owner` | The other side |
| `agreement-accepted`, `agreement-declined` | Both sides |
| `agreement-terminated` | The side that did not terminate |
| `agreement-expiring-soon` | Both sides, 30 days before the review date |

Every link in these emails opens a page that exists for that recipient — the
owner's organisation Studio or the creator's negotiations page — **gap**:
`Codex-2hxff.20` (today every link is dead). Copy always says "post-platform"
revenue.

## Not planned yet

Hard-locked contracts, different splits per tier, per-content splits,
owner-configurable visibility, reusable proposal templates and an earnings
forecast are all out of scope for now.
