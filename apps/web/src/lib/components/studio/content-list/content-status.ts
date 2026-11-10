/**
 * The content list's status filter, as its address holds it (`?status=`).
 * Both studios' lists read it here (Codex-a6ofh.2.6), so a link to the
 * drafts (the dashboard's, the New menu's) opens them in either.
 */

import { CONTENT_STATUS } from '@codex/constants';
import { CONTENT_LIST_HREF } from '../editor/editor-url';

type ContentStatus = (typeof CONTENT_STATUS)[keyof typeof CONTENT_STATUS];

export type ContentStatusFilter = 'all' | ContentStatus;

const STATUSES: readonly ContentStatus[] = Object.values(CONTENT_STATUS);

export const DRAFTS_HREF = `${CONTENT_LIST_HREF}?status=${CONTENT_STATUS.DRAFT}`;

/** The status an address asks for: all unless it names one. */
export function readStatusFilter(url: URL): ContentStatusFilter {
  const asked = url.searchParams.get('status');
  return STATUSES.find((status) => status === asked) ?? 'all';
}
