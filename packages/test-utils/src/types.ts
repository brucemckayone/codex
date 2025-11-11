/**
 * Shared Types for Test Utils
 *
 * Common type definitions used across test utilities.
 */

/**
 * Pagination metadata returned by list operations
 */
export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMetadata;
}
