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
  AllSettingsResponse,
  PaginatedListResponse,
  PlaybackProgressResponse,
  SessionData,
  SingleItemResponse,
  StreamingUrlResponse,
  UpdatePlaybackProgressResponse,
  UserData,
  UserLibraryResponse,
} from '@codex/shared-types';
import type { CreateCheckoutInput } from '@codex/validation';
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
      (headers as Record<string, string>).Cookie =
        `${COOKIES.SESSION_NAME}=${sessionCookie}`;
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
          `${COOKIES.SESSION_NAME}=${cookieToUse}`;
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
        request<{ user?: UserData; session?: SessionData }>(
          'auth',
          '/api/auth/session'
        ),
    },

    /**
     * Content endpoints
     */
    content: {
      /**
       * Get content by ID
       */
      get: (id: string) =>
        request<SingleItemResponse<ContentWithRelations>>(
          'content',
          `/api/content/${id}`
        ),

      /**
       * List content with optional filters
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
  };
}

/**
 * Type of the server API client
 */
export type ServerApi = ReturnType<typeof createServerApi>;
