/**
 * Visitor-facing words the gallery block renders itself. They belong in
 * `kit/model/copy.ts` (contract A1) and live here, as the other blocks' do
 * (03 X8), until that shared file takes them.
 */
export const GALLERY_COPY = {
  /** The strip's name for a screen reader when the section has no heading. */
  strip: 'Pictures',
  previous: 'Previous picture',
  next: 'Next picture',
} as const;
