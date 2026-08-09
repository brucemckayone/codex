/**
 * Shape of one fact in a `MoneyStatBand`.
 *
 * Co-located in a `.ts` rather than exported from the component's
 * `<script module>`: `svelte-check` accepts a type export there, but `tsc`
 * raises TS2614 for consumers importing it, so the build fails while the
 * editor stays green.
 */
export interface MoneyStat {
  label: string;
  value: string | number;
  /** Turns the tile into a link to the detail behind the number. */
  href?: string;
  /** Sub-label under the value — e.g. what the number excludes. */
  hint?: string;
}
