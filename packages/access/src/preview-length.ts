/**
 * How long a film's public preview runs, said once for every film a visitor
 * can press: the org's intro film (`intro-film-views.ts`) and a course's sales
 * clips (`getCourseSellPreview`), so the two never name different lengths for
 * the same cut.
 */

/**
 * The longest public preview: `PREVIEW_DURATION` in the transcoder
 * (`create_preview`, infrastructure/runpod/handler/main.py).
 */
const PREVIEW_SECONDS = 30;

/**
 * How long a film's preview runs. The transcoder cuts it from a tenth of the
 * way in, for up to {@link PREVIEW_SECONDS} (`create_preview`), so a short
 * film's preview is shorter still.
 */
export function previewLength(durationSeconds: number | null): number | null {
  if (durationSeconds === null) return null;
  const start = Math.floor(durationSeconds * 0.1);
  return Math.min(PREVIEW_SECONDS, durationSeconds - start);
}
