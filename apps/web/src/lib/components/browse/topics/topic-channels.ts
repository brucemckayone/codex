/**
 * The data behind each Channels page (`TopicChannels.svelte`): which loaded
 * pieces belong to a topic, its three newest, its type mix, and the words on
 * the page. Pure, so the rules are tested without a DOM.
 *
 * The catalogue the landing hands over is the newest pieces only (50), so a
 * topic's loaded pieces can be fewer than its real `contentCount`. A tally of
 * the loaded ones would then print a wrong number, so the type mix carries
 * numbers only when the loaded pieces ARE the whole topic, and otherwise just
 * names the types it has.
 */
import type { TopicItem } from '$lib/components/topic/topic-card.types';
import type { BrowseItem } from '../browse-module.types';

/** Mini cards per page. */
const MINI_CAP = 3;

/**
 * Plain English, like the host `BrowseModule`'s own labels. Kept in one place
 * so a move to paraglide messages is a one-file change.
 */
export const COPY = {
  tablist: 'Topics',
  previous: 'Previous topic',
  next: 'Next topic',
  browseAll: 'Browse this topic',
} as const;

type ContentType = BrowseItem['contentType'];

const TYPE_ORDER: readonly ContentType[] = ['video', 'audio', 'article'];

/** A type's name in a tally, singular and plural. */
const TYPE_COUNT: Record<ContentType, (n: number) => string> = {
  video: (n) => `${n} ${n === 1 ? 'video' : 'videos'}`,
  audio: (n) => `${n} audio`,
  article: (n) => `${n} ${n === 1 ? 'article' : 'articles'}`,
};

/** A type's name without a number: the host's type-tab labels. */
const TYPE_NAME: Record<ContentType, string> = {
  video: 'Videos',
  audio: 'Audio',
  article: 'Articles',
};

/**
 * The loaded pieces of each topic, keyed by slug, in the catalogue's own order
 * (newest first). One pass over the catalogue, however many topics there are.
 */
function groupByTopic(items: readonly BrowseItem[]): Map<string, BrowseItem[]> {
  const bySlug = new Map<string, BrowseItem[]>();
  for (const item of items) {
    for (const slug of item.categorySlugs ?? []) {
      const list = bySlug.get(slug);
      if (list) list.push(item);
      else bySlug.set(slug, [item]);
    }
  }
  return bySlug;
}

/**
 * The topic's type mix, video first: "3 videos · 1 audio" when the loaded
 * pieces are the whole topic, "Videos · Audio" when they may be only some of
 * it (or its count is unknown), and `null` when none of it is loaded.
 */
export function typeMixLabel(
  inTopic: readonly BrowseItem[],
  contentCount: number | undefined
): string | null {
  if (inTopic.length === 0) return null;
  const tally = new Map<ContentType, number>();
  for (const item of inTopic)
    tally.set(item.contentType, (tally.get(item.contentType) ?? 0) + 1);
  const present = TYPE_ORDER.filter((t) => tally.has(t));
  const whole = contentCount === inTopic.length;
  return present
    .map((t) => (whole ? TYPE_COUNT[t](tally.get(t) ?? 0) : TYPE_NAME[t]))
    .join(' · ');
}

/** "Browse 12 pieces"; with no known count, no number at all. */
export function browseLabel(contentCount: number | undefined): string {
  if (contentCount === undefined) return COPY.browseAll;
  return `Browse ${contentCount} ${contentCount === 1 ? 'piece' : 'pieces'}`;
}

/** "Topic 02 of 05". */
export function kickerLabel(index: number, total: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Topic ${pad(index + 1)} of ${pad(total)}`;
}

/** The letter a coverless page shows large: "The Body" is a "B". */
export function topicInitial(name: string): string {
  return (
    name
      .trim()
      .replace(/^the\s+/i, '')
      .charAt(0)
      .toUpperCase() || '·'
  );
}

/** One Channels page, everything it shows. */
export interface ChannelPage {
  topic: TopicItem;
  kicker: string;
  mix: string | null;
  cta: string;
  minis: BrowseItem[];
}

/** Every page, in the topics' own (curator) order. */
export function buildChannelPages(
  topics: readonly TopicItem[],
  items: readonly BrowseItem[]
): ChannelPage[] {
  const bySlug = groupByTopic(items);
  return topics.map((topic, index) => {
    const inTopic = bySlug.get(topic.slug) ?? [];
    return {
      topic,
      kicker: kickerLabel(index, topics.length),
      mix: typeMixLabel(inTopic, topic.contentCount),
      cta: browseLabel(topic.contentCount),
      minis: inTopic.slice(0, MINI_CAP),
    };
  });
}
