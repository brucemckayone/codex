/**
 * The purchase history's piece: the columns a history row reads, and where
 * the bought piece is now (Codex-a6ofh.6.7, mockup LN9). A module of its own
 * so purchase-service.ts, a money file, does not grow (architecture rule
 * SIZE).
 */
import type { PurchasedContentState, PurchaseWithItem } from '../types';

/**
 * The piece's columns for a history row. `leavesAt` and `deletedAt` say
 * where it is now, and there is no `deletedAt` filter: the purchase row
 * stays after the piece goes.
 */
export const HISTORY_CONTENT = {
  id: true,
  title: true,
  slug: true,
  thumbnailUrl: true,
  contentType: true,
  leavesAt: true,
  deletedAt: true,
} as const;

/**
 * Where a bought piece is now: removed once deleted (on its delete), leaving
 * while it has a leave date, else still on Revelations. `null` for a course
 * purchase, which has no piece.
 */
export function contentStateOf(
  piece: PurchaseWithItem['content']
): PurchasedContentState | null {
  if (piece === null) return null;
  if (piece.deletedAt != null) {
    return { state: 'removed', on: piece.deletedAt.toISOString() };
  }
  if (piece.leavesAt != null) {
    return { state: 'leaving', on: piece.leavesAt.toISOString() };
  }
  return { state: 'available' };
}
