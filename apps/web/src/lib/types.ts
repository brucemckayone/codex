/**
 * Web app-specific type definitions
 *
 * NOTE: Most API types (UserData, SessionData, ProgressData, CheckoutResponse)
 * are imported from @codex/shared-types for consistency across the platform.
 * Only web-app-specific types should be defined here.
 */

// Re-export commonly used types for convenience
export type {
  CheckoutResponse,
  SessionData,
  UserData,
} from '@codex/shared-types';

import type {
  Content,
  Organization,
  ServedMediaItem,
  Subscription,
  SubscriptionTier,
} from '@codex/database/schema';
import type { MyMembershipResponse } from '@codex/shared-types';
import type { HeroLayout } from '@codex/validation';

export interface ContentWithRelations extends Content {
  creator?: {
    id: string;
    /** Absent on the anonymous public list, which never selects it. */
    email?: string;
    name: string | null;
  };
  organization?: Organization | null;
  mediaItem?: ServedMediaItem | null;
}

/** As content-api serves it: never the transcoder's raw detail. */
export interface MediaItemWithRelations extends ServedMediaItem {
  creator?: {
    id: string;
    email: string;
    name: string | null;
  };
}

/**
 * Shared layout types used across Header, Footer, and Sidebar components.
 * Single source of truth — imported by all layout components.
 */
export interface LayoutUser {
  name: string;
  email: string;
  image?: string;
  role?: string;
}

export interface LayoutOrganization {
  name: string;
  slug: string;
  logoUrl?: string;
}

/**
 * Organization data for org context (web app extended version)
 * Includes UI-specific fields not present in backend Organization type
 */
interface OrgBrandFineTune {
  // Fine-tune values (text/heading/body weight, shadow scale/color, heading
  // colour, etc.) are stored as keys inside tokenOverrides JSON. The
  // previously broken-out columns were dropped in Codex-g49b4.
  tokenOverrides?: string | null;
  darkModeOverrides?: string | null;
  /** Codex-wwedk: dark-theme tokenOverrides JSON (parallel to tokenOverrides). */
  darkTokenOverrides?: string | null;
}

// ─── Wire-Shape Helpers ────────────────────────────────────────────────────

/**
 * Replace every `Date` field on `T` with `string`.
 *
 * Drizzle row types (e.g. `Subscription`, `SubscriptionTier`) declare
 * `timestamp` columns as `Date`, but those values become ISO strings the
 * moment they cross a JSON boundary (server load → page, fetch → response).
 * Using the bare row type on the client invites `as unknown as string`
 * casts at every `formatDate(...)` call site.
 *
 * `DateAsString<T>` is the canonical wire-shape transformation: it walks
 * `T` once, rewrites `Date` → `string`, preserves nullability, and is
 * idempotent on already-string fields.
 *
 * Use it whenever you ascribe a Drizzle row as the response type of an
 * API call or `+page.server.ts` load — never reach for `as unknown as` to
 * paper over the mismatch in components.
 */
type DateAsString<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K] extends Date | undefined
        ? string | undefined
        : T[K] extends Date | null | undefined
          ? string | null | undefined
          : T[K];
};

// ─── Subscription Types ────────────────────────────────────────────────────

/**
 * A subscription as its subscriber receives it: the row without the org's fee
 * split or the internal bookkeeping fields, which the service leaves out of
 * both reads below (`SUBSCRIBER_HIDDEN_COLUMNS` in @codex/subscription,
 * Codex-mbs2l).
 */
type SubscriberSubscription = Omit<
  Subscription,
  | 'platformFeeCents'
  | 'organizationFeeCents'
  | 'creatorPayoutCents'
  | 'duplicateOfSubscriptionId'
  | 'churnReason'
>;

/**
 * Subscription with tier and org info, matching backend SubscriptionWithOrg shape.
 * Returned by GET /subscriptions/mine.
 *
 * Wire shape: timestamps (`currentPeriodStart`, `currentPeriodEnd`,
 * `cancelledAt`, `createdAt`, `updatedAt`) arrive as ISO strings over JSON,
 * not the `Date` instances Drizzle declares. `DateAsString<...>` performs
 * the row → wire transformation at the type level so `formatDate(...)`
 * call sites never need `as unknown as string`.
 */
export interface UserOrgSubscription
  extends DateAsString<SubscriberSubscription> {
  tier: DateAsString<SubscriptionTier>;
  organization: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  };
}

/**
 * Subscription with tier info for current org context.
 * Returned by GET /subscriptions/current.
 *
 * Wire shape: see `UserOrgSubscription` above for rationale.
 */
export interface CurrentSubscription
  extends DateAsString<SubscriberSubscription> {
  tier: DateAsString<SubscriptionTier>;
}

/**
 * Wire shape for the proration confirmation dialog.
 *
 * Mirrors `TierChangePreview` from `@codex/subscription`, with `currentPeriodEnd`
 * as an ISO string (server serialises Date over JSON). The `prorationDate`
 * (Unix timestamp in seconds) MUST be threaded back into the change-tier
 * commit so Stripe re-uses the exact proration calculation that produced
 * `amountDueCents` — otherwise the user gets charged a different amount than
 * they confirmed.
 */
export interface TierChangePreview {
  amountDueCents: number;
  prorationLineItems: Array<{
    description: string | null;
    amountCents: number;
  }>;
  newRecurringAmountCents: number;
  newRecurringInterval: 'month' | 'year';
  prorationDate: number;
  isUpgrade: boolean;
  currentPeriodEnd: string;
}

/**
 * Subscription context for a content detail page.
 *
 * Canonical declaration site (Codex-lqvw4.16) — previously declared in
 * `lib/server/content-detail.ts`, but server modules can't be imported by
 * client code, which forced duplicate type declarations in client utilities.
 * Lives here so both server (`loadSubscriptionContext()` return type) and
 * client (`useSubscriptionContext()` parameter type) can import the same
 * shape.
 *
 * Narrower client views may use `Pick<SubscriptionContext, ...>` rather than
 * redeclare a near-equivalent shape.
 */
export interface SubscriptionContext {
  /** Whether the content requires a subscription tier */
  requiresSubscription: boolean;
  /** Whether the user has an active subscription to this org */
  hasSubscription: boolean;
  /** Whether the user's tier is high enough for this content */
  subscriptionCoversContent: boolean;
  /** The user's current subscription (null if none) */
  currentSubscription: CurrentSubscription | null;
  /** All active tiers for this org (for the subscribe modal) */
  tiers: SubscriptionTier[];
}

/**
 * Tiers-only context for org pages.
 *
 * Distinct from `SubscriptionContext` (Codex-lqvw4.16): this is the shape
 * streamed by the org `+layout.server.ts` to power "Included" badges on
 * landing/explore pages — the user's subscription state is read client-side
 * from `subscriptionCollection`, so the layout only needs to ship the org's
 * tier list. Previously misnamed `SubscriptionContext` in
 * `access-context.svelte.ts`, which collided with the canonical 5-field
 * shape.
 */
export interface OrgTiersContext {
  tiers: SubscriptionTier[];
}

/**
 * Per-tier subscriber and MRR breakdown.
 */
interface TierBreakdown {
  tierId: string;
  tierName: string;
  subscriberCount: number;
  mrrCents: number;
}

/**
 * Subscription stats for an org (admin view).
 * Returned by GET /subscriptions/stats
 */
export interface SubscriptionStats {
  totalSubscribers: number;
  activeSubscribers: number;
  mrrCents: number;
  tierBreakdown: TierBreakdown[];
}

/**
 * Stripe Connect requirements payload.
 *
 * Normalised from Stripe's `Account.Requirements` shape — `null` arrays
 * are converted to `[]` server-side so the UI can iterate without guards.
 * `currentDeadline` is a Unix timestamp (seconds) — multiply by 1000 for
 * JavaScript `Date`.
 */
export interface ConnectRequirements {
  currentlyDue: string[];
  eventuallyDue: string[];
  pastDue: string[];
  pendingVerification: string[];
  currentDeadline: number | null;
  disabledReason: string | null;
  errors: Array<{ requirement: string; code: string; reason: string }>;
}

/**
 * Connect account status response.
 * Returned by GET /connect/me/status and POST /connect/me/sync
 */
export interface ConnectAccountStatusResponse {
  isConnected: boolean;
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  status: 'onboarding' | 'active' | 'restricted' | 'disabled' | null;
  /**
   * Live Stripe requirements payload (currently_due, eventually_due,
   * current_deadline, errors). Null when the account isn't connected, or
   * when Stripe was unreachable on the cache-miss path (degrades gracefully —
   * the UI shows status only, no requirements list).
   */
  requirements: ConnectRequirements | null;
  /**
   * True when the live Stripe requirements fetch FAILED (Codex-y2htq). Lets the
   * UI distinguish "no outstanding requirements" (`requirements: null` +
   * `false`/absent) from "we couldn't check right now" (`requirements: null` +
   * `true`) and show a retry affordance instead of a false "all clear".
   * Optional for backward-compat with older payloads.
   */
  requirementsFetchFailed?: boolean;
}

/**
 * An organisation's payout status — status fields only, for any member.
 * Returned by GET /connect/organization-status (Codex-2hxff.1).
 */
export type OrganizationPayoutStatusResponse = Pick<
  ConnectAccountStatusResponse,
  'isConnected' | 'chargesEnabled' | 'payoutsEnabled' | 'status'
>;

/**
 * Connect onboard response.
 * Returned by POST /connect/me/onboard
 */
export interface ConnectOnboardResponse {
  accountId: string;
  onboardingUrl: string;
}

/**
 * Connect dashboard link response.
 * Returned by POST /connect/me/dashboard
 */
export interface ConnectDashboardResponse {
  url: string;
}

/**
 * Subscription checkout session response.
 * Returned by POST /subscriptions/checkout
 */
export interface SubscriptionCheckoutResponse {
  sessionUrl: string;
  sessionId: string;
}

// Re-export for convenience
export type { SubscriptionTier } from '@codex/database/schema';

// ─── Organization Member Types ────────────────────────────────────────────

/**
 * Organization member item shape returned by the members API.
 * Defined here (not in $lib/server/api) because components import it directly.
 */
export interface OrgMemberItem {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  joinedAt: string;
}

/**
 * What removing a member would unwind (Codex-2hxff.64): counts from
 * `GET /api/organizations/:id/members/:userId/departure-preview`, scoped to the
 * organisation and that member as creator. Mirrors `DeparturePreview` in
 * `@codex/organization`.
 */
export interface DeparturePreview {
  /** Active revenue-share agreements, which end at removal. */
  agreements: number;
  /** Published content, which comes off sale at removal. */
  contentOnSale: number;
  /** Published courses, which come off sale at removal. */
  coursesOnSale: number;
  /** Live course subscriptions to those courses, cancelled at period end. */
  courseSubscriptions: number;
  /** Tier subscribers who keep the member's work until their next renewal. */
  tierSubscribersAffected: number;
}

// ─── Access grants and purchase history (Codex-2hxff.21) ──────────────────
//
// Mirrors the fixed API contract for the access-gaps change. Defined here
// (not in $lib/server/api) because the studio drawer and the account page
// read them.

/**
 * A support grant of one item to one customer, from
 * `GET /api/admin/customers/:customerId/grants`. Live and revoked grants are
 * both listed (newest `grantedAt` first), so the drawer keeps a record.
 */
export interface CustomerGrant {
  /** The entitlement id, which the revoke route takes. */
  id: string;
  contentId: string;
  contentTitle: string;
  contentSlug: string;
  /** ISO 8601. */
  grantedAt: string;
  /** The studio member who made the grant, when still known. */
  grantedByName: string | null;
  /** ISO 8601; `null` while the grant is live. */
  revokedAt: string | null;
  revokedByName: string | null;
}

/**
 * One row of the buyer's purchase history (`GET /purchases`). Content and
 * course purchases share the list; `kind` says which, and only that kind's
 * id and title are set.
 */
export interface PurchaseListItem {
  id: string;
  customerId: string;
  /** ISO 8601. */
  createdAt: string;
  kind: 'content' | 'course';
  contentId: string | null;
  contentTitle: string | null;
  courseId: string | null;
  courseTitle: string | null;
  amountCents: number;
  status: string;
  /**
   * ISO 8601; set when a chargeback opened on the payment. A won dispute
   * clears it. A lost one refunds the row and leaves it set, so the dispute
   * is open only while `status` is still `'completed'` (Codex-2hxff.60).
   */
  disputedAt: string | null;
}

// ─── Ownership Transfer Types (Codex-2hxff.2) ──────────────────────────────
//
// Mirrors the fixed API contract in
// `docs/handover/payments-sources/ownership-transfer/api-contract.md`. Defined
// here (not in $lib/server/api) because the studio components read them.

export type OwnershipRole = 'owner' | 'admin' | 'creator';

export type OwnershipOfferStatus =
  | 'open'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'expired';

export type OwnershipWithdrawnReason =
  | 'owner_cancelled'
  | 'recipient_ineligible'
  | 'support_reassigned';

/** One offer row, as the offer / withdraw / decline routes return it. */
export interface OwnershipOffer {
  id: string;
  organizationId: string;
  offeredByUserId: string;
  recipientUserId: string;
  status: OwnershipOfferStatus;
  withdrawnReason: OwnershipWithdrawnReason | null;
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
}

export interface OwnershipEligibleRecipient {
  userId: string;
  name: string;
  role: 'admin' | 'creator';
  joinedAt: string;
  payoutsReady: boolean;
}

export interface OwnershipActiveAgreement {
  creatorName: string;
  revenueType: 'subscription' | 'content_purchase';
  /** The creator's share in basis points (10000 = 100%). */
  shareBps: number;
  /** `effective_from`. */
  since: string;
}

export interface OwnershipLastOutcome {
  status: Exclude<OwnershipOfferStatus, 'open'>;
  recipientName: string;
  /** `responded_at`. */
  at: string;
  withdrawnReason: OwnershipWithdrawnReason | null;
}

/**
 * `GET /api/organizations/:id/ownership`. The optional fields are OMITTED for
 * viewers who may not see them — see each comment.
 */
export interface OwnershipView {
  owner: {
    userId: string;
    name: string;
    avatarUrl: string | null;
    /** `started_at` of the open ownership period. */
    ownerSince: string;
    /** The owner's Connect account has charges + payouts enabled. */
    payoutsReady: boolean;
  };
  viewerRole: OwnershipRole;
  /** Owner, or the offer's recipient. Null for everyone else and when none is open. */
  openOffer: {
    id: string;
    /** `payoutsReady` drives the state 6 "your payouts aren't set up" warning. */
    recipient: { userId: string; name: string; payoutsReady: boolean };
    offeredBy: { userId: string; name: string };
    offeredAt: string;
    expiresAt: string;
  } | null;
  /** OWNER ONLY: the newest closed offer (mockup state 9). */
  lastOutcome?: OwnershipLastOutcome | null;
  /** OWNER ONLY: active admins and creators, excluding the owner. */
  eligibleRecipients?: OwnershipEligibleRecipient[];
  /** OWNER ONLY: drives the state 3 "your subscription income will stop" warning. */
  ownerHasSubscriptionAgreement?: boolean;
  /** Owner or the open offer's recipient: the state 6 list. */
  activeAgreements?: OwnershipActiveAgreement[];
}

/** `POST …/offers/:offerId/accept`. */
export interface OwnershipAccepted {
  /** The caller, now the owner. */
  ownerUserId: string;
  ownerSince: string;
  /** Now an admin. */
  previousOwnerUserId: string;
}

/** The caller's open, unexpired offer for an org (on my-membership). */
export interface PendingOwnershipOffer {
  offerId: string;
  offeredByName: string;
  expiresAt: string;
}

/**
 * `GET /api/organizations/:id/members/my-membership` after Codex-2hxff.2.
 * Widened locally rather than in `@codex/shared-types` so apps/web does not
 * wait on a package rebuild; the extra field is additive.
 */
export type MyMembershipWithOwnership = MyMembershipResponse & {
  pendingOwnershipOffer: PendingOwnershipOffer | null;
};

// ─── Organization Types ────────────────────────────────────────────────────

/**
 * Public organization shape returned by the org-api `getPublicInfo` endpoint
 * (and the authenticated `getBySlug` fallback) — used by the org layout server
 * load and surfaced to every page rendered under `_org/[slug]/*`.
 *
 * Wire shape is the single source of truth in
 * `workers/organization-api/src/routes/organizations.ts` (`fetchPublicOrgInfo`):
 *   - `heroLayout` is the `HeroLayout` enum from `@codex/validation`
 *     (`HERO_LAYOUTS`); it drives the `data-hero-layout` attribute on
 *     `.org-layout` so the wrong value silently falls back to `'default'`.
 *   - `enableSubscriptions` comes from `FeatureSettingsResponse` and gates
 *     the subscription UI on the public storefront.
 *
 * Both fields MUST be present here so the org layout doesn't need to widen
 * the shape with a hand-written `as` cast — keeping the client and worker
 * contracts in lockstep.
 */
export interface OrganizationData {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  brandColors?: {
    primary?: string;
    secondary?: string | null;
    accent?: string | null;
    background?: string | null;
  };
  brandFonts?: { body?: string | null; heading?: string | null };
  brandRadius?: number;
  brandDensity?: number;
  brandFineTune?: OrgBrandFineTune;
  introVideoUrl?: string | null;
  heroLayout?: HeroLayout;
  enableSubscriptions?: boolean;
}
