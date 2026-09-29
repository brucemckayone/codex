# 02 — Kit foundation decisions (WP-2, recorded 2026-09-26)

The design lead's final values for the page kit. **Binding alongside `01-contract.md`**: later WPs
build on these, and any change is appended to `01-contract.md` §10. The source of truth is the code
(`apps/web/src/lib/page-builder/kit/`); this page is the map.

## Type scale (`kit/styles/kit.css`, per-Style overrides in `style-*.css`)

Every size is `calc(clamp(…) * var(--lp-scale))`; `cqi` is relative to the section container.

| Token | Base (all Styles) | Bold |
|---|---|---|
| display | per Style (below) | `clamp(3.25rem, .5rem + 9.6cqi, 8.5rem)` |
| lead | `clamp(1.25rem, 1.05rem + .5cqi, 1.5rem)` | `clamp(1.25rem, 1.05rem + .75cqi, 1.625rem)` |
| body | `clamp(1.125rem, 1.05rem + .2cqi, 1.25rem)` | `clamp(1.125rem, 1rem + .35cqi, 1.3125rem)` |
| small | `clamp(1rem, .96rem + .1cqi, 1.0625rem)` | base |
| label | `clamp(.9375rem, .9rem + .08cqi, 1rem)` | base |

Display: Clean `clamp(2.5rem, .9rem + 5.6cqi, 5.5rem)` · Soft `clamp(2.4rem, 1rem + 4.6cqi, 4.75rem)` ·
Cinematic `clamp(2.6rem, .8rem + 7.4cqi, 7rem)`. Leading display/heading: Bold .9/.95 · Clean
1.02/1.08 · Soft 1.08/1.12 · Cinematic .98/1.02. Measured at 1440: lead 26px (Bold) / 23.7px; body
20.8 / 19.6px; the smallest text on a page is 15.5px.

**Rules every block follows:** a section's intro paragraph is `Text size="lead"`; body copy and
lists use `--lp-size-body`; nothing goes below `--lp-size-label`; supporting text is quiet by
colour (`--lp-ink-soft`) and weight, never by being tiny.

## Shape and rhythm (base; Styles override)

Container 76rem (Bold 82, Clean 74, Soft 68) · measure 62ch · lead measure 44ch (Bold 36, Clean 42,
Soft 40). Radii card/media/button: base lg/lg/md · Bold none/none/none · Clean lg/lg/md · Soft
max(xl, space-6)/max(xl, space-8)/full · Cinematic lg/md/full. Section padding: compact
`clamp(space-10, space-6 + 3cqi, space-16)`, regular `clamp(space-16, space-8 + 5cqi, space-24)`,
spacious `clamp(space-20, space-10 + 8cqi, space-32)`.

## Colour schemes (`kit/styles/schemes.css`)

- Two poles. Light is `.lp`'s default; the dark pole applies under the org dark theme, under a scoped
  `[data-editing-theme='dark']` / `.lp[data-lp-theme='dark']` preview, and ALWAYS for Cinematic.
- Inputs: `--lp-brand` (brand colour; dark pole prefers `--brand-color-dark`), `--lp-brand-2`
  (secondary), the light/dark ground from `--brand-bg` / `--brand-bg-dark`.
- Surfaces per pole (ground, soft, contrast, panel, inverse panel, scrim) are OKLCH recipes with
  clamped lightness and capped chroma — see the file header.
- **Ink is computed per section from its own `--lp-bg`** via relative luminance in linear light
  (light/dark ink chosen at Y = .1791; tonal targets ink 17:1, ink-soft 7:1, button-line 3.2:1,
  line 1.45:1). Accent and button fills are brand-targeted to a luminance band so they stay legible.
- Schemes: `base` (ground), `soft`, `contrast` (inverse pole), `brand` and `accent` (brand /
  secondary fill, ink as accent, ink button with a brand label), plus internal `on-media` (scrim).
- A fallback without `pow()` in relative colour exists (lightness steps + mixes); Chrome is the
  audited engine.
- Measured: 40 configurations (4 Styles × 5 brands × 2 themes), 660 scheme elements, 0 failures;
  worst text/focus 4.70:1, button vs band 3.75:1.

## Defaults per Style (`kit/model/styles.ts`) — layout / scheme

| Section | Bold | Clean | Soft | Cinematic |
|---|---|---|---|---|
| hero | statement / brand | split / base | centered / soft | cover / base |
| video | theatre / base | split / soft | theatre / base | theatre / soft |
| problem | statement / contrast | list / base | split / soft | statement / base |
| text | statement / base | columns / soft | centered / base | statement / base |
| transformation | columns / contrast | steps / base | columns / soft | statement / soft |
| benefits | checklist / base | grid / soft | grid / base | split / base |
| curriculum | timeline / base | accordion / base | cards / soft | timeline / soft |
| preview | feature / contrast | split / soft | split / base | feature / base |
| instructor | split / base | split / base | centered / soft | quote / soft |
| testimonials | featured / base | grid / soft | grid / base | quote / base |
| stats | row / brand | grid / base | grid / soft | row / soft |
| pricing | focus / base | cards / soft | cards / base | focus / base |
| faq | columns / base | accordion / base | accordion / soft | accordion / soft |
| cta | band / brand | split / contrast | band / brand | band / base |

Invariant (enforced by `catalog.test.ts`): no `brand` band sits next to a `contrast` band.
Starter pages per Style live in `template.ts`.

## Behaviour

- `resolveSpacing(design, layout)`: a `compact` layout defaults to compact spacing unless chosen. The
  editor's spacing control must show the RESOLVED value.
- At container ≤ 30rem every CTA fills its cell; `ButtonRow` owns alignment via `--lp-actions-align`.
- The theme preview is scoped to `.lp[data-lp-theme]` (mirrors `[data-editing-theme]`), never `<html>`.
- `.lp-page` is the query container (not `.lp`); `StickyCta` is its sibling so `position: fixed`
  pins to the viewport. Page brand overrides sit on a nested `[data-org-brand]`; override fonts load
  in `<svelte:head>`.
- One hero entrance per Style, gated on `:root[data-theme]` + `prefers-reduced-motion:
  no-preference` + `.lp:not([data-lp-still])`, so no-JS and reduced motion render the final state.

## Open items routed to later WPs

- WP-6: `render/editable.ts` imports the legacy catalogue (wrong labels in the public bundle) —
  drop the import; set `--lp-nav-clearance` if the org mobile nav isn't `--space-16`; hero media
  arrives on the streamed `sellPreview`, so it's absent from first-paint HTML (LCP) — consider
  awaiting the hero still; add the page-image CDN base (`R2_PUBLIC_URL_BASE`) to the page envelope and
  `JourneySalesContext` so blocks can call `resolvePageImageUrl`.
- WP-7b: never re-render a focused multi-paragraph contenteditable from the store (paragraphs commit
  joined with `\n\n`); publish validation uses `validateKitShape` (not the legacy
  `validatePageShape`).
- WP-11: the gallery route's literal `http://localhost:4100` (dev tool; `SERVICE_PORTS` has no
  dev-cdn entry despite CLAUDE.md's table); the enrolled pricing panel's title is a `<p>`; Cinematic's
  adjacent base bands (preview + text) merge — review; no Lighthouse run yet; non-Chrome engines.
