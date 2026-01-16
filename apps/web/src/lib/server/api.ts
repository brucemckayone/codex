/**
 * Server-side API client factory
 *
 * Provides typed access to backend workers with:
 * - Automatic URL resolution based on environment
 * - Session cookie forwarding
 * - Typed error handling
 */

import { getServiceUrl, type ServiceName } from '@codex/constants';
import { dev } from '$app/environment';
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
 * @returns API client with typed fetch method
 */
export function createServerApi(platform: App.Platform | undefined) {
  return {
    /**
     * Make a fetch request to a backend worker
     *
     * @param worker - Which worker to call
     * @param path - API path (starting with /)
     * @param sessionCookie - Optional session cookie value
     * @param options - Additional fetch options
     * @returns Typed response data
     */
    async fetch<T>(
      worker: ServiceName,
      path: string,
      sessionCookie?: string,
      options?: RequestInit
    ): Promise<T> {
      const url = `${serverApiUrl(platform, worker)}${path}`;
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...options?.headers,
      };

      if (sessionCookie) {
        (headers as Record<string, string>).Cookie =
          `codex-session=${sessionCookie}`;
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

      return response.json();
    },
  };
}
