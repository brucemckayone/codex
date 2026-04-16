/**
 * Brand Editor Types
 *
 * Type-safe foundation for the floating brand editor panel.
 * These types are used by the store, presets, CSS injection,
 * and all Level 0-2 editor components.
 */

// ── Editor State ──────────────────────────────────────────────────────────

/** Color fields that can be overridden per-theme. */
export interface ThemeColors {
  primaryColor: string;
  secondaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
}

/** Theme color field names. */
export type ThemeColorField = keyof ThemeColors;

/** The complete state of the brand editor at any point in time. */
export interface BrandEditorState {
  primaryColor: string;
  secondaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  fontBody: string | null;
  fontHeading: string | null;
  radius: number;
  density: number;
  logoUrl: string | null;
  /** Per-token overrides from Level 2 fine-tune. null = auto-derive from primary. */
  tokenOverrides: Record<string, string | null>;
  /** Dark theme color overrides. null = auto-derive from light values. */
  darkOverrides: Partial<ThemeColors> | null;
  /** Selected hero layout variant. */
  heroLayout: string;
}

/** The subset of BrandEditorState that gets saved to the API. */
export type BrandEditorPayload = Omit<
  BrandEditorState,
  'tokenOverrides' | 'logoUrl'
>;

// ── Presets ───────────────────────────────────────────────────────────────

/** A preset is a complete brand design system. */
export interface BrandPreset {
  id: string;
  name: string;
  description: string;
  values: BrandEditorPayload;
  /** Optional token overrides bundled with the preset (hero, player, glass, cards, etc.) */
  tokenOverrides?: Record<string, string>;
  /** Optional hero layout variant ('default' | 'centered' | 'logo-hero') */
  heroLayout?: string;
}

// ── Navigation ────────────────────────────────────────────────────────────

/** Navigation level identifiers. */
export type LevelId =
  | 'home'
  | 'colors'
  | 'typography'
  | 'shape'
  | 'shadows'
  | 'logo'
  | 'presets'
  | 'hero-effects'
  | 'intro-video'
  | 'header-layout'
  | 'fine-tune-colors'
  | 'fine-tune-typography';

/** Depth in the breadcrumb hierarchy. */
export type LevelDepth = 0 | 1 | 2;

/** Metadata for a navigation level. */
export interface LevelMeta {
  id: LevelId;
  depth: LevelDepth;
  label: string;
  parent: LevelId | null;
  icon?: string;
  description?: string;
}

// ── Panel State ───────────────────────────────────────────────────────────

/** The panel's visibility state. */
export type PanelState = 'closed' | 'open' | 'minimized';

// ── CSS Variable Mapping ──────────────────────────────────────────────────

/** Maps a BrandEditorState field to a CSS custom property name + value transform. */
export interface CssVarMapping {
  /** The CSS custom property to set (e.g., '--brand-color'). */
  property: string;
  /** Extract the value from BrandEditorState. Return undefined to remove the property. */
  getValue: (state: BrandEditorState) => string | undefined;
}
