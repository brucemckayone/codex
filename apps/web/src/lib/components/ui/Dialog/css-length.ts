type LengthUnit =
  | 'px'
  | 'rem'
  | 'em'
  | 'ch'
  | '%'
  | 'vw'
  | 'vh'
  | 'dvw'
  | 'dvh'
  | 'svw'
  | 'svh'
  | 'lvw'
  | 'lvh'
  | 'vmin'
  | 'vmax'
  | 'cqw'
  | 'cqh'
  | 'cqi'
  | 'cqb';

type MathFunction = 'calc' | 'min' | 'max' | 'clamp';

/**
 * What Dialog.Content's `maxWidth` and `maxHeight` take: a number with its
 * unit, a math function or a token, never a keyword or a bare number. The
 * panel clamps `maxHeight` inside `min()`, where `none`, `auto` or `90` is
 * invalid: the whole value fell away, the panel lost its cap and the Footer
 * went off screen (Codex-vlphc review G3-M1). `maxWidth` takes the same, so
 * neither can drop its cap.
 *
 * In a .ts module, not the component: `tsc` sees only a .svelte file's
 * default export.
 */
export type CssLength =
  | `${number}${LengthUnit}`
  | `${MathFunction}(${string})`
  | `var(--${string})`;
