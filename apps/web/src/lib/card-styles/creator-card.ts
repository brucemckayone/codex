/**
 * A creator as one card (Codex-7104r.6): the card-styles gallery's creator
 * round, mapped onto CardModel. The avatar is the image (the name's initial
 * when there is none), the role is the kicker, the name is the one action,
 * the bio is the description and the content count is a meta fact. No badge,
 * price or progress: a creator is not for sale.
 *
 * The words are the ones the creator cards use today (the drawer's role
 * names, the content count), so a style changes the look, never the copy.
 */
import {
  getThumbnailDimensions,
  getThumbnailSrcset,
  getThumbnailUrl,
} from '$lib/utils/image';
import * as m from '$paraglide/messages';
import type { CardLayout, CardModel } from './card-model';

export interface CreatorCardInput {
  readonly name: string;
  readonly avatarUrl?: string | null;
  readonly bio?: string | null;
  /** The org membership role: 'owner' | 'admin' | 'creator' | … */
  readonly role?: string | null;
  readonly contentCount?: number | null;
  /** A link to the creator, or the creators page's drawer. */
  readonly action: CardModel['action'];
  readonly layout?: CardLayout;
  /** How wide the card is drawn: with an avatar that records its size, its srcset. */
  readonly sizes?: string;
  /**
   * The one file an avatar that does NOT record its size is drawn from, as
   * the card draws it today: `md` in a contact-sheet cell, `lg` in the
   * landing carousel.
   */
  readonly fallbackSize?: 'md' | 'lg';
}

function roleWord(role: string | null | undefined): string {
  if (role === 'owner') return m.creator_drawer_role_owner();
  if (role === 'admin') return m.creator_drawer_role_admin();
  return m.creator_drawer_role_creator();
}

/**
 * CreatorPortrait's rule: a srcset only where its widths are true. An older
 * avatar's sm/md/lg can all be the same small upload, so the nominal
 * descriptors would lie and the browser would draw it smaller than it is; it
 * gets one file. A sized folder lists the widths actually written.
 */
function avatarImage(input: CreatorCardInput): CardModel['image'] {
  const url = input.avatarUrl;
  if (!url) return null;
  const size = getThumbnailDimensions(url);
  if (!size) return { src: getThumbnailUrl(url, input.fallbackSize ?? 'lg') };
  const srcset = input.sizes ? getThumbnailSrcset(url) : '';
  return {
    src: getThumbnailUrl(url, 'lg'),
    ratio: `${size.width} / ${size.height}`,
    srcset: srcset || undefined,
    sizes: srcset ? input.sizes : undefined,
  };
}

export function creatorToCard(input: CreatorCardInput): CardModel {
  const count = input.contentCount;
  return {
    kind: 'creator',
    layout: input.layout ?? 'tile',
    title: input.name,
    action: input.action,
    image: avatarImage(input),
    kicker: roleWord(input.role),
    desc: input.bio?.trim() || null,
    // As the showcase cell says it: a count only when there is one.
    meta:
      count != null && count > 0
        ? [
            {
              key: 'count',
              text:
                count === 1
                  ? m.creator_content_count_one()
                  : m.creator_content_count({ count }),
            },
          ]
        : [],
    cta: m.card_cta_view_profile(),
  };
}
