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
  CustomerDetails,
  CustomerListItem,
  DashboardStats,
  RevenueAnalyticsResponse,
  TopContentAnalyticsResponse,
} from '@codex/admin';
import {
  COOKIES,
  getServiceUrl,
  HEADERS,
  MIME_TYPES,
  type ServiceName,
} from '@codex/constants';
import type { MediaItem } from '@codex/database/schema';
import type { AvatarUploadResponse } from '@codex/identity';
import type { NotificationPreferencesResponse } from '@codex/notifications';
import type { PurchaseListItem } from '@codex/purchase';
import type {
  AllSettingsResponse,
  BrandingSettingsResponse,
  CheckSlugResponse,
  ContactSettingsResponse,
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
  CancelSubscriptionInput,
  ChangeTierInput,
  ConnectOnboardInput,
  CreateCheckoutInput,
  CreatePortalSessionInput,
  CreateSubscriptionCheckoutInput,
  CreateTierInput,
  ReactivateSubscriptionInput,
  UpdateBrandingInput,
  UpdateContactInput,
  UpdateFeaturesInput,
  UpdateNotificationPreferencesInput,
  UpdateProfileInput,
  UpdateTierInput,
  UpgradeToCreatorInput,
} from '@codex/validation';
import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { logger } from '$lib/observability';
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
  SubscriberItem,
  SubscriptionCheckoutResponse,
  SubscriptionStats,
  SubscriptionTier,
  UserOrgSubscription,
} from '../types';
import { ApiError } from './errors';
export type { OrgMemberItem };

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
      // Send both our platform cookie name and BetterAuth's internal name.
      // BetterAuth's get-session handler only looks for 'better-auth.session_token'
      // regardless of cookie.name config, while other workers use COOKIES.SESSION_NAME.
      //
      // IMPORTANT: The cookie value from SvelteKit's cookies.get() is the raw value
      // as stored by the browser. We pass it through without encoding to avoid
      // corrupting JWT signatures (which use URL-safe base64: A-Z, a-z, 0-9, -, _).
      // Calling encodeURIComponent() would corrupt tokens by encoding . - _ as %2E %2D %5F.
      (headers as Record<string, string>).Cookie =
        `${COOKIES.SESSION_NAME}=${sessionCookie}; better-auth.session_token=${sessionCookie}`;
    }

    // Abort fetch after 10 seconds to prevent indefinite hangs when a worker
    // is slow or unresponsive (e.g. during E2E tests with cold KV/DB).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const timer = logger.startTimer(`api:${worker}${path}`);
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers,
    }).finally(() => clearTimeout(timeoutId));
    timer.end({ method: options?.method ?? 'GET', status: response.status });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ message: 'Unknown error' }))) as {
        message?: string;
        code?: string;
      };
      throw new ApiError(
        response.status,
        error.message ?? 'API Error',
        error.code
      );
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
        // Pass cookie value through without encoding (see request() above for rationale)
        (headers as Record<string, string>).Cookie =
          `${COOKIES.SESSION_NAME}=${cookieToUse}; better-auth.session_token=${cookieToUse}`;
      }

      // AbortController timeout — matches request() to prevent indefinite hangs
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const timer = logger.startTimer(`api.fetch:${worker}${path}`);
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers,
      }).finally(() => clearTimeout(timeoutId));
      timer.end({ method: options?.method ?? 'GET', status: response.status });

      if (!response.ok) {
        const error = (await response
          .json()
          .catch(() => ({ message: 'Unknown error' }))) as {
          message?: string;
          code?: string;
        };
        throw new ApiError(
          response.status,
          error.message ?? 'API Error',
          error.code
        );
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
       * Upload avatar (multipart - uses raw fetch for FormData, then unwraps procedure envelope)
       */
      uploadAvatar: (file: File): Promise<AvatarUploadResponse> => {
        const url = `${serverApiUrl(platform, 'identity')}/api/user/avatar`;
        const formData = new FormData();
        formData.append('avatar', file);

        return fetch(url, {
          method: 'POST',
          headers: sessionCookie
            ? { Cookie: `${COOKIES.SESSION_NAME}=${sessionCookie}` }
            : {},
          body: formData,
        }).then(async (res) => {
          if (!res.ok) throw new ApiError(res.status, 'Upload failed');
          const json = await res.json();
          // Unwrap single-item envelope: { data: T } → T
          const record = json as Record<string, unknown>;
          if ('data' in record && record.data != null) {
            return record.data as AvatarUploadResponse;
          }
          return json as AvatarUploadResponse;
        });
      },

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
       * - accessType: 'free' | 'paid' | 'subscribers' | 'members' (optional)
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
        request<PaginatedListResponse<ContentWithRelations>>(
          'content',
          `/api/content/public${params ? `?${params}` : ''}`
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
      uploadLogo: (
        id: string,
        file: File
      ): Promise<BrandingSettingsResponse> => {
        const url = `${serverApiUrl(platform, 'org')}/api/organizations/${id}/settings/branding/logo`;
        const formData = new FormData();
        formData.append('logo', file);

        return fetch(url, {
          method: 'POST',
          headers: sessionCookie
            ? { Cookie: `${COOKIES.SESSION_NAME}=${sessionCookie}` }
            : {},
          body: formData,
        }).then(async (res) => {
          if (!res.ok) throw new ApiError(res.status, 'Logo upload failed');
          const json = await res.json();
          // Unwrap single-item envelope: { data: T } → T
          const record = json as Record<string, unknown>;
          if ('data' in record && record.data != null) {
            return record.data as BrandingSettingsResponse;
          }
          return json as BrandingSettingsResponse;
        });
      },

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
     * Analytics endpoints (Admin API)
     */

    /**
     * Get revenue stats
     * Returns { totalRevenueCents, totalPurchases, averageOrderValueCents, ... }
     */
    analytics: {
      /**
       * Get revenue statistics
       *
       * Query parameters (from AdminRevenueQueryInput):
       * - startDate: ISO date string, e.g., '2025-01-01' (optional)
       * - endDate: ISO date string, e.g., '2025-01-31' (optional)
       *
       * Note: Maximum date range is 365 days (enforced by backend).
       *
       * @example
       * ```typescript
       * const params = new URLSearchParams();
       * params.set('startDate', '2025-01-01');
       * params.set('endDate', '2025-01-31');
       * const revenue = await api.analytics.getRevenue(params);
       * ```
       *
       * @see {@link AdminRevenueQueryInput}
       */
      getRevenue: (params?: URLSearchParams) =>
        request<RevenueAnalyticsResponse>(
          'admin',
          `/api/admin/analytics/revenue${params ? `?${params}` : ''}`
        ),

      /**
       * Get top content by revenue
       * Returns array of { contentId, contentTitle, revenueCents, purchaseCount }
       *
       * Query parameters (from AdminTopContentQueryInput):
       * - limit: number of items to return (1-100, default: 10)
       *
       * @example
       * ```typescript
       * const params = new URLSearchParams();
       * params.set('limit', '20');
       * const topContent = await api.analytics.getTopContent(params);
       * ```
       *
       * @see {@link AdminTopContentQueryInput}
       */
      getTopContent: (params?: URLSearchParams) =>
        request<TopContentAnalyticsResponse>(
          'admin',
          `/api/admin/analytics/top-content${params ? `?${params}` : ''}`
        ),

      /**
       * Get combined dashboard statistics (revenue, customers, top content)
       *
       * Single endpoint replacing 3 parallel calls. Returns:
       * - revenue: RevenueStats (includes revenueByDay[])
       * - customers: CustomerStats (totalCustomers, newCustomersLast30Days)
       * - topContent: PaginatedListResponse<TopContentItem>
       *
       * Query parameters (from adminDashboardStatsQuerySchema):
       * - organizationId: UUID (required)
       *
       * @example
       * ```typescript
       * const params = new URLSearchParams();
       * params.set('organizationId', orgId);
       * const stats = await api.analytics.getDashboardStats(params);
       * ```
       */
      getDashboardStats: (params?: URLSearchParams) =>
        request<DashboardStats>(
          'admin',
          `/api/admin/analytics/dashboard-stats${params ? `?${params}` : ''}`
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
       * Get user's current subscription for an org
       */
      getCurrent: (organizationId: string) =>
        request<CurrentSubscription | null>(
          'ecom',
          `/subscriptions/current?organizationId=${encodeURIComponent(organizationId)}`
        ),

      /**
       * Get all user's active subscriptions
       */
      getMine: () =>
        request<UserOrgSubscription[]>('ecom', '/subscriptions/mine'),

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
       * Get subscription stats for an org (admin)
       */
      getStats: (organizationId: string) =>
        request<SubscriptionStats>(
          'ecom',
          `/subscriptions/stats?organizationId=${encodeURIComponent(organizationId)}`
        ),

      /**
       * List subscribers for an org (admin, paginated)
       */
      getSubscribers: (organizationId: string, params?: URLSearchParams) => {
        const query = new URLSearchParams(params);
        query.set('organizationId', organizationId);
        return request<PaginatedListResponse<SubscriberItem>>(
          'ecom',
          `/subscriptions/subscribers?${query}`
        );
      },
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
    },
  };
}

/**
 * Type of the server API client
 */
export type ServerApi = ReturnType<typeof createServerApi>;
