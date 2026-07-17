/**
 * Category cover URL resolution
 *
 * Single home for the raw-R2-key → public-CDN-URL convention so the public
 * topic list (`public.ts`) and the authenticated studio management list
 * (`categories.ts`) resolve covers identically. Clients must never see the raw
 * R2 key; returns null when there is no cover or no configured CDN base.
 *
 * The stored `coverImageKey` is the base key (e.g. `categories/{id}/cover`);
 * `ImageProcessingService.processCategoryCover` writes `{sm,md,lg}.webp`
 * variants under it. Cards use the `md` variant.
 */
export function resolveCategoryCoverUrl(
  coverImageKey: string | null | undefined,
  r2Base: string | undefined
): string | null {
  return coverImageKey && r2Base ? `${r2Base}/${coverImageKey}/md.webp` : null;
}
