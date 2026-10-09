/**
 * Visitor-facing words the before-and-after block renders itself. They
 * belong in `kit/model/copy.ts` (contract A1) and live here only until that
 * shared file takes them — it is outside this block's folder.
 */
export const TRANSFORMATION_COPY = {
  /** The switch's name for a screen reader. */
  switch: 'Before and after',
  /** A tab's name when the creator left that side's title empty. */
  before: 'Before',
  after: 'After',
} as const;
