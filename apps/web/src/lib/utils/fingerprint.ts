/**
 * A short fingerprint of a JSON value, for telling whether a crash-recovery
 * draft was edited from the saved copy the server holds now. The page editor
 * and the brand editor both keep one (Codex-0keaj). Each normalises its value
 * the way the server hands it back before fingerprinting it, so a copy the tab
 * saved matches its own next load.
 *
 * Pure: no runes, no DOM, no `$lib/components` import, so the public-bundle
 * stores (`$lib/page-builder`, `$lib/brand-editor`) can use it.
 */

/** JSON with every object's keys sorted, because jsonb does not keep order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) {
      return inner;
    }
    const bag = inner as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(bag)
        .sort()
        .map((key) => [key, bag[key]])
    );
  });
}

/** A 53-bit string hash (cyrb53): a short fingerprint, not a security check. */
export function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
