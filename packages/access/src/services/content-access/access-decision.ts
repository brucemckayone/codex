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
  CONTENT_STATUS,
  ORGANIZATION_ROLES,
  SUBSCRIPTION_STATUS,
} from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import {
  content,
  organizationFollowers,
  organizationMemberships,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import type { ObservabilityClient } from '@codex/observability';
import type { PurchaseService } from '@codex/purchase';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { LOG_EVENTS, LOG_SEVERITY } from '../../constants';
import { AccessDeniedError } from '../../errors';
import {
  type AccessQueryClient,
  contentReachableViaOwnedCourse,
  hasStoredContentEntitlement,
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
  isFree: boolean;
  isPurchasable: boolean;
  priceCents: number | null;
  includedInTierId: string | null;
  isFollowerGated: boolean;
  isTeamOnly: boolean;
  courseOnly: boolean;
}

/**
 * Content fields the streaming-access adapter reads. Superset of the boolean
 * adapter's whitelist; kept as an alias so `getStreamingUrl`'s already-fetched
 * full row satisfies it structurally.
 */
export type StreamingAccessContent = ContentAccessPolicyRow;

/** Reason codes for a denial — logged, and threaded into `AccessDeniedError`. */
type DenyReason =
  | 'orgless_tier_gate'
  | 'course_only'
  | 'team_only'
  | 'team_only_requires_org'
  | 'followers_only'
  | 'followers_only_requires_org'
  | 'subscribers_only'
  | 'subscribers_only_requires_org'
  | 'paid'
  | 'paid_requires_purchase';

/**
 * Which arm granted — the streaming adapter maps this to the WP-1 grant log
 * (preserved because the observability suite pins the follower grant messages;
 * see content-access-service-followers-subscription.test.ts).
 */
type GrantVia =
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

type AccessDecision =
  | { granted: true; via: GrantVia }
  | { granted: false; reason: DenyReason };

const grant = (via: GrantVia): AccessDecision => ({ granted: true, via });
const deny = (reason: DenyReason): AccessDecision => ({
  granted: false,
  reason,
});

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
export async function decideContentAccess(
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

  // Active subscription meeting the content's minimum tier (by sortOrder).
  // `minimumTierId === null` → any active subscription grants (community gate).
  const hasSubscriptionAccess = async (
    minimumTierId: string | null
  ): Promise<boolean> => {
    if (userId == null || orgId == null) return false;
    const userSub = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.organizationId, orgId),
        inArray(subscriptions.status, [
          SUBSCRIPTION_STATUS.ACTIVE,
          SUBSCRIPTION_STATUS.CANCELLING,
        ]),
        gt(subscriptions.currentPeriodEnd, new Date())
      ),
      with: { tier: true },
    });
    if (!userSub) return false;
    if (!minimumTierId) return true;
    const contentTier = await db.query.subscriptionTiers.findFirst({
      where: eq(subscriptionTiers.id, minimumTierId),
      columns: { sortOrder: true },
    });
    if (!contentTier) return false;
    return userSub.tier.sortOrder >= contentTier.sortOrder;
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
    if (await hasSubscriptionAccess(null))
      return grant('followers_subscription');
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
    const [subscribed, purchased] = await Promise.all([
      hasSubscriptionAccess(policy.includedInTierId),
      verifyPurchase(),
    ]);
    if (subscribed) return grant('subscribers_subscription');
    if (purchased) return grant('subscribers_purchase');
    if (await viaContentEntitlement()) return grant('subscribers_entitlement');
    if (await viaOwnedCourse()) return grant('subscribers_course');
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
  isFree: true,
  isPurchasable: true,
  priceCents: true,
  includedInTierId: true,
  isFollowerGated: true,
  isTeamOnly: true,
  courseOnly: true,
} as const;

/**
 * BOOLEAN adapter — backs `ContentAccessService.canView` / `hasContentAccess`.
 * Answers "may this (userId, contentId) pair open this content ANYWHERE?"
 * without throwing or signing URLs. Returns `false` for missing / unpublished /
 * soft-deleted content (the distinction is not leaked at this layer). `userId`
 * is `null` for anonymous visitors.
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

  const contentRecord = await db.query.content.findFirst({
    where: and(
      eq(content.id, contentId),
      eq(content.status, CONTENT_STATUS.PUBLISHED),
      isNull(content.deletedAt)
    ),
    columns: POLICY_COLUMNS,
  });

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
 * THROWING adapter — backs `getStreamingUrl`. Runs the SAME decision core against
 * the read-only transaction snapshot, logs the security-relevant denial, and
 * throws `AccessDeniedError` on denial; returns normally on grant. Preserves the
 * orgless fail-closed guard (Codex-up7bx), the management-role bypass, and the
 * `subscribers ⊇ followers ⊇ public` hierarchy (Codex-xybr3).
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

  obs.warn('Access denied', {
    userId,
    contentId,
    organizationId: contentRecord.organizationId,
    reason: decision.reason,
    securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
    severity: LOG_SEVERITY.MEDIUM,
    eventType: LOG_EVENTS.ACCESS_CONTROL,
  });

  throw new AccessDeniedError(userId, contentId, {
    reason: decision.reason,
    ...(contentRecord.organizationId
      ? { organizationId: contentRecord.organizationId }
      : {}),
  });
}
