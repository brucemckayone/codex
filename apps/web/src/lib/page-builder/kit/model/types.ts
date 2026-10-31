/**
 * The page kit's document and block contracts
 * (docs/design/landing-builder/01-contract.md §2–§5).
 *
 * The PERSISTED envelope is unchanged — `landing_pages.sections[]` is still
 * `{ id, type, enabled, variant?, name?, design?, props }` — but its vocabulary
 * is new: `type` is a `SectionTypeId`, `variant` holds a layout id, and
 * `design` holds a `SectionStyle`. Legacy rows are converted by
 * `upgrade.ts` before anything in the kit sees them; nothing in the kit
 * reads a legacy id.
 */

import type { PageSection } from '@codex/shared-types';
import type { JourneySalesContext, SellPreview } from '../../render/types';
import type { JourneySellMediaSlot } from '../../sell-media-store.svelte';
import type {
  ColourSchemeId,
  PageDials,
  PageFacets,
  PageStyleId,
  SectionSpacingId,
  SectionTypeId,
} from './ids';

// ─── Document ────────────────────────────────────────────────────────────────

/** A section's style choices. Absent keys resolve from the page's Style. */
export interface SectionStyle {
  scheme?: ColourSchemeId;
  spacing?: SectionSpacingId;
}

/** The page-level design (`landing_pages.design`). */
export interface PageDesign {
  style?: PageStyleId;
  /** The page's dials (03 X61); an unset dial is the Style's. */
  dials?: PageDials;
  /** Another Style's Type on this page (03 X73); unset is the Style's own. */
  facets?: PageFacets;
}

/** A persisted section in kit vocabulary. `variant` is the layout id. */
export type KitSection = Omit<PageSection, 'type' | 'variant' | 'design'> & {
  type: SectionTypeId;
  variant?: string;
  design?: SectionStyle;
};

/** What the kit renders: an upgraded page. */
export interface KitPage {
  design: PageDesign;
  sections: KitSection[];
}

/**
 * One section's slot, fully resolved (layout, scheme and spacing never
 * undefined). Computed once by the renderer and handed to the block.
 */
export interface ResolvedSection {
  id: string;
  /** DOM anchor: the type id for the first of its type, `type-2`… after. */
  anchor: string;
  type: SectionTypeId;
  /** Position among RENDERED sections (hidden sections excluded). */
  index: number;
  layout: string;
  scheme: ColourSchemeId;
  spacing: SectionSpacingId;
  /** 1 for the page's single hero heading, 2 everywhere else. */
  headingLevel: 1 | 2;
  /**
   * A simple section's join (03 X64, `joinSimpleSections`): it takes the
   * ground of the section `above` (a Picture, Break or Button finishing that
   * band) or `below` (a Heading announcing the next one). Absent for every
   * ordinary section, and for a simple one that stands on its own: a colour
   * the creator chose, or no neighbour it may join.
   */
  join?: 'above' | 'below';
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

/** Inline-editing hooks. `null` on the public page — blocks must render
 *  byte-identical markup either way apart from the editable attributes. */
export interface BlockEdit {
  commit: (key: string, value: string) => void;
}

/** The props every block component receives. */
export interface BlockProps<P = Record<string, unknown>> {
  props: P;
  section: ResolvedSection;
  context: JourneySalesContext;
  edit: BlockEdit | null;
}

/** One editable field of a block, as the inspector renders it. */
export interface BlockField {
  key: string;
  /** Plain English, sentence case. Never a design term. */
  label: string;
  hint?: string;
  /**
   * `text`/`textarea` may also be edited inline on the canvas (`inline`).
   * `list` = string[] · `items` = object[] described by `itemFields` ·
   * `media` = one of the journey's sell-media slots · `image` = the creator's
   * own uploaded image, stored as an `ImageRef` (contract A3/A5) · `choice` =
   * a few `options` side by side, the first the default, stored as the absent
   * key (Codex-61zsk.58) · `mark` = one of the kit's marks (`model/marks.ts`)
   * or none, picked from its icons (Codex-61zsk.58).
   */
  control:
    | 'text'
    | 'textarea'
    | 'url'
    | 'toggle'
    | 'select'
    | 'choice'
    | 'mark'
    | 'list'
    | 'items'
    | 'media'
    | 'image'
    /** A Button's action (03 X64): where it goes, from the proven set. */
    | 'action'
    /** One of the page's live ways in (`deriveOfferPaths`), stored as its
     *  id: an option a creator describes is one the offer has (Codex-61zsk.14). */
    | 'offer';
  inline?: boolean;
  placeholder?: string;
  maxLength?: number;
  options?: readonly { value: string; label: string }[];
  itemFields?: readonly BlockField[];
  maxItems?: number;
  mediaSlot?: JourneySellMediaSlot;
  /** `image` only: the image is decorative unless the creator describes it —
   *  the alt-text prompt becomes an opt-in (hero, cta background; contract A5). */
  decorative?: boolean;
  /** Layout ids this field applies to. Absent = every layout. The inspector
   *  hides a field whose layout doesn't use it; the block never force-hides
   *  content the creator filled (layouts arrange, they don't censor). */
  layouts?: readonly string[];
  /** The Styles this field applies to. Absent = every Style. A Break's mark
   *  is offered only where the Style has one to draw (03 X64). */
  styles?: readonly PageStyleId[];
  /** `image` only: the layouts that crop this picture, each with the shapes
   *  it is cut to. The inspector offers a focal point under the upload, live
   *  in these layouts with a preview of each cut, and explained in the others
   *  (03 X64, Codex-61zsk.58). */
  focalLayouts?: Readonly<Record<string, readonly FocalCrop[]>>;
}

/**
 * One shape a layout cuts a picture to, on a wide screen, a tablet or a
 * phone: what the focal point's preview shows that screen keeping. Measured
 * in every Style, the shape a picture is drawn at where it is cut most.
 */
export interface FocalCrop {
  at: 'wide' | 'tablet' | 'phone';
  /** A CSS aspect ratio, `'2 / 1'`. */
  ratio: string;
}

/** A shape a layout cuts a course still to, in every Style unless it names some. */
export interface StillCrop extends FocalCrop {
  /** The Styles that cut it so; the others show the still whole there. */
  styles?: readonly PageStyleId[];
}

/**
 * A course still the section draws (the journey's, not an upload), and the
 * crops a focal point steers (Codex-61zsk.73, `model/still-focus.ts`). The
 * point is stored in the section's `stillFocus`; the inspector offers it
 * under each still the section draws, as it does under an upload.
 */
export interface StillFocusSpec {
  /**
   * The still the section draws now, read as the block reads it, from the
   * streamed preview once it settles (`undefined` until then): `null` where
   * there is none, or where a point would not steer it (the creator's own
   * image has its own point; a playing clip is never cropped by one).
   */
  still: (
    raw: Record<string, unknown>,
    preview: SellPreview | null | undefined,
    context: JourneySalesContext
  ) => string | null;
  /** The layouts that crop it, each with the shapes it is cut to. */
  focalLayouts: Readonly<Record<string, readonly StillCrop[]>>;
  /** The field it is offered right under; absent, it has a group of its own. */
  under?: string;
}

export interface BlockLayout {
  id: string;
  label: string;
  description: string;
}

/** Where a section type sits in the add-section gallery. */
export type BlockGroup =
  /** The simple one-job sections, first in the gallery (03 X64). */
  'basics' | 'opening' | 'story' | 'proof' | 'offer' | 'details';

/** Inputs for writing a new section's starter props. */
export interface TemplateContext {
  courseTitle: string;
  courseLede?: string | null;
}

/**
 * A section type's complete definition. One per `blocks/<type>/definition.ts`.
 * The catalogue (`catalog.ts`) only aggregates these — it never holds
 * type-specific knowledge of its own.
 */
export interface BlockDefinition<P = Record<string, unknown>> {
  type: SectionTypeId;
  label: string;
  description: string;
  group: BlockGroup;
  /** An `$lib/components/ui/Icon` component name, e.g. `'SparkleIcon'`. */
  icon: string;
  layouts: readonly BlockLayout[];
  fields: readonly BlockField[];
  /** At most this many per page (hero: 1). Absent = unlimited. */
  max?: number;
  /** Starter props for a freshly added section: real sentences derived from
   *  the course where possible — never lorem, never "A headline that…". */
  starter: (ctx: TemplateContext) => P;
  /** Content for gallery / layout-picker thumbnails. */
  sample: P;
  /** Tolerant reader: unknown keys dropped, wrong types → absent. */
  coerce: (raw: Record<string, unknown>) => P;
  /**
   * The index in the stored `items` of the entry this layout draws larger
   * than the rest (the first quote's panel, the mixed tiles' lead), or `null`
   * where none leads. The editor tags its row "Leads"; nothing is stored
   * (Codex-61zsk.58).
   */
  leadingItem?: (
    raw: Record<string, unknown>,
    layout: string,
    context: JourneySalesContext
  ) => number | null;
  /** The course still this section draws, which a focal point may steer. */
  stillFocus?: StillFocusSpec;
}
