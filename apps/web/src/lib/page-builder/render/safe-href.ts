/**
 * URL scheme guard for USER-AUTHORED links rendered on the public journey pages
 * (Codex-isr02 · review M1).
 *
 * Section props (`landing_pages.sections`) are creator-authored jsonb that the
 * public sales page renders verbatim. Svelte does NOT sanitise `href`, so a
 * persisted `javascript:` URL in a CTA is stored-XSS against every visitor who
 * clicks it (orgs are self-serve, so a low-trust actor can author one). This
 * collapses any href to a safe navigation target: an allowlist of `http`/`https`/
 * `mailto` schemes, plus scheme-less (relative / anchor / protocol-relative)
 * URLs; everything else (`javascript:`, `data:`, `vbscript:`, `blob:`, `file:`,
 * …) becomes `#`.
 */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

export function safeHref(href: string | null | undefined): string {
  if (!href) return '#';
  const trimmed = href.trim();
  if (!trimmed) return '#';

  // Detect the scheme on a control-char-STRIPPED copy: browsers strip C0
  // controls, spaces and DEL when parsing a URL scheme, so `java\tscript:…`
  // navigates as `javascript:…` — the guard must see the same normalised form.
  const normalised = Array.from(trimmed)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x20 && code !== 0x7f;
    })
    .join('');

  const scheme = normalised
    .match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1]
    ?.toLowerCase();

  // No scheme → relative / anchor / protocol-relative → a safe navigation.
  if (!scheme) return trimmed;
  if (SAFE_SCHEMES.has(scheme)) return trimmed;

  // Reject every executable / data scheme.
  return '#';
}
