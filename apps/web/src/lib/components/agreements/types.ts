/**
 * Shared types for revenue-share agreement UI components.
 *
 * Lives in a sibling `.ts` because SvelteKit's ambient `*.svelte` module
 * declaration only exposes the default export — named exports from
 * `<script module>` aren't surfaced to TypeScript consumers.
 */

/** Render mode for {@link RevenueSplitSlice} consumers. */
export type RevenueSplitMode = 'owner' | 'creator';

/**
 * One slice of the stacked-bar revenue split. Percent values are basis points
 * (0–10_000) internally; the component renders them as decimal percent.
 */
export interface RevenueSplitSlice {
  /** Stable identity for keyed iteration + onChange diffing. */
  id: string;
  /** Human-readable label (e.g. 'Platform Fee', 'Org owner', 'Alex Rivera'). */
  label: string;
  /** Share in basis points (0–10_000). 100 bp = 1 %. */
  percent: number;
  /**
   * CSS custom-property reference (e.g. `var(--color-info-600)`). MUST be a
   * token reference, NEVER a hex literal — keeps the org-branding chain intact.
   */
  color: string;
  /**
   * Locked slices cannot be dragged (e.g. platform fee, computed residual).
   * The boundary AFTER a locked slice is not focusable.
   */
  locked: boolean;
  /**
   * In creator mode, anonymous slices render with a generic label and no peer
   * identity. The owning slice (`anonymous: false`) renders normally.
   */
  anonymous: boolean;
}

/** Basis-points ceiling (100 %). */
export const BP_MAX = 10_000;
/** Single-step nudge in basis points (1 %). */
export const BP_STEP = 100;
/** Shift-modifier nudge in basis points (10 %). */
export const BP_STEP_LARGE = 1_000;
