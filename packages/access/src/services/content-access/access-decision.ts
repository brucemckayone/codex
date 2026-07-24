/**
 * Content access-decision logic for ContentAccessService.
 *
 * This module is the KEYSTONE of the CE-1 decomposition (Codex-2pryk.1.1). It
 * holds the two access-decision trees that were previously inlined and
 * duplicated inside `ContentAccessService`:
 *
 *   - `resolveHasContentAccess` — the BOOLEAN tree (from `hasContentAccess`).
 *     Answers "does this (userId, contentId) pair pass the access rules?" and
 *     NEVER throws / NEVER signs URLs. Self-fetches the content row.
 *
 *   - `assertStreamingAccess` — the THROWING tree (from `getStreamingUrl`'s
 *     read-only transaction). Runs against a transaction client, logs the
 *     grant/deny decision, and throws `AccessDeniedError` on denial.
 *
 * The two trees are DELIBERATELY kept separate here — they differ in return
 * shape (boolean vs throw), logging, query columns, and parallelism. Collapsing
 * them into one resolver is WP-2's job (the entitlements rewrite); this
 * refactor is behaviour-preserving and only makes the duplication visible and
 * side-by-side so that collapse becomes tractable.
 */

import {
  CONTENT_ACCESS_TYPE,
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

/** Content fields the streaming-access tree reads. */
interface StreamingAccessContent {
  organizationId: string | null;
  isFree: boolean;
  isPurchasable: boolean;
  priceCents: number | null;
  includedInTierId: string | null;
  isFollowerGated: boolean;
  isTeamOnly: boolean;
}

/**
 * Boolean access check — the equivalent of the access-decision logic embedded
 * in `getStreamingUrl`'s transaction, factored out so the progress save path
 * (and future callers) can gate writes without duplicating the rules. It
 * deliberately does NOT throw `AccessDeniedError` and does NOT generate signed
 * URLs; it only answers "does this (userId, contentId) pair pass the current
 * access rules?".
 *
 * Not run inside a transaction — progress saves don't require a snapshot
 * across the access read + the videoPlayback upsert. A race where access is
 * revoked between this check and the upsert is acceptable (the next heartbeat
 * will be blocked) and bounded by the short KV TTL on the revocation key.
 *
 * Returns `false` for:
 *   - Content not found / unpublished / soft-deleted (treated as no access)
 *   - Team-only content when user lacks a management role
 *   - Followers-only content when user is neither follower, active subscriber,
 *     nor management. Note: as of Codex-xybr3 the access hierarchy is
 *     `subscribers ⊇ followers ⊇ public` — an active subscription to the
 *     content's org grants followers-only access without needing a follower
 *     row. Ex-subscribers (status=cancelled) with an active follower row
 *     still get access via the follower fallback.
 *   - Subscribers-only content when user has neither an active subscription
 *     meeting the minimum tier, a purchase, nor management
 *   - Paid content when user has neither purchased nor (via tier) subscribed
 *     nor holds a management role
 *
 * Returns `true` for free content the user can see, and for any of the above
 * paths when satisfied.
 */
export async function resolveHasContentAccess(
  deps: {
    db: DatabaseClient;
    purchaseService: PurchaseService;
    obs: ObservabilityClient;
  },
  userId: string,
  contentId: string
): Promise<boolean> {
  const { db, purchaseService, obs } = deps;

  const contentRecord = await db.query.content.findFirst({
    where: and(
      eq(content.id, contentId),
      eq(content.status, CONTENT_STATUS.PUBLISHED),
      isNull(content.deletedAt)
    ),
    columns: {
      id: true,
      organizationId: true,
      isFree: true,
      isPurchasable: true,
      priceCents: true,
      includedInTierId: true,
      isFollowerGated: true,
      isTeamOnly: true,
    },
  });

  if (!contentRecord) {
    // Missing/unpublished content → treat as no access. Don't leak the
    // distinction between "doesn't exist" and "you can't see it" at this
    // layer — the caller translates the boolean.
    return false;
  }

  const orgId = contentRecord.organizationId;

  // ── Fail-closed guard: orgless content can never tier-gate (Codex-up7bx) ──
  // `subscription_tiers` is org-scoped (FK to organizations, unique per org),
  // so a `minimumTierId` on content with NO `organizationId` is a semantically
  // invalid row — there is no org against which a subscription/tier could be
  // checked. Earlier this slipped through every branch that conjoined the
  // subscription check with `orgId` being truthy, silently SKIPPING the tier
  // gate and granting access. Deny here, before any branch, so a pre-existing
  // bad row (regardless of how it was written) is never silently unlocked.
  if (orgId == null && contentRecord.includedInTierId != null) {
    obs.warn('Access denied - orgless content with tier gate', {
      userId,
      contentId,
      includedInTierId: contentRecord.includedInTierId,
      securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
      severity: LOG_SEVERITY.MEDIUM,
      eventType: LOG_EVENTS.ACCESS_CONTROL,
    });
    return false;
  }

  // Inline reusable helpers — mirror the branches in getStreamingUrl.
  const hasManagementMembership = async (
    organizationId: string
  ): Promise<boolean> => {
    const row = await db.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, 'active'),
        inArray(organizationMemberships.role, MANAGEMENT_ROLES)
      ),
      columns: { id: true },
    });
    return !!row;
  };

  const hasFollower = async (organizationId: string): Promise<boolean> => {
    const row = await db.query.organizationFollowers.findFirst({
      where: and(
        eq(organizationFollowers.organizationId, organizationId),
        eq(organizationFollowers.userId, userId)
      ),
      columns: { id: true },
    });
    return !!row;
  };

  const hasSubscriptionAccess = async (
    organizationId: string,
    minimumTierId: string | null
  ): Promise<boolean> => {
    const userSub = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.organizationId, organizationId),
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

  // Branch on the access-policy flags — behavior-preserving translation of the
  // former mutually-exclusive `accessType` chain (WP-1); WP-2 replaces this with
  // the entitlements resolver. Precedence: team > followers > tier > paid > free
  // (matches the old accessType chain; migrated single-mode rows set exactly one
  // gate, so precedence is observable only for future multi-flag content).
  if (contentRecord.isTeamOnly) {
    if (!orgId) return false;
    return hasManagementMembership(orgId);
  }

  if (contentRecord.isFollowerGated) {
    if (!orgId) return false;
    // Codex-xybr3: subscribers ⊇ followers. Active subscribers to the
    // content's org get followers-only access without needing a follower
    // row. Either a subscription OR a follower row grants access — both
    // are independent reads so launch them in parallel (R12 hard rule).
    // The deny path was previously 3 sequential round-trips; the cheap
    // pair now overlaps, falling through to management only when both
    // come back falsey. On grant either truthy result short-circuits.
    const [subscribed, followed] = await Promise.all([
      hasSubscriptionAccess(orgId, null),
      hasFollower(orgId),
    ]);
    if (subscribed || followed) return true;
    return hasManagementMembership(orgId);
  }

  if (contentRecord.includedInTierId != null) {
    if (!orgId) return false;
    // Subscription and purchase are independent gates — launch in parallel
    // (R12 hard rule). Falls through to management only when both deny.
    const [subscribed, purchased] = await Promise.all([
      hasSubscriptionAccess(orgId, contentRecord.includedInTierId),
      purchaseService.verifyPurchase(contentId, userId),
    ]);
    if (subscribed || purchased) return true;
    return hasManagementMembership(orgId);
  }

  // Paid content (priceCents > 0) — check purchase, optional tier, membership.
  if (contentRecord.priceCents && contentRecord.priceCents > 0) {
    // Purchase + (optional) subscription gates are independent — launch in
    // parallel when both apply (R12 hard rule). When no minimumTierId is
    // set the subscription path doesn't apply, so only purchase runs.
    if (orgId && contentRecord.includedInTierId) {
      const [purchased, subscribed] = await Promise.all([
        purchaseService.verifyPurchase(contentId, userId),
        hasSubscriptionAccess(orgId, contentRecord.includedInTierId),
      ]);
      if (purchased || subscribed) return true;
      return hasManagementMembership(orgId);
    }
    if (await purchaseService.verifyPurchase(contentId, userId)) {
      return true;
    }
    if (!orgId) return false;
    return hasManagementMembership(orgId);
  }

  // Free content with no price — access granted.
  return true;
}

/**
 * Throwing access check for the streaming path. Runs inside `getStreamingUrl`'s
 * read-only transaction against the already-fetched content row, logs the
 * grant/deny decision, and throws `AccessDeniedError` on denial. Returns
 * normally when access is granted.
 *
 * Preserves the exact behaviour of the previously-inlined tree, including the
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

  // ── Fail-closed guard: orgless content can never tier-gate ──
  // (Codex-up7bx) `subscription_tiers` is org-scoped, so content
  // with a `minimumTierId` but NO `organizationId` is a semantically
  // invalid row: there is no org against which the tier/subscription
  // could be resolved. Every accessType branch below conjoins the
  // subscription check with `organizationId` being present, which
  // for such a row silently SKIPS the gate and (in the free/paid
  // arms) grants access. Deny up front so a pre-existing bad row —
  // however it was written — is never silently unlocked. This must
  // precede the accessType branching.
  if (
    contentRecord.organizationId == null &&
    contentRecord.includedInTierId != null
  ) {
    obs.warn('Access denied - orgless content with tier gate', {
      userId,
      contentId,
      includedInTierId: contentRecord.includedInTierId,
      securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
      severity: LOG_SEVERITY.MEDIUM,
      eventType: LOG_EVENTS.ACCESS_CONTROL,
    });
    throw new AccessDeniedError(userId, contentId, {
      reason: 'orgless_tier_gate',
    });
  }

  // ── Reusable helper: check active subscription access ──────
  // Returns true if user has an active subscription to the org
  // that meets the content's minimum tier requirement.
  // When minimumTierId is null, any active subscription grants access.
  const checkSubscriptionAccess = async (
    orgId: string,
    minimumTierId: string | null
  ): Promise<boolean> => {
    const userSub = await tx.query.subscriptions.findFirst({
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

    // No minimum tier set — any active subscription grants access
    if (!minimumTierId) {
      obs.info('Access granted via subscription (any tier)', {
        userId,
        contentId,
        subscriptionTier: userSub.tier.name,
      });
      return true;
    }

    // Minimum tier set — compare sortOrder.
    // Archived (soft-deleted) tiers MUST still resolve here: a
    // creator who deletes a tier leaves historic content gated
    // against it, and active subscribers whose own subscription
    // predates the delete still need their access decision to
    // compare sort orders. The deletedAt filter is therefore
    // omitted intentionally — mirror of TierService.getTierForAccessCheck.
    const contentTier = await tx.query.subscriptionTiers.findFirst({
      where: eq(subscriptionTiers.id, minimumTierId),
    });

    if (contentTier && userSub.tier.sortOrder >= contentTier.sortOrder) {
      obs.info('Access granted via subscription', {
        userId,
        contentId,
        subscriptionTier: userSub.tier.name,
        contentMinTier: contentTier.name,
      });
      return true;
    }

    return false;
  };

  // ── Reusable helper: check management membership ────────────
  // Only owner/admin/creator roles bypass payment requirements.
  // Regular 'member' and 'subscriber' roles must purchase or
  // subscribe to access paid/subscriber content.
  const checkManagementMembership = async (orgId: string) => {
    return tx.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.organizationId, orgId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, 'active'),
        inArray(organizationMemberships.role, MANAGEMENT_ROLES)
      ),
    });
  };

  // ── Reusable helper: check follower relationship ────────────
  const checkFollower = async (orgId: string) => {
    return tx.query.organizationFollowers.findFirst({
      where: and(
        eq(organizationFollowers.organizationId, orgId),
        eq(organizationFollowers.userId, userId)
      ),
    });
  };

  // ── Access decision: branch on the access-policy flags ─────
  // Behavior-preserving translation of the former accessType else-if chain
  // (WP-1); precedence team > followers > tier > paid > free. WP-2 replaces
  // this with the entitlements resolver.

  // (a) Team-only: require management role (owner/admin/creator)
  if (contentRecord.isTeamOnly) {
    if (!contentRecord.organizationId) {
      throw new AccessDeniedError(userId, contentId, {
        reason: 'team_only_requires_org',
      });
    }

    const membership = await checkManagementMembership(
      contentRecord.organizationId
    );

    if (!membership) {
      obs.warn('Access denied - team-only content', {
        userId,
        contentId,
        organizationId: contentRecord.organizationId,
        securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
        severity: LOG_SEVERITY.MEDIUM,
        eventType: LOG_EVENTS.ACCESS_CONTROL,
      });
      throw new AccessDeniedError(userId, contentId, {
        organizationId: contentRecord.organizationId,
        reason: 'team_only',
      });
    }

    obs.info('Access granted via management role (team content)', {
      userId,
      contentId,
      organizationId: contentRecord.organizationId,
      membershipRole: membership.role,
    });
  }
  // (b) Followers-only: require active subscription, follower row,
  // or management role. Codex-xybr3 inverted the prior orthogonality:
  // the access hierarchy is now `subscribers ⊇ followers ⊇ public`,
  // so an active subscription to the content's org grants followers-
  // only access without needing a follower row. The subscriber check
  // runs FIRST so subscribers don't require the (free) follow action;
  // the follower check remains as a fallback so ex-subscribers
  // (status=cancelled) with an active follower row still see
  // followers-only content via the community signal.
  //
  // Paused / past_due / expired subscriptions are filtered out by
  // `checkSubscriptionAccess` (status IN (active, cancelling) AND
  // currentPeriodEnd > now) — consistent with the PR #5 filter used
  // for subscribers-only content.
  else if (contentRecord.isFollowerGated) {
    if (!contentRecord.organizationId) {
      throw new AccessDeniedError(userId, contentId, {
        reason: 'followers_only_requires_org',
      });
    }

    let granted = false;
    const orgId = contentRecord.organizationId;

    // Primary check (new): active subscription grants followers-only
    // access. `minimumTierId` is passed as null — any active tier
    // qualifies, because the content is gated to the community
    // (followers), not to a specific paid tier.
    const hasSubAccess = await checkSubscriptionAccess(orgId, null);
    if (hasSubAccess) {
      obs.info('Access granted via subscription (followers content)', {
        userId,
        contentId,
        organizationId: orgId,
        reason: 'followers_content_granted_via_subscription',
      });
      granted = true;
    }

    // Fallback: explicit follower row — preserves access for
    // ex-subscribers (status=cancelled) who followed before their
    // subscription lapsed, plus free-tier followers.
    if (!granted) {
      const follower = await checkFollower(orgId);
      if (follower) {
        obs.info('Access granted via follower (followers content)', {
          userId,
          contentId,
          organizationId: orgId,
        });
        granted = true;
      }
    }

    // Fallback: management membership (team implicitly has access)
    if (!granted) {
      const membership = await checkManagementMembership(orgId);
      if (membership) {
        obs.info('Access granted via management role (followers content)', {
          userId,
          contentId,
          organizationId: orgId,
          membershipRole: membership.role,
        });
        granted = true;
      }
    }

    if (!granted) {
      obs.warn('Access denied - followers-only content', {
        userId,
        contentId,
        organizationId: orgId,
        securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
        severity: LOG_SEVERITY.MEDIUM,
        eventType: LOG_EVENTS.ACCESS_CONTROL,
      });
      throw new AccessDeniedError(userId, contentId, {
        organizationId: orgId,
        reason: 'followers_only',
      });
    }
  }
  // (c) Subscribers-only: require active subscription (with optional tier check)
  else if (contentRecord.includedInTierId != null) {
    if (!contentRecord.organizationId) {
      throw new AccessDeniedError(userId, contentId, {
        reason: 'subscribers_only_requires_org',
      });
    }

    let granted = false;

    // Primary check: active subscription to the org
    const hasSubAccess = await checkSubscriptionAccess(
      contentRecord.organizationId,
      contentRecord.includedInTierId
    );

    if (hasSubAccess) {
      granted = true;
    }

    // Fallback: individual purchase (user may have bought it separately)
    if (!granted) {
      const hasPurchased = await purchaseService.verifyPurchase(
        contentId,
        userId
      );
      if (hasPurchased) {
        obs.info('Access granted via purchase (subscriber content)', {
          userId,
          contentId,
        });
        granted = true;
      }
    }

    // Fallback: management membership (owner/admin/creator only)
    // Regular 'member' and 'subscriber' roles must subscribe or purchase
    if (!granted) {
      const membership = await checkManagementMembership(
        contentRecord.organizationId
      );
      if (membership) {
        obs.info(
          'Access granted via management membership (subscriber content)',
          {
            userId,
            contentId,
            organizationId: contentRecord.organizationId,
            membershipRole: membership.role,
          }
        );
        granted = true;
      }
    }

    if (!granted) {
      obs.warn('Access denied - subscriber-only content', {
        userId,
        contentId,
        organizationId: contentRecord.organizationId,
        includedInTierId: contentRecord.includedInTierId,
        securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
        severity: LOG_SEVERITY.MEDIUM,
        eventType: LOG_EVENTS.ACCESS_CONTROL,
      });
      throw new AccessDeniedError(userId, contentId, {
        organizationId: contentRecord.organizationId,
        reason: 'subscribers_only',
      });
    }
  }
  // (c) Paid content: check purchase, then subscription, then membership
  else if (contentRecord.priceCents && contentRecord.priceCents > 0) {
    // Paid content - check purchase via PurchaseService
    const hasPurchased = await purchaseService.verifyPurchase(
      contentId,
      userId
    );

    if (hasPurchased) {
      obs.info('Access granted via purchase', {
        userId,
        contentId,
      });
    } else {
      // No purchase — check subscription tier access ONLY if content
      // is also subscriber-gated (has minimumTierId). Pure paid content
      // (accessType='paid', no minimumTierId) requires a purchase.
      let hasSubscriptionAccess = false;

      if (contentRecord.organizationId && contentRecord.includedInTierId) {
        hasSubscriptionAccess = await checkSubscriptionAccess(
          contentRecord.organizationId,
          contentRecord.includedInTierId
        );
      }

      if (!hasSubscriptionAccess) {
        // No subscription access — fall back to org membership check
        const contentOrgId = contentRecord.organizationId;

        if (!contentOrgId) {
          // Personal content with no org - requires purchase
          obs.warn('Access denied - paid personal content requires purchase', {
            userId,
            contentId,
            priceCents: contentRecord.priceCents,
            securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
            severity: LOG_SEVERITY.MEDIUM,
            eventType: LOG_EVENTS.ACCESS_CONTROL,
          });
          throw new AccessDeniedError(userId, contentId, {
            priceCents: contentRecord.priceCents,
          });
        }

        // Check if user is a management member (owner/admin/creator)
        // Regular 'member' and 'subscriber' roles must purchase or subscribe
        const membership = await checkManagementMembership(contentOrgId);

        if (!membership) {
          obs.warn('Access denied - no purchase and not management member', {
            userId,
            contentId,
            organizationId: contentOrgId,
            priceCents: contentRecord.priceCents,
            securityEvent: LOG_EVENTS.UNAUTHORIZED_ACCESS,
            severity: LOG_SEVERITY.MEDIUM,
            eventType: LOG_EVENTS.ACCESS_CONTROL,
          });
          throw new AccessDeniedError(userId, contentId, {
            priceCents: contentRecord.priceCents,
            organizationId: contentOrgId,
          });
        }

        obs.info('Access granted via management membership', {
          userId,
          contentId,
          organizationId: contentOrgId,
          membershipRole: membership.role,
        });
      } // end if (!hasSubscriptionAccess)
    }
  }
  // (d) Free content: grant access
  else {
    obs.info('Free content - access granted', {
      contentId,
    });
  }
}
