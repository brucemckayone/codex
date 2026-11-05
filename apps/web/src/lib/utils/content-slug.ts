/**
 * A content URL slug from a title (Codex-a6ofh.2.2).
 *
 * The content slug schema accepts only lowercase ASCII words joined by single
 * hyphens (`createSlugSchema` in @codex/validation), so accents are folded
 * rather than dropped: "Café notes" gives "cafe-notes", not "caf-notes". A
 * title with nothing left (only emoji or punctuation, or a script with no
 * Latin letters) gives `fallback`.
 *
 * Not `slugify` from @codex/validation: that one keeps every Unicode letter,
 * which suits category slugs, and a content slug cannot hold them.
 */
const MAX_SLUG_LENGTH = 80;

export function contentSlugFromTitle(title: string, fallback: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  return slug || fallback;
}
