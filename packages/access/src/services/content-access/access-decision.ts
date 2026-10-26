/**
 * Content access-decision logic for ContentAccessService.
 *
 * # The single collapsed resolver (Codex-2pryk.2.3 · WP-2)
 *
 * WP-1 (Codex-2pryk.1.1) split the access decision into two behaviour-preserving
 * trees so this collapse would be tractable. WP-2 collapses them: there is now
 * ONE decision core — {@link decideContentAccess} — and the two historical
 * entry points are thin adapters over it:
 *
 *   - {@link resolveHasContentAccess} — the BOOLEAN adapter (backs
 *     `ContentAccessService.canView` / `hasContentAccess`). Self-fetches the
 *     content row, returns `true`/`false`, never signs URLs, never throws on a
 *     plain denial.
 *   - {@link assertStreamingAccess} — the THROWING adapter (backs
 *     `getStreamingUrl`). Runs against the read-only transaction snapshot, logs
 *     the security-relevant denial, and throws `AccessDeniedError`.
 *
 * Both call the SAME core, so a boolean `canView` and the streaming gate can
 * never disagree — the J4 "shared seam" guarantee at the service layer.
 *
 * ## What the core decides (SPEC §6.1/§6.3 + HARDENING §C/§B.6)
 *
 * The core folds the 7 per-content policy flags (`isFree` / `isPurchasable` +
 * `priceCents` / `includedInTierId` / `courseOnly` / `isFollowerGated` /
 * `isTeamOnly`) together with the live grant sources:
 *   - `PurchaseService.verifyPurchase` (the authoritative content-purchase read),
 *   - the STORED `entitlements` grants (`content_purchase` / `grant`) — additive,
 *     forward-compatible with WP-6 (empty until it writes; see entitlements-resolver.ts),
 *   - the DERIVED subscription-tier grant (`includedInTierId` "this tier and above"),
 *   - and the "reachable via a course you own" arm (`courseOnly` + fallthrough).
 *
 * Precedence is preserved from WP-1 EXACTLY — team > followers > tier > paid >
 * free — because the 185-case integration suite pins query ORDER (e.g. the
 * management-role bypass is a per-branch FALLBACK checked AFTER the primary
 * purchase/subscription read, never a global short-circuit; a global bypass would
 * skip `verifyPurchase` and break the call-count assertions). The two arms the
 * SPEC pseudocode omits but live code requires (HARDENING §B.6) are kept: the
 * management-role bypass and the orgless-content-with-tier fail-closed deny
 * (Codex-up7bx). `courseOnly` suppresses every standalone path (reachable only via
 * a course entitlement, plus the management bypass).
 */

import {
  ACCESS_GRANTING_SUBSCRIPTION_STATUSES,
  CONTENT_STATUS,
  ORGANIZATION_ROLES,
  PURCHASE_STATUS,
} from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import {
  content,
  courses,
  organizationFollowers,
  organizationMemberships,
  purchases,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import type { ObservabilityClient } from '@codex/observability';
import type { PurchaseService } from '@codex/purchase';
import { and, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { LOG_EVENTS, LOG_SEVERITY } from '../../constants';
import { AccessDeniedError } from '../../errors';
import type { RevocationReason } from '../access-revocation';
import {
  type AccessQueryClient,
  contentReachableViaOwnedCourse,
  courseGrantHeldByDispute,
  courseGrantsHeldByDispute,
  type HeldCourseGrant,
  hasStoredContentEntitlement,
  resolveCourseEntitlementsBatch,
} from './entitlements-resolver';

/**
 * Transaction client type — derived from the DB client's `transaction` method
 * so the streaming-access tree can run against a read-only snapshot without
 * an `as any` cast (`feedback_tx_callback_type_derivation`).
 */
type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/**
 * Only owner/admin/creator roles bypass payment requirements. Regular
 * 'member' and 'subscriber' roles must purchase or subscribe to access
 * paid/subscriber content.
 */
const MANAGEMENT_ROLES: string[] = [
  ORGANIZATION_ROLES.OWNER,
  ORGANIZATION_ROLES.ADMIN,
  ORGANIZATION_ROLES.CREATOR,
];

/** The per-content access-policy flags the decision core reads (SPEC §6.1). */
export interface ContentAccessPolicyRow {
  organizationId: string | null;
  /**
   * `content.status`. Read by the publication rule in `decideContentAccess`
   * (Codex-p3m5j) — a one-off PURCHASE outlives unpublication, a relationship
   * does not — so the access layer needs it, not just the fetch predicate.
   */
  status: string;
  /**
   * When the item was first published; kept when it is unpublished. Read by
   * the publication rule (Codex-nacky): a row that is not published now and
   * never was is a draft that was never offered, so no grant reaches it.
   */
  publishedAt: Date | null;
  isFree: boolean;
  isPurchasable: boolean;
  priceCents: number | null;
  includedInTierId: string | null;
  isFollowerGated: boolean;
  isTeamOnly: boolean;
  courseOnly: boolean;
  /**
   * When the item was taken off sale because its creator left the
   * organisation (Codex-2hxff.64). Read by the renewal rule in
   * `decideContentAccess`; `null` for everything else, including ordinary
   * drafts, which the rule therefore leaves alone.
   */
  offSaleAt: Date | null;
}

/**
 * Content fields the streaming-access adapter reads. Superset of the boolean
 * adapter's whitelist; kept as an alias so `getStreamingUrl`'s already-fetched
 * full row satisfies it structurally.
 */
export type StreamingAccessContent = ContentAccessPolicyRow;

/** Reason codes for a denial — logged, and threaded into `AccessDeniedError`. */
export type DenyReason =
  | 'orgless_tier_gate'
  | 'course_only'
  | 'team_only'
  | 'team_only_requires_org'
  | 'followers_only'
  | 'followers_only_requires_org'
  | 'subscribers_only'
  | 'subscribers_only_requires_org'
  | 'paid'
  | 'paid_requires_purchase'
  /** Content is not published and the grant was not one someone paid for. */
  | 'unpublished_requires_purchase'
  /** Content was never published: a draft never offered, open to no arm. */
  | 'never_released';

/**
 * Which arm granted — the streaming adapter maps this to the WP-1 grant log
 * (preserved because the observability suite pins the follower grant messages;
 * see content-access-service-followers-subscription.test.ts), and the
 * withdrawn read to how its reader holds the item (Codex-ov2ii).
 */
export type GrantVia =
  | 'free'
  | 'course'
  | 'management'
  | 'team_management'
  | 'followers_subscription'
  | 'followers_follower'
  | 'followers_management'
  | 'subscribers_subscription'
  | 'subscribers_purchase'
  | 'subscribers_entitlement'
  | 'subscribers_course'
  | 'subscribers_management'
  | 'paid_purchase'
  | 'paid_entitlement'
  | 'paid_course'
  | 'paid_management';

/** The two arms granted by a subscription the user is paying for. */
export type SubscriptionGrantVia =
  | 'followers_subscription'
  | 'subscribers_subscription';

/**
 * A subscription grant carries the granting subscription's period. The
 * renewal rule in `decideContentAccess` compares its start with the item's
 * `offSaleAt`; its end is when a withdrawn item stops being covered, which the
 * detail page tells the reader (Codex-ov2ii). Typed as its own variant so a
 * subscription arm cannot be granted without them.
 */
type AccessDecision =
  | { granted: true; via: Exclude<GrantVia, SubscriptionGrantVia> }
  | {
      granted: true;
      via: SubscriptionGrantVia;
      periodStart: Date;
      periodEnd: Date;
    }
  | { granted: false; reason: DenyReason };

/** A granted decision: the arm that granted, and a subscription's period. */
export type AccessGrant = Extract<AccessDecision, { granted: true }>;

const grant = (
  via: Exclude<GrantVia, SubscriptionGrantVia>
): AccessDecision => ({
  granted: true,
  via,
});
const grantBySubscription = (
  via: SubscriptionGrantVia,
  period: { currentPeriodStart: Date; currentPeriodEnd: Date }
): AccessDecision => ({
  granted: true,
  via,
  periodStart: period.currentPeriodStart,
  periodEnd: period.currentPeriodEnd,
});
const deny = (reason: DenyReason): AccessDecision => ({
  granted: false,
  reason,
});

/**
 * The user's subscription to `orgId` that meets the content's minimum tier (by
 * sortOrder), or `null`. `minimumTierId === null` → any subscription qualifies
 * (community gate). Returns the subscription's `currentPeriodStart`, which the
 * renewal rule in `decideContentAccess` reads, and its `currentPeriodEnd`,
 * which a withdrawn item's note reads.
 *
 * `disputed` picks the side of the dispute pause it reads. The decision reads
 * `false`: a subscription is paused while a chargeback on one of its invoices
 * is open. {@link disputeHold} reads `true`, to say why a refusal is one.
 */
async function findGrantingSubscription(
  db: AccessQueryClient,
  userId: string,
  orgId: string,
  minimumTierId: string | null,
  disputed: boolean
): Promise<{ currentPeriodStart: Date; currentPeriodEnd: Date } | null> {
  const userSub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.organizationId, orgId),
      inArray(subscriptions.status, [...ACCESS_GRANTING_SUBSCRIPTION_STATUSES]),
      disputed
        ? isNotNull(subscriptions.disputedAt)
        : isNull(subscriptions.disputedAt),
      gt(subscriptions.currentPeriodEnd, new Date())
    ),
    with: { tier: true },
  });
  if (!userSub) return null;
  if (!minimumTierId) return userSub;
  const contentTier = await db.query.subscriptionTiers.findFirst({
    where: eq(subscriptionTiers.id, minimumTierId),
    columns: { sortOrder: true },
  });
  if (!contentTier) return null;
  return userSub.tier.sortOrder >= contentTier.sortOrder ? userSub : null;
}

/**
 * THE decision core — pure (no logging, no throw, no URL signing). Returns a
 * grant or a reasoned denial for the (userId, content) pair. `userId` is `null`
 * for anonymous visitors (public sales pages / free content) — every user-scoped
 * grant source then evaluates to "no grant", so only free content (and the
 * WP-1-preserving free fallthrough) is viewable.
 *
 * Runs against any query client — the base `db` (boolean path) or a read-only
 * `tx` (streaming path). `verifyPurchase` uses the PurchaseService's own db, as
 * in WP-1.
 */
async function decidePolicyAccess(
  deps: { db: AccessQueryClient; purchaseService: PurchaseService },
  userId: string | null,
  contentId: string,
  policy: ContentAccessPolicyRow
): Promise<AccessDecision> {
  const { db, purchaseService } = deps;
  const orgId = policy.organizationId;

  // Fail-closed guard: orgless content can never tier-gate (Codex-up7bx).
  // `subscription_tiers` is org-scoped, so a `includedInTierId` on content with
  // NO `organizationId` is a semantically invalid row — deny before any branch.
  if (orgId == null && policy.includedInTierId != null) {
    return deny('orgless_tier_gate');
  }

  // User-scoped grant helpers. All return false for an anonymous (null) user.
  const hasManagementMembership = async (): Promise<boolean> => {
    if (userId == null || orgId == null) return false;
    const row = await db.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.organizationId, orgId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, 'active'),
        inArray(organizationMemberships.role, MANAGEMENT_ROLES)
      ),
      columns: { id: true },
    });
    return !!row;
  };

  const hasFollower = async (): Promise<boolean> => {
    if (userId == null || orgId == null) return false;
    const row = await db.query.organizationFollowers.findFirst({
      where: and(
        eq(organizationFollowers.organizationId, orgId),
        eq(organizationFollowers.userId, userId)
      ),
      columns: { id: true },
    });
    return !!row;
  };

  // The GRANTING subscription, or `null` when none grants. One that a
  // chargeback holds back grants nothing.
  const grantingSubscription = async (
    minimumTierId: string | null
  ): Promise<{ currentPeriodStart: Date; currentPeriodEnd: Date } | null> => {
    if (userId == null || orgId == null) return null;
    return findGrantingSubscription(db, userId, orgId, minimumTierId, false);
  };

  const verifyPurchase = async (): Promise<boolean> => {
    if (userId == null) return false;
    return purchaseService.verifyPurchase(contentId, userId);
  };

  const viaOwnedCourse = async (): Promise<boolean> => {
    if (userId == null) return false;
    return contentReachableViaOwnedCourse(db, userId, contentId);
  };

  const viaContentEntitlement = async (): Promise<boolean> => {
    if (userId == null) return false;
    return hasStoredContentEntitlement(db, userId, contentId);
  };

  // ── courseOnly — suppresses EVERY standalone path (SPEC §6.1). Reachable only
  // via a course entitlement; the management bypass still applies (sees all org
  // content). Placed before the standalone flag branches so it wins "regardless
  // of the other flags".
  if (policy.courseOnly) {
    if (await viaOwnedCourse()) return grant('course');
    if (await hasManagementMembership()) return grant('management');
    return deny('course_only');
  }

  // ── team-only — management role only (WP-1). ──────────────────────────────
  if (policy.isTeamOnly) {
    if (!orgId) return deny('team_only_requires_org');
    return (await hasManagementMembership())
      ? grant('team_management')
      : deny('team_only');
  }

  // ── followers-only — active subscription OR follower row OR management. ────
  // (Codex-xybr3: subscribers ⊇ followers.) Checked SEQUENTIALLY, subscription
  // FIRST: an active subscriber is granted without the follower lookup ever
  // running (the short-circuit the WP-1 streaming tree + its observability suite
  // pin). Then the follower fallback (ex-subscribers with a live follow), then
  // the management bypass.
  if (policy.isFollowerGated) {
    if (!orgId) return deny('followers_only_requires_org');
    const sub = await grantingSubscription(null);
    if (sub) return grantBySubscription('followers_subscription', sub);
    if (await hasFollower()) return grant('followers_follower');
    return (await hasManagementMembership())
      ? grant('followers_management')
      : deny('followers_only');
  }

  // ── tier-gated (subscribers) — includedInTierId set (orgId guaranteed by the
  // orgless guard above). Subscription + purchase are independent → parallel;
  // then the additive entitlements-table grant and the "via a course you own"
  // arm; then management fallback.
  if (policy.includedInTierId != null) {
    if (!orgId) return deny('subscribers_only_requires_org');
    const [sub, purchased] = await Promise.all([
      grantingSubscription(policy.includedInTierId),
      verifyPurchase(),
    ]);
    // Once the item is off offer, only some grants outlive that (see
    // GRANT_SURVIVES_UNPUBLICATION), and a subscription's ends at renewal.
    // So an unpublished item tries every arm that survives BEFORE the
    // subscription: a subscriber who also bought it keeps it (owner, "one-off
    // buyers keep what they bought"; Codex-2hxff.64). On offer, the
    // subscription still answers first, as before.
    const onOffer = policy.status === CONTENT_STATUS.PUBLISHED;
    if (sub && onOffer)
      return grantBySubscription('subscribers_subscription', sub);
    if (purchased) return grant('subscribers_purchase');
    if (await viaContentEntitlement()) return grant('subscribers_entitlement');
    if (await viaOwnedCourse()) return grant('subscribers_course');
    if (sub) return grantBySubscription('subscribers_subscription', sub);
    return (await hasManagementMembership())
      ? grant('subscribers_management')
      : deny('subscribers_only');
  }

  // ── paid (priceCents > 0, no tier) — purchase first (WP-1), then the additive
  // entitlements-table grant and via-course arm, then management fallback.
  if ((policy.priceCents ?? 0) > 0) {
    if (await verifyPurchase()) return grant('paid_purchase');
    if (await viaContentEntitlement()) return grant('paid_entitlement');
    if (await viaOwnedCourse()) return grant('paid_course');
    if (!orgId) return deny('paid_requires_purchase');
    return (await hasManagementMembership())
      ? grant('paid_management')
      : deny('paid');
  }

  // ── free / fallthrough — WP-1 granted here (free content, no price). ───────
  return grant('free');
}

/**
 * Does this grant arm outlive UNPUBLICATION of the content? (Codex-p3m5j)
 *
 * Owner decision, 2026-09-23: **someone who purchased a one-off keeps it.**
 * The principle that separates the two columns below is ownership vs
 * relationship — a one-off payment (or a per-person grant standing in for one)
 * BUYS that item, whereas a subscription, a follow, a free listing or a staff
 * role grants access *while the item is on offer*. Unpublishing withdraws the
 * offer; it does not undo a sale.
 *
 * So the table is read only for an item withdrawn after it was RELEASED. A
 * row never published was never sold, and no arm reaches it, `true` or not
 * (Codex-nacky): an editor may put a draft practice in a curriculum before it
 * publishes, and its course's buyers must not stream it by id.
 *
 * Deliberately a `Record<GrantVia, boolean>` and not a `Set`: it is
 * exhaustiveness-checked, so adding a grant arm to {@link GrantVia} FAILS THE
 * BUILD until someone classifies it. A `Set` would silently default a new arm
 * to "does not survive", which is the safe direction but also the silent one —
 * and this table is a commercial commitment, not an implementation detail.
 *
 * Note what is deliberately `false`: every `*_management` arm. Streaming an
 * unpublished item already 404s for staff today (the status predicate applied
 * to everyone), so keeping them out preserves existing behaviour rather than
 * quietly widening it. Creators preview drafts through the studio, not here.
 */
const GRANT_SURVIVES_UNPUBLICATION: Record<GrantVia, boolean> = {
  // ── PURCHASED: a one-off payment, or a per-person entitlement row. Both
  // `purchases` and `content_access` are written per (user, content) — by
  // PurchaseService on checkout, and by admin customer-management as a comp or
  // refund stand-in. Neither recurs, so both are "they own this".
  paid_purchase: true,
  paid_entitlement: true,
  subscribers_purchase: true,
  subscribers_entitlement: true,

  // ── PURCHASED A CONTAINER: they bought the course this item sits in. The
  // course-level equivalent of this rule is Codex-yo4px, which stopped an
  // unpublished course leaving the buyer's shelf; this is the same promise one
  // level down, for an individual practice withdrawn from a bought curriculum.
  course: true,
  paid_course: true,
  subscribers_course: true,

  // ── RELATIONSHIP: access for as long as the item is on offer. A cancelled
  // subscriber does not keep the back catalogue, and unpublishing is the
  // creator withdrawing the offer. The two `*_subscription` arms have ONE
  // exception, decided before this table is read: an item taken off sale
  // because its creator left stays until the subscriber's next renewal (see
  // `subscriptionCoversOffSaleItem`).
  free: false,
  followers_subscription: false,
  followers_follower: false,
  subscribers_subscription: false,

  // ── STAFF: publication state is theirs to manage; see the docblock.
  management: false,
  team_management: false,
  followers_management: false,
  subscribers_management: false,
  paid_management: false,
};

/**
 * Does a subscription grant still cover an item that is no longer published?
 * (Codex-2hxff.64)
 *
 * Owner decision, 2026-10-21: when a creator leaves an organisation, their
 * published catalogue there is archived and stamped `offSaleAt`. A subscriber
 * already PAID for the period in which that happened, so they keep the item
 * until their next renewal: covered while `offSaleAt >= currentPeriodStart`.
 * A renewal moves `currentPeriodStart` past the stamp, and access ends.
 *
 * Only the two subscription arms qualify. A follow is not a payment, so
 * `followers_follower` stays lost on unpublication. An item with no
 * `offSaleAt` (an ordinary draft, or one the creator archived themselves) is
 * never covered, so that case reaches {@link GRANT_SURVIVES_UNPUBLICATION}
 * exactly as before.
 */
function subscriptionCoversOffSaleItem(
  decision: AccessDecision,
  offSaleAt: Date | null
): boolean {
  if (!decision.granted || !('periodStart' in decision)) return false;
  if (offSaleAt == null) return false;
  return offSaleAt.getTime() >= decision.periodStart.getTime();
}

/**
 * THE decision — the policy branches, then the publication rule.
 *
 * Both adapters route through here, so the rule has exactly one home. The
 * branch body ({@link decidePolicyAccess}) is untouched by it: publication is
 * not another access branch, it is a question asked of whatever the branches
 * decided.
 */
async function decideContentAccess(
  deps: { db: AccessQueryClient; purchaseService: PurchaseService },
  userId: string | null,
  contentId: string,
  policy: ContentAccessPolicyRow
): Promise<AccessDecision> {
  const decision = await decidePolicyAccess(deps, userId, contentId, policy);
  return applyPublicationRule(decision, policy);
}

/**
 * Published now, or once. The course player's curriculum read and the
 * withdrawn-item read use the same rule, in SQL.
 */
function isReleased(policy: ContentAccessPolicyRow): boolean {
  return (
    policy.status === CONTENT_STATUS.PUBLISHED || policy.publishedAt != null
  );
}

/**
 * The publication rule, asked of a decision the policy branches made. Its own
 * function so {@link disputeHold} asks it of the grant a dispute holds back.
 */
function applyPublicationRule(
  decision: AccessDecision,
  policy: ContentAccessPolicyRow
): AccessDecision {
  if (!decision.granted) return decision;
  if (policy.status === CONTENT_STATUS.PUBLISHED) return decision;
  // Also where a SOLD item lands once detached from its org: migration 0004's
  // trigger makes it a draft and nulls published_at. Denied either way
  // (Codex-7ncbh, "Nobody"); read a `never_released` refusal of a buyer as that.
  if (!isReleased(policy)) return deny('never_released');
  if (subscriptionCoversOffSaleItem(decision, policy.offSaleAt)) {
    return decision;
  }

  return GRANT_SURVIVES_UNPUBLICATION[decision.via]
    ? decision
    : deny('unpublished_requires_purchase');
}

/** A refusal that a payment dispute explains (a {@link RevocationReason}). */
export type DisputeHold = Extract<
  RevocationReason,
  'purchase_dispute' | 'subscription_dispute'
>;

/**
 * Is a refused stream refused because of an open payment dispute?
 * (Codex-2hxff.60.) Run on the deny path only, so a grant costs nothing more.
 *
 * The KV block says so for its first 20 minutes, and the hourly dispute
 * reconcile writes no block at all, so the content page's "Access is paused"
 * notice has to come from the database too.
 *
 * Only a grant the policy branch reads, and that a win would give back:
 * - `'purchase_dispute'`: a `completed` purchase of this item carrying
 *   `disputed_at` (the one `verifyPurchase` refuses because of the mark),
 *   where the branch reads a purchase (tier-gated or paid); or a disputed
 *   purchase of a course holding the item, where it reads the course arm
 *   (course-only, tier-gated or paid).
 * - `'subscription_dispute'`: a tier-gated or followers-only item that a
 *   subscription would grant but for its `disputed_at`, publication rule
 *   included; or, through the course arm, a course grant a disputed course
 *   or tier subscription holds back.
 * - `null` otherwise: team-only, an orgless tier gate, a follow, a
 *   subscription below the item's tier, or a row never released, which no
 *   grant reaches, so no dispute explains its refusal (Codex-nacky). A course
 *   grant survives unpublication of a released row, so the course arm needs
 *   no publication rule of its own.
 *
 * Mirrors the branch order of `decidePolicyAccess`. It only picks the copy
 * the page shows; the refusal itself stands either way.
 */
async function disputeHold(
  db: AccessQueryClient,
  userId: string,
  contentId: string,
  policy: ContentAccessPolicyRow
): Promise<DisputeHold | null> {
  if (!isReleased(policy)) return null;
  const orgId = policy.organizationId;
  if (orgId == null && policy.includedInTierId != null) return null;
  if (policy.courseOnly) return courseDisputeHold(db, userId, contentId);
  if (policy.isTeamOnly) return null;

  // The branch `decidePolicyAccess` takes: followers-only before tier-gated.
  const followersOnly = policy.isFollowerGated;
  const tierGated = !followersOnly && policy.includedInTierId != null;
  const paid = !followersOnly && !tierGated && (policy.priceCents ?? 0) > 0;

  if (tierGated || paid) {
    const disputed = await db.query.purchases.findFirst({
      where: and(
        eq(purchases.contentId, contentId),
        eq(purchases.customerId, userId),
        eq(purchases.status, PURCHASE_STATUS.COMPLETED),
        isNotNull(purchases.disputedAt)
      ),
      columns: { id: true },
    });
    if (disputed) return 'purchase_dispute';
  }

  if (orgId != null && (followersOnly || tierGated)) {
    const held = await findGrantingSubscription(
      db,
      userId,
      orgId,
      followersOnly ? null : policy.includedInTierId,
      true
    );
    if (held) {
      const heldGrant = grantBySubscription(
        followersOnly ? 'followers_subscription' : 'subscribers_subscription',
        held
      );
      if (applyPublicationRule(heldGrant, policy).granted) {
        return 'subscription_dispute';
      }
    }
  }

  return tierGated || paid ? courseDisputeHold(db, userId, contentId) : null;
}

/** The course arm's hold: the kind of dispute behind a held course grant. */
async function courseDisputeHold(
  db: AccessQueryClient,
  userId: string,
  contentId: string
): Promise<DisputeHold | null> {
  const held = await courseGrantHeldByDispute(db, userId, contentId);
  return held == null ? null : holdOfCourseGrant(held);
}

function holdOfCourseGrant(held: HeldCourseGrant): DisputeHold {
  return held === 'course_purchase'
    ? 'purchase_dispute'
    : 'subscription_dispute';
}

/**
 * The course twin of {@link resolveDisputePause} (Codex-2hxff.60), for the
 * course shelf and the course page's can-enter answer: for each course, the
 * dispute that holds back the user's grant to it, while nothing else opens
 * it: no live grant to the course, and no staff role in its organisation.
 * That is exactly when the course arm of the decision refuses the course's
 * course-only lessons and {@link disputeHold} names this hold, so a paused
 * course matches its lessons' notice.
 *
 * Keyed by course id; a course absent from the map is not paused. Three
 * reads, plus three more only when a dispute holds something back.
 */
export async function resolveCourseDisputePauses(
  db: AccessQueryClient,
  userId: string,
  courseIds: readonly string[]
): Promise<ReadonlyMap<string, DisputeHold>> {
  const paused = new Map<string, DisputeHold>();
  const held = await courseGrantsHeldByDispute(db, userId, courseIds);
  if (held.size === 0) return paused;

  const heldIds = [...held.keys()];
  const [entitled, staffed] = await Promise.all([
    resolveCourseEntitlementsBatch(db, userId, heldIds),
    coursesUserManages(db, userId, heldIds),
  ]);
  for (const [courseId, grant] of held) {
    if (!entitled.has(courseId) && !staffed.has(courseId)) {
      paused.set(courseId, holdOfCourseGrant(grant));
    }
  }
  return paused;
}

/**
 * Of `courseIds`, the courses in whose organisation the user holds an active
 * owner, admin or creator role: the decision's management bypass, per course.
 */
async function coursesUserManages(
  db: AccessQueryClient,
  userId: string,
  courseIds: readonly string[]
): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ courseId: courses.id })
    .from(courses)
    .innerJoin(
      organizationMemberships,
      eq(organizationMemberships.organizationId, courses.organizationId)
    )
    .where(
      and(
        inArray(courses.id, [...courseIds]),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, 'active'),
        inArray(organizationMemberships.role, MANAGEMENT_ROLES)
      )
    );
  return new Set(rows.map((row) => row.courseId));
}

/**
 * Map a grant `via` to the WP-1 streaming grant log. Only the two follower
 * messages are asserted by the observability suite (analytics distinguishes the
 * community-signal paths); every other arm logs a single generic grant line.
 */
function logGrant(
  obs: ObservabilityClient,
  via: GrantVia,
  ctx: { userId: string; contentId: string; organizationId: string | null }
): void {
  if (via === 'followers_subscription') {
    obs.info('Access granted via subscription (followers content)', {
      ...ctx,
      reason: 'followers_content_granted_via_subscription',
    });
    return;
  }
  if (via === 'followers_follower') {
    obs.info('Access granted via follower (followers content)', ctx);
    return;
  }
  obs.info('Access granted', { ...ctx, via });
}

/**
 * Content fields the boolean adapter reads. Whitelisted so the self-fetch only
 * pulls the policy columns (matches WP-1; adds `courseOnly`).
 */
const POLICY_COLUMNS = {
  id: true,
  organizationId: true,
  status: true,
  publishedAt: true,
  isFree: true,
  isPurchasable: true,
  priceCents: true,
  includedInTierId: true,
  isFollowerGated: true,
  isTeamOnly: true,
  courseOnly: true,
  offSaleAt: true,
} as const;

/**
 * BOOLEAN adapter — backs `ContentAccessService.canView` / `hasContentAccess`.
 * Answers "may this (userId, contentId) pair open this content ANYWHERE?"
 * without throwing or signing URLs. Returns `false` for missing / soft-deleted
 * content (the distinction is not leaked at this layer). `userId` is `null` for
 * anonymous visitors.
 *
 * UNPUBLISHED content is no longer a flat `false` (Codex-p3m5j): it is granted
 * to a purchase-derived arm and denied to every other, by the publication rule
 * in `decideContentAccess`. An anonymous caller is unaffected — every
 * user-scoped arm evaluates to no-grant, leaving only `free`, which does not
 * survive unpublication, so a draft stays unreadable to the public.
 *
 * Not run inside a transaction — progress saves and public reads don't need a
 * snapshot across the access read + a follow-on write; a race where access is
 * revoked between this check and a downstream write is bounded by the KV
 * revocation TTL.
 */
export async function resolveHasContentAccess(
  deps: {
    db: DatabaseClient;
    purchaseService: PurchaseService;
    obs: ObservabilityClient;
  },
  userId: string | null,
  contentId: string
): Promise<boolean> {
  const { db, purchaseService, obs } = deps;

  const contentRecord = await findPolicyRow(db, contentId);
  if (!contentRecord) return false;

  const decision = await decideContentAccess(
    { db, purchaseService },
    userId,
    contentId,
    contentRecord
  );

  // Surface the data-integrity denial (a bad orgless+tier row exists) as a
  // security warning even on the non-throwing path — preserves the WP-1
  // boolean-tree log (Codex-up7bx). Other denials return false silently, as
  // before, to avoid log-spamming public/anonymous canView calls.
  if (!decision.granted && decision.reason === 'orgless_tier_gate') {
    obs.warn('Access denied - orgless content with tier gate', {
      userId,
      contentId,
      includedInTierId: contentRecord.includedInTierId,
      securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
      severity: LOG_SEVERITY.MEDIUM,
      eventType: LOG_EVENTS.ACCESS_CONTROL,
    });
  }

  return decision.granted;
}

/**
 * The policy row the boolean adapters read, or `undefined` for missing or
 * soft-deleted content, or content of a deleted organisation.
 *
 * No `status` predicate (Codex-p3m5j). Unpublished content is fetched and
 * then adjudicated by the publication rule inside `decideContentAccess`,
 * which grants it only to a purchase-derived arm. Filtering here instead
 * would deny a buyer before their purchase was ever considered.
 *
 * `deletedAt` STAYS: a soft-deleted item is gone, not withdrawn from sale.
 * So is an item of a deleted organisation, to every arm (owner decision,
 * 2026-10-25: "Nobody"; Codex-7ncbh). Deleting an org leaves its content
 * published, so only this read can tell.
 */
async function findPolicyRow(db: DatabaseClient, contentId: string) {
  const row = await db.query.content.findFirst({
    where: and(eq(content.id, contentId), isNull(content.deletedAt)),
    columns: POLICY_COLUMNS,
    with: { organization: { columns: { deletedAt: true } } },
  });
  return isOfDeletedOrg(row) ? undefined : row;
}

/**
 * Is this content row's organisation soft-deleted? (Codex-7ncbh)
 *
 * `organization` is a REQUIRED key: a fetch that forgot
 * `with: { organization: { columns: { deletedAt: true } } }` must fail to
 * compile, not quietly read every org as live. `null` is an orgless piece.
 */
export function isOfDeletedOrg(
  row: { organization: { deletedAt: Date | null } | null } | undefined
): boolean {
  return row?.organization?.deletedAt != null;
}

/**
 * DISPUTE adapter — is this item paused for this user by an open payment
 * dispute? (Codex-2hxff.60.) The SAME decision core, then, on a denial, the
 * same {@link disputeHold} the streaming adapter names its refusal with. So
 * the library dims a disputed purchase exactly when the content page shows
 * the dispute notice.
 *
 * `null` when the item opens, is gone, or is refused for a reason no dispute
 * explains. A failed read throws: the caller decides what a failure shows.
 */
export async function resolveDisputePause(
  deps: { db: DatabaseClient; purchaseService: PurchaseService },
  userId: string,
  contentId: string
): Promise<DisputeHold | null> {
  const { db, purchaseService } = deps;

  const contentRecord = await findPolicyRow(db, contentId);
  if (!contentRecord) return null;

  const decision = await decideContentAccess(
    { db, purchaseService },
    userId,
    contentId,
    contentRecord
  );
  if (decision.granted) return null;
  return disputeHold(db, userId, contentId, contentRecord);
}

/**
 * GRANT adapter — backs `getWithdrawnContent` (Codex-ov2ii). Runs the SAME
 * decision core against the read-only transaction snapshot and returns the
 * grant itself, so the caller can say how the reader holds the item, or the
 * denial's reason. It logs the grant as the streaming adapter does, and leaves
 * the denial to the caller: a reader opening an old link to an item withdrawn
 * from sale is not a security event.
 */
export async function resolveContentGrant(
  tx: Tx,
  deps: { purchaseService: PurchaseService; obs: ObservabilityClient },
  userId: string,
  contentId: string,
  contentRecord: StreamingAccessContent
): Promise<{ grant: AccessGrant } | { reason: DenyReason }> {
  const { purchaseService, obs } = deps;

  const decision = await decideContentAccess(
    { db: tx, purchaseService },
    userId,
    contentId,
    contentRecord
  );

  if (!decision.granted) return { reason: decision.reason };

  logGrant(obs, decision.via, {
    userId,
    contentId,
    organizationId: contentRecord.organizationId,
  });
  return { grant: decision };
}

/**
 * THROWING adapter — backs `getStreamingUrl`. Runs the SAME decision core against
 * the read-only transaction snapshot, logs the security-relevant denial, and
 * throws `AccessDeniedError` on denial; returns normally on grant. Preserves the
 * orgless fail-closed guard (Codex-up7bx), the management-role bypass, and the
 * `subscribers ⊇ followers ⊇ public` hierarchy (Codex-xybr3).
 *
 * A denial that an open payment dispute explains carries that as its `reason`
 * ({@link disputeHold}); any other keeps the decision's own. So does one whose
 * dispute lookup fails: that lookup only picks the copy, so its failure is
 * logged and never turns a refusal into a 500.
 */
export async function assertStreamingAccess(
  tx: Tx,
  deps: { purchaseService: PurchaseService; obs: ObservabilityClient },
  userId: string,
  contentId: string,
  contentRecord: StreamingAccessContent
): Promise<void> {
  const { purchaseService, obs } = deps;

  const decision = await decideContentAccess(
    { db: tx, purchaseService },
    userId,
    contentId,
    contentRecord
  );

  if (decision.granted) {
    logGrant(obs, decision.via, {
      userId,
      contentId,
      organizationId: contentRecord.organizationId,
    });
    return;
  }

  let hold: DisputeHold | null = null;
  try {
    hold = await disputeHold(tx, userId, contentId, contentRecord);
  } catch (error) {
    obs.error('Access denied: the dispute lookup failed; own reason kept', {
      userId,
      contentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  obs.warn('Access denied', {
    userId,
    contentId,
    organizationId: contentRecord.organizationId,
    reason: decision.reason,
    disputeHold: hold,
    securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
    severity: LOG_SEVERITY.MEDIUM,
    eventType: LOG_EVENTS.ACCESS_CONTROL,
  });

  // The context is sent to the client as `details`: the hold names only the
  // kind of dispute, never its date, amount or reason.
  throw new AccessDeniedError(userId, contentId, {
    reason: hold ?? decision.reason,
    ...(contentRecord.organizationId
      ? { organizationId: contentRecord.organizationId }
      : {}),
  });
}
