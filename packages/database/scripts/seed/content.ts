import { getMediaThumbnailKey } from '../../../transcoding/src/paths';
import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';
import { CONTENT } from './constants';
import { ARTICLE_BODY_JSON } from './placeholders';

const now = new Date();
const publishedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
const archivedAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago

/** Build the dev-cdn URL for a content thumbnail */
function thumbnailUrl(
  creatorId: string,
  mediaId: string | null
): string | null {
  if (!mediaId) return null;
  return `http://localhost:4100/${getMediaThumbnailKey(creatorId, mediaId, 'md')}`;
}

/** Content descriptions by slug */
const DESCRIPTIONS: Record<string, string> = {
  'intro-to-typescript':
    'A comprehensive introduction to TypeScript covering type annotations, interfaces, generics, and practical patterns for building type-safe applications.',
  'advanced-svelte-patterns':
    'Deep dive into Svelte 5 runes, advanced reactivity patterns, component composition, and performance optimisation techniques. Requires Pro subscription.',
  'building-apis-with-hono':
    'Learn to build fast, type-safe REST APIs with Hono on Cloudflare Workers. Covers routing, middleware, validation, and deployment.',
  'tech-podcast-ep-1':
    'First episode discussing the modern web development landscape — TypeScript adoption, edge computing, and the rise of serverless architectures.',
  'draft-video-lesson':
    'Work in progress lesson covering intermediate TypeScript concepts.',
  'members-only-workshop':
    'Real-world project architecture, testing strategies, and deployment pipelines. Available via Standard subscription or £9.99 one-off purchase.',
  'private-notes': 'Personal notes and drafts for upcoming content.',
  'written-tutorial-getting-started':
    'A thorough written guide to getting started with modern web development, covering the essential tools and patterns.',
  'legacy-typescript-fundamentals':
    'An older course on TypeScript basics — superseded by the updated Intro to TypeScript course.',
  'typescript-deep-dive':
    'Go beyond the basics with advanced TypeScript patterns — conditional types, template literals, mapped types. Requires Standard subscription.',
  'css-variables-masterclass':
    'Master CSS custom properties and design tokens. Build themeable, maintainable design systems. One-off purchase £4.99.',
};

export async function seedContent(db: typeof DbClient) {
  const items = Object.values(CONTENT);

  await db.insert(schema.content).values(
    items.map((c) => ({
      id: c.id,
      creatorId: c.creatorId,
      organizationId: c.orgId,
      mediaItemId: c.mediaId,
      title: c.title,
      slug: c.slug,
      description:
        DESCRIPTIONS[c.slug] ??
        `${c.title} — seed content for local development.`,
      contentType: c.contentType,
      contentBody: null,
      contentBodyJson: c.contentType === 'written' ? ARTICLE_BODY_JSON : null,
      thumbnailUrl: thumbnailUrl(c.creatorId, c.mediaId),
      category: c.contentType === 'audio' ? 'podcasts' : 'tutorials',
      tags: ['seed-data', c.contentType],
      accessType:
        'accessType' in c ? (c as { accessType: string }).accessType : 'free',
      priceCents: c.priceCents,
      status: c.status,
      publishedAt:
        c.status === 'published'
          ? publishedAt
          : c.status === 'archived'
            ? archivedAt
            : null,
      viewCount: c.viewCount,
      purchaseCount: c.purchaseCount,
      createdAt: now,
      updatedAt: now,
    }))
  );

  console.log(`  Seeded ${items.length} content items`);
}
