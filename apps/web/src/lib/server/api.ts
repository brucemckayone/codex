/**
 * Server-side API client factory
 *
 * Provides typed access to backend workers with:
 * - Automatic URL resolution based on environment
 * - Session cookie forwarding
 * - Typed error handling
 * - Helper methods for common endpoints
 */

import type {
  PlaybackProgressResponse,
  StreamingUrlResponse,
  UpdatePlaybackProgressResponse,
  UserLibraryResponse,
} from '@codex/access';
import type {
  ActivityFeedResponse,
  ContentPerformanceItem,
  CreatorRevenueSplitItem,
  CustomerDetails,
  CustomerListItem,
  DashboardStats,
  FollowerStats,
  RevenueStats,
  SubscriberStats,
  TopContentItem,
} from '@codex/admin';
import type {
  AgreementProposal,
  CreatorOrganizationAgreement,
} from '@codex/agreements';
import { COOKIES, HEADERS, MIME_TYPES } from '@codex/constants';
import type {
  Category,
  CourseSubscriptionPlan,
  MediaItem,
} from '@codex/database/schema';
import type { AvatarUploadResponse } from '@codex/identity';
import type { NotificationPreferencesResponse } from '@codex/notifications';
import type {
  PurchaseListItem,
  SaleListItem,
  SalesStats,
} from '@codex/purchase';
import type {
  AllSettingsResponse,
  BrandingSettingsResponse,
  CheckSlugResponse,
  ContactSettingsResponse,
  CourseOffer,
  FeatureSettingsResponse,
  MyMembershipResponse,
  OrganizationPublicStatsResponse,
  OrganizationWithRole,
  PaginatedListResponse,
  PublicBrandingResponse,
  SessionData,
  UserData,
} from '@codex/shared-types';
import type {
  CreatorEarningsSummary,
  CreatorPayoutBreakdown,
  PayoutSummary,
  PayoutWithCreator,
  SubscriberListItem,
} from '@codex/subscription';
import {
  buildServiceUrl as getServiceUrl,
  type ServiceName,
} from '@codex/urls';
import type {
  CancelSubscriptionInput,
  ChangeTierInput,
  ConnectMeOnboardInput,
  ConnectOnboardInput,
  CreateCategoryInput,
  CreateCheckoutInput,
  CreatePortalSessionInput,
  CreateSubscriptionCheckoutInput,
  CreateTierInput,
  ReactivateSubscriptionInput,
  ResumeSubscriptionInput,
  UpdateBrandingInput,
  UpdateCategoryInput,
  UpdateContactInput,
  UpdateCreatorOnboardingInput,
  UpdateFeaturesInput,
  UpdateNotificationPreferencesInput,
  UpdateProfileInput,
  UpdateTierInput,
  UpgradeToCreatorInput,
} from '@codex/validation';
import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
// Studio journey-insights view shape (Codex-2pryk Round-D · WP-7). The FROZEN
// FE contract from the metric-model; the content-api route serialises the
// structurally-identical `@codex/access` twin. Type-only (erased).
import type { JourneyInsightsData } from '$lib/components/studio/journey-insights/metric-model';
// Journey member-surface view shapes (Codex-2pryk Round-D). Structurally
// identical to @codex/shared-types' cross-worker mirror the content-api routes
// serialise; imported from the FE $lib bag so callers get the exact FE types.
import type {
  CompletionSource,
  ContentCourseLinks,
  CourseCardSummary,
  CourseDashboardData,
  EnrolledCourseSummary,
  InCoursePracticeData,
  JourneyCourseSummary,
  PracticeCompletionRecord,
} from '$lib/journeys/types';
import { logger } from '$lib/observability';
// Journey PUBLIC sales-page shapes (Codex-2pryk Round-D · WP-3). Same FE-mirror
// rationale as above: the content-api serialises the `@codex/shared-types`
// twins (`JourneyCoursePage` / `CourseSellPreview`); these FE types are the
// structurally-identical shapes the renderer consumes. Type-only (erased) — no
// runtime import of the page-builder barrel.
import type {
  EditorCurriculum,
  EnrolledJourneyCard,
  JourneyCardView,
  JourneyCoursePage,
  JourneyListItem,
  JourneyPageRecord,
  JourneySellMedia,
  PageOffer,
} from '$lib/page-builder';
import type { SellPreview } from '$lib/page-builder/render';
// Import local types that extend DB types with relations
// OrgMemberItem is in $lib/types (not here) so components can import it
// without triggering the vite server-only module guard.
import type {
  CheckoutResponse,
  ConnectAccountStatusResponse,
  ConnectDashboardResponse,
  ConnectOnboardResponse,
  ContentWithRelations,
  CurrentSubscription,
  MediaItemWithRelations,
  OrganizationData,
  OrgMemberItem,
  SubscriptionCheckoutResponse,
  SubscriptionStats,
  SubscriptionTier,
  TierChangePreview,
  UserOrgSubscription,
} from '../types';
import { ApiError } from './errors';

/**
 * One item from `GET /api/content/public`, typed to match what the endpoint
 * ACTUALLY returns — not the raw DB row. The worker resolves R2 keys to CDN
 * URLs (`resolveR2Urls` adds `thumbnailUrl` + `hlsPreviewUrl` to `mediaItem`)
 * and `listPublic` attaches `categorySlugs`; `content_type` is a `varchar`
 * column (so `ContentWithRelations` widens it to `string`) but is constrained
 * to its enum, so we narrow it here. The SPEC §6.1 access-policy flags
 * (`isFree` / `isPurchasable` + `priceCents` / `includedInTierId` /
 * `isFollowerGated` / `isTeamOnly` / `courseOnly`) flow through unchanged from
 * `ContentWithRelations` (WP-1 replaced the single `accessType` enum). This is
 * the single source of truth for the landing/explore `ContentItem` shape.
 */
export type PublicContentListItem = Omit<
  ContentWithRelations,
  'mediaItem' | 'contentType'
> & {
  mediaItem:
    | (MediaItem & {
        thumbnailUrl: string | null;
        hlsPreviewUrl: string | null;
      })
    | null;
  contentType: 'video' | 'audio' | 'written';
  categorySlugs: string[];
};

/**
 * Resolve API URL for a worker
 *
 * @param platform - Platform interface containing env bindings
 * @param worker - Worker name
 * @returns The resolved base URL
 */
export function serverApiUrl(
  platform: App.Platform | undefined,
  worker: ServiceName
): string {
  // If SvelteKit is in dev mode (including E2E tests), ensure we use local ports.
  if (dev) {
    return getServiceUrl(
      worker,
      platform?.env ? { ...platform.env, dev: true } : true
    );
  }
  return getServiceUrl(worker, platform?.env || dev);
}

/**
 * Build the `Cookie` header value for forwarding the session token to the
 * AUTH worker's BetterAuth endpoints (`get-session`, `sign-out`).
 *
 * **The `__Secure-` prefix trap (production auth break, 2026-06-24):**
 * BetterAuth prefixes EVERY cookie name with `__Secure-` when its `baseURL`
 * is HTTPS — see `better-auth/dist/cookies/index.mjs`:
 *   `secureCookiePrefix = baseURL.startsWith("https://") ? "__Secure-" : ""`
 * The auth worker's `baseURL` is `WEB_APP_URL`, so in every deployed env
 * (prod / staging / dev-remote) the session cookie is named
 * `__Secure-better-auth.session_token`; only local dev (http://lvh.me) uses
 * the unprefixed `better-auth.session_token`.
 *
 * BetterAuth's `get-session` reads ONLY `ctx.context.authCookies.sessionToken.name`
 * (`api/routes/session.mjs`) with NO unprefixed fallback, so forwarding under
 * the unprefixed name silently yields `null` → every login bounces back to
 * /login. Forwarding BOTH names is robust across every env without env-sniffing
 * at each call site. A `Cookie` request header carries no `__Secure-` browser
 * restrictions (those only govern `Set-Cookie` storage), so this is safe.
 *
 * Non-auth workers (content/identity/...) validate via `@codex/security`,
 * which reads `codex-session` (`COOKIES.SESSION_NAME`) — included first.
 *
 * IMPORTANT: the value is forwarded verbatim (no encoding) to avoid corrupting
 * the `token.hmac` signature (URL-safe base64: A-Z a-z 0-9 - _ .).
 */
export function buildAuthForwardingCookie(sessionToken: string): string {
  return (
    `${COOKIES.SESSION_NAME}=${sessionToken}; ` +
    `__Secure-better-auth.session_token=${sessionToken}; ` +
    `better-auth.session_token=${sessionToken}`
  );
}

/**
 * Re-forward a browser-uploaded file to a worker as a fresh multipart body.
 *
 * A File reconstructed off the inbound SvelteKit request does NOT reliably
 * survive re-serialisation into a new outbound multipart body over a real
 * cross-worker fetch in workerd: the part reaches the worker WITHOUT a
 * `filename`, so it is parsed as a string form field rather than a File and
 * rejected with MissingFileError (a 400) before any type/size logic runs.
 * This is invisible locally — Node/undici preserves the part — and only
 * reproduces in production. It bit the avatar path first, then the logo path
 * (both Codex-sxm74); this helper is the single home for the fix so a third
 * upload path cannot silently reintroduce it.
 *
 * The fix: read `file.arrayBuffer()` into a brand-new in-memory File and append
 * it with an explicit filename, making the re-forward deterministic across
 * runtimes.
 *
 * On failure, surfaces the worker's real (already `mapErrorToResponse`-
 * sanitised) error message instead of masking every failure behind
 * `failureMessage` — that opacity is exactly what hid the original prod 400.
 * On success, unwraps the single-item procedure envelope (`{ data: T }` → `T`).
 */
async function forwardMultipartUpload<T>(options: {
  url: string;
  fieldName: string;
  file: File;
  fallbackFilename: string;
  sessionCookie: string | undefined;
  failureMessage: string;
}): Promise<T> {
  const {
    url,
    fieldName,
    file,
    fallbackFilename,
    sessionCookie,
    failureMessage,
  } = options;

  const bytes = await file.arrayBuffer();
  const forwardFile = new File([bytes], file.name || fallbackFilename, {
    type: file.type || 'application/octet-stream',
  });
  const formData = new FormData();
  formData.append(fieldName, forwardFile, forwardFile.name);

  const res = await fetch(url, {
    method: 'POST',
    headers: sessionCookie
      ? { Cookie: `${COOKIES.SESSION_NAME}=${sessionCookie}` }
      : {},
    body: formData,
  });

  if (!res.ok) {
    let message = failureMessage;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // Non-JSON body — keep the generic message.
    }
    throw new ApiError(res.status, message);
  }

  const json = await res.json();
  // Unwrap single-item envelope: { data: T } → T
  const record = json as Record<string, unknown>;
  if ('data' in record && record.data != null) {
    return record.data as T;
  }
  return json as T;
}

/**
 * Create a server-side API client
 *
 * @param platform - The SvelteKit platform object with env bindings
 * @param cookies - SvelteKit cookies object for session forwarding
 * @returns API client with typed fetch method and helper functions
 *
 * @example
 * ```typescript
 * // In +page.server.ts load function
 * export async function load({ cookies, platform }) {
 *   const api = createServerApi(platform, cookies);
 *   const session = await api.auth.getSession();
 *   return { session };
 * }
 * ```
 */
/**
 * Creator first-run onboarding state as returned over the wire (timestamps
 * are ISO strings after JSON serialization of the service's Date fields).
 */
export interface CreatorOnboardingResponse {
  currentStep: string;
  welcomeSeenAt: string | null;
  dismissedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createServerApi(
  platform: App.Platform | undefined,
  cookies?: Cookies
) {
  // Extract session cookie for forwarding to API workers
  const sessionCookie = cookies?.get(COOKIES.SESSION_NAME);

  /**
   * Make a fetch request to a backend worker
   *
   * @param worker - Which worker to call
   * @param path - API path (starting with /)
   * @param options - Additional fetch options
   * @returns Typed response data
   */
  async function request<T>(
    worker: ServiceName,
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${serverApiUrl(platform, worker)}${path}`;
    const headers: HeadersInit = {
      [HEADERS.CONTENT_TYPE]: MIME_TYPES.APPLICATION.JSON,
      ...options?.headers,
    };

    if (sessionCookie) {
      // Forward under every name the auth worker's BetterAuth might read.
      // See buildAuthForwardingCookie for the `__Secure-` prefix rationale.
      (headers as Record<string, string>).Cookie =
        buildAuthForwardingCookie(sessionCookie);
    }

    // Abort fetch after 10 seconds to prevent indefinite hangs when a worker
    // is slow or unresponsive (e.g. during E2E tests with cold KV/DB).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const timer = logger.startTimer(`api:${worker}${path}`);
    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        timer.end({ method: options?.method ?? 'GET', status: 408 });
        throw new ApiError(
          408,
          `Request to ${worker}${path} timed out`,
          'REQUEST_TIMEOUT'
        );
      }
      throw err;
    }
    clearTimeout(timeoutId);
    timer.end({ method: options?.method ?? 'GET', status: response.status });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      // Workers wrap errors in `{ error: { code, message, details } }`
      // (see @codex/service-errors `mapErrorToResponse`). Older callers
      // sometimes emit a flat `{ message, code }` shape (BetterAuth,
      // non-procedure routes) — fall back gracefully.
      const nested =
        body && typeof body === 'object' && body.error
          ? (body.error as {
              code?: string;
              message?: string;
              details?: unknown;
            })
          : undefined;
      const flat = body as {
        message?: string;
        code?: string;
        details?: unknown;
      } | null;
      const message = nested?.message ?? flat?.message ?? 'API Error';
      const code = nested?.code ?? flat?.code;
      const details = nested?.details ?? flat?.details;
      throw new ApiError(response.status, message, code, details);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return null as T;
    }

    const json = await response.json();
    // Unwrap procedure() envelope to give callers the inner payload.
    //
    // Response shapes:
    //   List:   { items: T[], pagination: {...} }  → return as-is (PaginatedListResponse)
    //   Single: { data: T }                        → unwrap to T
    //   Other:  { user, session } (BetterAuth)     → return as-is
    if (json == null || typeof json !== 'object') return json as T;
    const record = json as Record<string, unknown>;
    // List envelope: { items, pagination } — return as-is, matches PaginatedListResponse<T>
    if (Array.isArray(record.items) && record.pagination != null) {
      return json as T;
    }
    // Single-item envelope: { data: T } — unwrap
    if ('data' in record) {
      return record.data as T;
    }
    // Fallback: BetterAuth, raw endpoints
    return json as T;
  }

  /**
   * Builds an ecom-api URL with `organizationId` appended to the search
   * params, merging any caller-supplied URLSearchParams. The worker
   * re-derives scope from the authenticated membership — the URL param
   * is only used by `procedure()` to resolve org context.
   */
  function withOrg(
    path: string,
    organizationId: string,
    params?: URLSearchParams
  ): string {
    const q = new URLSearchParams(params);
    q.set('organizationId', organizationId);
    return `${path}?${q}`;
  }

  return {
    /**
     * Low-level fetch method (for backward compatibility)
     *
     * @deprecated Use specific helper methods instead
     */
    async fetch<T>(
      worker: ServiceName,
      path: string,
      customSessionCookie?: string,
      options?: RequestInit
    ): Promise<T> {
      const url = `${serverApiUrl(platform, worker)}${path}`;
      const headers: HeadersInit = {
        [HEADERS.CONTENT_TYPE]: MIME_TYPES.APPLICATION.JSON,
        ...options?.headers,
      };

      const cookieToUse = customSessionCookie || sessionCookie;
      if (cookieToUse) {
        (headers as Record<string, string>).Cookie =
          buildAuthForwardingCookie(cookieToUse);
      }

      // AbortController timeout — matches request() to prevent indefinite hangs
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const timer = logger.startTimer(`api.fetch:${worker}${path}`);
      let response: Response;
      try {
        response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof DOMException && err.name === 'AbortError') {
          timer.end({ method: options?.method ?? 'GET', status: 408 });
          throw new ApiError(
            408,
            `Request to ${worker}${path} timed out`,
            'REQUEST_TIMEOUT'
          );
        }
        throw err;
      }
      clearTimeout(timeoutId);
      timer.end({ method: options?.method ?? 'GET', status: response.status });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        const nested =
          body && typeof body === 'object' && body.error
            ? (body.error as {
                code?: string;
                message?: string;
                details?: unknown;
              })
            : undefined;
        const flat = body as {
          message?: string;
          code?: string;
          details?: unknown;
        } | null;
        const message = nested?.message ?? flat?.message ?? 'API Error';
        const code = nested?.code ?? flat?.code;
        const details = nested?.details ?? flat?.details;
        throw new ApiError(response.status, message, code, details);
      }

      if (response.status === 204) {
        return null as T;
      }

      const json = await response.json();
      if (json == null || typeof json !== 'object') return json as T;
      const record = json as Record<string, unknown>;
      if (Array.isArray(record.items) && record.pagination != null) {
        return json as T;
      }
      if ('data' in record) {
        return record.data as T;
      }
      return json as T;
    },

    /**
     * Authentication endpoints
     */
    auth: {
      /**
       * Get current session
       */
      getSession: () =>
        request<{ user?: UserData; session?: SessionData } | null>(
          'auth',
          '/api/auth/get-session'
        ),
    },

    /**
     * Account endpoints
     */
    account: {
      /**
       * Get user profile
       */
      getProfile: () => request<UserData>('identity', '/api/user/profile'),

      /**
       * Update user profile
       */
      updateProfile: (data: UpdateProfileInput) =>
        request<UserData>('identity', '/api/user/profile', {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),

      /**
       * Upgrade customer account to creator
       */
      upgradeToCreator: (data: UpgradeToCreatorInput) =>
        request<UserData & { role: string }>(
          'identity',
          '/api/user/upgrade-to-creator',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        ),

      /**
       * Soft-delete the authenticated user's own account.
       * Server requires the typed confirmation and blocks (422) if the user
       * still owns an organization.
       */
      deleteAccount: () =>
        request<null>('identity', '/api/user/account', {
          method: 'DELETE',
          body: JSON.stringify({ confirmation: 'DELETE' }),
        }),

      /**
       * Get notification preferences
       */
      getNotificationPreferences: () =>
        request<NotificationPreferencesResponse>(
          'identity',
          '/api/user/notification-preferences'
        ),

      /**
       * Update notification preferences
       */
      updateNotificationPreferences: (
        data: UpdateNotificationPreferencesInput
      ) =>
        request<NotificationPreferencesResponse>(
          'identity',
          '/api/user/notification-preferences',
          {
            method: 'PUT',
            body: JSON.stringify(data),
          }
        ),

      /**
       * Get creator first-run onboarding state (upserts defaults on first access)
       */
      getCreatorOnboarding: () =>
        request<CreatorOnboardingResponse>(
          'identity',
          '/api/user/creator-onboarding'
        ),

      /**
       * Patch creator onboarding state (step pointer + boolean intents)
       */
      updateCreatorOnboarding: (data: UpdateCreatorOnboardingInput) =>
        request<CreatorOnboardingResponse>(
          'identity',
          '/api/user/creator-onboarding',
          {
            method: 'PATCH',
            body: JSON.stringify(data),
          }
        ),

      /**
       * Upload avatar (multipart - uses raw fetch for FormData, then unwraps procedure envelope)
       */
      uploadAvatar: (file: File): Promise<AvatarUploadResponse> =>
        forwardMultipartUpload<AvatarUploadResponse>({
          url: `${serverApiUrl(platform, 'identity')}/api/user/avatar`,
          fieldName: 'avatar',
          file,
          fallbackFilename: 'avatar',
          sessionCookie,
          failureMessage: 'Upload failed',
        }),

      /**
       * Delete avatar
       */
      deleteAvatar: () =>
        request<void>('identity', '/api/user/avatar', {
          method: 'DELETE',
        }),

      /**
       * Get purchase history
       *
       * Query parameters:
       * - page: number (default: 1)
       * - limit: number (1-100, default: 20)
       * - status: 'completed' | 'pending' | 'failed' | 'refunded' (optional filter)
       *
       * @example
       * ```typescript
       * const params = new URLSearchParams();
       * params.set('page', '1');
       * params.set('limit', '20');
       * params.set('status', 'completed');
       * const history = await api.account.getPurchaseHistory(params);
       * ```
       */
      getPurchaseHistory: (params?: URLSearchParams) =>
        request<PaginatedListResponse<PurchaseListItem>>(
          'ecom',
          `/purchases${params ? `?${params}` : ''}`
        ),
    },

    /**
     * Content endpoints
     */
    content: {
      /**
       * Get content by ID
       *
       * @param id - Content UUID
       * @returns Single content item with relations (media, organization, etc.)
       */
      get: (id: string) =>
        request<ContentWithRelations>('content', `/api/content/${id}`),

      /**
       * List content with pagination and filtering
       *
       * Query parameters (from ContentQueryInput):
       * - page: number (default: 1)
       * - limit: number (1-100, default: 20)
       * - status: 'draft' | 'published' | 'archived' (optional)
       * - contentType: 'video' | 'audio' | 'written' (optional)
       * - accessType: 'free' | 'paid' | 'followers' | 'subscribers' | 'team' | 'course' (optional list filter — a query KIND label, not the stored flags)
       * - category: string filter (max 100 chars, optional)
       * - organizationId: UUID filter (optional)
       * - creatorId: UUID filter (optional)
       * - search: text search (max 255 chars, optional)
       * - sortBy: 'createdAt' | 'updatedAt' | 'publishedAt' | 'title' | 'viewCount' | 'purchaseCount' (default: 'createdAt')
       * - sortOrder: 'asc' | 'desc' (default: 'desc')
       *
       * @example
       * ```typescript
       * const params = new URLSearchParams();
       * params.set('status', 'published');
       * params.set('page', '1');
       * params.set('limit', '20');
       * const content = await api.content.list(params);
       * ```
       *
       * @see {@link ContentQueryInput}
       */
      list: (params?: URLSearchParams) =>
        request<PaginatedListResponse<ContentWithRelations>>(
          'content',
          `/api/content${params ? `?${params}` : ''}`
        ),

      /**
       * Browse content (cross-creator within an org).
       *
       * Stricter sibling of `list()`: the worker route enforces
       * `organizationId` is present and the service rejects browse-mode
       * queries that lack it. Use this from any UI that lists content
       * the signed-in user does not necessarily own (e.g. authenticated
       * /explore "popular" / "top-selling" sorts).
       *
       * Multi-tenant boundary: keeps studio drafts (no org filter) on
       * `/api/content` and prevents browse-style callers from silently
       * dropping orgId and leaking another org's data.
       */
      browse: (params: URLSearchParams) =>
        request<PaginatedListResponse<ContentWithRelations>>(
          'content',
          `/api/content/browse?${params}`
        ),

      /**
       * Create new content
       */
      create: (data: unknown) =>
        request<ContentWithRelations>('content', '/api/content', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      /**
       * Update content
       */
      update: (id: string, data: unknown) =>
        request<ContentWithRelations>('content', `/api/content/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),

      /**
       * Publish content (draft -> published)
       */
      publish: (id: string) =>
        request<ContentWithRelations>('content', `/api/content/${id}/publish`, {
          method: 'POST',
        }),

      /**
       * Unpublish content (published -> draft)
       */
      unpublish: (id: string) =>
        request<ContentWithRelations>(
          'content',
          `/api/content/${id}/unpublish`,
          {
            method: 'POST',
          }
        ),

      /**
       * Delete content
       */
      delete: (id: string) =>
        request<void>('content', `/api/content/${id}`, {
          method: 'DELETE',
        }),

      /**
       * Upload content thumbnail (multipart - uses raw fetch for FormData, then unwraps procedure envelope)
       */
      uploadThumbnail: (
        id: string,
        file: File
      ): Promise<{ thumbnailUrl: string; size: number; mimeType: string }> => {
        const url = `${serverApiUrl(platform, 'content')}/api/content/${id}/thumbnail`;
        const formData = new FormData();
        formData.append('thumbnail', file);

        return fetch(url, {
          method: 'POST',
          headers: sessionCookie
            ? { Cookie: `${COOKIES.SESSION_NAME}=${sessionCookie}` }
            : {},
          body: formData,
        }).then(async (res) => {
          if (!res.ok)
            throw new ApiError(res.status, 'Thumbnail upload failed');
          const json = await res.json();
          const record = json as Record<string, unknown>;
          if ('data' in record && record.data != null) {
            return record.data as {
              thumbnailUrl: string;
              size: number;
              mimeType: string;
            };
          }
          return json as {
            thumbnailUrl: string;
            size: number;
            mimeType: string;
          };
        });
      },

      /**
       * Delete content thumbnail
       */
      deleteThumbnail: (id: string) =>
        request<void>('content', `/api/content/${id}/thumbnail`, {
          method: 'DELETE',
        }),

      /**
       * List public content for an organization (no auth required)
       *
       * Query parameters (from PublicContentQueryInput):
       * - orgId: UUID (required) - organization to scope content
       * - page: number (default: 1)
       * - limit: number (1-50, default: 20)
       * - contentType: 'video' | 'audio' | 'written' (optional)
       * - search: text search (max 255 chars, optional)
       * - sort: 'newest' | 'oldest' | 'title' (default: 'newest')
       *
       * @example
       * ```typescript
       * const params = new URLSearchParams();
       * params.set('orgId', orgId);
       * params.set('sort', 'newest');
       * params.set('limit', '12');
       * const content = await api.content.getPublicContent(params);
       * ```
       */
      getPublicContent: (params?: URLSearchParams) =>
        request<PaginatedListResponse<PublicContentListItem>>(
          'content',
          `/api/content/public${params ? `?${params}` : ''}`
        ),

      /**
       * List an organization's published topic categories for the landing
       * "Browse by topic" section (public, no auth). Rows arrive ordered by
       * the curator's `sortOrder`; cover keys are already resolved to
       * md-variant CDN URLs server-side (raw R2 keys are never exposed).
       */
      getPublicCategories: (orgId: string) =>
        request<
          Array<{
            id: string;
            name: string;
            slug: string;
            description: string | null;
            icon: string | null;
            sortOrder: number;
            coverImageUrl: string | null;
          }>
        >(
          'content',
          `/api/content/public/categories?orgId=${encodeURIComponent(orgId)}`
        ),

      /**
       * Get published content platform-wide (discover page).
       * No org scoping — returns content from all organizations.
       */
      getDiscoverContent: (params?: URLSearchParams) =>
        request<PaginatedListResponse<ContentWithRelations>>(
          'content',
          `/api/content/public/discover${params ? `?${params}` : ''}`
        ),

      /**
       * Check if a content slug is available
       */
      checkSlug: (
        slug: string,
        organizationId?: string | null,
        excludeContentId?: string | null
      ) => {
        const params = new URLSearchParams();
        if (organizationId) params.set('organizationId', organizationId);
        if (excludeContentId) params.set('excludeContentId', excludeContentId);
        const qs = params.toString();
        return request<CheckSlugResponse>(
          'content',
          `/api/content/check-slug/${encodeURIComponent(slug)}${qs ? `?${qs}` : ''}`
        );
      },
    },

    /**
     * Category (topic taxonomy) endpoints — co-deployed on content-api at
     * `/api/categories`. Every call carries `?organizationId=` to target the
     * ORG space; omitting it would silently operate on the caller's PERSONAL
     * creator space (the backend's `organizationId` query param is optional).
     * The studio management surface always curates an org, so `organizationId`
     * is a required argument here.
     */
    categories: {
      /**
       * List categories in the caller's resolved space (paginated).
       * `params` MUST include `organizationId` for the org space. Each row
       * carries a resolved `coverImageUrl` (md variant) or null — the raw R2
       * key is never the display source.
       */
      list: (params: URLSearchParams) =>
        request<
          PaginatedListResponse<Category & { coverImageUrl: string | null }>
        >('content', `/api/categories?${params}`),

      /**
       * Create a category in the given org space. 201 → the new row.
       */
      create: (organizationId: string, data: CreateCategoryInput) =>
        request<Category>(
          'content',
          `/api/categories?organizationId=${encodeURIComponent(organizationId)}`,
          { method: 'POST', body: JSON.stringify(data) }
        ),

      /**
       * Update a category's editable fields (slug stays stable across renames).
       */
      update: (
        categoryId: string,
        organizationId: string,
        data: UpdateCategoryInput
      ) =>
        request<Category>(
          'content',
          `/api/categories/${categoryId}?organizationId=${encodeURIComponent(organizationId)}`,
          { method: 'PATCH', body: JSON.stringify(data) }
        ),

      /**
       * Soft-delete a category. 204 → null.
       */
      remove: (categoryId: string, organizationId: string) =>
        request<void>(
          'content',
          `/api/categories/${categoryId}?organizationId=${encodeURIComponent(organizationId)}`,
          { method: 'DELETE' }
        ),

      /**
       * Reorder categories — assigns sortOrder = array index. 204 → null.
       */
      reorder: (organizationId: string, orderedIds: string[]) =>
        request<void>(
          'content',
          `/api/categories/reorder?organizationId=${encodeURIComponent(organizationId)}`,
          { method: 'POST', body: JSON.stringify({ orderedIds }) }
        ),

      /**
       * Upload (or replace) a category cover image (multipart). Mirrors
       * `org.uploadLogo` — re-forwards the File via `forwardMultipartUpload`
       * with a deterministic filename so workerd never drops it, then unwraps
       * the single-item envelope. Returns the persisted key + resolved md URL.
       */
      uploadCover: (
        categoryId: string,
        organizationId: string,
        file: File
      ): Promise<{ coverImageKey: string | null; coverImageUrl: string }> =>
        forwardMultipartUpload<{
          coverImageKey: string | null;
          coverImageUrl: string;
        }>({
          url: `${serverApiUrl(platform, 'content')}/api/categories/${categoryId}/cover?organizationId=${encodeURIComponent(organizationId)}`,
          fieldName: 'cover',
          file,
          fallbackFilename: 'cover',
          sessionCookie,
          failureMessage: 'Cover upload failed',
        }),
    },

    /**
     * Content access endpoints
     */
    access: {
      /**
       * Get streaming URL for content
       */
      getStreamingUrl: (contentId: string) =>
        request<StreamingUrlResponse>(
          'access',
          `/api/access/content/${contentId}/stream`
        ),

      /**
       * Get playback progress
       */
      getProgress: (contentId: string) =>
        request<PlaybackProgressResponse>(
          'access',
          `/api/access/content/${contentId}/progress`
        ),

      /**
       * Save playback progress
       */
      saveProgress: (contentId: string, data: unknown) =>
        request<UpdatePlaybackProgressResponse>(
          'access',
          `/api/access/content/${contentId}/progress`,
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        ),

      /**
       * Get user library (purchased + free content)
       *
       * Query parameters (standard pagination):
       * - page: number (default: 1)
       * - limit: number (1-100, default: 20)
       *
       * @see {@link PaginationInput}
       */
      getUserLibrary: (params?: URLSearchParams) =>
        request<UserLibraryResponse>(
          'access',
          `/api/access/user/library${params ? `?${params}` : ''}`
        ),

      // ── Course journeys (Codex-2pryk Round-D) ─────────────────────────────
      // Journey reads/writes hit content-api (ServiceName 'access' → port 4001,
      // same worker) via the /api/access + /api/journeys mounts. The worker
      // derives the user from the forwarded session cookie, so these take no
      // userId argument. Each maps 1:1 to a $lib/server/journeys/round-d-seam
      // function the Phase-2 FE swaps its mock body for.

      /**
       * Entitlement gate for a course dashboard/journey (SPEC §6.3). Unwraps the
       * `{ canEnter }` envelope to the bare boolean the seam expects.
       */
      canEnterCourse: (courseId: string) =>
        request<{ canEnter: boolean }>(
          'access',
          `/api/access/courses/${courseId}/can-enter`
        ).then((r) => r.canEnter),

      /**
       * Entitlement check gating a signed stream (SPEC §6.3). Works
       * unauthenticated (public / free content resolves as userId=null).
       */
      canView: (contentId: string) =>
        request<{ canView: boolean }>(
          'access',
          `/api/access/content/${contentId}/can-view`
        ).then((r) => r.canView),

      /** Resolve a course summary by its org-scoped slug (null if none). */
      courseBySlug: (organizationId: string, slug: string) =>
        request<JourneyCourseSummary | null>(
          'access',
          `/api/journeys/courses/by-slug?organizationId=${encodeURIComponent(
            organizationId
          )}&slug=${encodeURIComponent(slug)}`
        ),

      /**
       * List an org's PUBLISHED courses for the /explore "Journeys" rail
       * (SPEC §8.5). Fully public — no auth needed; returns `[]` when the org
       * has no published courses.
       */
      listPublishedCourses: (organizationId: string) =>
        request<CourseCardSummary[]>(
          'access',
          `/api/journeys/courses?organizationId=${encodeURIComponent(
            organizationId
          )}`
        ),

      /**
       * Public: the PUBLISHED course(s) that include a content item as a
       * practice — the standalone content page's journey cross-link (F19/F20).
       * No auth needed (published-course public chrome only). `{ courses: [] }`
       * when the item belongs to no published course.
       */
      contentCourses: (contentId: string) =>
        request<ContentCourseLinks>(
          'access',
          `/api/journeys/content/${encodeURIComponent(contentId)}/courses`
        ),

      /**
       * Public course SALES PAGE by org-scoped landing-page slug (null if no
       * published page/course). Fully public — no auth needed (WP-3 shell).
       */
      coursePage: (organizationId: string, slug: string) =>
        request<JourneyCoursePage | null>(
          'access',
          `/api/journeys/pages/by-slug?organizationId=${encodeURIComponent(
            organizationId
          )}&slug=${encodeURIComponent(slug)}`
        ),

      /**
       * Public 30s sell-preview clips (intro + reel) for a course (null if the
       * course is not published). Public preview manifest URLs — no signing.
       */
      courseSellPreview: (courseId: string) =>
        request<SellPreview | null>(
          'access',
          `/api/journeys/courses/${courseId}/sell-preview`
        ),

      /**
       * Public journey DISCOVERY list (Codex-oi2w4) — published course-journeys
       * for the org home "featured" rail (`featured: true`) + the Explore grid.
       * Fully public; carries no per-user state.
       */
      listPublishedJourneys: (
        organizationId: string,
        opts: { featured?: boolean; limit?: number } = {}
      ) =>
        request<JourneyCardView[]>(
          'access',
          `/api/journeys/published?organizationId=${encodeURIComponent(
            organizationId
          )}${opts.featured ? '&featured=true' : ''}${
            opts.limit ? `&limit=${opts.limit}` : ''
          }`
        ),

      /**
       * The session user's ENROLLED journeys in this org, with a progress rollup
       * (the library "Your journeys" shelf + continue rail). Auth-scoped — the
       * content-api reads `userId` from the forwarded session; `organizationId`
       * scopes results to the browsed space.
       */
      listEnrolledJourneys: (organizationId: string) =>
        request<EnrolledJourneyCard[]>(
          'access',
          `/api/journeys/enrolled?organizationId=${encodeURIComponent(
            organizationId
          )}`
        ),

      /** Dashboard payload (enrollment + curriculum + progress rollup). */
      courseDashboard: (courseId: string) =>
        request<CourseDashboardData | null>(
          'access',
          `/api/journeys/courses/${courseId}/dashboard`
        ),

      /**
       * The member LIBRARY "Your journeys" shelf: every course the caller is
       * enrolled in within one org, each with a progress rollup. The worker
       * derives the user from the session; `organizationId` only narrows scope.
       */
      listEnrolledCourses: (organizationId: string) =>
        request<EnrolledCourseSummary[]>(
          'access',
          `/api/journeys/user/enrollments?organizationId=${encodeURIComponent(
            organizationId
          )}`
        ),

      /** In-course player payload (practice + playlist + signed stream URL). */
      inCoursePractice: (courseId: string, contentSlug: string) =>
        request<InCoursePracticeData | null>(
          'access',
          `/api/journeys/courses/${courseId}/practices/${encodeURIComponent(
            contentSlug
          )}`
        ),

      /** Record a practice completion (idempotent — repeat is a no-op). */
      persistCompletion: (input: {
        contentId: string;
        source: CompletionSource;
      }) =>
        request<PracticeCompletionRecord>(
          'access',
          `/api/journeys/practices/completions`,
          {
            method: 'POST',
            body: JSON.stringify(input),
          }
        ),

      /**
       * Studio journey INSIGHTS (Codex-2pryk Round-D · WP-7): course-scoped
       * `live` (financial) + `course` (engagement) aggregation for one reporting
       * period. Owner/admin only — the content-api route enforces
       * `requireOrgManagement` and re-derives scope from the session, so the
       * `organizationId` here is used only for org resolution, never as the
       * authorization source. Money is GBP pence.
       */
      courseInsights: (
        organizationId: string,
        courseId: string,
        period: string
      ) =>
        request<JourneyInsightsData>(
          'access',
          `/api/journeys/insights?organizationId=${encodeURIComponent(
            organizationId
          )}&courseId=${encodeURIComponent(courseId)}&period=${encodeURIComponent(
            period
          )}`
        ),

      /**
       * Studio index BATCH revenue (Codex-9p47t): authoritative gross revenue
       * per journey (30d default), keyed by landing-page id — the figure
       * `listJourneys` omits (revenueCents null) to avoid drift. Owner/admin
       * only; `organizationId` is for org resolution only. Money is GBP pence;
       * journeys with no revenue are omitted from the map.
       */
      listJourneyRevenue: (organizationId: string, period?: string) =>
        request<Record<string, number>>(
          'access',
          `/api/journeys/insights/org-revenue?organizationId=${encodeURIComponent(
            organizationId
          )}${period ? `&period=${encodeURIComponent(period)}` : ''}`
        ),

      // ── Studio journey MANAGEMENT (Codex-isr02 · page-builder write path) ──
      // Owner/admin only — the content-api routes enforce `requireOrgManagement`
      // and re-derive scope from the session; `organizationId` here is used ONLY
      // for org resolution, never as the authorization source.

      /** Studio index — the org's journeys, newest-edited first (optional status). */
      listJourneys: (organizationId: string, status?: string) =>
        request<JourneyListItem[]>(
          'access',
          `/api/journeys/studio/journeys?organizationId=${encodeURIComponent(
            organizationId
          )}${status ? `&status=${encodeURIComponent(status)}` : ''}`
        ),

      /** Create a journey (draft). Returns the new page id + slug. */
      createJourney: (
        organizationId: string,
        input: { title: string; pageType: string }
      ) =>
        request<{ id: string; slug: string }>(
          'access',
          `/api/journeys/studio/journeys?organizationId=${encodeURIComponent(
            organizationId
          )}`,
          { method: 'POST', body: JSON.stringify(input) }
        ),

      /** Load a page draft into the builder (null if foreign/missing). */
      getJourneyForBuilder: (organizationId: string, pageId: string) =>
        request<JourneyPageRecord | null>(
          'access',
          `/api/journeys/studio/journeys/${encodeURIComponent(
            pageId
          )}?organizationId=${encodeURIComponent(organizationId)}`
        ),

      /**
       * STUDIO curriculum read (Codex-03cwh) — the two-pane editor's admin
       * curriculum for a journey (resolved from the landing-page id to its
       * subject course), INCLUDING draft-content practices + picker metadata.
       * Owner/admin only; `organizationId` is for org resolution only.
       */
      getCourseCurriculum: (organizationId: string, pageId: string) =>
        request<EditorCurriculum>(
          'access',
          `/api/journeys/studio/journeys/${encodeURIComponent(
            pageId
          )}/curriculum?organizationId=${encodeURIComponent(organizationId)}`
        ),

      /**
       * STUDIO curriculum bulk-save (Codex-03cwh) — persist the whole desired
       * curriculum (stages + practice joins) for the journey's subject course in
       * one transaction; returns the freshly-persisted curriculum.
       */
      saveCourseCurriculum: (
        organizationId: string,
        pageId: string,
        body: {
          stages: Array<{
            id: string | null;
            name: string;
            gloss: string | null;
            practices: Array<{ contentId: string }>;
          }>;
        }
      ) =>
        request<EditorCurriculum>(
          'access',
          `/api/journeys/studio/journeys/${encodeURIComponent(
            pageId
          )}/curriculum?organizationId=${encodeURIComponent(organizationId)}`,
          { method: 'PUT', body: JSON.stringify(body) }
        ),

      /**
       * Studio LIVE-PREVIEW read (Codex-isr02 P0b-2) — the sell-page envelope
       * for ANY status (drafts included), management-gated (owner/admin; the
       * worker authorizes the client-supplied org against the session's
       * membership). Powers the builder iframe rendering an unpublished draft;
       * null for a foreign/missing/non-managed page so the public load
       * fail-closes to 404.
       */
      coursePagePreview: (organizationId: string, slug: string) =>
        request<JourneyCoursePage | null>(
          'access',
          `/api/journeys/studio/journeys/preview/by-slug?organizationId=${encodeURIComponent(
            organizationId
          )}&slug=${encodeURIComponent(slug)}`
        ),

      /**
       * Persist the builder's draft (sections/brand/title/slug/status). The param
       * is the editable subset the save touches; `brandOverrides` is optional to
       * stay assignable from SvelteKit's `command()`-inferred record (which infers
       * `.nullable()` fields as optional). The full record is still serialised —
       * the worker's Zod schema validates/strips it.
       */
      saveJourneyPage: (
        organizationId: string,
        record: Pick<
          JourneyPageRecord,
          'id' | 'title' | 'slug' | 'status' | 'sections'
        > & { brandOverrides?: JourneyPageRecord['brandOverrides'] }
      ) =>
        request<null>(
          'access',
          `/api/journeys/studio/journeys/${encodeURIComponent(
            record.id
          )}?organizationId=${encodeURIComponent(organizationId)}`,
          { method: 'PUT', body: JSON.stringify(record) }
        ),

      /**
       * Set the journey's ways-in + prices (pence, GBP). The ONLY write path to a
       * course's price — the worker persists the page's offer presentation and the
       * authoritative `courses.price_cents` in one transaction, so the sales page
       * and the checkout can never disagree about whether the journey is buyable.
       * Separate from `saveJourneyPage` so a price change needs no republish.
       */
      updateJourneyOffer: (
        organizationId: string,
        pageId: string,
        // The TOTAL offer bag (every path explicitly on/off). Declared inline
        // rather than as `PageOffer` — whose fields are all optional for the
        // render side — so a caller cannot omit a toggle and leave it ambiguous.
        offer: {
          tiersEnabled: boolean;
          subscriptionEnabled: boolean;
          subscriptionPriceCents: number | null;
          oneOffEnabled: boolean;
          oneOffPriceCents: number | null;
        }
      ) =>
        request<PageOffer>(
          'access',
          `/api/journeys/studio/journeys/${encodeURIComponent(
            pageId
          )}/offer?organizationId=${encodeURIComponent(organizationId)}`,
          { method: 'PATCH', body: JSON.stringify(offer) }
        ),

      // ── Sell media + cover (Codex-eqh0z) ──────────────────────────────────

      /**
       * Read the journey's sell media — the four `media_items` refs the sales
       * page's `introVideo` / `reel` / `guide` sections resolve, plus the cover
       * URL. Separate from `getJourneyForBuilder` because these columns live on
       * the subject COURSE and the page-save body is `.strict()`.
       */
      getJourneySellMedia: (organizationId: string, pageId: string) =>
        request<JourneySellMedia>(
          'access',
          `/api/journeys/studio/journeys/${encodeURIComponent(
            pageId
          )}/media?organizationId=${encodeURIComponent(organizationId)}`
        ),

      /**
       * Set the journey's sell media. A TOTAL write — every slot is sent, so a
       * `null` CLEARS that slot. The worker org-scopes each non-null id (the
       * media's creator must be an active member of this org) and rejects a
       * foreign id with 403 before writing anything.
       */
      updateJourneySellMedia: (
        organizationId: string,
        pageId: string,
        media: {
          introVideoMediaId: string | null;
          previewVideoMediaId: string | null;
          guideVideoMediaId: string | null;
          guidePortraitMediaId: string | null;
        }
      ) =>
        request<JourneySellMedia>(
          'access',
          `/api/journeys/studio/journeys/${encodeURIComponent(
            pageId
          )}/media?organizationId=${encodeURIComponent(organizationId)}`,
          { method: 'PATCH', body: JSON.stringify(media) }
        ),

      /**
       * Upload (or replace) the journey's still cover (multipart). Mirrors
       * `categories.uploadCover` — re-forwards the File via
       * `forwardMultipartUpload` with a deterministic filename so workerd never
       * drops it (a plain re-forward loses the filename and the worker 400s).
       */
      uploadJourneyCover: (
        organizationId: string,
        pageId: string,
        file: File
      ): Promise<{ coverImageUrl: string }> =>
        forwardMultipartUpload<{ coverImageUrl: string }>({
          url: `${serverApiUrl(
            platform,
            'access'
          )}/api/journeys/studio/journeys/${encodeURIComponent(
            pageId
          )}/cover?organizationId=${encodeURIComponent(organizationId)}`,
          fieldName: 'cover',
          file,
          fallbackFilename: 'cover',
          sessionCookie,
          failureMessage: 'Cover upload failed',
        }),

      /** Clear the journey's cover — the card falls back to its typographic form. */
      deleteJourneyCover: (organizationId: string, pageId: string) =>
        request<void>(
          'access',
          `/api/journeys/studio/journeys/${encodeURIComponent(
            pageId
          )}/cover?organizationId=${encodeURIComponent(organizationId)}`,
          { method: 'DELETE' }
        ),
    },

    /**
     * Organization endpoints
     */
    org: {
      /**
       * Create a new organization
       */
      create: (data: { name: string; slug: string; description?: string }) =>
        request<OrganizationData>('org', '/api/organizations', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      /**
       * Update organization identity fields (hero title + subheading).
       *
       * Wires the existing PATCH /api/organizations/:id endpoint
       * (requireOrgManagement). `slug` is intentionally NOT exposed here —
       * changing it swaps the org's subdomain (and triggers a dev-domain
       * rename), which must never happen from a hero-text edit form.
       */
      update: (
        id: string,
        data: { name?: string; description?: string | null }
      ) =>
        request<OrganizationData>('org', `/api/organizations/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),

      /**
       * Check if an organization slug is available
       */
      checkSlug: (slug: string) =>
        request<CheckSlugResponse>(
          'org',
          `/api/organizations/check-slug/${encodeURIComponent(slug)}`
        ),

      /**
       * Get organization by slug
       */
      getBySlug: (slug: string) =>
        request<OrganizationData>('org', `/api/organizations/slug/${slug}`),

      /**
       * Get organization settings
       */
      getSettings: (id: string) =>
        request<AllSettingsResponse>(
          'org',
          `/api/organizations/${id}/settings`
        ),

      /**
       * Update organization settings
       * Note: This maps to a hypothetical PATCH endpoint or requires individual PUTs.
       * Typing as generic object/unknown for now to match flexibility,
       * but ideally should be specific endpoints.
       */
      updateSettings: (id: string, data: unknown) =>
        request<unknown>('org', `/api/organizations/${id}/settings`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),

      /**
       * Update branding settings (primary color)
       */
      updateBranding: (id: string, data: UpdateBrandingInput) =>
        request<BrandingSettingsResponse>(
          'org',
          `/api/organizations/${id}/settings/branding`,
          {
            method: 'PUT',
            body: JSON.stringify(data),
          }
        ),

      /**
       * Upload organization logo (multipart - uses raw fetch for FormData, then unwraps procedure envelope)
       */
      uploadLogo: (id: string, file: File): Promise<BrandingSettingsResponse> =>
        forwardMultipartUpload<BrandingSettingsResponse>({
          url: `${serverApiUrl(platform, 'org')}/api/organizations/${id}/settings/branding/logo`,
          fieldName: 'logo',
          file,
          fallbackFilename: 'logo',
          sessionCookie,
          failureMessage: 'Logo upload failed',
        }),

      /**
       * Delete organization logo
       */
      deleteLogo: (id: string) =>
        request<BrandingSettingsResponse>(
          'org',
          `/api/organizations/${id}/settings/branding/logo`,
          {
            method: 'DELETE',
          }
        ),

      /**
       * Link a media item as the org's intro video
       */
      linkIntroVideo: (id: string, mediaItemId: string) =>
        request<BrandingSettingsResponse>(
          'org',
          `/api/organizations/${id}/settings/branding/intro-video`,
          {
            method: 'POST',
            body: JSON.stringify({ mediaItemId }),
          }
        ),

      /**
       * Get intro video transcoding status
       */
      getIntroVideoStatus: (id: string) =>
        request<{
          status:
            | 'none'
            | 'uploading'
            | 'uploaded'
            | 'transcoding'
            | 'ready'
            | 'failed';
          introVideoUrl: string | null;
          progress: number | null;
          error: string | null;
        }>(
          'org',
          `/api/organizations/${id}/settings/branding/intro-video/status`
        ),

      /**
       * Delete the org's intro video
       */
      deleteIntroVideo: (id: string) =>
        request<BrandingSettingsResponse>(
          'org',
          `/api/organizations/${id}/settings/branding/intro-video`,
          {
            method: 'DELETE',
          }
        ),

      /**
       * Get current user's organizations
       */
      getMyOrganizations: () =>
        request<OrganizationWithRole[]>(
          'org',
          '/api/organizations/my-organizations'
        ),

      /**
       * Get public branding by slug (no auth required)
       *
       * Returns minimal branding fields: { logoUrl, primaryColorHex }
       */
      getPublicBranding: (slug: string) =>
        request<PublicBrandingResponse>(
          'org',
          `/api/organizations/public/${slug}`
        ),

      /**
       * Get public org info by slug (no auth required)
       *
       * Returns org identity + branding for the org layout.
       * Works across subdomains without session cookies.
       */
      getPublicInfo: (slug: string) =>
        request<OrganizationData>(
          'org',
          `/api/organizations/public/${slug}/info`
        ),

      /**
       * Get public creators for an organization (no auth required)
       *
       * Returns paginated public creator profiles for display on org pages.
       * Only active members with owner/admin/creator roles are included.
       *
       * @param slug - Organization slug
       * @param params - Optional URL search params (page, limit)
       * @returns Paginated list of public creator profiles
       */
      getPublicCreators: (slug: string, params?: URLSearchParams) =>
        request<
          PaginatedListResponse<{
            id: string;
            name: string;
            username: string | null;
            avatarUrl: string | null;
            bio: string | null;
            socialLinks: {
              website?: string;
              twitter?: string;
              youtube?: string;
              instagram?: string;
            } | null;
            role: string;
            joinedAt: string;
            contentCount: number;
            recentContent: {
              title: string;
              slug: string;
              thumbnailUrl: string | null;
              contentType: string;
            }[];
            organizations: {
              name: string;
              slug: string;
              logoUrl: string | null;
            }[];
          }>
        >(
          'org',
          `/api/organizations/public/${slug}/creators${params ? `?${params}` : ''}`
        ),

      /**
       * Get public aggregate statistics for an organization.
       * Returns content counts by type, total duration, creator count, and views.
       */
      getPublicStats: (slug: string) =>
        request<OrganizationPublicStatsResponse>(
          'org',
          `/api/organizations/public/${slug}/stats`
        ),

      /**
       * Get current user's membership in an organization
       *
       * Returns the authenticated user's role and status within the org.
       * Used for access control and role-based UI rendering.
       *
       * @param id - Organization UUID
       * @returns Membership data with role, status, and joinedAt timestamp
       *
       * @example
       * ```typescript
       * const membership = await api.org.getMyMembership(orgId);
       * if (membership?.role === 'admin') {
       *   // Show admin controls
       * }
       * ```
       */
      getMyMembership: (id: string) =>
        request<MyMembershipResponse>(
          'org',
          `/api/organizations/${id}/members/my-membership`
        ),

      /**
       * Update contact settings (platform name, support email, social URLs, etc.)
       */
      updateContactSettings: (id: string, data: UpdateContactInput) =>
        request<ContactSettingsResponse>(
          'org',
          `/api/organizations/${id}/settings/contact`,
          {
            method: 'PUT',
            body: JSON.stringify(data),
          }
        ),

      /**
       * Update feature settings (subscriptions, purchases, signups)
       */
      updateFeatures: (id: string, data: UpdateFeaturesInput) =>
        request<FeatureSettingsResponse>(
          'org',
          `/api/organizations/${id}/settings/features`,
          {
            method: 'PUT',
            body: JSON.stringify(data),
          }
        ),

      /**
       * Get organization members
       *
       * @param id - Organization UUID
       * @param params - Optional pagination/filter params
       * @returns Paginated list of members
       */
      getMembers: (id: string, params?: URLSearchParams) =>
        request<PaginatedListResponse<OrgMemberItem>>(
          'org',
          `/api/organizations/${id}/members${params ? `?${params}` : ''}`
        ),

      /**
       * Invite a member to the organization
       *
       * @param id - Organization UUID
       * @param data - Email and role
       */
      inviteMember: (id: string, data: { email: string; role: string }) =>
        request<unknown>('org', `/api/organizations/${id}/members/invite`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      /**
       * Update a member's role
       *
       * @param id - Organization UUID
       * @param userId - Member's user ID
       * @param data - New role
       */
      updateMemberRole: (id: string, userId: string, data: { role: string }) =>
        request<unknown>('org', `/api/organizations/${id}/members/${userId}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),

      /**
       * Remove a member from the organization
       *
       * @param id - Organization UUID
       * @param userId - Member's user ID
       */
      removeMember: (id: string, userId: string) =>
        request<void>('org', `/api/organizations/${id}/members/${userId}`, {
          method: 'DELETE',
        }),

      /**
       * Follow an organization (idempotent)
       */
      follow: (id: string) =>
        request<null>('org', `/api/organizations/${id}/followers`, {
          method: 'POST',
        }),

      /**
       * Unfollow an organization (idempotent)
       */
      unfollow: (id: string) =>
        request<null>('org', `/api/organizations/${id}/followers`, {
          method: 'DELETE',
        }),

      /**
       * Check if authenticated user is following an organization
       */
      isFollowing: (id: string) =>
        request<{ following: boolean }>(
          'org',
          `/api/organizations/${id}/followers/me`
        ),

      /**
       * Get follower count for an organization (public)
       */
      getFollowerCount: (id: string) =>
        request<{ count: number }>(
          'org',
          `/api/organizations/${id}/followers/count`
        ),
    },

    /**
     * E-commerce / checkout endpoints
     */
    checkout: {
      /**
       * Create Stripe checkout session
       */
      create: (data: CreateCheckoutInput) =>
        request<CheckoutResponse>('ecom', '/checkout/create', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      createPortalSession: (data: CreatePortalSessionInput) =>
        request<{ url: string }>('ecom', '/checkout/portal-session', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      /**
       * Create a Stripe Checkout session for a ONE-OFF course purchase
       * (SPEC §7 path 1 — `POST /checkout/course`, auth required).
       *
       * The price, org and payout recipient are all resolved SERVER-SIDE from
       * the course row — the client supplies only the id and its redirect URLs,
       * so a tampered client can never influence what is charged.
       */
      course: (data: {
        courseId: string;
        successUrl: string;
        cancelUrl: string;
      }) =>
        request<CheckoutResponse>('ecom', '/checkout/course', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      /**
       * Create a Stripe Checkout session for a COURSE-SPECIFIC subscription
       * (SPEC §7 path 3 — `POST /checkout/course-subscription`, auth required).
       * The plan + Stripe Price are resolved server-side from the courseId.
       */
      courseSubscription: (data: {
        courseId: string;
        billingInterval: 'monthly' | 'annual';
        successUrl: string;
        cancelUrl: string;
      }) =>
        request<CheckoutResponse>('ecom', '/checkout/course-subscription', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      /**
       * Verify Stripe checkout session status
       *
       * Called on the checkout success page to confirm payment.
       * Returns session status, purchase record, and content details.
       *
       * @param sessionId - Stripe checkout session ID (cs_xxx)
       */
      verify: (sessionId: string) =>
        request<{
          sessionStatus: 'complete' | 'expired' | 'open';
          purchase?: {
            id: string;
            contentId: string;
            amountPaidCents: number;
            purchasedAt: string;
          };
          content?: {
            id: string;
            title: string;
            thumbnailUrl?: string;
            contentType: string;
          };
        }>(
          'ecom',
          `/checkout/verify?session_id=${encodeURIComponent(sessionId)}`
        ),
    },

    /**
     * Course monetization reads (ecom-api `/courses`).
     */
    courses: {
      /**
       * The AUTHORITATIVE offer for a course — every acquisition path that is
       * actually available, composed from real DB state (SPEC §7):
       * `purchase` from `courses.price_cents`, `subscription` from the active
       * `course_subscription_plans` row, `tiers` from
       * `course_tier_access ⋈ subscription_tiers`, plus `entitled` for the
       * viewer.
       *
       * This is what the journey sell page + checkout MUST read. The landing
       * page's `offer` bag and the `invite` section's authored `offers` are
       * PRESENTATION only — they may tease a path, but they can neither create
       * one nor set its price. Auth is optional: anonymous callers get the same
       * paths with `entitled: false`.
       */
      offer: (courseId: string) =>
        request<CourseOffer>(
          'ecom',
          `/courses/${encodeURIComponent(courseId)}/offer`
        ),

      // ── Studio monetisation WRITES (Codex-2pryk.2.4.1 routes) ─────────────
      //
      // The three mutations that make `offer` above return more than
      // `paths: ['purchase']`. They live on ecom-api (not content-api, where the
      // sibling journey-studio writes are) because plan creation calls Stripe and
      // only ecom-api is given `STRIPE_SECRET_KEY` in production.
      //
      // Each is org-guarded by `requireOrgManagement` on `?organizationId=`, and
      // each service method re-resolves the course by `(id, organizationId)` — so
      // `courseId` may safely come from the builder's loaded draft: the worst a
      // tampered value can do is address another course in an org the caller
      // already manages (no escalation), and a foreign course 404s.

      /**
       * Create or re-price the course's subscription plan (GBP pence). Idempotent
       * — a save button must survive a double press, so the first call creates the
       * Stripe Product + monthly/annual Prices and later calls re-price the same
       * plan row (and RE-LIST it if it had been withdrawn).
       *
       * 422 `CONNECT_ACCOUNT_NOT_READY` when the org has no onboarded Connect
       * account: a course subscription pays out to the org, so it cannot be sold
       * before payouts work. Callers must render that as payout guidance, not as a
       * generic failure.
       */
      upsertSubscriptionPlan: (
        organizationId: string,
        courseId: string,
        prices: { priceMonthly: number; priceAnnual: number }
      ) =>
        request<CourseSubscriptionPlan>(
          'ecom',
          `/studio/courses/${encodeURIComponent(
            courseId
          )}/subscription-plan?organizationId=${encodeURIComponent(
            organizationId
          )}`,
          { method: 'PUT', body: JSON.stringify(prices) }
        ),

      /**
       * Withdraw the subscription as a way in. `getCourseOffer` stops offering it
       * and new checkouts are refused; EXISTING subscribers keep renewing and keep
       * their entitlement (only `isActive` flips — the row is retained because
       * their `course_subscriptions.planId` FK points at it).
       *
       * Idempotent: no live plan is a 204, not a 404.
       */
      withdrawSubscriptionPlan: (organizationId: string, courseId: string) =>
        request<null>(
          'ecom',
          `/studio/courses/${encodeURIComponent(
            courseId
          )}/subscription-plan?organizationId=${encodeURIComponent(
            organizationId
          )}`,
          { method: 'DELETE' }
        ),

      /**
       * Set the EXACT set of org tiers that unlock this course (SPEC §7, "not just
       * min-tier"). A TOTAL write: tiers absent from `tierIds` lose access and
       * `[]` clears tier access entirely — so the panel's checkbox group has one
       * unambiguous meaning and two concurrent saves cannot interleave into a set
       * neither creator chose. 403 if any tier belongs to another org.
       */
      setTierAccess: (
        organizationId: string,
        courseId: string,
        tierIds: string[]
      ) =>
        request<null>(
          'ecom',
          `/studio/courses/${encodeURIComponent(
            courseId
          )}/tier-access?organizationId=${encodeURIComponent(organizationId)}`,
          { method: 'PUT', body: JSON.stringify({ tierIds }) }
        ),
    },

    /**
     * Analytics endpoints (Admin API)
     */

    /**
     * Get revenue stats
     * Returns { totalRevenueCents, totalPurchases, averageOrderValueCents, ... }
     */
    analytics: {
      /**
       * Get revenue statistics with optional period-over-period comparison.
       *
       * Query parameters (from AdminRevenueQueryInput):
       * - startDate: ISO date string, e.g., '2025-01-01' (optional)
       * - endDate: ISO date string, e.g., '2025-01-31' (optional)
       * - compareFrom / compareTo: ISO date strings for comparison period (both-or-neither)
       *
       * When compareFrom/compareTo are provided, `previous` is populated on the response.
       * Maximum date range is 365 days per window (enforced by backend).
       */
      getRevenue: (params?: URLSearchParams) =>
        request<RevenueStats>(
          'admin',
          `/api/admin/analytics/revenue${params ? `?${params}` : ''}`
        ),

      /**
       * Get top content ranked by revenue with optional per-row trend delta.
       *
       * Query parameters (from AdminTopContentQueryInput):
       * - limit: number of items (1-100, default: 10)
       * - startDate / endDate: ISO date strings (optional)
       * - compareFrom / compareTo: ISO date strings for trend-delta comparison (both-or-neither)
       *
       * Per-row fields include `thumbnailUrl`, `viewsInPeriod`, and `trendDelta`
       * (null when comparison not requested).
       */
      getTopContent: (params?: URLSearchParams) =>
        request<PaginatedListResponse<TopContentItem>>(
          'admin',
          `/api/admin/analytics/top-content${params ? `?${params}` : ''}`
        ),

      /**
       * Get subscriber statistics (active / new / churned) with optional
       * period-over-period comparison.
       *
       * Query parameters (from AdminSubscribersQueryInput):
       * - startDate / endDate / compareFrom / compareTo (all optional, ISO strings)
       *
       * When compareFrom/compareTo are provided, `previous` is populated on the response.
       */
      getSubscribers: (params?: URLSearchParams) =>
        request<SubscriberStats>(
          'admin',
          `/api/admin/analytics/subscribers${params ? `?${params}` : ''}`
        ),

      /**
       * Get follower statistics (total / new) with optional period-over-period
       * comparison. Note: unfollows hard-delete rows, so `totalFollowers` is an
       * approximation for historical windows.
       *
       * Query parameters (from AdminFollowersQueryInput):
       * - startDate / endDate / compareFrom / compareTo (all optional, ISO strings)
       */
      getFollowers: (params?: URLSearchParams) =>
        request<FollowerStats>(
          'admin',
          `/api/admin/analytics/followers${params ? `?${params}` : ''}`
        ),

      /**
       * Get per-content engagement metrics (views, watch time, completion %)
       * with optional per-row watch-time trend delta.
       *
       * Query parameters (from AdminContentPerformanceQueryInput):
       * - limit: number of items (1-100, default: 10)
       * - startDate / endDate / compareFrom / compareTo (all optional, ISO strings)
       *
       * LEFT-JOIN semantics — content with zero playback still appears (zeroed).
       */
      getContentPerformance: (params?: URLSearchParams) =>
        request<PaginatedListResponse<ContentPerformanceItem>>(
          'admin',
          `/api/admin/analytics/content-performance${params ? `?${params}` : ''}`
        ),

      /**
       * Get combined dashboard statistics (revenue, customers, top content).
       *
       * Query parameters (from adminDashboardStatsQuerySchema):
       * - organizationId: UUID (required)
       */
      getDashboardStats: (params?: URLSearchParams) =>
        request<DashboardStats>(
          'admin',
          `/api/admin/analytics/dashboard-stats${params ? `?${params}` : ''}`
        ),

      /**
       * Get per-creator revenue split rows for org-owner visibility on the
       * studio analytics page (Codex-mtv05).
       *
       * One row per ACTIVE creator-organization agreement, annotated with:
       *  - `totalRevenueCents` — SUM of purchase `creatorPayoutCents` joined
       *    via `content.creatorId`. Subscription invoice revenue is NOT
       *    included in Phase 1 (no per-creator immutable invoice row).
       *  - `splitPercent` — CURRENT creator share as a display percentage
       *    (0..100), already converted from basis points by the service.
       *  - `lastPayoutAt` — ISO string or null.
       *  - `pendingPayoutCents` — SUM of unresolved pending-payout amounts
       *    scoped by BOTH userId AND organizationId (multi-org safety).
       *
       * Single-creator orgs receive `items: []` and the page hides the
       * section entirely.
       *
       * Query parameters (from `adminRevenueByCreatorQuerySchema`):
       * - `startDate` / `endDate` — ISO strings (optional, both-or-neither
       *   for chronological order; max 365-day range)
       */
      getRevenueByCreator: (params?: URLSearchParams) =>
        request<PaginatedListResponse<CreatorRevenueSplitItem>>(
          'admin',
          `/api/admin/analytics/revenue-by-creator${params ? `?${params}` : ''}`
        ),
    },

    /**
     * Media endpoints (content-api worker)
     */
    media: {
      /**
       * Create a new media item (returns presigned upload info)
       *
       * @param data - Media item creation input (title, mediaType, mimeType, fileSizeBytes, r2Key)
       * @returns Created media item
       */
      create: (data: Record<string, unknown>) =>
        request<MediaItem>('content', '/api/media', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      /**
       * List media items with filters and pagination
       *
       * Query parameters (from MediaQueryInput):
       * - page: number (default: 1)
       * - limit: number (1-100, default: 20)
       * - status: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed' (optional)
       * - mediaType: 'video' | 'audio' (optional)
       * - sortBy: 'createdAt' | 'uploadedAt' | 'title' (optional)
       * - sortOrder: 'asc' | 'desc' (optional)
       */
      list: (params?: URLSearchParams) =>
        request<PaginatedListResponse<MediaItemWithRelations>>(
          'content',
          `/api/media${params ? `?${params}` : ''}`
        ),

      /**
       * Get a single media item by ID
       */
      get: (id: string) =>
        request<MediaItemWithRelations>('content', `/api/media/${id}`),

      /**
       * Update media item metadata
       */
      update: (id: string, data: unknown) =>
        request<MediaItem>('content', `/api/media/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),

      /**
       * Soft delete a media item
       */
      delete: (id: string) =>
        request<void>('content', `/api/media/${id}`, {
          method: 'DELETE',
        }),

      /**
       * Get transcoding status and progress for a media item
       * Calls media-api worker (not content-api)
       */
      transcodingStatus: (id: string) =>
        request<{
          status: string;
          transcodingProgress: number | null;
          transcodingStep: string | null;
          transcodingAttempts: number;
          transcodingError: string | null;
        }>('media', `/api/transcoding/status/${id}`),

      /**
       * Mark upload as complete and trigger transcoding
       */
      uploadComplete: (id: string) =>
        request<{ success: boolean; status: string }>(
          'content',
          `/api/media/${id}/upload-complete`,
          {
            method: 'POST',
          }
        ),

      /**
       * Upload a media file to R2 via the content-api worker.
       * Fallback for local dev when presigned URLs are unavailable.
       */
      upload: (id: string, file: File): Promise<{ success: boolean }> => {
        const url = `${serverApiUrl(platform, 'content')}/api/media/${id}/upload`;
        return fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': file.type,
            'X-Filename': encodeURIComponent(file.name),
            ...(sessionCookie
              ? {
                  Cookie: `${COOKIES.SESSION_NAME}=${sessionCookie}; better-auth.session_token=${sessionCookie}`,
                }
              : {}),
          },
          body: file,
        }).then(async (res) => {
          if (!res.ok) throw new ApiError(res.status, 'Upload failed');
          return res.json() as Promise<{ success: boolean }>;
        });
      },
    },

    /**
     * Admin endpoints
     */
    admin: {
      /**
       * Get customers list
       * Returns PaginatedListResponse with customer items
       *
       * Query parameters (standard pagination):
       * - page: number (default: 1)
       * - limit: number (1-100, default: 20)
       *
       * @example
       * ```typescript
       * const params = new URLSearchParams();
       * params.set('page', '2');
       * params.set('limit', '50');
       * const customers = await api.admin.getCustomers(params);
       * ```
       *
       * @see {@link AdminCustomerListQueryInput}
       */
      listContent: (params?: URLSearchParams) =>
        request<
          PaginatedListResponse<{ id: string; title: string; status: string }>
        >('admin', `/api/admin/content${params ? `?${params}` : ''}`),

      getCustomers: (params?: URLSearchParams) =>
        request<PaginatedListResponse<CustomerListItem>>(
          'admin',
          `/api/admin/customers${params ? `?${params}` : ''}`
        ),

      /**
       * Get activity feed
       * Returns { items: [...], pagination: {...} }
       *
       * Query parameters (from AdminActivityQueryInput):
       * - page: number (default: 1)
       * - limit: number (1-100, default: 20)
       * - type: 'purchase' | 'content_published' | 'member_joined' (optional)
       *
       * @example
       * ```typescript
       * const params = new URLSearchParams();
       * params.set('type', 'purchase');
       * params.set('limit', '10');
       * const activity = await api.admin.getActivity(params);
       * ```
       *
       * @see {@link AdminActivityQueryInput}
       */
      getActivity: (params?: URLSearchParams) =>
        request<ActivityFeedResponse>(
          'admin',
          `/api/admin/activity${params ? `?${params}` : ''}`
        ),

      /**
       * Get customer details with purchase history
       *
       * @param customerId - Customer's user UUID
       * @returns Customer profile with aggregated stats and purchase history
       */
      getCustomerDetail: (customerId: string, params?: URLSearchParams) =>
        request<CustomerDetails>(
          'admin',
          `/api/admin/customers/${customerId}${params ? `?${params}` : ''}`
        ),

      /**
       * Grant complimentary content access to a customer
       *
       * Used for refunds, promotions, and support.
       * Creates a contentAccess record (not a purchase), so revenue analytics stay accurate.
       *
       * @param customerId - Customer's user UUID
       * @param contentId - Content UUID to grant access to
       * @returns Success indicator
       */
      grantContentAccess: (
        customerId: string,
        contentId: string,
        params?: URLSearchParams
      ) =>
        request<{ success: boolean }>(
          'admin',
          `/api/admin/customers/${customerId}/grant-access/${contentId}${params ? `?${params}` : ''}`,
          { method: 'POST' }
        ),
    },

    /**
     * Subscription tier endpoints (organization-api worker)
     */
    tiers: {
      /**
       * List active tiers for an org (public, no auth required)
       */
      list: (orgId: string) =>
        request<SubscriptionTier[]>('org', `/api/organizations/${orgId}/tiers`),

      /**
       * Create a subscription tier
       */
      create: (orgId: string, data: CreateTierInput) =>
        request<SubscriptionTier>('org', `/api/organizations/${orgId}/tiers`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      /**
       * Update a subscription tier
       */
      update: (orgId: string, tierId: string, data: UpdateTierInput) =>
        request<SubscriptionTier>(
          'org',
          `/api/organizations/${orgId}/tiers/${tierId}`,
          {
            method: 'PATCH',
            body: JSON.stringify(data),
          }
        ),

      /**
       * Delete a subscription tier (soft delete)
       */
      delete: (orgId: string, tierId: string) =>
        request<void>('org', `/api/organizations/${orgId}/tiers/${tierId}`, {
          method: 'DELETE',
        }),

      /**
       * Reorder tiers
       */
      reorder: (orgId: string, tierIds: string[]) =>
        request<void>('org', `/api/organizations/${orgId}/tiers/reorder`, {
          method: 'POST',
          body: JSON.stringify({ tierIds }),
        }),
    },

    /**
     * Subscription endpoints (ecom-api worker)
     */
    subscription: {
      /**
       * Create a subscription checkout session
       */
      checkout: (data: CreateSubscriptionCheckoutInput) =>
        request<SubscriptionCheckoutResponse>(
          'ecom',
          '/subscriptions/checkout',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        ),

      /**
       * Verify a Stripe subscription-mode Checkout session.
       * Called by the /subscription/success page to poll until the webhook
       * has written the subscription row. Mirrors `checkout.verify` above.
       */
      verify: (sessionId: string) =>
        request<{
          sessionStatus: 'complete' | 'expired' | 'open';
          subscription?: {
            id: string;
            organizationId: string;
            tierId: string;
            tierName: string;
            organizationName: string;
            organizationSlug: string;
            startedAt: string;
          };
        }>(
          'ecom',
          `/subscriptions/verify?session_id=${encodeURIComponent(sessionId)}`
        ),

      /**
       * Get user's current subscription for an org
       */
      getCurrent: (organizationId: string) =>
        request<CurrentSubscription | null>(
          'ecom',
          withOrg('/subscriptions/current', organizationId)
        ),

      /**
       * Get all user's active subscriptions
       */
      getMine: () =>
        request<UserOrgSubscription[]>('ecom', '/subscriptions/mine'),

      /**
       * Preview the proration that a tier change would produce, without
       * mutating the subscription. Powers the confirmation dialog.
       */
      previewTierChange: (data: ChangeTierInput) =>
        request<TierChangePreview>(
          'ecom',
          '/subscriptions/preview-tier-change',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        ),

      /**
       * Change subscription tier (upgrade/downgrade)
       */
      changeTier: (data: ChangeTierInput) =>
        request<CurrentSubscription>('ecom', '/subscriptions/change-tier', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      /**
       * Cancel subscription at period end
       */
      cancel: (data: CancelSubscriptionInput) =>
        request<CurrentSubscription>('ecom', '/subscriptions/cancel', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      /**
       * Reactivate a subscription set to cancel at period end
       */
      reactivate: (data: ReactivateSubscriptionInput) =>
        request<CurrentSubscription>('ecom', '/subscriptions/reactivate', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      /**
       * Resume a PAUSED subscription (user-initiated, parallel to reactivate
       * but for the paused→active path rather than cancelling→active).
       */
      resume: (data: ResumeSubscriptionInput) =>
        request<CurrentSubscription>('ecom', '/subscriptions/resume', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      /**
       * Get subscription stats for an org (admin)
       */
      getStats: (organizationId: string) =>
        request<SubscriptionStats>(
          'ecom',
          withOrg('/subscriptions/stats', organizationId)
        ),

      /**
       * List subscribers for an org (studio Subscribers page — Codex-1csms).
       * Returns the joined SubscriberListItem shape (user + tier flattened in).
       * The worker re-derives scope from membership; the URL `organizationId`
       * is used only to resolve org context for the procedure helper.
       */
      getSubscribers: (organizationId: string, params?: URLSearchParams) =>
        request<PaginatedListResponse<SubscriberListItem>>(
          'ecom',
          withOrg('/subscriptions/subscribers', organizationId, params)
        ),

      /**
       * List sales for the studio ledger (Codex-1csms). Org-scoped inverse
       * of /purchases. See `packages/purchase/src/services/purchase-service.ts`
       * `listSales` for the data contract.
       */
      listSales: (organizationId: string, params?: URLSearchParams) =>
        request<PaginatedListResponse<SaleListItem>>(
          'ecom',
          withOrg('/sales', organizationId, params)
        ),

      /**
       * Aggregate KPIs (gross/net/refunded/count) for the studio Sales
       * ledger header tiles (Codex-1csms).
       */
      getSalesStats: (organizationId: string, params?: URLSearchParams) =>
        request<SalesStats>(
          'ecom',
          withOrg('/sales/stats', organizationId, params)
        ),

      /**
       * List pending + resolved creator payouts for an org (owner only,
       * paginated). Backs the studio payouts table (Codex-zqaxo).
       *
       * Forwards `organizationId` in the query string as the route
       * contract requires it, but the worker re-derives the scope from
       * the authenticated membership — never trusts the URL value.
       */
      listPayouts: (organizationId: string, params?: URLSearchParams) =>
        request<PaginatedListResponse<PayoutWithCreator>>(
          'ecom',
          withOrg('/subscriptions/payouts', organizationId, params)
        ),

      /**
       * Aggregate KPI numbers for the studio payouts page header
       * (Codex-05vp8). Lifetime totals + a windowed `earnedInPeriod`.
       * Owner-only; same scoping invariant as `listPayouts`.
       */
      getPayoutSummary: (organizationId: string, params?: URLSearchParams) =>
        request<PayoutSummary>(
          'ecom',
          withOrg('/subscriptions/payouts/summary', organizationId, params)
        ),

      /**
       * Per-creator payout breakdown for the studio payouts right rail
       * (Codex-6nt4l). Returns one entry per user who received a
       * `creator_payout` or `organization_fee` row under the current
       * filters; `platform_fee` rows are excluded. Owner-only.
       *
       * Returns a plain array (not paginated) — the rail surfaces every
       * matched creator under the filter, not a page slice.
       */
      getPayoutsByCreatorBreakdown: (
        organizationId: string,
        params?: URLSearchParams
      ) =>
        request<CreatorPayoutBreakdown[]>(
          'ecom',
          withOrg('/subscriptions/payouts/by-creator', organizationId, params)
        ),

      // ── Creator-self-scoped /me routes (Codex-69t7c.7 / WP7) ─────────────
      // These routes are scoped to the SESSION USER only — they return the
      // acting creator's OWN payouts across ALL orgs that paid them.
      // NEVER forward organizationId / userId (IDOR prevention, epic D8).

      /**
       * List the current creator's own payouts (paginated).
       * GET /subscriptions/me/payouts — self-scoped, no org context.
       * Returns `{ items: PayoutWithCreator[], pagination }` envelope.
       */
      getMyPayouts: (params?: URLSearchParams) =>
        request<PaginatedListResponse<PayoutWithCreator>>(
          'ecom',
          `/subscriptions/me/payouts${params?.toString() ? `?${params.toString()}` : ''}`
        ),

      /**
       * KPI numbers for the creator earnings hub (earned in period, total
       * earned, in transit, needs-attention). userId-scoped across all orgs.
       * GET /subscriptions/me/earnings-summary — single-item `{data}` envelope.
       */
      getMyEarningsSummary: (params?: URLSearchParams) =>
        request<CreatorEarningsSummary>(
          'ecom',
          `/subscriptions/me/earnings-summary${params?.toString() ? `?${params.toString()}` : ''}`
        ),
    },

    /**
     * Stripe Connect endpoints (ecom-api worker)
     */
    connect: {
      /**
       * Start Connect onboarding — creates Express account + returns onboarding URL
       */
      onboard: (data: ConnectOnboardInput) =>
        request<ConnectOnboardResponse>(
          'ecom',
          `/connect/onboard?organizationId=${encodeURIComponent(data.organizationId)}`,
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        ),

      /**
       * Get Connect account status for an org
       */
      getStatus: (organizationId: string) =>
        request<ConnectAccountStatusResponse>(
          'ecom',
          `/connect/status?organizationId=${encodeURIComponent(organizationId)}`
        ),

      /**
       * Get Stripe Express dashboard link
       */
      getDashboardLink: (organizationId: string) =>
        request<ConnectDashboardResponse>(
          'ecom',
          `/connect/dashboard?organizationId=${encodeURIComponent(organizationId)}`,
          {
            method: 'POST',
            body: JSON.stringify({ organizationId }),
          }
        ),

      /**
       * Sync Connect account status with Stripe (polls Stripe API)
       */
      syncStatus: (organizationId: string) =>
        request<ConnectAccountStatusResponse>(
          'ecom',
          `/connect/sync?organizationId=${encodeURIComponent(organizationId)}`,
          {
            method: 'POST',
            body: JSON.stringify({ organizationId }),
          }
        ),

      // ── Creator-self-scoped /me routes (Codex-69t7c.3 / WP3) ──────────────
      // These routes are scoped to the SESSION USER only. No org context.
      // NEVER forward organizationId / userId — the backend derives identity
      // from the session cookie (IDOR prevention, epic decision D8).

      /**
       * Create (or reuse) the current creator's Connect account and return
       * the Stripe onboarding URL. POST /connect/me/onboard — 201.
       */
      onboardMe: (data: ConnectMeOnboardInput) =>
        request<ConnectOnboardResponse>('ecom', '/connect/me/onboard', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      /**
       * Get the current creator's Connect account status.
       * GET /connect/me/status — self-scoped, no body/query params.
       */
      getMyStatus: () =>
        request<ConnectAccountStatusResponse>('ecom', '/connect/me/status'),

      /**
       * Force a Stripe status sync for the current creator, then return
       * the refreshed status payload. POST /connect/me/sync — no body.
       */
      syncMyStatus: () =>
        request<ConnectAccountStatusResponse>('ecom', '/connect/me/sync', {
          method: 'POST',
        }),

      /**
       * Get a Stripe Express dashboard login link for the current creator.
       * POST /connect/me/dashboard — no body.
       */
      getMyDashboardLink: () =>
        request<ConnectDashboardResponse>('ecom', '/connect/me/dashboard', {
          method: 'POST',
        }),
    },

    /**
     * Revenue-share agreements (ecom-api worker)
     *
     * Owner-facing: settings → revenue-share tab proposes/counters/accepts
     * agreements with team creators. Creator-facing: /studio/negotiations
     * (WP-8, separate WP) consumes `listForCreator`.
     */
    agreements: {
      /**
       * Owner-view list of active agreements for an org. Worker re-derives
       * scope from authenticated membership — `organizationId` in the
       * query is used only to resolve the `procedure()` membership gate.
       */
      list: (
        organizationId: string,
        params?: { revenueType?: 'subscription' | 'content_purchase' }
      ) => {
        const search = new URLSearchParams();
        if (params?.revenueType) search.set('revenueType', params.revenueType);
        return request<PaginatedListResponse<CreatorOrganizationAgreement>>(
          'ecom',
          withOrg('/agreements', organizationId, search)
        );
      },

      /**
       * Owner-view open proposals on this org (WP-9 — Codex-k9no0).
       * Optional `proposedByRole` filter narrows to "counter-proposals
       * from creators waiting on owner action" in a single round-trip.
       * Same `requireOrgManagement` gate as `list`.
       */
      listPending: (
        organizationId: string,
        params?: { proposedByRole?: 'owner' | 'creator' }
      ) => {
        const search = new URLSearchParams();
        if (params?.proposedByRole) {
          search.set('proposedByRole', params.proposedByRole);
        }
        return request<PaginatedListResponse<AgreementProposal>>(
          'ecom',
          withOrg('/agreements/pending', organizationId, search)
        );
      },

      /**
       * Owner-view negotiation thread for one (creator, revenueType) on
       * this org. Empty array if no thread exists.
       */
      getThread: (
        organizationId: string,
        creatorId: string,
        revenueType: 'subscription' | 'content_purchase'
      ) => {
        const search = new URLSearchParams({ revenueType });
        return request<AgreementProposal[]>(
          'ecom',
          withOrg(
            `/agreements/threads/${encodeURIComponent(creatorId)}`,
            organizationId,
            search
          )
        );
      },

      /**
       * Creator-view: my agreements across every org, with anonymised peer
       * aggregates. Worker scopes on `ctx.user.id`.
       */
      listForCreator: () =>
        request<
          PaginatedListResponse<{
            id: string;
            organizationId: string;
            creatorId: string;
            revenueType: string;
            status: string;
            effectiveFrom: string | Date;
            effectiveUntil: string | Date | null;
            organizationFeePercentage: number;
            currentProposalId: string | null;
            terminatedAt: string | Date | null;
            peers: { count: number; aggregateSharePercent: number };
          }>
        >('ecom', '/agreements/me'),

      /**
       * Creator-view portfolio aggregator (WP-8). Returns active +
       * pending-action-required + waiting-on-org + past in one round-trip.
       * Anonymisation contract preserved: peer aggregates only, never peer
       * identifiers.
       */
      getCreatorPortfolio: () =>
        request<{
          active: Array<{
            id: string;
            organizationId: string;
            organizationName: string | null;
            creatorId: string;
            revenueType: string;
            status: string;
            effectiveFrom: string | Date;
            effectiveUntil: string | Date | null;
            organizationFeePercentage: number;
            currentProposalId: string | null;
            terminatedAt: string | Date | null;
            peers: { count: number; aggregateSharePercent: number };
          }>;
          pendingActionRequired: Array<{
            proposalId: string;
            organizationId: string;
            organizationName: string | null;
            revenueType: string;
            proposedSharePercent: number;
            proposedTermMonths: number | null;
            proposedByRole: string;
            roundNumber: number;
            createdAt: string | Date;
            note: string | null;
            threadProposalId: string;
          }>;
          pendingWaitingOnOrg: Array<{
            proposalId: string;
            organizationId: string;
            organizationName: string | null;
            revenueType: string;
            proposedSharePercent: number;
            proposedTermMonths: number | null;
            proposedByRole: string;
            roundNumber: number;
            createdAt: string | Date;
            note: string | null;
            threadProposalId: string;
          }>;
          past: Array<{
            proposalId: string;
            organizationId: string;
            organizationName: string | null;
            revenueType: string;
            status: string;
            proposedSharePercent: number;
            proposedByRole: string;
            roundNumber: number;
            endedAt: string | Date | null;
            declineReason: string | null;
          }>;
        }>('ecom', '/agreements/me/portfolio'),

      /**
       * Creator-view negotiation thread by ANY proposal id within the
       * thread. Worker enumerates threads where the caller is the named
       * creator (including pending-only threads without an active row).
       */
      getMyThread: (proposalId: string) =>
        request<AgreementProposal[]>(
          'ecom',
          `/agreements/me/threads/${encodeURIComponent(proposalId)}`
        ),

      /**
       * Round 1 owner-initiated proposal. `organizationId` lives in the
       * query string (procedure() resolveOrganizationId only reads query
       * fallback; body org would 400 with ORG_CONTEXT_REQUIRED).
       */
      propose: (
        organizationId: string,
        input: {
          creatorId: string;
          revenueType: 'subscription' | 'content_purchase';
          sharePercent: number;
          termMonths: number;
          note?: string;
          effectiveFrom?: string | Date;
        }
      ) =>
        request<AgreementProposal>(
          'ecom',
          `/agreements/propose?organizationId=${encodeURIComponent(organizationId)}`,
          {
            method: 'POST',
            body: JSON.stringify(input),
          }
        ),

      /** Counter an open proposal — service flips role from parent. */
      counter: (
        proposalId: string,
        input: {
          sharePercent: number;
          termMonths: number;
          note?: string;
        }
      ) =>
        request<AgreementProposal>(
          'ecom',
          `/agreements/${encodeURIComponent(proposalId)}/counter`,
          {
            method: 'POST',
            body: JSON.stringify(input),
          }
        ),

      /** Accept an open proposal — service performs atomic 6-step write. */
      accept: (proposalId: string) =>
        request<CreatorOrganizationAgreement>(
          'ecom',
          `/agreements/${encodeURIComponent(proposalId)}/accept`,
          {
            method: 'POST',
            body: JSON.stringify({}),
          }
        ),

      /** Decline an open proposal — optional reason captured for audit. */
      decline: (proposalId: string, input?: { reason?: string }) =>
        request<AgreementProposal>(
          'ecom',
          `/agreements/${encodeURIComponent(proposalId)}/decline`,
          {
            method: 'POST',
            body: JSON.stringify(input ?? {}),
          }
        ),

      /** Withdraw a proposal — only the proposing side may withdraw. */
      withdraw: (proposalId: string) =>
        request<AgreementProposal>(
          'ecom',
          `/agreements/${encodeURIComponent(proposalId)}/withdraw`,
          {
            method: 'POST',
            body: JSON.stringify({}),
          }
        ),

      /** Terminate an active agreement — either party may terminate. */
      terminate: (agreementId: string, input?: { reason?: string }) =>
        request<CreatorOrganizationAgreement>(
          'ecom',
          `/agreements/${encodeURIComponent(agreementId)}/terminate`,
          {
            method: 'POST',
            body: JSON.stringify(input ?? {}),
          }
        ),
    },
  };
}
