/**
 * The org's card style, handed down from the org layout to the shared card
 * components (ContentCard, JourneyEntryCard, CreatorCard,
 * CreatorCarouselCard) so no page has to pass it (Codex-7104r).
 *
 * The layout sets an object of GETTERS, so a card reads the live value: the
 * brand editor's pending choice while it is open, the saved one otherwise.
 * Anywhere the layout is not an ancestor (platform pages, creator profiles)
 * reads Today, the platform's own card markup. Studio sets Today too.
 */
import { type CardStyle, DEFAULT_CARD_STYLE } from '@codex/validation';
import { getContext, setContext } from 'svelte';

export interface CardStyleContext {
  readonly style: CardStyle;
  /** The org's dial values for `style`, as custom properties (resolve.ts). */
  readonly vars: Readonly<Record<string, string>>;
}

const KEY = Symbol('card-style');

const TODAY: CardStyleContext = { style: DEFAULT_CARD_STYLE, vars: {} };

export function setCardStyleContext(context: CardStyleContext): void {
  setContext(KEY, context);
}

export function getCardStyleContext(): CardStyleContext {
  return getContext<CardStyleContext | undefined>(KEY) ?? TODAY;
}
