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
  /**
   * Where the picture's subject is, in whole percent across (`x`) and down
   * (`y`), 0–100; absent is the centre (Codex-61zsk.53). It belongs to the
   * picture, not to a block, so a duplicated section or page keeps it and any
   * block that crops may steer by it. Always read through {@link readFocus}.
   */
  focus?: { x: number; y: number };
  /**
   * The picture's own width and height in pixels, from the UPLOAD RESPONSE
   * only (`processPageImage`), never typed or guessed. Their presence is what
   * tells a block the reference has an `xl` object: a key uploaded before
   * `xl` existed has neither, so it is never offered an `xl` that is not
   * there. Read through {@link readSize}.
   */
  w?: number;
  h?: number;
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

/** The four sizes `ImageProcessingService.processPageImage` writes under a page image's base key. */
export type PageImageVariant = 'sm' | 'md' | 'lg' | 'xl';

/** The widths each variant is written at, at most (`processor.ts`). */
const VARIANT_WIDTHS: Readonly<Record<PageImageVariant, number>> = {
  sm: 200,
  md: 400,
  lg: 800,
  xl: 1600,
};

/** What the page-image upload answers (`uploadPageImage`). An older worker omits the size. */
export interface PageImageUpload {
  key: string;
  url: string;
  width?: number;
  height?: number;
}

/** The centre: where a picture with no focal point is steered. */
export const CENTRE_FOCUS = { x: 50, y: 50 } as const;

function percent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : null;
}

/**
 * The picture's focal point, rounded to whole percent and clamped to the
 * frame; the centre for a reference with none, or with anything malformed
 * (the props are creator-authored jsonb, never trusted).
 */
export function readFocus(ref: unknown): { x: number; y: number } {
  if (!isImageRef(ref) || typeof ref.focus !== 'object' || !ref.focus) {
    return { ...CENTRE_FOCUS };
  }
  const x = percent(ref.focus.x);
  const y = percent(ref.focus.y);
  return x === null || y === null ? { ...CENTRE_FOCUS } : { x, y };
}

/**
 * The focal point the creator placed, or `undefined` where the picture has
 * none to steer by (none stored, a malformed one, or the centre): a block
 * passes it to `Media`'s `focus`, so a picture nobody pointed draws exactly
 * as it did before focal points (Codex-61zsk.58).
 */
export function storedFocus(
  ref: unknown
): { x: number; y: number } | undefined {
  const focus = readFocus(ref);
  return focus.x === CENTRE_FOCUS.x && focus.y === CENTRE_FOCUS.y
    ? undefined
    : focus;
}

/** The picture's own size, or `null` when the reference does not carry one. */
export function readSize(ref: unknown): { w: number; h: number } | null {
  if (!isImageRef(ref)) return null;
  const { w, h } = ref;
  const whole = (n: unknown): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n > 0;
  return whole(w) && whole(h) ? { w, h } : null;
}

/**
 * Resolve a stored {@link ImageRef} (or any unknown prop value) to its public
 * CDN URL, appending the `{sm|md|lg|xl}.webp` suffix
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
 * `xl` exists only for a reference that carries its size ({@link readSize});
 * asked of one without, this answers `lg`, the largest that reference has.
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
  const size = variant === 'xl' && !readSize(ref) ? 'lg' : variant;
  return `${cdnBase}/${ref.key}/${size}.webp`;
}

/**
 * Every stored size of a page image as a `srcset`, so a frame never fetches
 * more than it draws. With the picture's size each width is the one written
 * (`min(variant, w)`, never upscaled) and `xl` is listed; without it, the
 * three every page image has at their nominal widths. A width two variants
 * share is listed once. `''` with no CDN base or no reference.
 */
export function pageImageSrcset(
  ref: unknown,
  cdnBase: string | null | undefined
): string {
  if (!cdnBase || !isImageRef(ref)) return '';
  const size = readSize(ref);
  const variants: PageImageVariant[] = size
    ? ['sm', 'md', 'lg', 'xl']
    : ['sm', 'md', 'lg'];
  const seen = new Set<number>();
  const entries: string[] = [];
  for (const variant of variants) {
    const width = size
      ? Math.min(VARIANT_WIDTHS[variant], size.w)
      : VARIANT_WIDTHS[variant];
    if (seen.has(width)) continue;
    seen.add(width);
    entries.push(`${cdnBase}/${ref.key}/${variant}.webp ${width}w`);
  }
  return entries.join(', ');
}

/** The widest content column any Style draws (Bold's `--lp-container`). */
const WIDEST_COLUMN_REM = 82;

/** A share of the content column from a viewport width (rem) up. */
type ColumnShare = readonly [fromRem: number, fraction: number];

/**
 * A `sizes` for a picture drawn across `fraction` of the kit's content
 * column, or across each share in `from` from its viewport width up, for
 * choosing from {@link pageImageSrcset} (Codex-61zsk.66). The column is the
 * window less its gutters, up to the Style's container, so the window capped
 * at the widest Style's column never declares less than a Style draws; a
 * narrower Style fetches a file one step larger at most.
 *
 * Every share stops growing where the column does, at an 82rem window, so
 * each is its `vw` below that and its `rem` from it: not min(), which Safari
 * before 26.4 ignores in `sizes`, reading 100vw (Codex-sntzy). The first
 * entry that matches wins, so they run widest first, and an entry a wider one
 * always answers, or one that says what the next one does, is left out.
 */
export function columnSizes(
  fraction = 1,
  from: readonly ColumnShare[] = []
): string {
  const shares = [...from, [0, fraction] as const].sort((a, b) => b[0] - a[0]);
  const entries: { fromRem: number; length: string }[] = [];
  const add = (fromRem: number, length: string) => {
    const last = entries.at(-1);
    if (last && fromRem >= last.fromRem) return;
    if (last?.length === length) last.fromRem = fromRem;
    else entries.push({ fromRem, length });
  };
  for (const [fromRem, share] of shares) {
    const vw = Math.round(share * 10000) / 100;
    const rem = Math.round(share * WIDEST_COLUMN_REM * 100) / 100;
    add(Math.max(fromRem, WIDEST_COLUMN_REM), `${rem}rem`);
    if (fromRem < WIDEST_COLUMN_REM) add(fromRem, `${vw}vw`);
  }
  return entries
    .map(({ fromRem, length }) =>
      fromRem > 0 ? `(min-width: ${fromRem}rem) ${length}` : length
    )
    .join(', ');
}
