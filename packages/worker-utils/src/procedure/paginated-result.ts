/**
 * PaginatedResult — Marker class for paginated responses
 *
 * When a procedure handler returns PaginatedResult, procedure() serialises it
 * as a top-level list envelope:
 *
 *   { items: T[], pagination: { page, limit, total, totalPages } }
 *
 * Handlers for non-paginated (single-item) responses return plain objects and
 * procedure() wraps them as { data: T }.
 *
 * @example
 * ```typescript
 * import { PaginatedResult } from '@codex/worker-utils';
 *
 * app.get('/api/content',
 *   procedure({
 *     handler: async (ctx) => {
 *       const result = await ctx.services.content.list(filters, pagination);
 *       return new PaginatedResult(result.items, result.pagination);
 *     },
 *   })
 * );
 * ```
 */

import type { PaginationMetadata } from '@codex/shared-types';

export class PaginatedResult<T> {
  constructor(
    public readonly items: T[],
    public readonly pagination: PaginationMetadata
  ) {}
}
