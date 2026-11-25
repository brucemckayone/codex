/**
 * Where each card style's stylesheet is served (Codex-7104r).
 *
 * Each `lib/styles/card-styles/<id>.css` is its own emitted, hashed asset
 * (`?url`): the org layout links ONLY the style the org uses, so a page pays
 * for one style, not twenty. The brand editor's picker links them all while it
 * is open. `base.css` (the structural floor every style needs) is not here:
 * StyledCard imports it, so it ships with the component.
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

/** Every style's stylesheet URL (the brand editor's picker shows them all). */
export function allCardStyleHrefs(): string[] {
  return [...BY_STYLE.values()];
}
