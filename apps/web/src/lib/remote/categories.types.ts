/**
 * Shared category-management types + projection.
 *
 * Lives in a plain `.ts` module (NOT inside `categories.remote.ts`) so it can be
 * imported by the server load, the remote functions, AND the page component
 * without leaking non-remote runtime exports out of a `*.remote.ts` file, and so
 * the client picks up only the erased `import type` (the `Category`/DB-schema
 * dependency never reaches the browser bundle). Mirrors the `topic-card.types.ts`
 * precedent.
 */

import type { Category } from '@codex/database/schema';

/**
 * Serializable projection of a category row for the studio management UI.
 *
 * The API's `Category` type carries `Date` columns (createdAt/updatedAt/…) that
 * arrive as strings over the wire; this projection keeps only the fields the
 * management surface renders, all devalue-serializable.
 *
 * `coverImageUrl` is the resolved CDN URL (md variant) the management list
 * endpoint now returns, or null when there is no cover / no configured CDN
 * base. `coverImageKey` is the raw R2 key, kept so the UI can still signal
 * "a cover exists" in the null-URL fallback (e.g. local dev without a base).
 */
export interface StudioCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  coverImageKey: string | null;
  coverImageUrl: string | null;
  sortOrder: number;
}

/**
 * Map a raw API `Category` row to the serializable management projection.
 * The list endpoint enriches rows with a resolved `coverImageUrl`; create /
 * update return a plain `Category` (no URL) → coverImageUrl falls back to null.
 */
export function toStudioCategory(
  row: Category & { coverImageUrl?: string | null }
): StudioCategory {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    icon: row.icon ?? null,
    coverImageKey: row.coverImageKey ?? null,
    coverImageUrl: row.coverImageUrl ?? null,
    sortOrder: row.sortOrder,
  };
}
