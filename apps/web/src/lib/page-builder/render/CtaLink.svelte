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
</script>

<a
  {href}
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
