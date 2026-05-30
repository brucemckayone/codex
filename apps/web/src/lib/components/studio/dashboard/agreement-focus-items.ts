/**
 * Revenue-share focus-item aggregators (WP-9 — Codex-k9no0).
 *
 * Pure functions that translate the three (owner) / two (creator)
 * agreement signal types into `FocusItem[]` consumed by FocusRail.
 *
 * Why pure functions live outside the page component:
 *  - The studio dashboard is `ssr=false`, so all data fan-in happens via
 *    remote queries — these aggregators receive the resolved data as
 *    plain inputs and stay free of `$derived` / browser-only globals.
 *  - Unit testing the aggregator without spinning up a Svelte render is
 *    cheap; the page component then just wires inputs and outputs.
 *
 * Unit semantics:
 *  - `sharePercent` (a.k.a. `proposed_creator_share_percent` on the
 *    proposals table; `10000 - organizationFeePercentage` on the
 *    legacy active-agreement row) is BASIS POINTS of post-platform
 *    revenue (0–10000). All copy says "of post-platform
 *    [revenueType] revenue" per the C1 math semantic
 *    (`project_revenue_share_decisions.md`).
 *  - Currency is GBP — no `$` symbols. Display copy is currency-free
 *    in this surface; percentages only.
 *  - Dates are real `Date` objects (or ISO strings that the page-level
 *    code is expected to coerce before calling here). The helper
 *    accepts both shapes and normalises internally so the test surface
 *    can pass whichever is convenient.
 *
 * Dismissal:
 *  - `dismissable: true` items can be filtered by the caller using the
 *    existing `$lib/collections/dismissals` helper. The aggregator does
 *    NOT consult dismissal state itself — that lives in the browser-only
 *    localStorage collection. The caller filters returned items via
 *    `isDismissed(item.id)` before passing to FocusRail.
 */

import { EditIcon } from '$lib/components/ui/Icon';
import type { FocusItem } from './focus-rail-types';

// ─── Input shapes ─────────────────────────────────────────────────────────

/**
 * Subset of OrgMemberItem this aggregator needs. The full type lives in
 * `$lib/types` but we narrow here so the test fixtures don't need to
 * mock unrelated fields (email, joinedAt, status).
 */
export interface TeamMemberInput {
  userId: string;
  name: string | null;
  email: string;
  role: string;
}

/**
 * Subset of `CreatorOrganizationAgreement` this aggregator consumes.
 * The legacy `organizationFeePercentage` column is the dual-write source
 * of truth for active rows today (per WP-1 discoveries); we accept it as
 * a number and translate to display % at render time.
 */
export interface ActiveAgreementInput {
  id: string;
  creatorId: string;
  revenueType: string;
  /** Basis points (0–10000) of the org's slice; share = 10000 - this. */
  organizationFeePercentage: number;
  /** ISO string or Date. `null` = indefinite. */
  effectiveUntil: string | Date | null;
}

/**
 * Subset of `AgreementProposal` this aggregator consumes. Mirrors the
 * shape returned by `listPendingProposals` (owner) and the
 * `pendingActionRequired` slice of the creator portfolio.
 */
export interface OpenProposalInput {
  id: string;
  creatorId: string;
  proposedByRole: string;
  revenueType: string;
  proposedCreatorSharePercent: number;
}

/**
 * Creator-side: a pending proposal from an org (round-1 owner-initiated).
 * Mirrors the `pendingActionRequired` row from the creator portfolio
 * endpoint.
 */
export interface PendingProposalForCreatorInput {
  proposalId: string;
  organizationId: string;
  organizationName: string | null;
  revenueType: string;
  proposedSharePercent: number;
}

/**
 * Creator-side: an active agreement on some org, used by the
 * "expiring in 30 days" warning. Mirrors the `active` row from the
 * creator portfolio endpoint.
 */
export interface ActiveAgreementForCreatorInput {
  id: string;
  organizationId: string;
  organizationName: string | null;
  /** ISO string or Date. `null` = indefinite. */
  effectiveUntil: string | Date | null;
}

// ─── Display helpers (private — kept inline; not exported) ────────────────

/** Format a basis-points share (0–10000) as a display string ("30%"). */
function formatSharePercent(basisPoints: number): string {
  const asPercent = basisPoints / 100;
  return Number.isInteger(asPercent)
    ? `${asPercent}%`
    : `${asPercent.toFixed(1)}%`;
}

/** Translate the schema enum to the body copy form. */
function revenueTypeLabel(revenueType: string): string {
  return revenueType === 'subscription' ? 'subscription' : 'content-purchase';
}

/** Resolve a team member's display name, falling back to email. */
function memberDisplayName(member: TeamMemberInput): string {
  return member.name?.trim() || member.email;
}

/**
 * Window in days for "agreement expiring soon" warnings. Mirrors the
 * `agreement.expiring_soon` notification trigger documented in the plan
 * (148: "30d before expiry"). Hardcoded here as a derived UI constant —
 * if the notification window ever changes, the email service and this
 * helper must move in lockstep.
 */
const EXPIRING_SOON_WINDOW_DAYS = 30;

/**
 * Compute whole days until `effectiveUntil`. Returns `null` for
 * indefinite agreements (no `effectiveUntil`) and for already-expired
 * windows (negative — the FocusRail does not surface past-expiry).
 *
 * @param now Injected for deterministic tests. Defaults to `new Date()`.
 */
function daysUntil(
  effectiveUntil: string | Date | null,
  now: Date = new Date()
): number | null {
  if (effectiveUntil == null) return null;
  const target =
    effectiveUntil instanceof Date ? effectiveUntil : new Date(effectiveUntil);
  if (Number.isNaN(target.getTime())) return null;
  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = Math.ceil((target.getTime() - now.getTime()) / msPerDay);
  return diff;
}

// ─── Public aggregators ───────────────────────────────────────────────────

export interface OwnerFocusItemInput {
  /** Active org team members (excluding subscribers) — see the settings
   *  page for the same filtering rule. */
  teamMembers: TeamMemberInput[];
  /** Active agreements on the org across both revenue types. */
  activeAgreements: ActiveAgreementInput[];
  /** Open proposals on the org with `proposedByRole='creator'`. */
  pendingCreatorCounters: OpenProposalInput[];
  /** Injected clock — tests pass a fixed `Date`. */
  now?: Date;
}

/**
 * Three owner-dashboard signal types:
 *
 *   1. Propose-revenue-share nudge — surfaced for every active team
 *      creator who has NO active subscription agreement. Persists until
 *      the owner proposes (the creator gains a subscription agreement)
 *      or dismisses the card (`dismissable: true`).
 *
 *   2. Counter-proposal received — surfaced for every open proposal on
 *      this org with `proposedByRole='creator'`. Not dismissable; the
 *      card clears when the owner accepts / declines / counters.
 *
 *   3. Agreement expiring soon — surfaced for every active agreement
 *      whose `effectiveUntil` is within {@link EXPIRING_SOON_WINDOW_DAYS}.
 *      Dismissable warning; the email notifier covers the persistent
 *      reminder channel.
 *
 * Returned items are NOT filtered by dismissal — caller does that.
 *
 * Per the plan's signal ordering (line 131–136): action > warning >
 * muted. We emit (counter-received, propose-nudge, expiring) in that
 * priority order, with the FocusRail rendering them in array order.
 */
export function buildOwnerAgreementFocusItems(
  input: OwnerFocusItemInput
): FocusItem[] {
  const items: FocusItem[] = [];
  const now = input.now ?? new Date();

  // Member name index for description copy.
  const memberById = new Map<string, TeamMemberInput>();
  for (const m of input.teamMembers) {
    memberById.set(m.userId, m);
  }

  // 1. Counter-proposal received (action, non-dismissable). Ordered by
  //    creator name for deterministic surfacing.
  const sortedCounters = [...input.pendingCreatorCounters].sort((a, b) => {
    const nameA = memberById.get(a.creatorId);
    const nameB = memberById.get(b.creatorId);
    const labelA = nameA ? memberDisplayName(nameA) : 'Creator';
    const labelB = nameB ? memberDisplayName(nameB) : 'Creator';
    return labelA.localeCompare(labelB);
  });
  for (const proposal of sortedCounters) {
    if (proposal.proposedByRole !== 'creator') continue;
    const creator = memberById.get(proposal.creatorId);
    const name = creator ? memberDisplayName(creator) : 'A creator';
    const revLabel = revenueTypeLabel(proposal.revenueType);
    items.push({
      id: `agreement-counter-${proposal.id}`,
      eyebrow: 'Revenue share',
      title: `${name} sent a counter-proposal`,
      description: `${formatSharePercent(proposal.proposedCreatorSharePercent)} of post-platform ${revLabel} revenue`,
      href: '/studio/monetisation/revenue-share',
      tone: 'action',
      icon: EditIcon,
      dismissable: false,
    });
  }

  // 2. Propose-nudge (action, dismissable). For every active team
  //    creator without a subscription agreement. We scope to role=creator
  //    + role=admin (rank-and-file creators on the team); subscribers
  //    are not team and must be excluded by the caller. The settings
  //    page uses the same filter.
  const creatorIdsWithSubAgreement = new Set(
    input.activeAgreements
      .filter((a) => a.revenueType === 'subscription')
      .map((a) => a.creatorId)
  );
  const sortedMembers = [...input.teamMembers].sort((a, b) =>
    memberDisplayName(a).localeCompare(memberDisplayName(b))
  );
  for (const member of sortedMembers) {
    // Only team creators qualify — owners/admins are the org operators,
    // not the audience-facing creators we'd negotiate revenue with.
    // The settings page renders cards for every non-subscriber, so we
    // include role='creator' AND role='admin' here for parity.
    if (member.role !== 'creator' && member.role !== 'admin') continue;
    if (creatorIdsWithSubAgreement.has(member.userId)) continue;
    const name = memberDisplayName(member);
    items.push({
      id: `agreement-propose-${member.userId}`,
      eyebrow: 'Revenue share',
      title: `Set up revenue share with ${name}`,
      description: "They'll get nothing until you propose a split.",
      href: `/studio/monetisation/revenue-share?focus=${encodeURIComponent(member.userId)}`,
      tone: 'action',
      icon: EditIcon,
      dismissable: true,
    });
  }

  // 3. Expiring soon (warning, dismissable). Ordered by soonest first.
  const expiring = input.activeAgreements
    .map((agreement) => ({
      agreement,
      days: daysUntil(agreement.effectiveUntil, now),
    }))
    .filter(
      (entry): entry is { agreement: ActiveAgreementInput; days: number } =>
        entry.days !== null &&
        entry.days >= 0 &&
        entry.days <= EXPIRING_SOON_WINDOW_DAYS
    )
    .sort((a, b) => a.days - b.days);
  for (const { agreement, days } of expiring) {
    const creator = memberById.get(agreement.creatorId);
    const name = creator ? memberDisplayName(creator) : 'a creator';
    items.push({
      id: `agreement-expiring-${agreement.id}`,
      eyebrow: 'Revenue share',
      title: `Agreement with ${name} expires in ${days} day${days === 1 ? '' : 's'}`,
      description: 'Renew or terminate before it auto-expires.',
      href: `/studio/monetisation/revenue-share?focus=${encodeURIComponent(agreement.creatorId)}`,
      tone: 'warning',
      dismissable: true,
    });
  }

  return items;
}

export interface CreatorFocusItemInput {
  /** `pendingActionRequired` slice of the creator portfolio. */
  pendingProposalsFromOrg: PendingProposalForCreatorInput[];
  /** `active` slice of the creator portfolio. */
  activeAgreements: ActiveAgreementForCreatorInput[];
  /** Injected clock — tests pass a fixed `Date`. */
  now?: Date;
}

/**
 * Two creator-dashboard signal types:
 *
 *   1. Pending proposal from org — surfaced for every row in
 *      `pendingActionRequired`. Per
 *      [[pending-proposals-no-agreement-row]], these proposals exist
 *      ONLY as `agreement_proposals` rows; the creator's portfolio
 *      endpoint queries the proposals table directly to surface them.
 *      Not dismissable; cleared when the creator accepts / declines /
 *      counters.
 *
 *   2. Active agreement expiring — surfaced for every active agreement
 *      whose `effectiveUntil` is within
 *      {@link EXPIRING_SOON_WINDOW_DAYS}. Dismissable warning.
 *
 * Returned items are NOT filtered by dismissal — caller does that.
 */
export function buildCreatorAgreementFocusItems(
  input: CreatorFocusItemInput
): FocusItem[] {
  const items: FocusItem[] = [];
  const now = input.now ?? new Date();

  // 1. Pending proposal from org (action, non-dismissable). Ordered by
  //    org name for determinism.
  const sortedPending = [...input.pendingProposalsFromOrg].sort((a, b) => {
    const nameA = a.organizationName ?? 'An organisation';
    const nameB = b.organizationName ?? 'An organisation';
    return nameA.localeCompare(nameB);
  });
  for (const proposal of sortedPending) {
    const orgName = proposal.organizationName ?? 'An organisation';
    const revLabel = revenueTypeLabel(proposal.revenueType);
    items.push({
      id: `agreement-pending-${proposal.proposalId}`,
      eyebrow: 'Revenue share',
      title: `${orgName} proposed a revenue share`,
      description: `${formatSharePercent(proposal.proposedSharePercent)} of post-platform ${revLabel} revenue`,
      href: `/studio/negotiations/${encodeURIComponent(proposal.proposalId)}`,
      tone: 'action',
      icon: EditIcon,
      dismissable: false,
    });
  }

  // 2. Expiring soon (warning, dismissable). Ordered by soonest first.
  const expiring = input.activeAgreements
    .map((agreement) => ({
      agreement,
      days: daysUntil(agreement.effectiveUntil, now),
    }))
    .filter(
      (
        entry
      ): entry is {
        agreement: ActiveAgreementForCreatorInput;
        days: number;
      } =>
        entry.days !== null &&
        entry.days >= 0 &&
        entry.days <= EXPIRING_SOON_WINDOW_DAYS
    )
    .sort((a, b) => a.days - b.days);
  for (const { agreement, days } of expiring) {
    const orgName = agreement.organizationName ?? 'an organisation';
    items.push({
      id: `agreement-expiring-${agreement.id}`,
      eyebrow: 'Revenue share',
      title: `Your agreement with ${orgName} expires in ${days} day${days === 1 ? '' : 's'}`,
      description: 'Renew with the org or it auto-expires.',
      href: `/studio/negotiations/${encodeURIComponent(agreement.id)}`,
      tone: 'warning',
      dismissable: true,
    });
  }

  return items;
}
