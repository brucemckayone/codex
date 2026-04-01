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

import { contentQuerySchema } from '@codex/validation';
import { z } from 'zod';
import { command, form, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';

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
  return api.content.get(id);
});

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
// Public Content List Query (no auth required)
// ─────────────────────────────────────────────────────────────────────────────

const publicContentQueryParamsSchema = z.object({
  orgId: z.string().uuid(),
  slug: z.string().max(500).optional(),
  page: z.number().min(1).default(1).optional(),
  limit: z.number().min(1).max(50).default(20).optional(),
  contentType: z.enum(['video', 'audio', 'written']).optional(),
  search: z.string().max(255).optional(),
  sort: z.enum(['newest', 'oldest', 'title']).default('newest').optional(),
});

/**
 * List published content for an organization (public, no auth required)
 *
 * Used by org landing and explore pages to display content to unauthenticated visitors.
 *
 * Usage in Svelte:
 * ```svelte
 * {#each (await getPublicContent({ orgId })).items as item}
 *   <ContentCard content={item} />
 * {/each}
 * ```
 */
export const getPublicContent = query(
  publicContentQueryParamsSchema,
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const searchParams = new URLSearchParams();
    searchParams.set('orgId', params.orgId);
    if (params.slug) searchParams.set('slug', params.slug);
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.contentType) searchParams.set('contentType', params.contentType);
    if (params.search) searchParams.set('search', params.search);
    if (params.sort) searchParams.set('sort', params.sort);

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

const createContentCommandSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional().nullable(),
  contentType: z.enum(['video', 'audio', 'written']),
  visibility: z.enum(['public', 'private', 'members_only', 'purchased_only']),
  priceCents: z.number().int().min(0).optional().nullable(),
  organizationId: z.string().uuid().optional().nullable(),
  mediaItemId: z.string().uuid().optional().nullable(),
  contentBody: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  thumbnailUrl: z.string().url().optional().nullable(),
});

/**
 * Create new content
 *
 * Usage:
 * ```typescript
 * const result = await createContent({
 *   title: 'My Post',
 *   slug: 'my-post',
 *   contentType: 'written',
 *   visibility: 'public',
 *   organizationId: orgId,
 *   contentBody: 'Hello world',
 * });
 * ```
 */
export const createContent = command(
  createContentCommandSchema,
  async (data) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.content.create(data);
  }
);

const updateContentCommandSchema = z.object({
  id: z.string().uuid(),
  data: z.object({
    title: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    contentType: z.enum(['video', 'audio', 'written']).optional(),
    visibility: z
      .enum(['public', 'private', 'members_only', 'purchased_only'])
      .optional(),
    priceCents: z.number().int().min(0).optional().nullable(),
    organizationId: z.string().uuid().optional().nullable(),
    mediaItemId: z.string().uuid().optional().nullable(),
    contentBody: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
    tags: z.array(z.string()).optional(),
    thumbnailUrl: z.string().url().optional().nullable(),
  }),
});

/**
 * Update existing content
 *
 * Usage:
 * ```typescript
 * const result = await updateContent({
 *   id: contentId,
 *   data: { title: 'Updated Title' },
 * });
 * ```
 */
export const updateContent = command(
  updateContentCommandSchema,
  async ({ id, data }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.content.update(id, data);
  }
);

/**
 * Delete content by ID
 *
 * Usage:
 * ```typescript
 * await deleteContent(contentId);
 * ```
 */
export const deleteContent = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.content.delete(id);
});

// ─────────────────────────────────────────────────────────────────────────────
// Content Status Transitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Publish content (draft -> published)
 *
 * Calls POST /api/content/:id/publish. The backend enforces business rules
 * (e.g., media must be ready for video/audio content before publishing).
 */
export const publishContent = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.content.publish(id);
});

/**
 * Unpublish content (published -> draft)
 *
 * Calls POST /api/content/:id/unpublish.
 */
export const unpublishContent = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.content.unpublish(id);
});

// ─────────────────────────────────────────────────────────────────────────────
// Content Form (progressive enhancement)
// ─────────────────────────────────────────────────────────────────────────────

/** Helper: missing/empty strings → null for optional fields from FormData */
const optionalString = z
  .string()
  .optional()
  .default('')
  .transform((v) => (v === '' ? null : v));

/** Helper: missing/empty string → null for optional UUID fields */
const optionalUuid = z
  .string()
  .optional()
  .default('')
  .transform((v) => (v === '' ? null : v))
  .pipe(z.string().uuid().nullable());

const createContentFormSchema = z.object({
  organizationId: z.string().uuid(),
  title: z.string().min(1, 'Title is required'),
  slug: z.string().min(1, 'Slug is required'),
  description: optionalString,
  contentType: z.enum(['video', 'audio', 'written']),
  mediaItemId: optionalUuid,
  contentBody: optionalString,
  visibility: z.enum(['public', 'private', 'members_only', 'purchased_only']),
  price: z.string().transform((v) => {
    const parsed = parseFloat(v || '0');
    return Number.isNaN(parsed) ? 0 : Math.round(parsed * 100);
  }),
});

/**
 * Create content form (progressive enhancement)
 *
 * Sends data to POST /api/content. Price input is in dollars,
 * transformed to cents by the schema.
 */
export const createContentForm = form(
  createContentFormSchema,
  async ({
    organizationId,
    title,
    slug,
    description,
    contentType,
    mediaItemId,
    contentBody,
    visibility,
    price,
  }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const result = await api.content.create({
        title,
        slug,
        description,
        contentType,
        mediaItemId,
        contentBody,
        visibility,
        organizationId,
        priceCents: price,
      });

      return { success: true as const, contentId: result.id };
    } catch (error) {
      return {
        success: false as const,
        error:
          error instanceof Error ? error.message : 'Failed to create content',
      };
    }
  }
);

const updateContentFormSchema = z.object({
  contentId: z.string().uuid(),
  organizationId: z.string().uuid(),
  title: z.string().min(1, 'Title is required'),
  slug: z.string().min(1, 'Slug is required'),
  description: optionalString,
  contentType: z.enum(['video', 'audio', 'written']),
  mediaItemId: optionalUuid,
  contentBody: optionalString,
  visibility: z.enum(['public', 'private', 'members_only', 'purchased_only']),
  price: z.string().transform((v) => {
    const parsed = parseFloat(v || '0');
    return Number.isNaN(parsed) ? 0 : Math.round(parsed * 100);
  }),
});

/**
 * Update content form (progressive enhancement)
 *
 * Sends data to PATCH /api/content/:id.
 */
export const updateContentForm = form(
  updateContentFormSchema,
  async ({
    contentId,
    organizationId,
    title,
    slug,
    description,
    contentType,
    mediaItemId,
    contentBody,
    visibility,
    price,
  }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const result = await api.content.update(contentId, {
        title,
        slug,
        description,
        contentType,
        mediaItemId,
        contentBody,
        visibility,
        organizationId,
        priceCents: price,
      });

      return { success: true as const, data: result };
    } catch (error) {
      return {
        success: false as const,
        error:
          error instanceof Error ? error.message : 'Failed to update content',
      };
    }
  }
);
