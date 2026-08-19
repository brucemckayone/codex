<!--
  @component ActionLink

  A NAVIGATION action that looks like a `Button`.

  Why this exists rather than `<a><Button/></a>`: a `<button>` is interactive
  content, and interactive content may not be a descendant of `<a>`. The nested
  form parses into two focusable elements for one action — keyboard users tab
  through it twice and screen readers announce a link containing a button. Five
  studio empty states currently ship that nesting; these pages stop doing it.

  The systemic fix is an `href` prop on `ui/Button` itself (rendering
  `<svelte:element>`), which is out of bounds this round — hence a local
  component that mirrors Button's variant/size contract exactly, consuming the
  same tokens so the two cannot drift in colour. Keep the two in step: if
  `Button` gains `href`, delete this and migrate the call sites.

  @prop {string} href - Destination.
  @prop {'primary'|'secondary'|'ghost'} [variant='primary'] - Matches Button.
  @prop {'sm'|'md'} [size='md'] - Matches Button.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';

  interface Props extends HTMLAnchorAttributes {
    href: string;
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md';
    children: Snippet;
  }

  const {
    href,
    variant = 'primary',
    size = 'md',
    children,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<a
  {href}
  class="action-link {className ?? ''}"
  data-variant={variant}
  data-size={size}
  {...restProps}
>
  {@render children()}
</a>

<style>
  /* Mirrors `ui/Button`'s base + variant rules token-for-token. */
  .action-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-family: var(--font-sans);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) transparent;
    transition: var(--transition-colors), var(--transition-shadow);
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
  }

  .action-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .action-link[data-size='sm'] {
    height: var(--space-8);
    padding-inline: var(--space-3);
    font-size: var(--text-sm);
  }

  .action-link[data-size='md'] {
    height: var(--space-10);
    padding-inline: var(--space-4);
    font-size: var(--text-base);
  }

  /* `--color-on-interactive`, not `--color-text-inverse` — the ink has to
     contrast with the brand fill it sits on, not with the page. Same reasoning
     as Button's primary variant. */
  .action-link[data-variant='primary'] {
    background-color: var(--color-interactive);
    color: var(--color-on-interactive);
    border: none;
  }

  .action-link[data-variant='primary']:hover {
    background-color: var(--color-interactive-hover);
  }

  .action-link[data-variant='secondary'] {
    background-color: var(--color-surface);
    color: var(--color-text);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .action-link[data-variant='secondary']:hover {
    background-color: var(--color-surface-secondary);
  }

  .action-link[data-variant='ghost'] {
    background-color: transparent;
    color: var(--color-text);
    border: none;
  }

  .action-link[data-variant='ghost']:hover {
    background-color: var(--color-surface-secondary);
  }
</style>
