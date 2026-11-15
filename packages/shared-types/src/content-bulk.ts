/**
 * The studio content list's bulk actions (Codex-a6ofh.3.5, owner 2026-11-12:
 * "Bulk endpoints, one bump"). `POST /api/content/bulk/{publish, unpublish,
 * delete, categories, access}` → `{ data: ContentBulkResponse }`: each piece
 * goes through its own rules, and comes back with what happened to it.
 */
import type { ErrorResponse } from './worker-types';

/** The bulk actions, each `POST /api/content/bulk/<action>`. */
export type ContentBulkAction =
  | 'publish'
  | 'unpublish'
  | 'delete'
  | 'categories'
  | 'access';

/**
 * What happened to one piece:
 * - `done`: it changed;
 * - `scheduled`: a publish set to go live when its media is ready (D-b1);
 * - `unchanged`: there was nothing to do (already live, already a draft, the
 *   categories or the access already held);
 * - `refused`: a 4xx of its own, `error` as the per-piece route sends it;
 * - `failed`: a 5xx on that piece, logged, `error` with no internal detail.
 */
export type ContentBulkOutcome =
  | 'done'
  | 'scheduled'
  | 'unchanged'
  | 'refused'
  | 'failed';

export type ContentBulkResult =
  | { id: string; outcome: 'done' | 'scheduled' | 'unchanged' }
  | {
      id: string;
      outcome: 'refused' | 'failed';
      error: ErrorResponse['error'];
    };

export interface ContentBulkResponse {
  /** One per id, in the order sent. */
  results: ContentBulkResult[];
}
