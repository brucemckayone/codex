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
import { getRequestEvent, query } from '$app/server';
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
    const orgResponse = await api.org.getBySlug(orgSlug);
    if (!orgResponse?.data) {
      throw new Error('Organization not found');
    }

    // Then get content filtered by org
    const params = new URLSearchParams();
    params.set('organizationId', orgResponse.data.id);
    params.set('slug', contentSlug);
    params.set('limit', '1');

    const contentResponse = await api.content.list(params);
    const content = contentResponse?.items?.[0];

    if (!content) {
      throw new Error('Content not found');
    }

    return { data: content };
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
