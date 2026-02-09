/**
 * Shared API Error class
 *
 * This lives in $lib/api/ (not $lib/server/) so it can be used by:
 * - Remote Functions (server-side)
 * - Client components (error handling)
 * - Server API client
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

  /**
   * Type guard to check if an error is an ApiError
   */
  static isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError;
  }
}
