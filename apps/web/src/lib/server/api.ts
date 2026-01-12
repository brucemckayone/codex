/**
 * Server-side API client factory
 *
 * Provides typed access to backend workers with:
 * - Automatic URL resolution based on environment
 * - Session cookie forwarding
 * - Typed error handling
 */

const DEFAULT_URLS = {
  auth: 'http://localhost:42069',
  content: 'http://localhost:4001',
  access: 'http://localhost:4001',
  org: 'http://localhost:42071',
  ecom: 'http://localhost:42072',
} as const;

type WorkerName = keyof typeof DEFAULT_URLS;

/**
 * API Error with typed properties
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Create a server-side API client
 *
 * @param platform - The SvelteKit platform object with env bindings
 * @returns API client with typed fetch method
 */
export function createServerApi(platform: App.Platform | undefined) {
  const getUrl = (worker: WorkerName): string => {
    switch (worker) {
      case 'auth':
        return platform?.env?.AUTH_WORKER_URL ?? DEFAULT_URLS.auth;
      case 'content':
      case 'access':
        return platform?.env?.API_URL ?? DEFAULT_URLS.content;
      case 'org':
        return platform?.env?.ORG_API_URL ?? DEFAULT_URLS.org;
      case 'ecom':
        return platform?.env?.ECOM_API_URL ?? DEFAULT_URLS.ecom;
    }
  };

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
      worker: WorkerName,
      path: string,
      sessionCookie?: string,
      options?: RequestInit
    ): Promise<T> {
      const url = `${getUrl(worker)}${path}`;
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
