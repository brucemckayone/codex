/**
 * A content row as the content lists hold it, a draft unless told otherwise
 * (Codex-a6ofh.2.6): the fields a draft's progress reads, set to a blank
 * free video with no media. Each test sets what it is about.
 *
 * Plain `.ts`, NOT a `*.test.*` file → never collected as a suite.
 */
import type { ContentWithRelations } from '$lib/types';

export const MEDIA_ID = '22222222-2222-2222-2222-222222222222';

export function draftRow(
  fields: Partial<ContentWithRelations> = {}
): ContentWithRelations {
  return {
    id: 'c1',
    title: 'Svelte runes deep dive',
    contentType: 'video',
    status: 'draft',
    publishedAt: null,
    description: null,
    contentBody: null,
    contentBodyJson: null,
    mediaItemId: null,
    mediaItem: null,
    thumbnailUrl: null,
    organizationId: 'org-1',
    isFree: true,
    isPurchasable: false,
    priceCents: null,
    isTierGated: false,
    isFollowerGated: false,
    isTeamOnly: false,
    category: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...fields,
  } as ContentWithRelations;
}

/** The row's media, as the list joins it. */
export function withMedia(
  status: string,
  deletedAt: Date | null = null
): Partial<ContentWithRelations> {
  return {
    mediaItemId: MEDIA_ID,
    mediaItem: { id: MEDIA_ID, status, deletedAt } as never,
  };
}

/** For sale at £12. */
export const PAID = { isFree: false, isPurchasable: true, priceCents: 1200 };

/** Live since now. */
export const LIVE = {
  status: 'published',
  publishedAt: new Date().toISOString() as never,
} as const;
