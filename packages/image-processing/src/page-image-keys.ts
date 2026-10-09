/**
 * Page-image R2 keys — the ONE owner of their shape (Codex-61zsk.10, contract
 * amendment A3).
 *
 * A block stores a page image's BASE key,
 * `landing-pages/{pageId}/images/{imageId}`, in an `ImageRef.key`. No object
 * lives at that key: the bytes are the three variants under it,
 * `{base}/{sm,md,lg}.webp` ({@link stillVariantKeys}). The upload that writes
 * them, the save that nominates them for cleanup and the sweep that deletes
 * them all go through here, because the first version got this wrong: the
 * save queued the BASE key, the sweep deleted an object that never existed and
 * marked the row deleted, and every variant stayed in R2 for good.
 */
import { stillVariantKeys } from './utils/upload-pipeline';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BASE_KEY = new RegExp(`^landing-pages/(${UUID})/images/${UUID}$`);
const OBJECT_KEY = new RegExp(
  `^(landing-pages/${UUID}/images/${UUID})/(?:sm|md|lg)\\.webp$`
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

/** The three R2 objects behind a base key, in sm/md/lg order. */
export function pageImageObjectKeys(baseKey: string): string[] {
  const keys = stillVariantKeys(baseKey);
  return [keys.sm, keys.md, keys.lg];
}

/**
 * The base key an R2 object belongs to, or `null` for anything that is not
 * one of a page image's three variants.
 */
export function pageImageKeyOfObject(r2Key: string): string | null {
  return OBJECT_KEY.exec(r2Key)?.[1] ?? null;
}
