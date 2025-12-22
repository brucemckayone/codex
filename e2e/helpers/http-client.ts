/**
 * Simple HTTP client for E2E tests
 * Replaces Playwright's APIRequestContext with native fetch
 */

export interface RequestOptions {
  headers?: Record<string, string>;
  data?: unknown;
  maxRedirects?: number;
  multipart?: Record<
    string,
    { name: string; mimeType: string; buffer: Buffer }
  >;
}

/**
 * HTTP client that mimics Playwright's request API using native fetch
 */
export const httpClient = {
  /**
   * GET request
   */
  async get(url: string, options?: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options?.headers,
    };

    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: options?.maxRedirects === 0 ? 'manual' : 'follow',
    });

    return response;
  },

  /**
   * POST request with JSON body
   */
  async post(url: string, options?: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    // Handle multipart form data
    if (options?.multipart) {
      delete headers['Content-Type']; // Let fetch set the boundary
      const formData = new FormData();

      for (const [fieldName, file] of Object.entries(options.multipart)) {
        const blob = new Blob([file.buffer], { type: file.mimeType });
        formData.append(fieldName, blob, file.name);
      }

      return fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...options?.headers,
        },
        body: formData,
        redirect: options?.maxRedirects === 0 ? 'manual' : 'follow',
      });
    }

    return fetch(url, {
      method: 'POST',
      headers,
      body: options?.data ? JSON.stringify(options.data) : undefined,
      redirect: options?.maxRedirects === 0 ? 'manual' : 'follow',
    });
  },

  /**
   * PUT request with JSON body
   */
  async put(url: string, options?: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    return fetch(url, {
      method: 'PUT',
      headers,
      body: options?.data ? JSON.stringify(options.data) : undefined,
    });
  },

  /**
   * PATCH request with JSON body
   */
  async patch(url: string, options?: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    return fetch(url, {
      method: 'PATCH',
      headers,
      body: options?.data ? JSON.stringify(options.data) : undefined,
    });
  },

  /**
   * DELETE request
   */
  async delete(url: string, options?: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options?.headers,
    };

    return fetch(url, {
      method: 'DELETE',
      headers,
    });
  },
};

// Export type alias for migration compatibility
export type HttpClient = typeof httpClient;
