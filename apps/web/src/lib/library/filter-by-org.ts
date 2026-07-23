/**
 * Library Filter by Org — the single cross-org boundary for the library
 * collection. Pure predicate + helper for scoping a user's multi-org library
 * to one organization on org-subdomain library views (e.g.
 * `acme.codex.app/library`, `acme.codex.app/`).
 *
 * ## Why one shared boundary
 *
 * The library collection (`$lib/collections/library.ts`) is stored in a single
 * localStorage key spanning every org the user has joined, keyed by
 * content.id. Two surfaces read that one cross-org collection:
 *   - the platform library (`(platform)/library`) shows the FULL set (no org
 *     filter — it is the "everything you own" view), and
 *   - the org library (`_org/[slug]/(space)/library`) must scope to the
 *     current org ONLY, via `filterLibraryItemsByOrg`, or cross-org content
 *     bleeds through.
 * Keeping the org-scoping predicate here (rather than inline in the org page)
 * means the one place both surfaces disagree — "all orgs" vs "this org" — is
 * expressed once and locked by tests.
 *
 * The original bug (Codex-q3zuf) filtered by `organizationSlug`, which was
 * nullable; legacy entries with null slugs slipped through. This predicate
 * filters strictly by the non-null `organizationId` instead.
 *
 * ## Relationship to schema versioning
 *
 * This predicate trusts that every entry carries the current `LibraryItem`
 * shape (`content.organizationId`). That invariant is upheld by
 * `$lib/library/schema-version.ts`, which discards/migrates any stale-shape
 * localStorage payload BEFORE the collection hydrates. When the course-grouping
 * change lands it will extend both this filter and the schema version together.
 */

interface LibraryItemLike {
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
