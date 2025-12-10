import { z } from 'zod';

/**
 * Unified pagination schema for all list queries
 *
 * Provides consistent pagination parameters across all API endpoints.
 * Query string parameters are coerced from strings to numbers.
 *
 * @example
 * ```typescript
 * const contentListSchema = paginationSchema.extend({
 *   status: z.enum(['draft', 'published']).optional(),
 * });
 * ```
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().max(1000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
