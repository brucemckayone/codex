/**
 * Page-image helpers (Codex-61zsk.10, contract amendment A3).
 *
 * INERT + public-bundle safe: pure functions only, no server imports, no
 * component imports — lives under `$lib/page-builder` alongside
 * `journey-queries.ts`, for the same reason that file states: both the
 * public renderer (SSR) and the studio editor (browser) need these.
 *
 * `ImageRef` is the ONE convention every block honours for a free-placement
 * upload (`props.image`, `props.background`, `items[].image`, ...) — the
 * server finds references by deep-scanning `sections` for this shape's
 * `key` string under a page's own R2 prefix
 * (`CourseJourneyService.saveJourneyPage`), never by knowing a block's prop
 * names. Blocks never build a CDN URL themselves; they call
 * {@link resolvePageImageUrl}.
 */

export interface ImageRef {
  /** R2 base key, `landing-pages/{pageId}/images/{imageId}` — no variant suffix. */
  key: string;
  alt?: string;
}

/** Narrow an unknown prop value to a real {@link ImageRef}. */
export function isImageRef(value: unknown): value is ImageRef {
  if (typeof value !== 'object' || value === null) return false;
  const { key, alt } = value as { key?: unknown; alt?: unknown };
  return (
    typeof key === 'string' &&
    key.length > 0 &&
    (alt === undefined || typeof alt === 'string')
  );
}

/** The three sizes `ImageProcessingService.processPageImage` writes under a page image's base key. */
export type PageImageVariant = 'sm' | 'md' | 'lg';

/**
 * Resolve a stored {@link ImageRef} (or any unknown prop value) to its public
 * CDN URL, appending the `{sm|md|lg}.webp` suffix
 * `ImageProcessingService.processPageImage` writes under the base key.
 *
 * Takes `cdnBase` as an explicit argument rather than reading it from an
 * ambient constant — deliberately, and it is the one open decision this WP
 * is reporting rather than improvising past. No client-visible CDN-base
 * constant exists on the web today: every OTHER still
 * (`heroImageKey`/`coverImageKey`/`signatureImageKey`) is resolved
 * SERVER-SIDE inside the worker, from `ctx.env.R2_PUBLIC_URL_BASE` (see
 * `resolveCourseHeroUrl` / `resolveCourseCoverUrl` / `resolveCourseSignatureUrl`
 * in `packages/access/src/services/course-journey-service.ts` — the same
 * "caller supplies the base, a pure function resolves" split this mirrors
 * for the web), and handed to the client as an already-built URL; the web
 * itself never needed to turn a bare key into a URL before this WP. So this
 * function is pure and asks its caller for the one thing it cannot know on
 * its own, exactly like its server-side siblings do. Wiring a real
 * `cdnBase` value into whatever calls this (page data, a load function) is
 * a Handoff for the page-kit renderer.
 *
 * Returns `null` for anything that is not a real `ImageRef`, or when no
 * `cdnBase` is supplied — never a half-formed URL.
 */
export function resolvePageImageUrl(
  ref: unknown,
  variant: PageImageVariant,
  cdnBase: string | null | undefined
): string | null {
  if (!cdnBase || !isImageRef(ref)) return null;
  return `${cdnBase}/${ref.key}/${variant}.webp`;
}
