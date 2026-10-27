/**
 * Type definitions for Content Management Service
 *
 * Uses proper Drizzle ORM types - NO `any` types anywhere!
 * All types are inferred from database schema or explicitly defined.
 */

import type { DatabaseClient, dbHttp } from '@codex/database';
import type {
  Content,
  MediaItem,
  NewContent,
  NewMediaItem,
  ServedMediaItem,
} from '@codex/database/schema';
import type { ReadableOrganization } from '@codex/organization';

/**
 * Database client type — re-exported from `@codex/database` so consumers
 * see a single canonical shape. Accepts HTTP or WS clients (services
 * read under HTTP in workers and WS in tests).
 */
export type Database = DatabaseClient;

/**
 * Transaction type for Drizzle ORM
 * Used for multi-step database operations
 */
export type DatabaseTransaction = Parameters<
  Parameters<typeof dbHttp.transaction>[0]
>[0];

import type {
  PaginatedListResponse,
  PaginationParams,
  PublicContentCreator,
  PublicContentOrganization,
  PublicMediaItem,
  SingleItemResponse,
  SortOrder,
} from '@codex/shared-types';

// The catalogue's wire types live in shared-types, so content-api, this
// package and apps/web compile against one contract (Codex-ve5eh).
export type {
  PublicContentCreator,
  PublicContentOrganization,
  PublicMediaItem,
};

/**
 * Content query filters
 */
export interface ContentFilters {
  status?: 'draft' | 'published' | 'archived';
  contentType?: 'video' | 'audio' | 'written';
  accessType?:
    | 'free'
    | 'paid'
    | 'followers'
    | 'subscribers'
    | 'team'
    | 'course';
  category?: string;
  organizationId?: string | null;
  creatorId?: string;
  search?: string;
  sortBy?:
    | 'createdAt'
    | 'updatedAt'
    | 'publishedAt'
    | 'title'
    | 'viewCount'
    | 'purchaseCount';
  sortOrder?: SortOrder;
}

/**
 * Media item query filters
 */
export interface MediaItemFilters {
  status?: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed';
  mediaType?: 'video' | 'audio';
  sortBy?: 'createdAt' | 'uploadedAt' | 'title';
  sortOrder?: SortOrder;
}

/**
 * Content with populated relations
 */
export interface ContentWithRelations extends Content {
  creator?: {
    id: string;
    /** Absent on the anonymous public list (`listPublic`), which never selects it. */
    email?: string;
    name: string | null;
  };
  /** Never the payee's user id: every read leaves it out (Codex-kk6zx). */
  organization?: ReadableOrganization | null;
  mediaItem?: ServedMediaItem | null;
  /**
   * Ids of the `categories` (topic taxonomy) this content belongs to (WP-5).
   * Populated by `ContentService.get` so the studio edit form can pre-select
   * current memberships; excludes soft-deleted categories.
   */
  categoryIds?: string[];
}

export type { ServedMediaItem };

/**
 * Media item with populated relations
 */
export interface MediaItemWithRelations extends ServedMediaItem {
  creator?: {
    id: string;
    email: string;
    name: string | null;
  };
}

/**
 * Re-export database types for convenience
 */
export type { Content, MediaItem };
export type { NewContent, NewMediaItem };
export type { PaginationParams, SortOrder };

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Response for GET /api/content/:id
 * Returns a single content item with full relations
 */
export type ContentResponse = SingleItemResponse<ContentWithRelations>;

/**
 * Response for GET /api/content
 * Returns paginated list of content items with relations
 */
export type ContentListResponse = PaginatedListResponse<ContentWithRelations>;

/**
 * The media_items columns the anonymous public list (`listPublic`) selects
 * (Codex-ve5eh). `durationSeconds` is the one field the web reads directly;
 * the two keys are read on the server only, to build `thumbnailUrl` and
 * `hlsPreviewUrl`, and never go on the wire. Anything else on the row (r2Key,
 * hlsMasterPlaylistKey, runpodJobId, transcodingError, ...) is internal.
 */
export type PublicMediaItemSource = Pick<
  MediaItem,
  'durationSeconds' | 'thumbnailKey' | 'hlsPreviewKey'
>;

/**
 * A catalogue row any viewer may read: the content row without its sales count
 * (`CATALOGUE_CONTENT_COLUMNS`), its creator without an email, and the
 * projected org and media item. `list({ scope: 'browse' })` returns these
 * (Codex-1bdx0); `listPublic` adds the topic slugs. The org and creator are
 * already their wire shapes (`@codex/shared-types`); the media item still holds
 * the two keys the route resolves to URLs.
 */
export type CatalogueContentRow = Omit<
  ContentWithRelations,
  'mediaItem' | 'organization' | 'creator' | 'purchaseCount'
> & {
  mediaItem: PublicMediaItemSource | null;
  organization: PublicContentOrganization | null;
  creator: PublicContentCreator;
};

/**
 * One `listPublic` row: a catalogue row and its org-scoped topic slugs.
 */
export type PublicContentRow = CatalogueContentRow & {
  categorySlugs: string[];
};

/**
 * One item of `GET /api/content/public` as content-api sends it: a
 * `listPublic` row with its media item's keys resolved to URLs. It is what the
 * worker's builder (`toPublicItems`, r2-public-urls.ts) returns for a
 * `PublicContentRow`, checked there at compile time. apps/web keeps its own
 * copy, `PublicContentListItem` (api.ts), on its own row types. It stays here, not in
 * `@codex/shared-types`: it is built on the content row type from
 * `@codex/database`, and shared-types sits below the database.
 */
export type PublicContentItem = Omit<PublicContentRow, 'mediaItem'> & {
  mediaItem: PublicMediaItem | null;
};

/**
 * Response for GET /api/content/public
 * Returns paginated list of published content for unauthenticated visitors
 */
export type PublicContentListResponse =
  PaginatedListResponse<PublicContentItem>;

/**
 * Response for POST /api/content
 * Returns newly created content item
 */
export type CreateContentResponse = SingleItemResponse<Content>;

/**
 * Response for PATCH /api/content/:id
 * Returns updated content item
 */
export type UpdateContentResponse = SingleItemResponse<Content>;

/**
 * Response for POST /api/content/:id/publish
 * Returns published content item
 */
export type PublishContentResponse = SingleItemResponse<Content>;

/**
 * Response for POST /api/content/:id/unpublish
 * Returns unpublished content item
 */
export type UnpublishContentResponse = SingleItemResponse<Content>;

/**
 * Response for DELETE /api/content/:id
 * Returns null (204 No Content)
 */
export type DeleteContentResponse = null;

/**
 * Response for GET /api/media/:id
 * Returns a single media item with full relations
 */
export type MediaResponse = SingleItemResponse<MediaItemWithRelations>;

/**
 * Response for GET /api/media
 * Returns paginated list of media items with relations
 */
export type MediaListResponse = PaginatedListResponse<MediaItemWithRelations>;

/**
 * Response for POST /api/media
 * Returns newly created media item
 */
export type CreateMediaResponse = SingleItemResponse<ServedMediaItem>;

/**
 * Response for PATCH /api/media/:id
 * Returns updated media item
 */
export type UpdateMediaResponse = SingleItemResponse<ServedMediaItem>;

/**
 * Response for DELETE /api/media/:id
 * Returns null (204 No Content)
 */
export type DeleteMediaResponse = null;
