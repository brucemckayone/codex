/**
 * Server-side API client factory
 *
 * Provides typed access to backend workers with:
 * - Automatic URL resolution based on environment
 * - Session cookie forwarding
 * - Typed error handling
 * - Helper methods for common endpoints
 */

import {
  COOKIES,
  getServiceUrl,
  HEADERS,
  MIME_TYPES,
  type ServiceName,
} from '@codex/constants';
import type { MediaItem } from '@codex/database/schema';
import type {
  ActivityFeedResponse,
  AllSettingsResponse,
  AvatarUploadResponse,
  BrandingSettingsResponse,
  ContactSettingsResponse,
  CustomerListItem,
  MyMembershipResponse,
  NotificationPreferencesResponse,
  OrganizationWithRole,
  PaginatedListResponse,
  PlaybackProgressResponse,
  PurchaseListItem,
  RevenueAnalyticsResponse,
  SessionData,
  SingleItemResponse,
  StreamingUrlResponse,
  TopContentAnalyticsResponse,
  UpdatePlaybackProgressResponse,
  UserData,
  UserLibraryResponse,
} from '@codex/shared-types';
import type {
  CreateCheckoutInput,
  CreatePortalSessionInput,
  UpdateBrandingInput,
  UpdateContactInput,
  UpdateNotificationPreferencesInput,
  UpdateProfileInput,
} from '@codex/validation';
import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
// Import local types that extend DB types with relations
import type {
  CheckoutResponse,
  ContentWithRelations,
  MediaItemWithRelations,
  OrganizationData,
} from '../types';
import { ApiError } from './errors';

/**
 * Organization member item shape returned by the members API
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

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers,
    }).finally(() => clearTimeout(timeoutId));

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

    return response.json();
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

      const response = await fetch(url, {
        ...options,
        headers,
      });

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

      return response.json();
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
      getProfile: () =>
        request<SingleItemResponse<UserData>>('identity', '/api/user/profile'),

      /**
       * Update user profile
       */
      updateProfile: (data: UpdateProfileInput) =>
        request<SingleItemResponse<UserData>>('identity', '/api/user/profile', {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),

      /**
       * Get notification preferences
       */
      getNotificationPreferences: () =>
        request<SingleItemResponse<NotificationPreferencesResponse>>(
          'identity',
          '/api/user/notification-preferences'
        ),

      /**
       * Update notification preferences
       */
      updateNotificationPreferences: (
        data: UpdateNotificationPreferencesInput
      ) =>
        request<SingleItemResponse<NotificationPreferencesResponse>>(
          'identity',
          '/api/user/notification-preferences',
          {
            method: 'PUT',
            body: JSON.stringify(data),
          }
        ),

      /**
       * Upload avatar (multipart - handled differently from request())
       * Use direct fetch with FormData instead of request()
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
          return res.json() as Promise<AvatarUploadResponse>;
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
        request<SingleItemResponse<ContentWithRelations>>(
          'content',
          `/api/content/${id}`
        ),

      /**
       * List content with pagination and filtering
       *
       * Query parameters (from ContentQueryInput):
       * - page: number (default: 1)
       * - limit: number (1-100, default: 20)
       * - status: 'draft' | 'published' | 'archived' (optional)
       * - contentType: 'video' | 'audio' | 'written' (optional)
       * - visibility: 'public' | 'private' | 'members_only' | 'purchased_only' (optional)
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
        request<SingleItemResponse<ContentWithRelations>>(
          'content',
          '/api/content',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        ),

      /**
       * Update content
       */
      update: (id: string, data: unknown) =>
        request<SingleItemResponse<ContentWithRelations>>(
          'content',
          `/api/content/${id}`,
          {
            method: 'PATCH',
            body: JSON.stringify(data),
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
       * Get organization by slug
       */
      getBySlug: (slug: string) =>
        request<SingleItemResponse<OrganizationData>>(
          'org',
          `/api/organizations/slug/${slug}`
        ),

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
       * Upload organization logo (multipart form data)
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
          return res.json() as Promise<BrandingSettingsResponse>;
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
       * Get current user's organizations
       */
      getMyOrganizations: () =>
        request<OrganizationWithRole[]>(
          'org',
          '/api/organizations/my-organizations'
        ),

      /**
       * Get public org info by slug (no auth required)
       *
       * Returns org identity + branding for the org layout.
       * Works across subdomains without session cookies.
       */
      getPublicInfo: (slug: string) =>
        request<SingleItemResponse<OrganizationData>>(
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
            avatarUrl: string | null;
            role: string;
            joinedAt: string;
            contentCount: number;
          }>
        >(
          'org',
          `/api/organizations/public/${slug}/creators${params ? `?${params}` : ''}`
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
    },

    /**
     * E-commerce / checkout endpoints
     */
    checkout: {
      /**
       * Create Stripe checkout session
       */
      create: (data: CreateCheckoutInput) =>
        request<SingleItemResponse<CheckoutResponse>>(
          'ecom',
          '/checkout/create',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        ),

      createPortalSession: (data: CreatePortalSessionInput) =>
        request<SingleItemResponse<{ url: string }>>(
          'ecom',
          '/checkout/portal-session',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
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
        request<SingleItemResponse<MediaItem>>('content', '/api/media', {
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
        request<SingleItemResponse<MediaItemWithRelations>>(
          'content',
          `/api/media/${id}`
        ),

      /**
       * Update media item metadata
       */
      update: (id: string, data: unknown) =>
        request<SingleItemResponse<MediaItem>>('content', `/api/media/${id}`, {
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
    },
  };
}

/**
 * Type of the server API client
 */
export type ServerApi = ReturnType<typeof createServerApi>;
