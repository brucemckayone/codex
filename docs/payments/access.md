# Access

What lets a person watch, listen to or read paid content, how that access is
taken away, and how caches keep up. The decision itself lives in
`packages/access` (`access-decision.ts`, `entitlements-resolver.ts`).

A **gap** marker means the code does not behave this way yet; see
[status.md](status.md).

---

## Sources of access

| Source | Grants | Stored or derived |
|---|---|---|
| **Purchase** | One piece of content. The purchase must be completed and not under dispute. | `purchases` |
| **Entitlement** — `content_purchase` | One piece of content | Stored in `entitlements` |
| **Entitlement** — `course_purchase` | One course | Stored |
| **Entitlement** — `course_subscription` | One course, until the end of the paid period | Stored, with `expiresAt` |
| **Entitlement** — `grant` | One piece of content or course, given by support | Stored |
| **Tier subscription** | The organisation's content up to that tier, and courses included in that tier | Derived live from `subscriptions` |
| **Management role** | Everything in the organisation, for its owner, admins and creators | Derived from membership |

An entitlement is live while `revokedAt` is empty and `expiresAt` (if set) is
in the future. Each person holds at most one live entitlement per resource and
source.

**A tier subscription grants access** while its status is `active` or
`cancelling` — and `past_due` while Stripe is still retrying the payment —
and the paid period has not ended. Course subscription plans follow the same
statuses: every gate reads `ACCESS_GRANTING_SUBSCRIPTION_STATUSES`
(`@codex/constants`). A higher tier
includes everything in the tiers below it. A course is included in the exact
tiers chosen for it in Studio.

**`content_access` is not a source of access.** The table is still written by
purchase completion and cleared on refunds and disputes, but nothing reads it
for access. Never add a reader; it is due for removal.

## Which source each kind of content accepts

| Content | Accepts |
|---|---|
| Free | Everyone |
| Priced (sold on its own) | A purchase, a `content_purchase` or `grant` entitlement, a course that contains it, or a management role |
| In a tier | A subscription at that tier or above, a purchase if it is also sold on its own, or a management role |
| Followers-only | A subscription, following the organisation, or a management role |
| Team-only | A management role |
| Course-only | A course entitlement, or a management role |

Content that is followers-only, team-only or course-only is never sold on its
own (see [purchases.md](purchases.md#what-can-be-bought)), so those rules never
have to honour a purchase. A purchase keeps granting access after the content is
unpublished.

## When access ends

| Event | What ends | Comes back when |
|---|---|---|
| Full refund of a purchase | That item (entitlement revoked) | — |
| Partial refund of a purchase | Nothing (owner decision P-1) | — |
| Dispute opened on a purchase | That item, paused | The dispute is won |
| Dispute lost on a purchase | That item, for good | — |
| Dispute opened on a subscription invoice | Everything from that subscription, paused (`disputed_at`); its billing paused too | The dispute is won, and no other chargeback on it is open |
| Dispute lost on a subscription invoice | Everything from that subscription: it is cancelled at Stripe | The person subscribes again |
| Subscription cancelled (at period end) | Nothing until the period ends | The subscriber reactivates before it ends |
| Subscription ends | Everything from that subscription | The person subscribes again |
| Subscription paused | Everything from that subscription | It is resumed |
| Renewal payment fails | Nothing while Stripe retries (owner decision P-3) | — |
| Stripe gives up retrying | Everything from that subscription | The person subscribes again |
| Full refund of the current period's subscription payment | Everything from that subscription: it is cancelled at Stripe (owner decision P-4) | The person subscribes again |

## Streaming revocation

A stream URL is a presigned R2 URL that keeps working until it expires,
whatever happens to access in the meantime. Two layers close that gap:

1. **Short URLs.** Stream URLs last 600 seconds
   (`DEFAULT_STREAMING_URL_TTL_SECONDS`).
2. **A block list.** When access ends, a KV key `revoked:user:{userId}:{orgId}`
   is written with the reason and time, for 1200 seconds — twice the longest
   URL lifetime. `getStreamingUrl` checks it before issuing a URL. The `revoked:`
   keyspace is kept apart from `cache:` because it is an authoritative block
   list, not a cache.

| The block is written when | The block is cleared when |
|---|---|
| A subscription ends, is paused, or Stripe gives up retrying | A subscription becomes active again or is resumed |
| A purchase or a tier subscription's current-period payment is fully refunded — **gap**: `Codex-2hxff.8` (not for one-off purchases today) | A payment succeeds after a failure |
| A dispute opens | A subscription is reactivated or resumed through our routes |
| | A dispute is won (a purchase's; a subscription's — **gap**: `Codex-2hxff.9`) |

The block is **not** written when a subscriber cancels at period end (they have
paid for the period) or when a renewal payment fails and Stripe is retrying it.

## Playback progress

Saving playback progress (`savePlaybackProgress`) requires current access to the
content. Without the check, someone whose access had ended could keep posting
progress and bring back "continue watching" entries that look like access.

## Support grants

Support can give a customer complimentary access to content
(`POST /api/admin/customers/:customerId/grant-access/:contentId`, organisation
owner or admin). This writes a `grant` entitlement, which the access decision and
the library both honour — **gap**: `Codex-2hxff.21` (today it writes only
`content_access`, so a grant does nothing).

## The library

A person's library lists everything they can access through purchases,
entitlements (including grants and courses) and subscriptions. Content under an
open dispute is hidden — **gap**: `Codex-2hxff.9`. Purchase history (`GET
/purchases`) lists content and course purchases — **gap**: `Codex-2hxff.21`.

## Keeping caches in step

Every event that changes what a person can access invalidates **both** of their
per-user caches, so the library and the subscription badge never disagree:

- `COLLECTION_USER_LIBRARY(userId)` — what they can see;
- `COLLECTION_USER_SUBSCRIPTION(userId, orgId)` — their tier in that
  organisation.

`invalidateForUser` (`packages/subscription/src/services/subscription-invalidation.ts`)
bumps both through `waitUntil`, and every `SubscriptionService` mutation ends by
calling it. Webhooks bump the versions server-side; the browser notices through
the version manifest and reloads its collections. A page that confirms a
purchase or subscription also refreshes those collections itself — **gap**:
`Codex-2hxff.22`. The account subscriptions page reloads through its own
`depends('account:subscriptions')` key after a change. The general caching model
is in [docs/caching-strategy.md](../caching-strategy.md).
