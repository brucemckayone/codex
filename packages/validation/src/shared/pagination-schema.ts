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
  page: z.coerce
    .number()
    .int({ message: 'Must be a whole number' })
    .positive({ message: 'Must be greater than 0' })
    .max(1000, { message: 'Must be 1000 or less' })
    .default(1),
  limit: z.coerce
    .number()
    .int({ message: 'Must be a whole number' })
    .positive({ message: 'Must be greater than 0' })
    .max(100, { message: 'Must be 100 or less' })
    .default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
