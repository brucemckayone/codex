/**
 * Content Remote Functions
 *
 * Server-side functions for content browsing using SvelteKit Remote Functions.
 * Uses `query()` for cached reads that can be awaited directly in Svelte templates.
 *
 * These functions use the existing server API client, which handles:
 * - URL resolution based on environment
 * - Session cookie forwarding
 * - Typed error handling
 */

import { ERROR_CODES, PUBLISH_REFUSAL_CODES } from '@codex/constants';
import {
  CONTENT_THUMBNAIL_MAX_BYTES,
  CONTENT_THUMBNAIL_MAX_MB,
  CONTENT_THUMBNAIL_MIME_TYPES,
  checkContentSlugSchema,
  contentDraftSchema,
  contentQuerySchema,
  PAGINATION_MAX_LIMIT,
  PAGINATION_MAX_PAGE,
  publicContentArgsSchema,
  updateContentSchema,
} from '@codex/validation';
import { z } from 'zod';
import { command, form, getRequestEvent, query } from '$app/server';
import { describeThrown } from '$lib/client-log';
import { hasStoredText, renderContentBody } from '$lib/editor/render';
import { logger } from '$lib/observability';
import { isReadOutage, remoteErrorStatus } from '$lib/remote/query-result';
import { createServerApi } from '$lib/server/api';
import { withoutRawBody } from '$lib/server/content-detail';
import { ApiError } from '$lib/server/errors';
import { forwardClientErrors } from '$lib/server/forward-client-errors';
import {
  contentSlugFromTitle,
  freeSlugCandidates,
} from '$lib/utils/content-slug';

// ─────────────────────────────────────────────────────────────────────────────
// Content List Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List content with pagination and filtering
 *
 * Uses existing schema from @codex/validation (Zod v3, Standard Schema compatible)
 *
 * Usage in Svelte:
 * ```svelte
 * {#each await listContent({ status: 'published', limit: 10 }) as item}
 *   <ContentCard content={item} />
 * {/each}
 * ```
 */
export const listContent = query(
  contentQuerySchema.optional(),
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.status) searchParams.set('status', params.status);
    if (params?.organizationId)
      searchParams.set('organizationId', params.organizationId);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
    if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);

    return api.content.list(searchParams.toString() ? searchParams : undefined);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Org Browse Query
// ─────────────────────────────────────────────────────────────────────────────

const browseContentSchema = z.object({
  organizationId: z.string().uuid(),
  page: z.coerce.number().int().min(1).max(PAGINATION_MAX_PAGE).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION_MAX_LIMIT)
    .default(PAGINATION_MAX_LIMIT),
});

/**
 * One page of an organisation's published content, from every creator
 * (`GET /api/content/browse`, the read behind /explore's signed-in sorts).
 * Unlike `listContent`, which is scoped to the signed-in creator, this spans
 * the whole org catalogue; course-only content is never in it. Backs the
 * Studio grant picker (Codex-2hxff.21).
 *
 * Usage in Svelte:
 * ```svelte
 * <script>
 *   const page1 = browseContent({ organizationId: orgId, page: 1 });
 * </script>
 * ```
 */
export const browseContent = query(
  browseContentSchema,
  async ({ organizationId, page, limit }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.content.browse(
      new URLSearchParams({
        organizationId,
        page: String(page),
        limit: String(limit),
      })
    );
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Single Content Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get single content by ID
 *
 * Usage:
 * ```svelte
 * {#await getContent(contentId)}
 *   <Skeleton />
 * {:then { data }}
 *   <h1>{data.title}</h1>
 * {/await}
 * ```
 */
export const getContent = query(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  // A 4xx keeps its status (a piece deleted, or not theirs), so the studio
  // can tell it from an outage (Codex-a6ofh.2.3); a 5xx stays kit's 500.
  return forwardClientErrors(() => api.content.get(id));
});

/**
 * The portals the creator's own piece is a practice in (Codex-a6ofh.2.5):
 * read only where the live editor shows them, so the piece's read stays lean.
 */
export const getContentPortals = query(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return forwardClientErrors(() => api.content.portals(id));
});

/**
 * The creator's own piece as visitors will see it, for the studio's preview
 * (Codex-a6ofh.2.11): a draft too, which the public page cannot show (it
 * reads published pieces only). The read is creator-scoped, so another
 * creator's id is a 404, kept like `getContent`'s. The body is rendered here
 * as the public page renders it, and the raw body is not sent with it.
 * Stored text that rendered to nothing is said (`contentBodyUnavailable`),
 * never shown as no body (Codex-uuz1g).
 */
export const getContentPreview = query(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  const content = await forwardClientErrors(() => api.content.get(id));
  const media = content.mediaItem ?? null;
  // A piece with no cover of its own shows its media's poster, as the public
  // read resolves it and the creator's read does not. A deleted file's poster
  // is never read: the preview says it was deleted.
  const posterless =
    !content.thumbnailUrl && media?.thumbnailKey != null && !media.deletedAt;
  const [contentBodyHtml, mediaPoster] = await Promise.all([
    renderContentBody(content, {
      contentId: content.id,
      surface: 'studio-preview',
    }),
    posterless && media ? mediaPosterUrl(api, media.id, content.id) : null,
  ]);
  return {
    content: {
      ...withoutRawBody(content),
      mediaItem: media ? { ...media, thumbnailUrl: mediaPoster } : null,
    },
    contentBodyHtml,
    contentBodyUnavailable: hasStoredText(content) && contentBodyHtml == null,
  };
});

/**
 * The media's own poster, for a preview with no cover of its own. It only
 * decorates the player, so a read that fails is logged and the preview
 * shows none, as a piece with no poster does.
 */
async function mediaPosterUrl(
  api: ReturnType<typeof createServerApi>,
  mediaId: string,
  contentId: string
): Promise<string | null> {
  try {
    return (await api.media.get(mediaId)).thumbnailUrl;
  } catch (error) {
    logger.warn('studio_content_preview.poster_read_failed', {
      contentId,
      mediaId,
      ...describeThrown(error),
    });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Content by Slug Query (for SEO-friendly URLs)
// ─────────────────────────────────────────────────────────────────────────────

const contentBySlugSchema = z.object({
  orgSlug: z.string().min(1),
  contentSlug: z.string().min(1),
});

/**
 * Get content by organization and content slugs
 *
 * Useful for SEO-friendly URLs like /creators/username/content-title
 *
 * Usage:
 * ```svelte
 * {#await getContentBySlug({ orgSlug: 'john-doe', contentSlug: 'intro-to-coding' })}
 *   <Skeleton />
 * {:then { data }}
 *   <ContentDetail content={data} />
 * {/await}
 * ```
 */
export const getContentBySlug = query(
  contentBySlugSchema,
  async ({ orgSlug, contentSlug }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    // First get the organization by slug
    const org = await api.org.getBySlug(orgSlug);
    if (!org?.id) {
      throw new Error('Organization not found');
    }

    // Then get content filtered by org
    const params = new URLSearchParams();
    params.set('organizationId', org.id);
    params.set('slug', contentSlug);
    params.set('limit', '1');

    const contentResponse = await api.content.list(params);
    const content = contentResponse?.items?.[0];

    if (!content) {
      throw new Error('Content not found');
    }

    return content;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Content Slug Availability Check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a content slug is available
 *
 * Used by SlugField for real-time uniqueness feedback.
 * Scoped to organization (org content) or creator (personal content).
 * A refusal keeps its status (a lapsed sign-in, a piece not theirs), never
 * a 500 read as an outage (the epic review).
 */
export const checkContentSlug = query(
  checkContentSlugSchema,
  async ({ slug, organizationId, excludeContentId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return forwardClientErrors(() =>
      api.content.checkSlug(slug, organizationId, excludeContentId)
    );
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Public Content List Query (no auth required)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List published content for an organization (public, no auth required)
 *
 * Used by org landing and explore pages to display content to unauthenticated visitors.
 * Its arguments are `publicContentArgsSchema`, built from the API's own field
 * rules so that an argument the API would refuse is refused here as a 400.
 *
 * Usage in Svelte:
 * ```svelte
 * {#each (await getPublicContent({ orgId })).items as item}
 *   <ContentCard content={item} />
 * {/each}
 * ```
 */
export const getPublicContent = query(
  publicContentArgsSchema,
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const searchParams = new URLSearchParams();
    searchParams.set('orgId', params.orgId);
    if (params.slug) searchParams.set('slug', params.slug);
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.contentType) searchParams.set('contentType', params.contentType);
    if (params.category) searchParams.set('category', params.category);
    if (params.search) searchParams.set('search', params.search);
    if (params.sort) searchParams.set('sort', params.sort);
    if (params.creatorId) searchParams.set('creatorId', params.creatorId);
    if (params.featured !== undefined)
      searchParams.set('featured', String(params.featured));

    return api.content.getPublicContent(searchParams);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Batched Content Query (for n+1 problem)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Batched content fetch for solving n+1 problem
 *
 * When rendering a list where each item needs additional content data,
 * use this batched query instead of individual getContent calls.
 *
 * Usage:
 * ```svelte
 * {#each items as item}
 *   {#await getContentBatch(item.contentId)}
 *     <Skeleton />
 *   {:then content}
 *     <span>{content.title}</span>
 *   {/await}
 * {/each}
 * ```
 */
export const getContentBatch = query.batch(z.string().uuid(), async (ids) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  // Fetch all content IDs in a single request
  const params = new URLSearchParams();
  for (const id of ids) {
    params.append('id', id);
  }

  const response = await api.content.list(params);
  const contents = response?.items ?? [];

  // Create lookup map for O(1) access
  const lookup = new Map(contents.map((c) => [c.id, c]));

  // Return resolver function
  return (id: string) => lookup.get(id) ?? null;
});

// ─────────────────────────────────────────────────────────────────────────────
// Content Mutations (command)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete content by ID. A refusal keeps its status and words
 * ({@link forwardClientErrors}): a lapsed sign-in or a piece already gone is
 * not an outage. A piece already gone says so by its own code
 * (`CONTENT_NOT_FOUND`), which the editor treats as done; a 404 alone is not.
 *
 * Usage:
 * ```typescript
 * await deleteContent(contentId);
 * ```
 */
export const deleteContent = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return forwardClientErrors(() => api.content.delete(id), {
    detailCodes: [ERROR_CODES.CONTENT_NOT_FOUND],
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Content Status Transitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Publish content (draft -> published)
 *
 * Calls POST /api/content/:id/publish. The backend enforces business rules
 * (e.g., media must be ready for video/audio content before publishing).
 *
 * A refusal the creator can act on keeps its message, such as "Set up payouts
 * before publishing…" (Codex-2hxff.14): a bare `ApiError` would read "An
 * unexpected error occurred" in production. A 5xx stays sanitised. Its code
 * is the refusal's own (`PUBLISH_REFUSAL_CODES`), never just the class, so
 * the publish checklist can name the row (Codex-a6ofh.2.4).
 */
export const publishContent = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return forwardClientErrors(() => api.content.publish(id), {
    detailCodes: PUBLISH_REFUSAL_CODES,
  });
});

/**
 * A piece's publish fields and its saved address: all the Publish step reads
 * of a publish when ready, a cancel or a check (Codex-a6ofh.2.9), so only
 * these go back.
 */
function publishFields(row: {
  status: string;
  publishedAt: Date | string | null;
  publishRequestedAt: Date | string | null;
  publishBlockedReason: string | null;
  slug: string | null;
}) {
  return {
    status: row.status,
    publishedAt: row.publishedAt,
    publishRequestedAt: row.publishRequestedAt,
    publishBlockedReason: row.publishBlockedReason,
    // Its address as saved, for View once it is live.
    slug: row.slug,
  };
}

/**
 * Publish when ready (Codex-a6ofh.2.9): as {@link publishContent}, but media
 * still on its way schedules the go-live instead of refusing. Every other
 * rule is checked now, and refuses by the same codes. Ready media goes live
 * at once; otherwise it comes back a draft with `publishRequestedAt` set, so
 * the caller reads its `status` to know which.
 */
export const publishContentWhenReady = command(
  z.string().uuid(),
  async (id) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const row = await forwardClientErrors(
      () => api.content.publish(id, { whenReady: true }),
      { detailCodes: PUBLISH_REFUSAL_CODES }
    );
    return publishFields(row);
  }
);

/**
 * Where a piece's publish stands (Codex-a6ofh.2.9): its status and its
 * publish-when-ready fields, read fresh. The Publish step reads it after the
 * media settles, to see the go-live land, without refreshing the page's own
 * read of the piece (a background refresh of that is a trap: it can swap in
 * the error page). Only these fields go back.
 */
export const readPublishState = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return publishFields(await forwardClientErrors(() => api.content.get(id)));
});

/** Its own code, so the step can tell "it went live first" from a failure. */
const CANCEL_REFUSAL_CODES = [ERROR_CODES.CONTENT_ALREADY_LIVE] as const;

/** A save's own refusals: a publish rule's, or a draft's save that came after it went live. */
const SAVE_REFUSAL_CODES = [
  ...PUBLISH_REFUSAL_CODES,
  ERROR_CODES.CONTENT_ALREADY_LIVE,
] as const;

/**
 * Cancel a publish-when-ready schedule (Codex-a6ofh.2.9): DELETE
 * /api/content/:id/publish-request. The draft stays a draft. Refused with
 * CONTENT_ALREADY_LIVE when the piece went live first.
 */
export const cancelPublishRequest = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  const row = await forwardClientErrors(
    () => api.content.cancelPublishRequest(id),
    { detailCodes: CANCEL_REFUSAL_CODES }
  );
  return publishFields(row);
});

/**
 * Unpublish content (published -> draft)
 *
 * Calls POST /api/content/:id/unpublish.
 */
export const unpublishContent = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return forwardClientErrors(() => api.content.unpublish(id));
});

// ─────────────────────────────────────────────────────────────────────────────
// Draft saving (Codex-a6ofh.2.2)
// ─────────────────────────────────────────────────────────────────────────────

const isSlugTaken = (err: unknown) =>
  ApiError.isApiError(err) && err.status === 409;

/**
 * A slug the title gives, made free: each of {@link freeSlugCandidates} in
 * turn, tried by `write`, which another piece's slug refuses with a 409. The
 * last refusal is the creator's. Returns the slug that took and what `write`
 * answered.
 */
async function withFreeSlug<T>(
  base: string,
  write: (slug: string) => Promise<T>
): Promise<{ slug: string; result: T }> {
  const tries = freeSlugCandidates(base);
  for (let i = 0; ; i += 1) {
    const slug = tries[i] ?? base;
    try {
      return { slug, result: await write(slug) };
    } catch (err) {
      if (i >= tries.length - 1 || !isSlugTaken(err)) throw err;
    }
  }
}

/**
 * Save the fields the editor changed, and only those, as a PATCH.
 *
 * A command: drafts autosave a moment after the creator stops typing, so a
 * save refreshes no list. It sends back only a slug it chose and, when a
 * cover was sent, the cover the row kept: the editor already holds what it
 * saved, and the row would carry the whole body again. A live piece's staged
 * cover too old to take leaves the stored one (Codex-a6ofh.2.5), which the
 * editor then says.
 * A refusal keeps its message and code through {@link forwardClientErrors},
 * a publish rule's own code too: a save to live content refuses a new gap as
 * a publish would. A live piece's Update sends its changes the same way.
 *
 * `slugFollowsTitle`: the slug is the one the title gives, not one the
 * creator typed, so another piece holding it is made free as the first save
 * does ({@link createContentDraft}), never a refusal that stops every save.
 *
 * `asDraft`: a draft's autosave. The server refuses it once the piece has
 * been live (409 CONTENT_ALREADY_LIVE, forwarded with its code), so a piece
 * that went live with the editor still open (its schedule fired, an admin,
 * another tab) never takes a half-typed change (Codex-a6ofh.2).
 */
export const saveContent = command(
  z.object({
    id: z.string().uuid(),
    patch: updateContentSchema,
    slugFollowsTitle: z.boolean().optional(),
    asDraft: z.boolean().optional(),
  }),
  async ({ id, patch, slugFollowsTitle, asDraft = false }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const coverKept = (saved: { thumbnailUrl: string | null }) =>
      patch.thumbnailUrl !== undefined
        ? { thumbnailUrl: saved.thumbnailUrl }
        : {};
    return forwardClientErrors(
      async (): Promise<{ slug?: string; thumbnailUrl?: string | null }> => {
        const { slug } = patch;
        if (!slugFollowsTitle || !slug) {
          return coverKept(await api.content.update(id, patch, { asDraft }));
        }
        const saved = await withFreeSlug(slug, (free) =>
          api.content.update(id, { ...patch, slug: free }, { asDraft })
        );
        return { slug: saved.slug, ...coverKept(saved.result) };
      },
      { detailCodes: SAVE_REFUSAL_CODES }
    );
  }
);

/**
 * Create a draft from the first thing the creator adds (owner 4A): its type,
 * a title and whatever else they have added so far. Returns the new id and
 * the slug it took.
 *
 * The slug comes from the title, made free ({@link withFreeSlug}): a create
 * refuses a taken slug with a 409. Refreshes no list, like
 * {@link saveContent}.
 */
export const createContentDraft = command(contentDraftSchema, async (draft) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  const base = contentSlugFromTitle(draft.title, draft.contentType);
  return forwardClientErrors(async () => {
    const { slug, result } = await withFreeSlug(base, (free) =>
      api.content.create({ ...draft, slug: free })
    );
    return { id: result.id, slug };
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Content Thumbnail Upload (file upload via form)
// ─────────────────────────────────────────────────────────────────────────────

const isThumbnailType = (type: string) =>
  CONTENT_THUMBNAIL_MIME_TYPES.some((allowed) => allowed === type);

const uploadThumbnailSchema = z.object({
  contentId: z.string().uuid(),
  thumbnail: z
    .instanceof(File)
    .refine(
      (file) => isThumbnailType(file.type),
      'Thumbnail must be PNG, JPEG, or WebP'
    )
    .refine(
      (file) => file.size <= CONTENT_THUMBNAIL_MAX_BYTES,
      `File must be less than ${CONTENT_THUMBNAIL_MAX_MB}MB`
    ),
});

/** How long the piece's read after a cover upload may take (`sendPieceBack`). */
const PIECE_REREAD_TIMEOUT_MS = 5000;

type ServerApi = ReturnType<typeof createServerApi>;

/**
 * The piece's own read goes back with a cover form's answer, success or
 * failure (`refreshes`), so kit never falls back to re-running every load on
 * the page, whose failure would swap the editor for the error page mid-edit
 * (Codex-a6ofh.2.3). Kit re-runs them after any form answer that refreshes
 * nothing, so a stage, which changes nothing, sends the piece back too. It
 * is read here and `set`, never `refresh()`ed: kit keeps a refresh's own
 * promise and awaits it again for the response, so a failed one would fail
 * an upload already saved. If the read fails, nothing is recorded and kit
 * re-runs the loads, as it did before. The creator's answer waits on it, so
 * it gets less time than a page read.
 */
async function sendPieceBack(api: ServerApi, contentId: string) {
  try {
    // Read, THEN call the query: kit starts a query's own read a beat after
    // it is called unless a `set` came first, so calling it before this
    // await would read the piece twice.
    const piece = await api.content.get(contentId, {
      timeoutMs: PIECE_REREAD_TIMEOUT_MS,
    });
    getContent(contentId).set(piece);
  } catch (error) {
    const fields = {
      contentId,
      status: remoteErrorStatus(error),
      ...describeThrown(error),
    };
    // An outage here is the warning that kit re-runs the page's loads.
    if (isReadOutage(error)) {
      logger.error('content.thumbnail_reread_failed', fields);
    } else {
      logger.warn('content.thumbnail_reread_failed', fields);
    }
  }
}

/**
 * A cover form's handler: `send` puts the file in place, and the answer is
 * the same either way.
 */
function coverUpload(
  send: (
    api: ServerApi,
    contentId: string,
    file: File
  ) => Promise<{ thumbnailUrl: string }>,
  staged: boolean
) {
  return async ({
    contentId,
    thumbnail,
  }: z.infer<typeof uploadThumbnailSchema>) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    let thumbnailUrl: string;
    try {
      ({ thumbnailUrl } = await send(api, contentId, thumbnail));
    } catch (error) {
      // A refusal is written for the creator; anything else is an outage
      // (the studio's one rule counts a timeout and a rate limit as one),
      // whose message (a fetch error, a stack) never reaches them, so it is
      // logged here. The status lets the studio log it as one too.
      const status = ApiError.isApiError(error) ? error.status : 500;
      const refused = ApiError.isApiError(error) && !isReadOutage(error);
      if (!refused) {
        logger.error('content.thumbnail_upload_failed', {
          contentId,
          status,
          staged,
          ...describeThrown(error),
        });
      }
      await sendPieceBack(api, contentId);
      return {
        success: false as const,
        status,
        error: refused ? error.message : 'Failed to upload thumbnail',
      };
    }
    await sendPieceBack(api, contentId);
    return { success: true as const, thumbnailUrl };
  };
}

/**
 * Upload content thumbnail
 *
 * Uses form() for native FormData submission (File objects cannot be
 * serialized by command()/devalue).
 *
 * Usage:
 * ```svelte
 * <form {...uploadThumbnailForm} enctype="multipart/form-data">
 *   <input type="hidden" name="contentId" value={contentId} />
 *   <input type="file" name="thumbnail" accept="image/png,image/jpeg,image/webp" />
 *   <button>Upload</button>
 * </form>
 * ```
 */
export const uploadThumbnailForm = form(
  uploadThumbnailSchema,
  coverUpload((api, id, file) => api.content.uploadThumbnail(id, file), false)
);

/**
 * Ready a cover for a piece that has been live, without applying it
 * (Codex-a6ofh.2.5): its changes wait for Update, which sends the URL this
 * answers with as `thumbnailUrl`. The row and the public pages are untouched.
 */
export const stageThumbnailForm = form(
  uploadThumbnailSchema,
  coverUpload((api, id, file) => api.content.stageThumbnail(id, file), true)
);

/**
 * Delete content thumbnail. A refusal keeps its status and words, never a
 * 500 read as an outage (the epic review).
 */
export const deleteThumbnailCommand = command(
  z.string().uuid(),
  async (contentId) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return forwardClientErrors(() => api.content.deleteThumbnail(contentId));
  }
);
