/**
 * Where a creator's content is filed (Codex-a6ofh.3.2): the personal studio's
 * "Where" menu (mockup L4b: Everywhere 14 · Personal 3 · Studio Alpha 9).
 *
 * `GET /api/content/where-counts` → `{ data: ContentWhereCounts }`. The
 * creator's own live pieces, whatever their status: the menu narrows the
 * whole list, so it counts the whole list.
 */
export interface ContentWhereCounts {
  /** Every live piece of the creator's: "Everywhere". */
  all: number;
  /** Pieces filed under no org: the personal studio's own. */
  personal: number;
  /** One per org the creator has pieces in, by name. */
  orgs: ContentWhereOrg[];
}

export interface ContentWhereOrg {
  id: string;
  name: string;
  count: number;
}
