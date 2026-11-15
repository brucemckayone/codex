/**
 * The content list's status tabs, as its address holds them (`?status=`).
 * Both studios' lists read it here (Codex-a6ofh.2.6), so a link to the
 * drafts (the dashboard's, the New menu's) opens them in either.
 *
 * A tab is a lifecycle, not the stored status (Codex-a6ofh.3.6, owner
 * 2026-11-13): Drafts are the drafts never live, and Off sale the pieces
 * once live and not on sale now, archived or a draft again. The list asks
 * the API for the same (`lifecycle`), so its pages and totals are the tab's.
 */

import {
  CONTENT_LIFECYCLE,
  CONTENT_LIFECYCLES,
  CONTENT_STATUS,
  type ContentLifecycle,
} from '@codex/constants';
import { CONTENT_LIST_HREF } from '../editor/editor-url';

export type ContentStatusFilter = 'all' | ContentLifecycle;

export const DRAFTS_HREF = `${CONTENT_LIST_HREF}?status=${CONTENT_LIFECYCLE.DRAFT}`;

/** The tab an address asks for: all unless it names one. */
export function readStatusFilter(url: URL): ContentStatusFilter {
  const asked = url.searchParams.get('status');
  // The tab was Archived until Codex-a6ofh.3.6: an old link opens Off sale,
  // which holds every archived piece.
  if (asked === CONTENT_STATUS.ARCHIVED) return CONTENT_LIFECYCLE.OFF_SALE;
  return CONTENT_LIFECYCLES.find((lifecycle) => lifecycle === asked) ?? 'all';
}
