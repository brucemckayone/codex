/**
 * The content list's Change access sheet (Codex-a6ofh.3.5, owner D-b2, mockups
 * L2b and L2b′): which kinds it offers, the price it starts at, and the lines
 * that say what the change does to the pieces selected, before it is sent.
 * The server still judges each piece; these only say what to expect.
 */
import type { ContentWithRelations } from '$lib/types';
import type { ContentAccessKind } from '$lib/utils/content-access';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';

/** What the sheet holds: the editor's own access group (`DraftAccess`). */
export interface AccessChoice {
  kind: ContentAccessKind;
  priceCents: number;
  /** The tiers ticked; null leaves each piece's own (Buy once, D-b5). */
  tierIds: string[] | null;
}

export type AccessPiece = Pick<
  ContentWithRelations,
  | 'id'
  | 'title'
  | 'organizationId'
  | 'isFree'
  | 'isPurchasable'
  | 'priceCents'
  | 'isTierGated'
  | 'isFollowerGated'
  | 'isTeamOnly'
  | 'buyerCount'
>;

/**
 * The one org every selected piece is filed in, or null (owner R3): Followers,
 * Subscribers and Team only belong to an org, so a selection with a personal
 * piece, or pieces of two orgs, is offered Free and Buy once alone.
 */
export function selectionOrg(pieces: readonly AccessPiece[]): string | null {
  const first = pieces[0]?.organizationId ?? null;
  return first !== null &&
    pieces.every((piece) => piece.organizationId === first)
    ? first
    : null;
}

/** For sale now, at a price. */
const forSale = (piece: AccessPiece) =>
  piece.isPurchasable === true && (piece.priceCents ?? 0) > 0;

/**
 * The price the sheet starts at (D-b5): the one every selected piece is sold
 * at, or null when they differ or any is not for sale.
 */
export function sharedPrice(pieces: readonly AccessPiece[]): number | null {
  const prices = new Set(
    pieces.map((piece) => (forSale(piece) ? piece.priceCents : null))
  );
  if (prices.size !== 1) return null;
  const [only] = prices;
  return only ?? null;
}

export interface AccessLine {
  /** `warning`: some pieces will be left alone. */
  tone: 'info' | 'warning';
  text: string;
}

const buyersOf = (pieces: readonly AccessPiece[]) =>
  pieces.reduce((sum, piece) => sum + (piece.buyerCount ?? 0), 0);

function buyersKeep(pieces: readonly AccessPiece[]): string | null {
  const buyers = buyersOf(pieces);
  if (buyers === 0) return null;
  return buyers === 1
    ? m.studio_content_access_buyers_keep_one()
    : m.studio_content_access_buyers_keep({ count: buyers });
}

function withBuyers(text: string, pieces: readonly AccessPiece[]): string {
  const keep = buyersKeep(pieces);
  return keep ? `${text} ${keep}` : text;
}

/** A new price, at least £1: which pieces it changes, and that their buyers stay. */
function repriceLine(
  pieces: readonly AccessPiece[],
  priceCents: number
): AccessLine | null {
  const repriced = pieces.filter(
    (piece) => forSale(piece) && piece.priceCents !== priceCents
  );
  const [only] = repriced;
  if (!only) return null;
  const to = formatPrice(priceCents);
  const text =
    repriced.length === 1
      ? m.studio_content_access_reprice_one({
          title: only.title,
          from: formatPrice(only.priceCents ?? 0),
          to,
        })
      : m.studio_content_access_reprice_many({ count: repriced.length, to });
  return { tone: 'info', text: withBuyers(text, repriced) };
}

function stopsSoldLine(
  pieces: readonly AccessPiece[],
  buyersStay: boolean
): AccessLine | null {
  const stopping = pieces.filter(forSale);
  if (stopping.length === 0) return null;
  const text =
    stopping.length === 1
      ? m.studio_content_access_stops_sold_one()
      : m.studio_content_access_stops_sold({ count: stopping.length });
  return { tone: 'info', text: buyersStay ? withBuyers(text, stopping) : text };
}

/**
 * What the change does, in the mockup's words: a price that changes, pieces
 * that stop being sold, tiers kept, and (owner R1) the bought pieces a move
 * to Followers or Team only leaves alone, since both end a buyer's playback.
 */
export function accessChangeLines(
  pieces: readonly AccessPiece[],
  choice: AccessChoice
): AccessLine[] {
  const lines: (AccessLine | null)[] = [];
  switch (choice.kind) {
    case 'paid':
      lines.push(
        choice.priceCents > 0 ? repriceLine(pieces, choice.priceCents) : null
      );
      if (pieces.some((piece) => piece.isTierGated)) {
        lines.push({
          tone: 'info',
          text: m.studio_content_access_keeps_tiers(),
        });
      }
      break;
    case 'subscribers':
      lines.push(
        choice.priceCents > 0
          ? repriceLine(pieces, choice.priceCents)
          : stopsSoldLine(pieces, true)
      );
      break;
    case 'followers':
    case 'team': {
      const bought = pieces.filter((piece) => (piece.buyerCount ?? 0) > 0);
      const [only] = bought;
      if (only) {
        lines.push({
          tone: 'warning',
          text:
            bought.length === 1
              ? m.studio_content_access_left_alone_one({ title: only.title })
              : m.studio_content_access_left_alone({ count: bought.length }),
        });
      }
      lines.push(
        stopsSoldLine(
          pieces.filter((piece) => (piece.buyerCount ?? 0) === 0),
          false
        )
      );
      break;
    }
    default:
      lines.push(stopsSoldLine(pieces, false));
  }
  return lines.filter((line): line is AccessLine => line !== null);
}
