import { z } from 'zod';

/** The last page any list accepts. */
export const PAGINATION_MAX_PAGE = 1000;

/** The most items one page of a list holds. */
export const PAGINATION_MAX_LIMIT = 100;

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
    .max(PAGINATION_MAX_PAGE, {
      message: `Must be ${PAGINATION_MAX_PAGE} or less`,
    })
    .default(1),
  limit: z.coerce
    .number()
    .int({ message: 'Must be a whole number' })
    .positive({ message: 'Must be greater than 0' })
    .max(PAGINATION_MAX_LIMIT, {
      message: `Must be ${PAGINATION_MAX_LIMIT} or less`,
    })
    .default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

/**
 * A `?page=` URL param as a page every list accepts (1 to
 * {@link PAGINATION_MAX_PAGE}), for a server load that forwards it
 * (Codex-osuqt). A hand-edited `?page=1001` or `?page=abc` would otherwise
 * reach the API as a 400, which a page logs at error level as its own
 * contract bug: an alarm any visitor could raise by editing a URL.
 */
export function clampPageParam(raw: string | null | undefined): number {
  const page = Number.parseInt(raw ?? '1', 10) || 1;
  return Math.min(PAGINATION_MAX_PAGE, Math.max(1, page));
}
