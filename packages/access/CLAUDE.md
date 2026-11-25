# @codex/access

Content access control, signed URL generation, and playback progress tracking. Co-deployed with content-api worker because it requires direct R2 access.

**Rules for what grants and removes paid access — sources, revocation, the streaming block list, cache invalidation — are in [docs/payments/access.md](../../docs/payments/access.md).** `content_access` is NOT an access source; never add a reader.

## Key Exports

```typescript
import { ContentAccessService, createContentAccessService } from '@codex/access';
import { AccessDeniedError, ContentNotFoundError, R2SigningError } from '@codex/access';
import { PlanAccessService } from '@codex/access'; // ctx.services.planAccess
```

`PlanAccessService` (Codex-2hxff.91) is the Studio's tier checklist: `getAccessSummary`, `getDeleteImpact`, `listTierItems`, `setTierItems` (an idempotent delta, one `dbWs` transaction: eligibility, payouts for PUBLISHED adds, a paid film's switch turned on, `closedNow`) and `afterTierAccessChange` (catalogue + subscriber library bumps). Studio-only and uncached; organization-api's `tiers.ts` routes call it. It is one of the three writers of `content_tier_access` (with `@codex/content`'s `content-tier-access.ts` and `TierService`).

## `ContentAccessService`

### Constructor

```typescript
const service = new ContentAccessService({
  db,
  environment,
  r2,              // R2Signer: R2Service (prod) or DevR2Signer (dev)
  purchaseService, // the purchase read: the registry passes its PurchaseService; only verifyPurchase is called
});
```

In dev, `DevR2Signer` returns unsigned dev-cdn URLs. In production, uses `R2Service` with AWS SigV4.

### Factory

```typescript
const { service, cleanup } = createContentAccessService(env);
// Builds DB, R2 and the purchase read (+ optional revocation, contentApiBaseUrl, hlsTokenSecret) from env bindings; await cleanup() to close the DB client.
// The read is @codex/purchase's verifyPurchase(db, …), never a PurchaseService: its money dependencies (fees, mailers, Stripe) are required, and content-api has no Stripe secret (rule A8, Codex-2hxff.55).
```

### Methods

| Method | Signature | Notes |
|---|---|---|
| `getStreamingUrl` | `(userId: string, input: GetStreamingUrlInput, options?: { includeBody?: boolean })` | Verifies access (KV revocation short-circuit first when wired). For video/audio returns an HLS master-playlist PROXY URL on the content-api origin carrying a signed HLS token; `streamingUrl` is `null` for written content. The waveform is a presigned R2 URL. Returns `{ streamingUrl, waveformUrl, expiresAt, contentType, readyVariants?, body? }`. `body` (`{ contentBody, contentBodyJson }`) only with `includeBody`, taken from the row the access decision read, after it granted: the detail pages' body for a gated piece (Codex-039vo). A row never released is granted to no one (Codex-nacky), so it needs no check of its own. A deleted organisation's content is a `ContentNotFoundError`, before the decision (Codex-7ncbh). |
| `getWithdrawnContent` | `(userId: string, query: WithdrawnContentQuery)` | An item withdrawn from sale that this reader still has, by its detail URL's key: `{ orgId, slug }` or a personal piece's `{ creatorId, slug }` (Codex-ov2ii). Only a row released once (`publishedAt` set), not published now, not deleted, in a live org. Same revocation check, read-only snapshot and `decideContentAccess` as `getStreamingUrl`, through `resolveContentGrant`. Returns `{ content, held }`: the public row's shape with NO body (that is `/stream?include=body`'s) and `held: { by: 'purchase' \| 'entitlement' \| 'course' \| 'subscription', until }` from the arm that granted (`until`: the granting subscription's period end, always set for `subscription`, null for any other hold). Every miss (no row, deleted org, revoked, denied) is the SAME `ContentNotFoundError`, keyed on the slug the caller sent, so a reader without access never learns the item exists. |
| `savePlaybackProgress` | `(userId: string, input: SavePlaybackProgressInput)` | Upserts position/duration. Auto-marks `completed = true` at 95% (`VIDEO_PROGRESS` constant). |
| `getPlaybackProgress` | `(userId: string, input: GetPlaybackProgressInput)` | Returns `{ positionSeconds, durationSeconds, completed, updatedAt }` or null. |
| `listUserLibrary` | `(userId: string, input: ListUserLibraryInput)` | Paginated library: purchased + membership + subscription + free-relationship + followers-relationship content (five parallel arms). Includes progress data and journey provenance. |

## Access Decision Logic

`getStreamingUrl()` (via `assertStreamingAccess` → `decideContentAccess` in `services/content-access/access-decision.ts`) branches by the content's access-policy flags — `courseOnly`, `isTeamOnly`, `isFollowerGated`, `isTierGated`, `priceCents > 0` — inside a read-only transaction:

| accessType | Granted when |
|---|---|
| `team` | User has a management role in the org (owner / admin / creator). |
| `followers` | User has an **active subscription** to the org **or** follows the org **or** has a management role. |
| `subscribers` (`isTierGated` on) | Active subscription on one of the tiers TICKED for the content (`content_tier_access`, a set: a dearer tier is not implied) **or** a completed purchase **or** a stored entitlement **or** an owned course **or** a management role. With NO tier ticked the item is CLOSED: no subscriber reaches it, and it never falls through to free. |
| paid (`priceCents > 0`, no tier) | User has a completed purchase **or** a stored entitlement **or** an owned course **or** a management role. A subscription alone does NOT unlock paid content. |
| `free` / `null` (no price) | Granted — subject only to content being non-deleted AND published. This is the one arm where publication still gates everyone, because `free` does not survive unpublication (see below). |

Content must be non-deleted. A soft-deleted row → `ContentNotFoundError` (404);
granted-but-unauthorized paths map to `AccessDeniedError` (403).

### Why a stream is refused (`AccessDeniedError.context.reason`)

The KV block answers first and carries its own `RevocationReason`. Otherwise
the reason is the decision's `DenyReason`, unless `disputeHold` (deny path only)
finds an open payment dispute behind the refusal (Codex-2hxff.60). It names
only a grant the decision's branch reads and a win would give back:
- `'purchase_dispute'`: a completed purchase of the item with `disputed_at`
  set, where the branch reads a purchase (tier-gated or paid); or a completed
  course purchase with `disputed_at` set, for a course holding the item, where
  the branch reads the course arm (course-only, tier-gated or paid).
- `'subscription_dispute'`: a tier-gated or followers-only item that a
  subscription would grant but for its `disputed_at` (publication rule
  included); or, through the course arm, a course grant held back by a
  disputed course subscription (`grantNotPausedByDispute`) or by a disputed
  tier subscription's `course_tier_access`.
- Team-only, an orgless tier gate, a follow and a subscription below the
  item's tier explain nothing. A won course dispute plays; a lost one shows
  the course gate.

The web shows "Access paused" with no Buy button for either. The context is
client-facing: it names the kind of dispute only, never a date, amount or
reason. Chargeback writers use the same two values in the KV block; a lost
dispute writes `'refund'`. If `disputeHold` throws, the refusal keeps the
decision's own reason and the failure is logged at error: the lookup only
picks the copy.

**One predicate for the card and the page.** `resolveDisputePause(deps,
userId, contentId)` runs the decision and, on a denial, `disputeHold`. The
library keeps a disputed purchase's paused mark only when it returns a hold,
so the card is dimmed exactly when the page shows the notice. If it throws,
the row keeps its mark and the failure is logged at error.

The course shelf has the same guarantee. `listEnrolledCourses` sets each
entry's `disputeHold` from `resolveCourseDisputePauses`, which reads the
same held course grants (`courseGrantsHeldByDispute`) the lesson's course arm
reads, and pauses a course only while the user holds no live grant to it and
no staff role in the organisation. That is exactly when its course-only
lessons show the notice. A lesson in two courses can still open through the
other one; the card speaks for its own course. If the read fails, the shelf
loads unpaused and the failure is logged at error.

The course page asks the same predicate: `getCourseEntry` (GET
`/api/access/courses/:courseId/can-enter`, `CourseEntryResponse`) returns
`canEnterCourse` unchanged plus `disputeHold`, computed only when entry is
refused, so a granted call costs nothing more. A failed lookup logs at error
and returns `disputeHold: null`. `canEnterCourse` itself has no staff bypass;
a staff role only means the course is never shown paused.

**The 20-minute block (owner decision Q2).** The KV block is written for the
buyer's whole organisation, and for every disputed content purchase, because
`accessEnded` only asks whether another completed purchase keeps the item.
So for up to 20 minutes the stream refuses, with the dispute reason, an item
the decision would still grant, a disputed item that a subscription, a support
grant or a staff role covers included, while the library shows that item
playable. After the block expires, the decision answers and plays it.

### Publication vs entitlement (Codex-p3m5j)

Content does NOT have to be **published**. Owner decision, 2026-09-23: *a one-off
purchase outlives unpublication; a relationship does not.* A one-off payment (or
a per-person `grant` entitlement standing in for one) BUYS that item, whereas
a subscription, a follow, a free listing or a staff role grants access **while
the item is on offer**. Unpublishing withdraws the offer; it does not undo a sale.

The rule lives in ONE place — `decideContentAccess` in
`services/content-access/access-decision.ts` — as a post-filter on which arm
granted, so both the boolean and streaming adapters inherit it. Neither
self-fetch filters on `content.status` any more; both still filter
`isNull(deletedAt)`.

The table below applies only to a row RELEASED once: published now, or
`publishedAt` set (the course player's curriculum read and the withdrawn-item
read use the same rule in SQL). A row never released was never sold, so the
rule denies it to EVERY arm with `never_released`, the `true` ones included
(Codex-nacky): an editor may put a draft practice in a curriculum, and its
course's buyers must not stream it by id. `disputeHold` returns `null` for such
a row, so its refusal is never named a paused dispute. Note that
`publishedAt` IS cleared in one place: migration 0004's
`trigger_unpublish_on_org_delete` sets `status` draft and nulls `published_at`
when `organization_id` goes to NULL (an org hard-delete's cascade), so such a
row reads as never released.

A **deleted organisation's** content is gone to every arm, like a deleted item
(owner decision, 2026-10-25: "Nobody"; Codex-7ncbh). Soft-deleting an org leaves
its content, courses and entitlements in place, so every read that opens or
lists content asks the org itself:
- the content self-fetches, via `isOfDeletedOrg`: `findPolicyRow` (false on
  the boolean path, a `null` library pause) and `getStreamingUrl`'s KV
  revocation pre-check and transaction read (a `ContentNotFoundError`), each
  before the decision, any dispute lookup and any revocation answer.
  `getWithdrawnContent` answers its revocation check first, but with the same
  uniform 404, so the order is not observable there;
- the library listing (`buildContentFilters`, an `orgIsLive`-style
  anti-join), so the item leaves the shelf rather than linger as a card that
  404s;
- `CourseJourneyService.loadCourseSummaryById`, so a deleted org's course
  dashboard and in-course player both answer `null`: a written practice
  reaches its reader through that read alone, with no stream to refuse it.

Not yet covered, and tracked by Codex-62chf: the course-level public and shelf
reads (`getCoursePage`, `getCourseBySlug`, `getCourseSellPreview`,
`getContentCourses`, the published and enrolled lists) and
`hasCourseEntitlement`. They expose no body and no signed stream, and the web
never reaches them for a deleted org (its site no longer resolves).

`isOfDeletedOrg` takes `organization` as a REQUIRED key, so a self-fetch that
forgets the `with` fails to compile rather than reading every org as live.

| Grant arm | Survives unpublication |
|---|---|
| `paid_purchase`, `paid_entitlement`, `subscribers_purchase`, `subscribers_entitlement` | **yes** — they paid for this item |
| `course`, `paid_course`, `subscribers_course` | **yes** — they bought the course it sits in (course-level equivalent: Codex-yo4px) |
| `free`, `followers_follower` | no — access lasts while it is on offer |
| `followers_subscription`, `subscribers_subscription` | no — EXCEPT an item stamped `offSaleAt` (its creator left the org, Codex-2hxff.64): kept until the subscriber's next renewal, i.e. while `offSaleAt >= currentPeriodStart` of the granting subscription |
| every `*_management` arm | no — unchanged from before; creators preview drafts via the studio, not a signed stream |

`GRANT_SURVIVES_UNPUBLICATION` is a `Record<GrantVia, boolean>`, not a `Set`, so
adding a grant arm **fails the build** until someone classifies it. Do not
convert it to a `Set`: a new arm would silently default to "does not survive",
which is the safe direction but also the silent one, and this table is a
commercial commitment.

The same renewal rule applies wherever a subscription reaches an off-sale item:
tier-derived course entry (`hasDerivedCourseTierAccess` and
`resolveCourseEntitlementsBatch` join `courses` and require
`off_sale_at IS NULL OR off_sale_at >= current_period_start`), and the
library's subscription and followers arms. An item with no `offSaleAt` (an
ordinary draft) is untouched by it. Pinned by
`off-sale-access.integration.test.ts`.

An anonymous caller is unaffected: every user-scoped arm evaluates to no-grant,
leaving only `free`, which does not survive — so a draft stays unreadable to the
public.

**Detail pages (Codex-ov2ii).** The grant at the gate was not enough on its
own: both web detail pages found rows only through the published-only public
list, so every reader this table keeps (a buyer, a course owner, a subscriber
until renewal) got "Content not found". `getWithdrawnContent` is that page's
lookup for a signed-in reader. It maps the granting arm to `held`
(`heldFrom`: a subscription grant carries its period, and `HELD_BY` is
exhaustive over every other arm like the table above; the arms that do not
survive map to null and fail closed), so the note a reader sees can never give
a reason the gate did not use. Staff arms do not survive, so the team keeps
the 404 on a public URL and previews in the studio. Subscription grants carry
`periodStart` AND `periodEnd`: the renewal rule reads the start, the note the
end. Pinned by `content-access-service-withdrawn.test.ts` (decision, identical
404s) and `content-access-withdrawn.integration.test.ts` (the lookup's WHERE).

### Access hierarchy (Codex-xybr3)

The platform's access hierarchy is **`subscribers ⊇ followers ⊇ public`**. An active subscription to the content's org grants followers-only access without requiring a follower row. Tier-gated (subscribers-only) content is **orthogonal** to this hierarchy — a subscription does NOT automatically unlock tier-gated content unless the subscriber's tier is one of the content's ticked tiers.

Inside the followers branch, checks run in this order:

1. **Subscription** — `status IN ACCESS_GRANTING_SUBSCRIPTION_STATUSES` (active, cancelling, and `past_due` while Stripe retries a failed renewal — `@codex/constants`) AND `disputed_at IS NULL` AND `currentPeriodEnd > now()`. Any tier qualifies (followers-only content has no tier gate at all). Paused / cancelled / expired subscriptions are filtered out. On grant, `obs.info` emits `reason='followers_content_granted_via_subscription'` so analytics can distinguish the subscription-driven path from an explicit follow.
2. **Follower row** — fallback so ex-subscribers (status=cancelled) who are still following continue to see the content.
3. **Management membership** — owner/admin/creator implicitly bypass the gate.

**The decision reads ticks, not tiers (Codex-2hxff.91).** `findGrantingSubscription` is ONE subscriptions read whose `where` carries `tier_id IN (SELECT tier_id FROM content_tier_access WHERE content_id = $c AND organization_id = $org)`. No tier row, `sortOrder` or `deletedAt` is read. A tier's soft delete sweeps its ticks in the same transaction, so an archived tier opens nothing; the legacy column `included_in_tier_id` is never read here (the rename guard test in `@codex/content` fails if a new reader appears).

**Raw SQL inside a relational query names its columns as text.** Drizzle's `db.query.X.findFirst/findMany` rewrites EVERY drizzle column in its `where` to the ROOT table's alias: `${contentTierAccess.tierId}` inside the subscriptions read rendered as `"subscriptions"."tier_id"` (42703). The tick subqueries therefore alias the table (`content_tier_access cta`) and write `cta.tier_id`. Mock-db suites cannot see this; only the DB-backed suites do.

## Library Query

`listUserLibrary()` runs five independent query arms in parallel:
- `queryPurchased` — content with completed purchases, unioned with live support grants (`entitlements.source = 'grant'`); an item both bought and granted is one row. A purchase with an open chargeback stays listed with `purchase.disputedAt` set (Codex-2hxff.60), paused, only while `resolveDisputePause` names a hold: the mark is cleared when the item still opens (a covering subscription, a support grant, a staff role, an owned course) or is refused for a reason no dispute explains (say it became course-only). That costs one access decision per disputed row. The undim is decided at fetch time, so it stays cached on the client until the next library version bump: a covering grant that lapses by its `expiresAt` bumps nothing, and the card stays undimmed while the stream refuses. A lost dispute is `refunded` and leaves. `purchase.disputedAt` is `null` for a grant. No second-copy check: `uq_purchases_completed_customer_content` allows one completed purchase per item
- `queryMembership` — content accessible via org membership
- `querySubscription` — content behind the tier switch (`isTierGated`, not `courseOnly`) ticked for the subscription's own tier: the same ticks the decision reads
- `queryFreeRelationship` — `isFree` content of followed/subscribed orgs
- `queryFollowersRelationship` — `isFollowerGated` content of followed/subscribed orgs

Results are merged, deduplicated, and enriched with progress data.

## Custom Errors

| Error | HTTP | When |
|---|---|---|
| `AccessDeniedError` | 403 | User has no valid access path to paid content |
| `ContentNotFoundError` | 404 | Content doesn't exist or is deleted (a draft is not a 404: see Access Decision Logic) |
| `MediaNotReadyForStreamingError` | 422 | Content has no associated media item |
| `R2SigningError` | 500 | Failed to generate signed URL |
| `InvalidContentTypeError` | 500 | Unexpected media type |

## Rules

- **MUST** check access before generating signed URLs — never generate URLs without access verification
- **MUST** scope all library and progress queries to the authenticated `userId`
- **MUST** keep the `isNull(deletedAt)` filter on every content self-fetch — deleted is gone, not withdrawn
- **MUST** keep the org's `deletedAt` read (`with: { organization: { columns: { deletedAt: true } } }` + `isOfDeletedOrg`) on those self-fetches — a deleted org's content is gone too (Codex-7ncbh). The stub suites cannot see a dropped `with`; `content-access-unpublished-purchase.test.ts` asserts the fetch asks for it
- **MUST NOT** re-add a `content.status` predicate to those self-fetches. It would 404 a buyer before their purchase is considered, and silently make the publication rule dead code. Pinned by `content-access-unpublished-purchase.test.ts`, which inspects the WHERE the code actually builds
- **NEVER** expose raw R2 keys or bucket names to clients — only return signed URLs
- Access check uses a transaction for snapshot consistency

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/cloudflare-clients` (R2), `@codex/purchase`, `@codex/constants`
- **Used by**: content-api worker (port 4001) — co-deployed because signed URL generation needs direct R2 binding

## Reference Files

- `packages/access/src/services/ContentAccessService.ts`
- `packages/access/src/constants.ts` — `LOG_EVENTS`, `LOG_SEVERITY`
