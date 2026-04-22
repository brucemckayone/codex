import { getMediaThumbnailKey } from '../../../transcoding/src/paths';
import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';
import { CONTENT, ORGS } from './constants';
import { ARTICLE_BODY_JSON, OFFERING_BODY_JSON } from './placeholders';

const now = new Date();
const publishedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
const archivedAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago

/** Build the dev-cdn URL for a content thumbnail */
function thumbnailUrl(
  creatorId: string,
  mediaId: string | null,
  slug?: string,
  orgId?: string
): string | null {
  if (mediaId) {
    return `http://localhost:4100/${getMediaThumbnailKey(creatorId, mediaId, 'md')}`;
  }
  // Bones written content uses offering images stored under a slug-based key
  if (orgId === ORGS.bones.id && slug) {
    return `http://localhost:4100/${creatorId}/thumbnails/offering-${slug}/thumb.jpg`;
  }
  return null;
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
  'community-qa-behind-the-scenes':
    'Exclusive behind-the-scenes Q&A for followers. Follow the organisation to watch this free content.',
  'internal-planning-session':
    'Private team discussion about upcoming content and roadmap. Only visible to team members.',
  // ── Of Blood & Bones offerings ──
  'skin-talismans':
    'Sacred tattoo work rooted in ancestral symbolism. Each skin talisman is a co-created ritual marking, designed through ceremony and consultation.',
  'tooth-talismans':
    'Hand-crafted ritual jewellery featuring ethically sourced teeth, bone, and natural materials. Each piece carries intention and ancestral connection.',
  'soul-path-mentorship':
    'One-on-one mentorship journeys for those called to deepen their connection with ancestral practices, somatic wisdom, and ceremonial living.',
  'limpia-energy-cleansing':
    'Traditional Mesoamerican energy cleansing using herbs, eggs, and prayer. A gentle yet powerful practice for releasing what no longer serves.',
  'ceremonial-cacao':
    'Guided ceremonial cacao experiences opening the heart space. Learn the history, preparation, and sacred protocols of working with cacao as medicine.',
  'sacred-calendar':
    'Explore the Mesoamerican sacred calendar system. Understand your day sign, trecena, and how to align your life with natural cycles.',
  'closing-the-bones':
    'A postpartum and grief ritual rooted in Latin American tradition. A deeply nurturing practice of wrapping, rocking, and energetic closure.',
  held: 'H.E.L.D \u2014 Healing, Embodiment, Listening, Depth. A somatic container for processing trauma, grief, and life transitions through bodywork.',
  'neuro-somatic-intelligence':
    'Integrate neuroscience with somatic practices. Learn to regulate your nervous system, release stored patterns, and build resilience.',
  'sound-therapy':
    'Vibrational healing through singing bowls, tuning forks, and voice. A guided sonic journey for deep relaxation and energetic recalibration.',
  'eco-somatic-experiencing':
    'Nature-based somatic practices that reconnect you with the more-than-human world. Grounding, forest bathing, and earth-based ceremony.',
};

export async function seedContent(db: typeof DbClient) {
  const items = Object.values(CONTENT);

  await db.insert(schema.content).values(
    items.map((c) => {
      const accessType =
        'accessType' in c ? (c as { accessType: string }).accessType : 'free';

      // Defense-in-depth clamp mirroring the service-layer normalization
      // in `ContentService.create/update` (commit 848944eb). `minimumTierId`
      // is only meaningful for `subscribers` (required) and `paid` (optional,
      // hybrid). For any other accessType we force null regardless of what
      // the seed constants declare, so a nonsensical (accessType, tier) pair
      // can never land in the DB even if the constants drift.
      const rawTierId =
        'minimumTierId' in c
          ? (c as { minimumTierId: string | null }).minimumTierId
          : null;
      const minimumTierId =
        accessType === 'subscribers' || accessType === 'paid'
          ? (rawTierId ?? null)
          : null;

      return {
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
        contentBodyJson:
          c.contentType === 'written'
            ? c.orgId === ORGS.bones.id
              ? OFFERING_BODY_JSON
              : ARTICLE_BODY_JSON
            : null,
        thumbnailUrl: thumbnailUrl(c.creatorId, c.mediaId, c.slug, c.orgId),
        category:
          c.orgId === ORGS.bones.id
            ? 'healing'
            : c.contentType === 'audio'
              ? 'podcasts'
              : 'tutorials',
        tags: ['seed-data', c.contentType],
        accessType,
        priceCents: c.priceCents,
        minimumTierId,
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
      };
    })
  );

  console.log(`  Seeded ${items.length} content items`);
}
