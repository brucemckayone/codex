/**
 * Control-rail navigation model (Codex-cijzb · WP-1.5).
 *
 * Replaces the retired 12-level back-button stack (`$lib/brand-editor/levels.ts`,
 * still used by the legacy overlay) with a flat, grouped model: three groups —
 * Foundations, Identity, Hero — each owning a handful of controls. This module
 * is the pure, framework-free spine: group/control metadata, the honest
 * "Affects:" surface map, the search matcher, and the change-ledger diff. The
 * rail components render from it; the tests exercise it directly.
 *
 * The leaf FIELD components (OKLCH picker, FontPicker, sliders, logo + hero
 * controls) are REUSED from `$lib/components/brand-editor/**` — this model only
 * describes how they are grouped, searched, and summarised, never re-implements
 * a field.
 */
import type { BrandEditorState } from '$lib/brand-editor';

// ── Group + control identity ────────────────────────────────────────────────

export type RailGroupId = 'foundations' | 'identity' | 'hero';

export type RailControlId =
  | 'colours'
  | 'shape'
  | 'typography'
  | 'logo'
  | 'hero-text'
  | 'hero-layout'
  | 'hero-effects';

export interface RailControlMeta {
  readonly id: RailControlId;
  readonly label: string;
  /** Glyph shown in the control header — matches the mockup's icon language. */
  readonly icon: string;
  /** Extra search terms beyond the label (synonyms + sub-field names). */
  readonly keywords: readonly string[];
  /**
   * Product surfaces this control's fields touch — rendered as the "Affects:"
   * chips. Kept HONEST: reflects the real token consumers (e.g. the heading
   * font reaches card/content titles per WP-0.1; the brand colour drives
   * buttons/links/focus/hero/player per css-injection's derivation header).
   */
  readonly affects: readonly string[];
}

export interface RailGroupMeta {
  readonly id: RailGroupId;
  readonly label: string;
  readonly icon: string;
  readonly controls: readonly RailControlMeta[];
}

/**
 * The three groups and their controls. Each control maps 1:1 onto a reused
 * brand-editor field component (see BrandStudioRail's group snippets).
 */
export const RAIL_GROUPS: readonly RailGroupMeta[] = [
  {
    id: 'foundations',
    label: 'Foundations',
    icon: '◑',
    controls: [
      {
        id: 'colours',
        label: 'Colours',
        icon: '◑',
        keywords: [
          'colour',
          'color',
          'palette',
          'brand',
          'primary',
          'secondary',
          'accent',
          'background',
        ],
        // --brand-color derives interactive/buttons, links, focus rings;
        // accent + background reach cards, hero and the player surfaces.
        affects: ['Buttons', 'Links', 'Focus rings', 'Cards', 'Hero', 'Player'],
      },
      {
        id: 'shape',
        label: 'Shape & density',
        icon: '⬡',
        keywords: [
          'radius',
          'corner',
          'rounded',
          'density',
          'spacing',
          'compact',
          'roundness',
        ],
        affects: ['Buttons', 'Cards', 'Inputs', 'Spacing'],
      },
    ],
  },
  {
    id: 'identity',
    label: 'Identity',
    icon: 'Aa',
    controls: [
      {
        id: 'typography',
        label: 'Typography',
        icon: 'Aa',
        keywords: ['font', 'typeface', 'body', 'heading', 'text', 'type'],
        // Heading font drives headings AND class-based titles/cards (WP-0.1);
        // body font drives body copy.
        affects: ['Headings', 'Titles', 'Cards', 'Body text'],
      },
      {
        id: 'logo',
        label: 'Logo',
        icon: '◻',
        keywords: ['logo', 'image', 'mark', 'brand mark', 'upload'],
        affects: ['Header', 'Hero'],
      },
      {
        id: 'hero-text',
        label: 'Hero text',
        icon: '¶',
        // The org name + subheading rendered in the landing hero. Searchable
        // from "hero", "name", "title", "tagline" etc. so it surfaces whether
        // the admin thinks "identity" or "hero".
        keywords: [
          'hero',
          'text',
          'title',
          'name',
          'organization',
          'organisation',
          'subheading',
          'tagline',
          'description',
          'headline',
        ],
        affects: ['Hero section'],
      },
    ],
  },
  {
    id: 'hero',
    label: 'Hero',
    icon: '⊞',
    controls: [
      {
        id: 'hero-layout',
        label: 'Layout & visibility',
        icon: '⊞',
        keywords: [
          'hero',
          'layout',
          'arrangement',
          'visibility',
          'show',
          'hide',
          'title',
          'stats',
          'pills',
          'logo size',
        ],
        affects: ['Hero section'],
      },
      {
        id: 'hero-effects',
        label: 'Effects',
        icon: '◈',
        keywords: [
          'shader',
          'effect',
          'animation',
          'background',
          'preset',
          'canvas',
        ],
        affects: ['Hero background'],
      },
    ],
  },
];

// ── Lookups ──────────────────────────────────────────────────────────────────

/** Flat list of every control across all groups, in display order. */
export function flattenControls(): readonly RailControlMeta[] {
  return RAIL_GROUPS.flatMap((group) => group.controls);
}

/** The group a control belongs to, or null when the id is unknown. */
export function findControlGroup(controlId: RailControlId): RailGroupId | null {
  const group = RAIL_GROUPS.find((g) =>
    g.controls.some((c) => c.id === controlId)
  );
  return group?.id ?? null;
}

// ── Search ─────────────────────────────────────────────────────────────────

function normalise(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Does a control match the search query? Empty/whitespace query matches every
 * control (search inactive). Matches on the label, any keyword, or any
 * "Affects:" surface — all substring, case-insensitive.
 */
export function controlMatchesQuery(
  control: RailControlMeta,
  query: string
): boolean {
  const q = normalise(query);
  if (q === '') return true;
  const haystack = [control.label, ...control.keywords, ...control.affects].map(
    normalise
  );
  return haystack.some((entry) => entry.includes(q));
}

export interface RailControlLocation {
  readonly groupId: RailGroupId;
  readonly control: RailControlMeta;
}

/**
 * The first control (in display order) matching a non-empty query — the jump
 * target when the admin presses Enter in the search box. Returns null when the
 * query is empty or nothing matches.
 */
export function firstControlMatch(query: string): RailControlLocation | null {
  if (normalise(query) === '') return null;
  for (const group of RAIL_GROUPS) {
    for (const control of group.controls) {
      if (controlMatchesQuery(control, query)) {
        return { groupId: group.id, control };
      }
    }
  }
  return null;
}

// ── Change ledger ────────────────────────────────────────────────────────────

/**
 * Human-readable labels for every persisted field of `BrandEditorState`, in the
 * order the ledger lists them. Object-valued fields (the override maps) are
 * summarised as a single ledger entry — a per-field Reset reverts the whole map
 * to its saved value, matching `brandEditor.resetField`'s top-level contract.
 */
export const FIELD_LABELS: Record<keyof BrandEditorState, string> = {
  primaryColor: 'Brand colour',
  secondaryColor: 'Secondary colour',
  accentColor: 'Accent colour',
  backgroundColor: 'Background colour',
  fontBody: 'Body font',
  fontHeading: 'Heading font',
  radius: 'Corner radius',
  density: 'Density',
  logoUrl: 'Logo',
  tokenOverrides: 'Fine-tune & hero overrides',
  darkOverrides: 'Dark colour overrides',
  darkTokenOverrides: 'Dark fine-tune overrides',
  heroLayout: 'Hero layout',
};

const LEDGER_FIELD_ORDER = Object.keys(
  FIELD_LABELS
) as (keyof BrandEditorState)[];

export interface FieldChange {
  readonly field: keyof BrandEditorState;
  readonly label: string;
}

/** Deep value-equality for a single field via canonical JSON. */
function fieldEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Has this one field diverged from its saved value? */
export function isFieldDirty(
  saved: BrandEditorState | null,
  pending: BrandEditorState | null,
  field: keyof BrandEditorState
): boolean {
  if (!saved || !pending) return false;
  return !fieldEquals(saved[field], pending[field]);
}

/**
 * The change ledger: every field whose pending value differs from saved, with
 * its display label, in stable order. Empty array when nothing changed (or the
 * editor is closed). Drives the "N changes" count and the per-field Reset list.
 */
export function diffBrandState(
  saved: BrandEditorState | null,
  pending: BrandEditorState | null
): FieldChange[] {
  if (!saved || !pending) return [];
  const changes: FieldChange[] = [];
  for (const field of LEDGER_FIELD_ORDER) {
    if (!fieldEquals(saved[field], pending[field])) {
      changes.push({ field, label: FIELD_LABELS[field] });
    }
  }
  return changes;
}
