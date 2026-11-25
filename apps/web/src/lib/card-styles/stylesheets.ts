/**
 * Where each card style's stylesheet is served (Codex-7104r).
 *
 * Each `lib/styles/card-styles/<id>.css` is its own emitted, hashed asset
 * (`?url`): the org layout links ONLY the style the org uses, so a page pays
 * for one style, not twenty. The brand editor's picker links them all while it
 * is open. `base.css` (the structural floor every style needs) is not here:
 * StyledCard imports it, so it ships with the component.
 *
 * Vite runs a `?url` stylesheet through the CSS pipeline (minified, comments
 * gone) and always emits it as its own file: checked on Vite 6.4, even a 1 MB
 * `assetsInlineLimit` never turns one into a `data:` URL, which the CSP's
 * `style-src 'self'` would block.
 *
 * The server and client builds each emit a copy under a different hash (the
 * client's lowers `inset` for its browser targets), and both land in the
 * client output. That is harmless: hydrating a `<link>`, Svelte keeps the
 * server's `href` (attributes.js skips `href` on LINK), so an SSR'd page
 * never re-fetches; only a live change in the editor loads the client copy.
 */
import type { CardStyle } from '@codex/validation';

const URLS = import.meta.glob<string>(
  ['../styles/card-styles/*.css', '!../styles/card-styles/base.css'],
  { query: '?url', import: 'default', eager: true }
);

const BY_STYLE = new Map(
  Object.entries(URLS).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1, -'.css'.length),
    url,
  ])
);

/** The stylesheet URL for `style`; none for 'today' (the platform's own). */
export function cardStyleHref(style: CardStyle): string | undefined {
  return style === 'today' ? undefined : BY_STYLE.get(style);
}

/** Every style's stylesheet (the brand editor's picker shows them all). */
export function allCardStyleLinks(): { style: string; href: string }[] {
  return [...BY_STYLE].map(([style, href]) => ({ style, href }));
}
