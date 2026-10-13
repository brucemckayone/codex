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
import type { JourneySalesContext } from '../../render/types';
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
   * own uploaded image, stored as an `ImageRef` (contract A3/A5).
   */
  control:
    | 'text'
    | 'textarea'
    | 'url'
    | 'toggle'
    | 'select'
    | 'list'
    | 'items'
    | 'media'
    | 'image'
    /** A Button's action (03 X64): where it goes, from the proven set. */
    | 'action';
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
  /** `image` only: the layouts that crop this picture. The inspector offers
   *  a focal point under the upload, live in these layouts and explained in
   *  the others (03 X64). */
  focalLayouts?: readonly string[];
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
}
