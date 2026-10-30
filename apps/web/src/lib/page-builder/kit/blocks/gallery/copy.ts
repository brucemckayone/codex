/**
 * Visitor-facing words the gallery block renders itself. They belong in
 * `kit/model/copy.ts` (contract A1) and live here, as the other blocks' do
 * (03 X8), until that shared file takes them.
 */
export const GALLERY_COPY = {
  /** The strip's and the lightbox's name for a screen reader when the section has no heading. */
  pictures: 'Pictures',
  previous: 'Previous picture',
  next: 'Next picture',
  /** A tile's press, counted from 1: "Open picture 3 of 8: A mat by the window". */
  open: (index: number, count: number, alt: string) =>
    alt
      ? `Open picture ${index} of ${count}: ${alt}`
      : `Open picture ${index} of ${count}`,
  close: 'Close',
  /** Where the lightbox is in the set, counted from 1: "3 / 8". */
  counter: (index: number, count: number) => `${index} / ${count}`,
} as const;
