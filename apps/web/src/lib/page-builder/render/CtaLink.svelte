<!--
  @component CtaLink

  Token-driven call-to-action ANCHOR for the public journey sales page. The
  shared `ui/Button` renders a `<button>`; a sales-page CTA is a navigation
  (to the checkout surface), so it must be an `<a>` for correct semantics and
  right-click / open-in-new-tab behaviour. This mirrors Button's visual language
  in tokens only, with the mandatory `:focus-visible` ring (R14).

  Consumes semantic `--color-*` tokens only — NEVER raw `--brand-*` — so it
  re-themes with the org brand and any per-page brandOverrides automatically.

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

  .cta[data-variant='primary'] {
    background: var(--color-brand-primary);
    color: var(--color-text-on-brand);
  }

  .cta[data-variant='primary']:hover {
    background: var(--color-brand-primary-hover);
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
