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
import type {
  ActivityFeedResponse,
  AllSettingsResponse,
  AvatarUploadResponse,
  CustomerListItem,
  MyMembershipResponse,
  NotificationPreferencesResponse,
  OrganizationWithRole,
  PaginatedListResponse,
  PlaybackProgressResponse,
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
  UpdateNotificationPreferencesInput,
  UpdateProfileInput,
} from '@codex/validation';
import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
// Import local types that extend DB types with relations
import type {
  CheckoutResponse,
  ContentWithRelations,
  OrganizationData,
} from '../types';
import { ApiError } from './errors';

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
      (headers as Record<string, string>).Cookie =
        `${COOKIES.SESSION_NAME}=${sessionCookie}; better-auth.session_token=${sessionCookie}`;
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
<<<<<<< feat/studio-layout-shell
       * Get current user's organizations
       */
      getMyOrganizations: () =>
        request<OrganizationWithRole[]>(
          'org',
          '/api/organizations/my-organizations'
        ),

      /**
       * Get user's membership in an organization
       */
      getMyMembership: (id: string) =>
        request<{ role: string | null; joinedAt: string | null }>(
=======
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
>>>>>>> main
          'org',
          `/api/organizations/${id}/members/my-membership`
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
        request<SingleItemResponse<CheckoutResponse>>(
          'ecom',
          '/checkout/create',
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
