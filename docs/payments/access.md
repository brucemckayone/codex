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
source. It records the organisation that sold or granted the item; a creator's
own sale outside any organisation stores no organisation.

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

The same holds for a course taken off sale. Someone entitled to it still opens
it, with every practice that was ever released, including practices taken off
sale since. A course or practice that was never released stays hidden from
everyone except the editor (`Codex-2hxff.65`), and no one can stream it by its
id either: the access decision grants a never-released row to no one, a buyer
included (`Codex-nacky`). "Released" means `published_at` is set, or the row
is `published`; unpublishing never clears `published_at`. Detaching an item
from its organisation does: a database trigger (migration 0004) makes it a
draft and clears `published_at`, so it reads as never released.

When an organisation is deleted, nobody keeps its content, buyers included
(owner decision, 2026-10-25: "Nobody"; `Codex-7ncbh`). Its pages are already
gone (the org's site no longer resolves), and the stream and access checks
treat its content as deleted. What a deletion owes those buyers is an open
question (`Codex-ltbml`).

A tier subscription does **not** keep an unpublished item for good. It is a
licence, not a sale. When a removed creator's items come off sale
([agreements](agreements.md#what-comes-off-sale)), each one is stamped
`off_sale_at`. A tier subscriber keeps it only while
`off_sale_at >= current_period_start`, which means until their next renewal.
Tier-derived course access (`course_tier_access`) follows the same rule. An
item with no stamp (unpublished by hand) is not on offer to subscribers at
all. When an item is unpublished, the purchase, entitlement and course
sources are checked before the subscription. That way a subscriber who also
bought the item keeps it after renewing.

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
| Creator removed from the organisation (`Codex-2hxff.64`) | For tier subscribers, that creator's items at the next renewal. For followers, at once. Course subscriptions are cancelled at period end. Buyers keep theirs. | The item is republished by hand |
| Support revokes a grant | That grant only; a purchase of the item still grants | Support grants it again |

## Streaming revocation

A stream link is an HLS token for the content's playlist proxy. The token is
checked on every playlist request, but access is not: a link already issued
keeps playing until its token expires, whatever happens to access in the
meantime. When access ends:

- **New links are refused at once.** `getStreamingUrl` checks access in the
  database before it issues a link. That check is the authority.
- **A link already issued plays to its expiry**: 10 minutes by default
  (`DEFAULT_STREAMING_URL_TTL_SECONDS`), plus at most a minute for segment
  links fetched just before it expires. The API accepts up to 2 hours when a
  caller asks for it (`getStreamingUrlSchema`); the web app never asks. The
  owner accepted this window (`Codex-2hxff.61`): nothing checks access per
  playlist or per segment.
- **A block list.** A KV key `revoked:user:{userId}:{orgId}` is written with
  the reason and time, for 1200 seconds (`REVOCATION_TTL_SECONDS`).
  `getStreamingUrl` reads it before the database check and refuses a new link
  while it is there. It does not stop a link already issued, and it grants
  nothing: the database check refuses without it, so a missing key, a failed
  write or an early clear changes nothing. The `revoked:` keyspace is kept
  apart from `cache:` because it is an authoritative block list, not a cache.

| The block is written when | The block is cleared when |
|---|---|
| A subscription ends, is paused, or Stripe gives up retrying (it becomes `unpaid` or is cancelled) | A subscription becomes active again, unless its billing is paused (see below), or is resumed |
| A tier subscription's current-period payment is fully refunded (the subscription is cancelled) | A subscription payment succeeds |
| A chargeback opens, or a dispute is lost, on a subscription invoice | A subscription is reactivated or resumed through our routes |
| A chargeback opens, or a dispute is lost, on a purchase, unless the buyer holds the item another way | A dispute is won and the access it paused is restored (a purchase's, or a subscription's with no other chargeback open) |

A chargeback on a subscription invoice also pauses its billing at Stripe
(`pause_collection`), and Stripe reports that as
`customer.subscription.updated` with the status still `active`. That event does
not clear the block: only an `active` subscription with no `pause_collection`
does. Resuming billing after a won dispute sends that event, and the won
dispute clears the block itself too.

The block is **not** written when a subscriber cancels at period end (they have
paid for the period), when a renewal payment fails and Stripe is retrying it,
when a one-off purchase is refunded, or when support revokes a grant (see
[Support grants](#support-grants)). A one-off refund removes that item's
access, so the database check refuses new links for it at once; the block is
per organisation and would also stop the buyer's other items there.

## Playback progress

Saving playback progress (`savePlaybackProgress`) requires current access to the
content. Without the check, someone whose access had ended could keep posting
progress and bring back "continue watching" entries that look like access.

## Support grants

Support can give a customer complimentary access to one item of the
organisation's content, and take it back. The routes are on admin-api, for the
organisation's owner or admins, and the Studio customer drawer uses them.

| Route | What it does |
|---|---|
| `POST /api/admin/customers/:customerId/grant-access/:contentId` | Writes a `grant` entitlement, recording who granted it (`granted_by_user_id`). A re-grant while one is live does nothing. |
| `GET /api/admin/customers/:customerId/grants` | The organisation's grants for the customer, newest first, live and revoked, with the names of who granted and who revoked each. |
| `DELETE /api/admin/customers/:customerId/grants/:entitlementId` | Revokes that grant: sets `revoked_at` and `revoked_by_user_id`. Returns 204, and again if it was already revoked. |

- **What a grant needs.** The customer has a purchase or a membership in the
  organisation; the content belongs to the organisation and is not deleted.
- **What can be granted.** Only an item a grant can open: priced content or
  content in a tier (owner decision, 2026-10-21). The access decision reads an
  entitlement only on those two branches, so a grant of free, followers-only,
  team-only or course-only content would open nothing; it is refused with a
  422. The rule is `isGrantableContent` (`@codex/constants`), which the Studio's
  pickers use too.
- **What a grant does.** The access decision honours it wherever it honours a
  `content_purchase` entitlement, and, like a purchase, it survives
  unpublication. The library lists it with the purchases. It is not a
  purchase: it adds nothing to sales or revenue.
- **What a revoke touches.** Only that grant. It must match the id, the
  customer, the organisation and `source = 'grant'`; anything else, such as a
  purchase entitlement or another organisation's grant, is a 404. A purchase of
  the same item keeps granting.
- **When access ends.** The next access decision denies the item. A revoke does
  not write the `revoked:user:` block, because that block would also cut the
  customer off from everything else they hold in the organisation (the rule
  for a course-plan refund, `Codex-2hxff.10`). A stream URL already issued
  plays until it expires, within 600 seconds.
- **No email** is sent for a grant or a revoke; support tells the customer.
- **Caches.** Both bump the customer's library version (`invalidateUserLibrary`).
  The access decision is read live, so nothing else is cached.

## The library

A person's library lists everything they can access through purchases,
entitlements (including grants and courses) and subscriptions. A live support
grant is listed with the purchases, under the `purchased` filter; an item both
bought and granted is listed once. Content under an open dispute is hidden —
**gap**: `Codex-2hxff.9`. Purchase history (`GET /purchases`) lists content and
course purchases.

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
