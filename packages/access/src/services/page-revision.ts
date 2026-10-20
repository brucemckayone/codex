/**
 * A journey page's revision, for the builder's saves (Codex-61zsk.18).
 *
 * A builder save sends the WHOLE page, so two devices editing one page would
 * each write their copy over the other's. The builder reads a revision with
 * the page and sends it back with each save, and the save is refused (412)
 * when the stored page has moved on since; the editor then stops saving and
 * says to reload.
 *
 * WHY A FINGERPRINT, not `updated_at`: every write to the row stamps
 * `updated_at`, the builder's own included. One builder save also writes the
 * page's offer (`updateJourneyOffer`), and the studio's list features a page
 * (`setJourneyFeatured`); neither touches what a page save writes, but each
 * moves `updated_at`, so a check on it would refuse the builder's next
 * autosave after its own price change. The revision is a digest of exactly
 * the columns a page save writes, so it moves when, and only when, another
 * page save could be overwritten. No column, so no migration.
 */

/** The columns `saveJourneyPage` writes: what another page save can lose. */
export interface RevisionedPage {
  slug: string;
  title: string;
  status: string;
  brandOverrides: unknown;
  sections: unknown;
  design: unknown;
  seo: unknown;
}

/**
 * JSON with every object's keys sorted, so that two reads of one row agree
 * whatever order a driver hands `jsonb` keys back in (the builder's read and
 * the save's transaction run on different clients).
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const fields = Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The page's revision: 128 bits of SHA-256 over its saved columns, in hex. */
export async function pageRevision(page: RevisionedPage): Promise<string> {
  const text = canonical([
    page.slug,
    page.title,
    page.status,
    page.brandOverrides ?? null,
    page.sections ?? [],
    page.design ?? null,
    page.seo ?? null,
  ]);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
