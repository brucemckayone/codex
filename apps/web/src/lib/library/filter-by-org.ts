/**
 * Library Filter by Org — pure predicate + helper for scoping a user's
 * multi-org library collection to a single organization on org-subdomain
 * library views (e.g. `acme.codex.app/library`, `acme.codex.app/`).
 *
 * The library collection is stored in a single localStorage key spanning
 * every org the user has joined, keyed by content.id. When rendered on an
 * org subdomain we must filter to that org ONLY — otherwise cross-org
 * content bleeds through. The original bug (Codex-q3zuf) filtered by
 * `organizationSlug` which was nullable; legacy entries with null slugs
 * slipped through.
 *
 * Extracted here so the predicate is unit-testable and its contract is
 * enforced by a test suite — making it hard to silently regress back to
 * the slug-based filter.
 */

export interface LibraryItemLike {
  content?: {
    organizationId?: string | null;
  };
}

/**
 * Return only items whose `content.organizationId` strictly equals the
 * current `orgId`. Items with null or missing `organizationId`, or items
 * belonging to another org, are excluded. Returns an empty array when
 * `orgId` is undefined (e.g. org data hasn't loaded yet).
 */
export function filterLibraryItemsByOrg<T extends LibraryItemLike>(
  items: readonly T[],
  orgId: string | undefined
): T[] {
  if (orgId === undefined) return [];
  return items.filter((item) => item.content?.organizationId === orgId);
}
