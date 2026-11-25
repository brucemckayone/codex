/**
 * The one card, as data (Codex-7104r). StyledCard renders this into the card
 * styles' single markup (`article.sc`, see StyledCard.svelte); each style's
 * stylesheet then hides, reorders or restyles its parts with CSS only.
 *
 * Every word here is final copy: the adapters (`adapters.ts`) turn a
 * ContentCard's, JourneyEntryCard's or creator card's props into this, with
 * the same price, access and progress wording those components use today
 * (paraglide messages), so StyledCard itself decides nothing about content.
 */

export type CardKind = 'video' | 'audio' | 'article' | 'portal' | 'creator';

/** The slot the card fills: a grid / rail tile, a list row, a featured hero. */
export type CardLayout = 'tile' | 'row' | 'featured';

/** Drives the styles' access colouring; 'paid' when it has a price. */
export type CardAccess = 'free' | 'paid' | 'members' | 'followers';

/** Which meta fact a span holds (styles show, hide or order them by key). */
export type CardMetaKey =
  | 'position'
  | 'duration'
  | 'read'
  | 'stages'
  | 'practices'
  | 'next'
  | 'creator'
  | 'count';

export interface CardMetaItem {
  readonly key: CardMetaKey;
  readonly text: string;
}

export interface CardModel {
  readonly kind: CardKind;
  readonly layout: CardLayout;
  /** The accessible name of the card's one action. */
  readonly title: string;
  /**
   * THE one action. A link for almost every card; a button only where the
   * page opens something in place (the creators page's drawer).
   */
  readonly action:
    | { readonly href: string }
    | { readonly onclick: (event: MouseEvent) => void };
  /**
   * `ratio` ("w / h") when the file's real size is known; else the style's
   * cover ratio. `srcset` and `sizes` are the image's stored widths and the
   * card's drawn width, as Today's cards pass them (Codex-kk9nv).
   */
  readonly image?: {
    readonly src: string;
    readonly ratio?: string;
    readonly srcset?: string;
    readonly sizes?: string;
  } | null;
  readonly access?: CardAccess;
  readonly owned?: boolean;
  /** Revoked or disputed: the card is paused. */
  readonly dimmed?: boolean;
  /** The short chip on the media: "Free", "£10.00", "Paused", "Featured". */
  readonly badge?: { readonly label: string; readonly paused?: boolean } | null;
  /** The type word: Video · Audio · Article · Portal · a creator's role. */
  readonly kicker: string;
  readonly desc?: string | null;
  readonly meta?: readonly CardMetaItem[];
  /** A status reason (a paused card's "Payment dispute"). */
  readonly note?: string | null;
  /**
   * Progress. `total` ≤ 16 draws a segment per practice (`done` lit),
   * more draws one bar (with a tick per practice); none draws one bar.
   */
  readonly progress?: {
    readonly percent: number;
    readonly done?: number;
    readonly total?: number;
    /** The foot's status: "5 of 11 practices", "Completed". */
    readonly label?: string;
  } | null;
  /** An un-started portal's stages, drawn as an empty, decorative track. */
  readonly preview?: { readonly stages: number } | null;
  /** The foot's value: "£898.00", "Free", "Included with membership". */
  readonly price?: string | null;
  /** The action's words (text, not a link: the card is the link). */
  readonly cta: string;
}
