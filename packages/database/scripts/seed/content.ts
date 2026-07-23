import { getMediaThumbnailKey } from '../../../transcoding/src/paths';
import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';
import { CONTENT, ORGS } from './constants';
import { ARTICLE_BODY_JSON, OFFERING_BODY_JSON } from './placeholders';

const now = new Date();
const publishedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
const archivedAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago

/** Build a Date N days before now — used to spread seed publish dates. */
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/**
 * Of Blood & Bones items promoted to the landing "Editor's picks" carousel.
 * One per medium (video / audio / article) so the FeatureCarousel exercises its
 * type badge, audio-waveform treatment, and per-type CTA across all three.
 */
const FEATURED_SLUGS = new Set<string>([
  'fire-ceremony-at-dusk', // video
  'drum-journey-lower-world', // audio
  'the-medicine-of-grief', // article
]);

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
  // ── Of Blood & Bones — expanded catalogue ──
  'morning-somatic-flow':
    'A gentle body-led movement practice to greet the day. Wake the nervous system, mobilise the spine, and arrive fully in your body.',
  'fire-ceremony-at-dusk':
    'A guided evening fire ceremony for release and renewal. Offer what no longer serves to the flames and set intention for the turning of the day.',
  'breath-of-the-ancestors':
    'A breath-led journey honouring those who came before. Reconnect with lineage and let ancestral memory move through the body.',
  'womb-awakening-movement':
    'Slow, reverent movement to reconnect with the womb space and creative centre. Part of the Soul Path mentorship container.',
  'copal-and-smoke-cleansing-rite':
    'Learn the sacred protocols of copal and smoke cleansing. A hands-on rite for clearing energy from body, space, and objects.',
  'grounding-practice-roots-and-earth':
    'A grounding practice drawing on breath and earth connection. Settle a busy system and root down through body and soil.',
  'ancestral-lullaby-sound-bath':
    'A tender sound bath weaving voice and bowls into an ancestral lullaby. Deep rest for the weary and the grieving.',
  'drum-journey-lower-world':
    'A guided shamanic drum journey to the lower world. Meet your allies and retrieve what waits for you in the unseen.',
  'ocean-breath-meditation':
    'An audio breath meditation paced to the rhythm of the tide. Ujjayi breathing to calm the nervous system and clear the mind.',
  'whispers-of-the-lineage':
    'An intimate audio transmission on listening to ancestral guidance. Included in the Soul Path mentorship.',
  'tuning-fork-reset':
    'A short vibrational reset using weighted tuning forks. Recalibrate the body’s energetic field in minutes.',
  'coyolxauhqui-moon-chant':
    'A devotional moon chant honouring Coyolxauhqui. Free for followers of the space — sing along under the night sky.',
  'the-medicine-of-grief':
    'A written meditation on grief as sacred medicine. How loss cracks us open and what the body knows about mourning.',
  'reading-the-bodys-stories':
    'A somatic literacy guide to the stories held in tissue and posture. Learn to listen to what the body has been carrying.',
  'working-with-copal-and-sacred-smoke':
    'A written guide to sourcing, preparing, and working with copal and sacred smoke in your own practice. One-off purchase £4.99.',
  'nervous-system-literacy':
    'Understand the language of your nervous system — states, cues, and regulation. Practical tools for coming back to safety.',
  'the-four-sacred-directions':
    'A written teaching on the four directions and their medicine. Part of the Soul Path mentorship curriculum.',
  'vibration-as-medicine':
    'An essay on sound and vibration as healing modalities. The science and the sacred behind bowls, drums, and voice.',
};

/**
 * Translate a seed constant's authoring shape (single `accessType` + price +
 * minimum tier) into the SPEC §6.1 policy flags the `content` table now stores
 * (WP-1 hard-replaced the `accessType`/`minimumTierId` columns). Mirrors the
 * legacy CHECK mapping (HARDENING §H2) and the `ContentService.create`
 * normalization, so seeded rows behave identically to app-created content.
 *
 * `includedInTierId` is populated only for tier-bearing modes (subscribers /
 * hybrid paid), matching the former clamp — a nonsensical (mode, tier) pair
 * can never land even if the constants drift.
 */
function toAccessFlags(c: {
  accessType?: string;
  priceCents?: number | null;
  minimumTierId?: string | null;
}): {
  isFree: boolean;
  isPurchasable: boolean;
  priceCents: number | null;
  includedInTierId: string | null;
  courseOnly: boolean;
  isFollowerGated: boolean;
  isTeamOnly: boolean;
} {
  const accessType = c.accessType ?? 'free';
  const price = c.priceCents ?? null;
  const tierId = c.minimumTierId ?? null;
  const base = {
    isFree: false,
    isPurchasable: false,
    priceCents: null as number | null,
    includedInTierId: null as string | null,
    courseOnly: false,
    isFollowerGated: false,
    isTeamOnly: false,
  };
  switch (accessType) {
    case 'paid':
      // Purchasable; a non-null tier makes it a hybrid (also tier-included).
      return {
        ...base,
        isPurchasable: true,
        priceCents: price,
        includedInTierId: tierId,
      };
    case 'subscribers':
      // Tier-gated; an optional price makes it ALSO purchasable.
      return {
        ...base,
        includedInTierId: tierId,
        isPurchasable: (price ?? 0) > 0,
        priceCents: (price ?? 0) > 0 ? price : null,
      };
    case 'followers':
      return { ...base, isFollowerGated: true };
    case 'team':
      return { ...base, isTeamOnly: true };
    default:
      return { ...base, isFree: true };
  }
}

export async function seedContent(db: typeof DbClient) {
  const items = Object.values(CONTENT);

  await db.insert(schema.content).values(
    items.map((c) => {
      const accessFlags = toAccessFlags(c);

      // Optional per-item publish offset (days ago). Items without it fall
      // back to the shared 7-days-ago constant. Lets the expanded catalogue
      // spread its publishedAt over recent dates for realistic ordering.
      const publishedDaysAgo =
        'publishedDaysAgo' in c
          ? (c as { publishedDaysAgo?: number }).publishedDaysAgo
          : undefined;

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
        featured: FEATURED_SLUGS.has(c.slug),
        tags: ['seed-data', c.contentType],
        ...accessFlags,
        status: c.status,
        publishedAt:
          c.status === 'published'
            ? publishedDaysAgo != null
              ? daysAgo(publishedDaysAgo)
              : publishedAt
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
