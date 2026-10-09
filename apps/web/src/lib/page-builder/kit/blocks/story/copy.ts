/**
 * Visitor-facing words the story block renders itself. They belong in
 * `kit/model/copy.ts` (contract A1) and live here only until that shared file
 * takes them — it is outside this block's folder.
 */
export const STORY_COPY = {
  /** The strip's name for a screen reader when the section has no heading. */
  strip: 'Moments',
  previous: 'Previous moment',
  next: 'Next moment',
} as const;
