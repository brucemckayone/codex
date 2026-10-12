/**
 * Page-image R2 keys — the ONE owner of their shape (Codex-61zsk.10, contract
 * amendment A3).
 *
 * A block stores a page image's BASE key,
 * `landing-pages/{pageId}/images/{imageId}`, in an `ImageRef.key`. No object
 * lives at that key: the bytes are the four variants under it,
 * `{base}/{sm,md,lg,xl}.webp` ({@link pageImageVariantKeys}). The upload that
 * writes them, the save that nominates them for cleanup and the sweep that
 * deletes them all go through here, because the first version got this wrong:
 * the save queued the BASE key, the sweep deleted an object that never existed
 * and marked the row deleted, and every variant stayed in R2 for good.
 *
 * `xl` (Codex-61zsk.13, -61zsk.53) is a page image's alone, for a picture
 * drawn across the band. A key uploaded before it existed has no `xl` object;
 * the sweep's delete of that missing object is a no-op, so the four-key list
 * holds for every page image, old or new. All four places that know the set
 * (the processor's variants, {@link OBJECT_KEY}, {@link pageImageObjectKeys}
 * and the web's `PageImageVariant`) change together, or an `xl` object is
 * written that nothing ever deletes.
 */
import { stillVariantKeys, type VariantKeys } from './utils/upload-pipeline';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BASE_KEY = new RegExp(`^landing-pages/(${UUID})/images/${UUID}$`);
const OBJECT_KEY = new RegExp(
  `^(landing-pages/${UUID}/images/${UUID})/(?:sm|md|lg|xl)\\.webp$`
);

/** The base key for one uploaded page image; `imageId` is minted per upload. */
export function pageImageKey(pageId: string, imageId: string): string {
  return `landing-pages/${pageId}/images/${imageId}`;
}

/**
 * The page a base key is namespaced under, or `null` when `value` is not
 * exactly a key the upload route mints: two lowercase uuids and nothing else.
 * The exact shape is the point. A save may only nominate what an upload could
 * have produced, not any string that happens to share the prefix.
 */
export function pageIdOfPageImageKey(value: string): string | null {
  return BASE_KEY.exec(value)?.[1] ?? null;
}

/** The four variant keys under a page image's base key. */
export function pageImageVariantKeys(
  baseKey: string
): VariantKeys & { xl: string } {
  return { ...stillVariantKeys(baseKey), xl: `${baseKey}/xl.webp` };
}

/** The four R2 objects behind a base key, in sm/md/lg/xl order. */
export function pageImageObjectKeys(baseKey: string): string[] {
  const keys = pageImageVariantKeys(baseKey);
  return [keys.sm, keys.md, keys.lg, keys.xl];
}

/**
 * The base key an R2 object belongs to, or `null` for anything that is not
 * one of a page image's four variants.
 */
export function pageImageKeyOfObject(r2Key: string): string | null {
  return OBJECT_KEY.exec(r2Key)?.[1] ?? null;
}

/**
 * Every page-image key anywhere in a value: the save diff's scan
 * (`CourseJourneyService.saveJourneyPage`). It walks every string LEAF of
 * the tree and keeps the ones that are EXACTLY a key the upload route mints
 * (`pageIdOfPageImageKey`), so it needs no per-type schema knowledge: a
 * Picture's `{ key, alt, focus, w, h }` (03 X64), a gallery's items and a
 * section's background are all found the same way. Page copy, a link or a
 * string that merely shares the prefix is inert.
 *
 * Takes `unknown` on purpose: it reads the OLD stored value (whatever an
 * earlier version of the type persisted) as well as the NEW input, and a
 * shape it does not recognise is walked past, never thrown on.
 */
export function pageImageKeysIn(
  value: unknown,
  into: Set<string> = new Set()
): Set<string> {
  if (typeof value === 'string') {
    if (pageIdOfPageImageKey(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) pageImageKeysIn(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) pageImageKeysIn(nested, into);
  }
  return into;
}

/**
 * The keys a save drops: referenced before it and nowhere after it. This only
 * NOMINATES them; the sweep decides, after a grace period, by asking whether
 * any page in the org still shows the key, so an undo, a duplicate or a
 * second Picture with the same picture keeps it.
 */
export function droppedPageImageKeys(
  before: unknown,
  after: unknown
): string[] {
  const kept = pageImageKeysIn(after);
  return [...pageImageKeysIn(before)].filter((key) => !kept.has(key));
}
