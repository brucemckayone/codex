/**
 * Visitor-facing words the testimonials block renders itself. They belong in
 * `kit/model/copy.ts` (contract A1) and live here, as the other blocks' do
 * (03 X8), until that shared file takes them.
 */
export const TESTIMONIALS_COPY = {
  /** The moving strip's pause button: its visible word… */
  pause: 'Pause',
  /** …and its name for a screen reader, which starts with that word. */
  pauseLabel: 'Pause the moving quotes',
} as const;
