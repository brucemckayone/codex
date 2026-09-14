<!--
  @component CtaLink

  Token-driven call-to-action ANCHOR for the public journey sales page. The
  shared `ui/Button` renders a `<button>`; a sales-page CTA is a navigation
  (to the checkout surface), so it must be an `<a>` for correct semantics and
  right-click / open-in-new-tab behaviour. This mirrors Button's visual language
  in tokens only, with the mandatory `:focus-visible` ring (R14).

  Consumes semantic `--color-*` tokens only — NEVER raw `--brand-*` — so it
  re-themes with the org brand and any per-page brandOverrides automatically.
  The primary variant additionally reads the `--jp-cta-*` seam so the journey
  `accent` axis can restyle the pay button without any section repainting
  `.cta`, which `journey-design.test.ts` still forbids (`Codex-kdsuo`).

  @prop {string} href - Navigation target (absolute or app-relative URL)
  @prop {'primary' | 'secondary'} [variant='primary'] - Visual weight
  @prop {'md' | 'lg'} [size='lg'] - CTA size
  @prop {Snippet} children - Label content
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { safeHref } from './safe-href';

  interface Props extends HTMLAnchorAttributes {
    href: string;
    variant?: 'primary' | 'secondary';
    size?: 'md' | 'lg';
    children: Snippet;
  }

  const {
    href,
    variant = 'primary',
    size = 'lg',
    children,
    class: className,
    ...restProps
  }: Props = $props();

  // href is creator-authored (section props) and rendered on the PUBLIC page.
  // Svelte does not sanitise href, so guard the scheme (reject javascript:/data:
  // etc.) — see safe-href.ts (review M1, Codex-isr02).
  const guardedHref = $derived(safeHref(href));
</script>

<a
  href={guardedHref}
  class="cta {className ?? ''}"
  data-variant={variant}
  data-size={size}
  {...restProps}
>
  {@render children()}
</a>

<style>
  .cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-button);
    font-family: var(--font-body);
    font-weight: var(--font-semibold);
    line-height: var(--leading-none);
    text-decoration: none;
    text-align: center;
    cursor: pointer;
    /*
      WCAG 2.5.5 floor. Measured by the WT-3 pilot: `lg`'s content box came out
      40–41px at every density and every width — `--text-base` (16px) at
      `--leading-none` plus 2 × `--space-3` (12px) is 40px, and nothing declared a
      floor. `md` is smaller still. This affects every CTA on every journey
      section, which is why it belongs here rather than in one component.

      `--tap-target-min` is `max(2.75rem, var(--space-11))`, so an org whose
      `--brand-density` is under 1 cannot shrink the target below 44px — a floor a
      brand setting can lower is not a floor (contract A2). Padding still governs
      the resting size wherever it already clears the floor; this only ever makes
      the target larger.
    */
    min-height: var(--tap-target-min);
    transition:
      background-color var(--duration-fast) var(--ease-default),
      border-color var(--duration-fast) var(--ease-default),
      transform var(--duration-fast) var(--ease-default);
  }

  .cta[data-size='md'] {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
  }

  .cta[data-size='lg'] {
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-base);
  }

  /*
    The journey `accent` axis reaches the pay button through the `--jp-cta-*`
    seam (`journey-design.css`), which is why these are `var()`s with the
    org-brand pair as the FALLBACK rather than as the value.

    Outside a `.jp-sec` — `FloatingCta` is the case — nothing declares
    `--jp-cta-*`, so every fallback fires and this element paints exactly the
    brand pill it always has. Inside one, `accent: fill` and `accent: glow`
    resolve the seam back to that same pair, so four of the eight looks
    (including Candlelit) are byte-identical to before.

    Measured, at the point of the change (`Codex-4avmh`): the filled pair
    carries an exhaustive 4.58:1 floor for any brand hex; the outline values
    put 7.70–20.07 on the label and never less than 3.47:1 on the boundary.

    LONGHAND border properties only. The base `.cta` rule already set border
    width and style through the `border` shorthand; a `border-inline-start`
    shorthand here would re-assert both AND reset the other three edges'
    colour after `border-color` had set it.
  */
  .cta[data-variant='primary'] {
    background: var(--jp-cta-fill, var(--color-brand-primary));
    color: var(--jp-cta-ink, var(--color-text-on-brand));
    border-color: var(--jp-cta-border, transparent);
    border-inline-start-width: var(--jp-cta-stripe-width, var(--border-width));
    border-inline-start-color: var(
      --jp-cta-stripe,
      var(--jp-cta-border, transparent)
    );
  }

  .cta[data-variant='primary']:hover {
    background: var(--jp-cta-fill-hover, var(--color-brand-primary-hover));
  }

  .cta[data-variant='secondary'] {
    background: var(--color-surface);
    color: var(--color-text);
    border-color: var(--color-border-strong);
  }

  .cta[data-variant='secondary']:hover {
    border-color: var(--color-border-hover);
    background: var(--color-surface-secondary);
  }

  .cta:active {
    transform: translateY(1px);
  }

  .cta:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  @media (prefers-reduced-motion: reduce) {
    .cta {
      transition: none;
    }
    .cta:active {
      transform: none;
    }
  }
</style>
