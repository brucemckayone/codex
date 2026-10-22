/**
 * The base key each kind of still lives under, for one entity. Every folder
 * of that still sits directly in it (Codex-kk9nv.5), and an upload from before
 * then has its files in it. One definition, so the code that writes a folder
 * and the sweep that decides one cannot disagree about where it is.
 */

/** The stills whose DB write the caller owns, by image type. */
export const CALLER_OWNED_STILL_BASE = {
  category_cover: (categoryId: string) => `categories/${categoryId}/cover`,
  course_cover: (courseId: string) => `courses/${courseId}/cover`,
  course_hero: (courseId: string) => `courses/${courseId}/hero`,
  course_signature: (courseId: string) => `courses/${courseId}/signature`,
} as const;
