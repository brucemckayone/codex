/**
 * Content Filter by Org — pure predicate for scoping a content array
 * (catalogue grids, explore views, related content) to a single
 * organization on org-subdomain pages.
 *
 * Sister of `apps/web/src/lib/library/filter-by-org.ts`. Library items
 * wrap content under `.content`; raw catalogue items expose
 * `organizationId` directly. Same defensive contract: strict equality,
 * null/missing values excluded, empty `orgId` returns empty.
 *
 * Used as a render-time seatbelt on the org `/explore` page so that
 * even if the underlying TanStack DB collection is somehow polluted
 * with another org's content (cache poisoning, navigation race, KV
 * staleness), the wrong items never reach the DOM.
 */

interface ContentItemLike {
  organizationId?: string | null;
}

/**
 * Return only items whose `organizationId` strictly equals the current
 * `orgId`. Items with null or missing `organizationId`, or items
 * belonging to another org, are excluded. Returns an empty array when
 * `orgId` is undefined (e.g. org data hasn't loaded yet).
 */
export function filterContentItemsByOrg<T extends ContentItemLike>(
  items: readonly T[],
  orgId: string | undefined
): T[] {
  if (orgId === undefined) return [];
  return items.filter((item) => item.organizationId === orgId);
}
