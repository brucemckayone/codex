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

/** The numbered tries a taken slug gets, before one with a random suffix. */
const NUMBERED_TRIES = ['2', '3', '4', '5'];
const RANDOM_SUFFIX_LENGTH = 6;

/**
 * The slugs a slug made from a title is tried as, in order, while another
 * piece holds it (Codex-a6ofh.2.4): itself, `-2` to `-5`, then once with a
 * random suffix. The last refusal is the creator's.
 */
export function freeSlugCandidates(base: string): string[] {
  return [
    base,
    ...NUMBERED_TRIES.map((n) => `${base}-${n}`),
    `${base}-${crypto.randomUUID().slice(0, RANDOM_SUFFIX_LENGTH)}`,
  ];
}

/**
 * The slug is the one this title gives, or that one made free with a
 * number ({@link freeSlugCandidates}): a slug no one typed. Not the random
 * suffix: six hex digits are also a date or a code a creator types
 * (`report-202411`), and one taken for the title's would be lost to the next
 * title edit. A piece that needed one keeps its slug, as a typed one is.
 */
export function isTitleSlug(
  slug: string,
  title: string,
  fallback: string
): boolean {
  const base = contentSlugFromTitle(title, fallback);
  if (slug === base) return true;
  if (!slug.startsWith(`${base}-`)) return false;
  const suffix = slug.slice(base.length + 1);
  return NUMBERED_TRIES.includes(suffix);
}
