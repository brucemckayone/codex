/**
 * The shape of a Style's DATA half (contract 01 §4, 03 §4) — what it picks when
 * a section has not. Its CSS half is `kit/styles/style-<id>.css`.
 *
 * Each Style lives in its own file under `style-definitions/` so the Style
 * agents of 03 §12 never edit the same file; `styles.ts` aggregates them.
 */
import type {
  ColourSchemeId,
  LayoutId,
  PageStyleId,
  SectionTypeId,
} from './ids';

export interface StyleDefinition {
  id: PageStyleId;
  label: string;
  /** One plain sentence for the Style picker. */
  description: string;
  layouts: { readonly [T in SectionTypeId]: LayoutId<T> };
  schemes: Readonly<Record<SectionTypeId, ColourSchemeId>>;
  /**
   * The scheme a featured card (the recommended offer, a highlighted panel)
   * renders in, given the scheme of the section around it. A nested scheme,
   * not a fill colour, so the button inside the card is contrasted against the
   * CARD — a section's button tokens are only valid on the section's own ground.
   */
  featured: Readonly<Record<ColourSchemeId, ColourSchemeId>>;
  /** Every section type, in the order a full page tells the story. */
  order: readonly SectionTypeId[];
  /** The sections a brand-new page starts with (a subset of `order`). */
  starter: readonly SectionTypeId[];
  /**
   * The font pairing this Style suggests, from the brand editor's `FontPicker`
   * list. A SUGGESTION: the Style tab offers it and the creator accepts it into
   * the page's own brand; changing Style never changes fonts (03 §1, §9).
   */
  fonts?: { heading: string; body: string };
  /**
   * How the org's shader shows through an `atmosphere` section: blurred, as on
   * the org's other pages, or sharp (03 §5.1). Absent = blurred.
   */
  atmosphere?: 'soft' | 'sharp';
  /**
   * The scheme the floating call to action is drawn in — its own small band
   * over whatever section it passes, so never `atmosphere` (there is no veil
   * to see through). Absent = `base` (`PageRenderer`): the org's own
   * surface, where the bar is a raised card in the org's card colour holding
   * the org's button (owner, D9).
   */
  sticky?: Exclude<ColourSchemeId, 'atmosphere'>;
}

/** The sales narrative: promise, pain, the journey, shift, proof, offer, objections, ask. */
export const STORY_ORDER = [
  'hero',
  'video',
  'problem',
  'story',
  'text',
  'transformation',
  'benefits',
  'curriculum',
  'preview',
  'gallery',
  'instructor',
  'testimonials',
  'stats',
  'pricing',
  'faq',
  'cta',
] as const satisfies readonly SectionTypeId[];
