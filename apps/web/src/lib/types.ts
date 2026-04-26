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
  MediaItem,
  Organization,
  Subscription,
  SubscriptionTier,
} from '@codex/database/schema';

export interface ContentWithRelations extends Content {
  creator?: {
    id: string;
    email: string;
    name: string | null;
  };
  organization?: Organization | null;
  mediaItem?: MediaItem | null;
}

export interface MediaItemWithRelations extends MediaItem {
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
export interface OrgBrandFineTune {
  tokenOverrides?: string | null;
  darkModeOverrides?: string | null;
  shadowScale?: string | null;
  shadowColor?: string | null;
  textScale?: string | null;
  headingWeight?: string | null;
  bodyWeight?: string | null;
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
export type DateAsString<T> = {
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
 * Subscription with tier and org info, matching backend SubscriptionWithOrg shape.
 * Returned by GET /subscriptions/mine.
 *
 * Wire shape: timestamps (`currentPeriodStart`, `currentPeriodEnd`,
 * `cancelledAt`, `createdAt`, `updatedAt`) arrive as ISO strings over JSON,
 * not the `Date` instances Drizzle declares. `DateAsString<...>` performs
 * the row → wire transformation at the type level so `formatDate(...)`
 * call sites never need `as unknown as string`.
 */
export interface UserOrgSubscription extends DateAsString<Subscription> {
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
export interface CurrentSubscription extends DateAsString<Subscription> {
  tier: DateAsString<SubscriptionTier>;
}

/**
 * Per-tier subscriber and MRR breakdown.
 */
export interface TierBreakdown {
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
 * Connect account status response.
 * Returned by GET /connect/status
 */
export interface ConnectAccountStatusResponse {
  isConnected: boolean;
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  status: 'onboarding' | 'active' | 'restricted' | 'disabled' | null;
}

/**
 * Connect onboard response.
 * Returned by POST /connect/onboard
 */
export interface ConnectOnboardResponse {
  accountId: string;
  onboardingUrl: string;
}

/**
 * Connect dashboard link response.
 * Returned by POST /connect/dashboard
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

/**
 * Subscriber item in admin list.
 * Returned by GET /subscriptions/subscribers
 */
export interface SubscriberItem {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  tierId: string;
  tierName: string;
  status: string;
  billingInterval: string;
  amountCents: number;
  currentPeriodEnd: string;
  createdAt: string;
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

// ─── Organization Types ────────────────────────────────────────────────────

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
}
