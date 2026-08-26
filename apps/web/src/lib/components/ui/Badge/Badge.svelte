<!--
  @component Badge

  Small non-interactive status/label pill. This IS the studio's status pill —
  `payouts/+page.svelte` and `sales/+page.svelte` both render their row status
  through it, so there is no separate pill implementation.

  Status variants read `styles/themes/status.css`, which derives each surface
  from the page's own `--color-surface` / `--color-border` / `--color-text`.
  `accent` stays on the brand tokens (declared at `:root` in both themes, so
  system-scope safe).

  Sized as a quiet chip: half-step padding + medium weight. It renders a
  non-interactive `<div>`, so WCAG 2.5.8 target size does not apply.

  @prop {'neutral'|'success'|'warning'|'error'|'info'|'accent'} [variant='neutral']
  @prop {Snippet} children - Label content
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
    variant?: 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'accent';
  }

  const { children, variant = 'neutral', class: className, ...restProps }: Props = $props();
</script>

<div class="badge {className ?? ''}" data-variant={variant} {...restProps}>
  {@render children()}
</div>

<style>
  .badge {
    /* Seeded with the neutral triple to match the `variant = 'neutral'` prop
       default, so an unrecognised data-variant still renders as a chip. */
    --_surface: var(--color-surface-secondary);
    --_border: var(--color-border);
    --_text: var(--color-text);

    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-full);
    padding: var(--space-1-5) var(--space-2-5);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    line-height: var(--leading-none);
    transition: var(--transition-colors);
    white-space: nowrap;
    background-color: var(--_surface);
    border: var(--border-width) var(--border-style) var(--_border);
    color: var(--_text);
  }

  .badge[data-variant='neutral'] {
    --_surface: var(--color-surface-secondary);
    --_border: var(--color-border);
    --_text: var(--color-text);
  }

  .badge[data-variant='success'] {
    --_surface: var(--color-status-success-surface);
    --_border: var(--color-status-success-border);
    --_text: var(--color-status-success-text);
  }

  .badge[data-variant='warning'] {
    --_surface: var(--color-status-warning-surface);
    --_border: var(--color-status-warning-border);
    --_text: var(--color-status-warning-text);
  }

  .badge[data-variant='error'] {
    --_surface: var(--color-status-error-surface);
    --_border: var(--color-status-error-border);
    --_text: var(--color-status-error-text);
  }

  .badge[data-variant='info'] {
    --_surface: var(--color-status-info-surface);
    --_border: var(--color-status-info-border);
    --_text: var(--color-status-info-text);
  }

  .badge[data-variant='accent'] {
    --_surface: var(--color-brand-accent-subtle);
    --_border: var(--color-brand-accent);
    --_text: var(--color-brand-accent);
  }
</style>
