/**
 * The one media query that decides whether `FilterDrawer` behaves as a
 * right-edge desktop panel or a mobile bottom sheet.
 *
 * It MUST stay byte-identical to the `--below-sm` custom-media the component's
 * CSS uses (`apps/web/src/lib/styles/tokens/breakpoints.css`), because the JS
 * commit model (live write-through vs staged + Apply) and the CSS geometry have
 * to flip at the same width — a drawer that looks like a bottom sheet but
 * commits like a desktop panel loses the user's staged picks.
 *
 * Lives in a plain `.ts` rather than the component's `<script module>` so both
 * the component and its test can import it under plain `tsc`: an ambient
 * `*.svelte` module only declares a default export, so a `<script module>`
 * re-export trips TS2614.
 */
export const MOBILE_QUERY = '(max-width: 39.9375rem)';
