/**
 * Today's card props → the card styles' one card (`CardModel`, Codex-7104r).
 *
 * ContentCard and JourneyEntryCard keep their props; when the org has picked
 * a card style they hand them to these pure functions and render StyledCard
 * from the result (plan D4). Every fact Today's card shows lands in a slot of
 * the card styles' markup, in the same words: price and access through
 * `priceBadgeLabel` (D10), resume and access states through the messages
 * Today's cards use, and new paraglide keys for the words only the card
 * styles say (D12).
 */
import { extractPlainText } from '@codex/validation';
import type { JourneyEntryCardProps } from '$lib/components/journeys/journey-entry-card';
import {
  isHybridPrice,
  type PriceBadgeAccessType,
  priceBadgeLabel,
} from '$lib/components/ui/PriceBadge/price-badge-label';
import {
  formatDuration,
  formatDurationHuman,
  formatPrice,
} from '$lib/utils/format';
import {
  cappedSizes,
  DEFAULT_SIZES,
  getThumbnailDimensions,
  getThumbnailSrcset,
} from '$lib/utils/image';
import { calculateProgressPercent } from '$lib/utils/progress';
import * as m from '$paraglide/messages';
import {
  type CardAccess,
  type CardKind,
  type CardLayout,
  type CardMetaItem,
  type CardModel,
  clampPercent,
} from './card-model';

/** The ContentCard props a styled card is drawn from (ContentCard.svelte). */
export interface ContentCardInput {
  variant?: 'grid' | 'featured' | 'compact' | 'resume';
  layout?: 'default' | 'row';
  autoPromoteAudio?: boolean;
  title: string;
  href?: string;
  thumbnail?: string | null;
  sizes?: string;
  description?: string | null;
  contentType?: 'video' | 'audio' | 'article';
  duration?: number | null;
  creator?: { username?: string; displayName?: string };
  progress?: {
    positionSeconds?: number;
    durationSeconds?: number;
    completed?: boolean;
    percentComplete?: number;
  } | null;
  price?: { amount: number; currency: string } | null;
  purchased?: boolean;
  included?: boolean;
  contentAccessType?: PriceBadgeAccessType | null;
  isFollower?: boolean;
  tierName?: string | null;
  category?: string | null;
  featured?: boolean;
  accessState?: 'active' | 'cancelling' | 'past_due' | 'revoked' | 'disputed';
  accessStatePeriodEnd?: string | null;
  accessStateActionHref?: string;
}

/** A control the card draws above its one link (StyledCard's `accessAction`). */
export interface CardAccessAction {
  href: string;
  label: string;
}

type TypeKind = Exclude<CardKind, 'creator'>;

const KIND_WORD: Record<TypeKind, () => string> = {
  video: m.content_type_video,
  audio: m.content_type_audio,
  article: m.content_type_article,
  portal: m.card_kind_portal,
};

const CONTENT_CTA: Record<'video' | 'audio' | 'article', () => string> = {
  video: m.card_cta_watch,
  audio: m.card_cta_listen,
  article: m.card_cta_read,
};

/**
 * How wide a journey card is drawn, as an upper bound on its picture: a style
 * may bleed the picture across the whole card. A tile sits in Today's
 * 15-17rem rail, a row in its 24rem rails, and the featured card is the
 * dashboard's threshold, in its 48.75rem column. Over-declaring costs bytes,
 * never sharpness.
 */
const JOURNEY_SIZES: Record<CardLayout, string> = {
  tile: cappedSizes(82, '17rem'),
  row: cappedSizes(82, '24rem'),
  featured: cappedSizes(92, '48.75rem'),
};

function cardImage(
  src: string | null | undefined,
  sizes: string | undefined
): CardModel['image'] {
  if (!src) return null;
  const size = getThumbnailDimensions(src);
  return {
    src,
    ratio: size ? `${size.width} / ${size.height}` : undefined,
    srcset: getThumbnailSrcset(src) || undefined,
    sizes,
  };
}

function plain(text: string | null | undefined): string | null {
  if (!text) return null;
  return extractPlainText(text).trim() || null;
}

/** An article's reading time: "5 min read", "1 hr 10 min read". */
function readTimeLabel(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '';
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) {
    return m.card_meta_read_minutes({ minutes: totalMinutes });
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return m.card_meta_read_hours({ hours });
  return m.card_meta_read_hours_minutes({ hours, minutes });
}

// ── ContentCard ─────────────────────────────────────────────────────────

/**
 * The slot: a browse tile, the hero, or a row. A resume card is a row, as
 * the card-styles gallery draws its continue rail; so is a compact card, and
 * the audio row ContentCard draws for `layout='row'` or `autoPromoteAudio`.
 */
function contentLayout(input: ContentCardInput): CardLayout {
  const variant = input.variant ?? 'grid';
  if (variant === 'featured') return 'featured';
  if (variant === 'resume' || variant === 'compact') return 'row';
  if (input.layout === 'row') return 'row';
  const autoRow =
    input.autoPromoteAudio &&
    variant === 'grid' &&
    input.contentType === 'audio';
  return autoRow ? 'row' : 'tile';
}

function contentAccess(input: ContentCardInput): CardAccess | undefined {
  switch (input.contentAccessType) {
    case 'free':
      return 'free';
    case 'paid':
      return 'paid';
    case 'followers':
      return 'followers';
    case 'subscribers':
    case 'team':
      return 'members';
    default:
      if (input.price == null) return undefined;
      return input.price.amount === 0 ? 'free' : 'paid';
  }
}

/** ContentCard's resume line: "Resume from 1:23", "Read from 40%". */
function resumeFromText(
  contentType: 'video' | 'audio' | 'article',
  progress: ContentCardInput['progress'],
  percent: number
): string {
  if (contentType === 'article') {
    return m.library_resume_read_from({ percent: String(percent) });
  }
  const time = formatDuration(progress?.positionSeconds ?? 0);
  if (contentType === 'audio') return m.library_resume_listen_from({ time });
  return m.library_resume_from({ time });
}

function resumeCta(contentType: 'video' | 'audio' | 'article'): string {
  if (contentType === 'article') return m.library_resume_reading();
  if (contentType === 'audio') return m.library_resume_listening();
  return m.library_resume();
}

/** The access state's reason, in the words ContentCard uses. */
function contentNote(input: ContentCardInput): string | null {
  switch (input.accessState) {
    case 'revoked':
      return m.card_note_subscription_ended();
    case 'disputed':
      return m.card_note_payment_dispute();
    case 'past_due':
      return m.library_access_payment_failed();
    case 'cancelling': {
      if (!input.accessStatePeriodEnd) return null;
      const end = new Date(input.accessStatePeriodEnd);
      if (Number.isNaN(end.getTime())) return null;
      const date = end.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      });
      return m.library_access_ends_on({ date });
    }
    default:
      return null;
  }
}

export function contentToCard(input: ContentCardInput): CardModel {
  const variant = input.variant ?? 'grid';
  const contentType = input.contentType ?? 'video';
  const layout = contentLayout(input);
  const dimmed =
    input.accessState === 'revoked' || input.accessState === 'disputed';
  const owned =
    !!input.purchased ||
    !!input.included ||
    (input.contentAccessType === 'followers' && !!input.isFollower);

  // The price/access label, where ContentCard draws its PriceBadge.
  const priceInput = {
    amount: input.price?.amount ?? null,
    purchased: input.purchased,
    included: input.included,
    accessType: input.contentAccessType,
    isFollower: input.isFollower,
    tierName: input.tierName,
  };
  const showsPrice =
    variant !== 'compact' &&
    variant !== 'resume' &&
    (input.price != null ||
      !!input.purchased ||
      !!input.included ||
      input.contentAccessType != null);
  const priceLabel = showsPrice ? priceBadgeLabel(priceInput) : '';
  // Bought outright OR on a plan: ContentCard's stacked two-line badge.
  const hybrid = isHybridPrice({ ...priceInput, stacked: true });

  const featured = !!input.featured && variant === 'grid' && layout === 'tile';

  let badge: CardModel['badge'] = null;
  if (dimmed) badge = { label: m.card_badge_paused(), paused: true };
  else if (featured) badge = { label: m.content_featured_label() };
  else if (priceLabel) badge = { label: priceLabel };

  let price: string | null = null;
  if (priceLabel && !owned) {
    price =
      hybrid && input.tierName
        ? m.card_price_or_plan({ price: priceLabel, plan: input.tierName })
        : priceLabel;
  }

  const meta: CardMetaItem[] = [];
  if (contentType !== 'article' && input.duration && variant !== 'resume') {
    meta.push({ key: 'duration', text: formatDurationHuman(input.duration) });
  }
  const readTime =
    contentType === 'article' ? readTimeLabel(input.duration) : '';
  if (readTime) meta.push({ key: 'read', text: readTime });
  const creatorName = input.creator?.displayName ?? input.creator?.username;
  if (creatorName) meta.push({ key: 'creator', text: creatorName });

  const percent = calculateProgressPercent(input.progress);
  const hasProgress =
    input.progress != null && (!!input.progress.completed || percent > 0);
  const resume = variant === 'resume';

  const kind = KIND_WORD[contentType]();
  const showsDesc =
    variant === 'grid' || variant === 'featured' || contentType === 'article';

  return {
    kind: contentType,
    layout,
    title: input.title,
    action: { href: input.href ?? '#' },
    image: cardImage(input.thumbnail, input.sizes ?? DEFAULT_SIZES),
    access: contentAccess(input),
    owned,
    dimmed,
    badge,
    kicker: input.category
      ? m.card_kicker_category({ kind, category: input.category })
      : kind,
    desc: showsDesc ? plain(input.description) : null,
    meta,
    note: contentNote(input),
    progress: hasProgress
      ? {
          percent,
          label: resume
            ? resumeFromText(contentType, input.progress, percent)
            : undefined,
        }
      : null,
    price,
    cta: resume ? resumeCta(contentType) : CONTENT_CTA[contentType](),
  };
}

/**
 * The dimmed card's own control (plan D7): a revoked subscription's way back
 * (`accessStateActionHref`), or a disputed purchase's page, which explains.
 */
export function contentAccessAction(
  input: Pick<
    ContentCardInput,
    'accessState' | 'accessStateActionHref' | 'href'
  >
): CardAccessAction | undefined {
  if (input.accessState === 'revoked') {
    return {
      href: input.accessStateActionHref ?? '/account/subscriptions',
      label: m.card_access_reactivate(),
    };
  }
  if (input.accessState === 'disputed') {
    return { href: input.href ?? '#', label: m.card_access_details() };
  }
  return undefined;
}

// ── JourneyEntryCard ────────────────────────────────────────────────────

const TYPE_KINDS: readonly TypeKind[] = ['video', 'audio', 'article', 'portal'];

/**
 * A row's kicker is a TYPE label ("Portal"; the library's standalone
 * practices pass 'video' / 'audio' / 'article'): it names the card's kind.
 * Any other kicker is an editorial line, and the card is a portal.
 */
function kindOfKicker(kicker: string | null | undefined): TypeKind | null {
  const word = (kicker ?? '').trim().toLowerCase();
  return TYPE_KINDS.find((kind) => kind === word) ?? null;
}

function statText(stat: {
  value: number;
  label: string;
  key?: string;
}): string {
  const one = stat.value === 1;
  if (stat.key === 'stages') {
    return one
      ? m.card_meta_stages_one({ count: stat.value })
      : m.card_meta_stages({ count: stat.value });
  }
  if (stat.key === 'practices') {
    return one
      ? m.card_meta_practices_one({ count: stat.value })
      : m.card_meta_practices({ count: stat.value });
  }
  return `${stat.value} ${stat.label}`;
}

export function journeyToCard(props: JourneyEntryCardProps): CardModel {
  const layout = props.layout ?? 'tile';
  const typed = kindOfKicker(props.kicker);
  const kind = typed ?? 'portal';
  const stats = props.stats ?? [];
  const progress = props.progress ?? null;
  // No price and no membership line: an enrolled journey, or a practice
  // the member has started.
  const owned = props.priceCents == null && !props.membershipLabel;
  const dimmed = !!props.dimmed;

  const priceText =
    props.priceCents != null
      ? formatPrice(props.priceCents)
      : (props.membershipLabel ?? null);

  let badge: CardModel['badge'] = null;
  if (dimmed) badge = { label: m.card_badge_paused(), paused: true };
  else if (owned && props.accessLabel) badge = { label: props.accessLabel };
  else if (!owned && priceText) badge = { label: priceText };

  // The access chip says why a paused card is paused.
  const note =
    props.accessLabel && (dimmed || !owned) ? props.accessLabel : null;

  const meta: CardMetaItem[] = [];
  if (props.meta && !props.next && !props.guideName) {
    meta.push({ key: 'position', text: props.meta });
  }
  for (const stat of stats) {
    meta.push({ key: stat.key ?? 'count', text: statText(stat) });
  }
  if (props.next && layout !== 'tile') {
    meta.push({ key: 'next', text: m.card_meta_next({ title: props.next }) });
  }
  if (props.guideName) meta.push({ key: 'creator', text: props.guideName });

  const stages = stats.find((stat) => stat.key === 'stages')?.value ?? 0;
  // The dashboard threshold, a featured row, is the page's hero.
  const slot: CardLayout =
    layout === 'row' && props.featured ? 'featured' : layout;

  return {
    kind,
    layout: slot,
    title: props.title,
    action: { href: props.href },
    image: cardImage(props.coverImageUrl, JOURNEY_SIZES[slot]),
    access: owned
      ? undefined
      : props.priceCents != null
        ? 'paid'
        : props.membershipAccess,
    owned,
    dimmed,
    badge,
    kicker: KIND_WORD[kind](),
    // An editorial kicker ("A twelve-practice descent") has no slot of its
    // own (the kicker is the type word), so it stands in for a missing
    // tagline.
    desc: props.tagline || (typed ? null : props.kicker) || null,
    meta,
    note,
    progress: progress
      ? {
          percent: clampPercent(progress.percent),
          done: progress.done,
          total: progress.total,
          label: progress.label ?? undefined,
        }
      : null,
    preview:
      !progress && kind === 'portal' && !owned && stages > 0
        ? { stages }
        : null,
    price: owned ? null : priceText,
    cta: props.cta ?? m.card_cta_view_portal(),
  };
}
