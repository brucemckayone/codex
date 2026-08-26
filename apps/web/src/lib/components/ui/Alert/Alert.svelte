<!--
  @component Alert

  Inline status message. Renders on org surfaces (studio, checkout) AND outside
  `.org-layout` (auth pages, `(platform)/account/*`, root `+error.svelte`), so
  every token it consumes is `:root`-guaranteed — the status colours come from
  `styles/themes/status.css`, which derives them from the page's own surface,
  border and ink rather than from fixed palette tints.

  `role` is derived from the variant: `error` → `alert` (implies
  `aria-live="assertive"`), everything else → `status` (implies
  `aria-live="polite"`). `{...restProps}` is spread LAST on purpose so a caller
  rendering persistent page furniture can opt out with `role="presentation"`.

  @prop {'error'|'success'|'info'|'warning'} [variant='error'] - Status treatment
  @prop {Snippet} children - Message content
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    variant?: 'error' | 'success' | 'info' | 'warning';
    children: Snippet;
  }

  const { variant = 'error', children, class: className, ...restProps }: Props = $props();
</script>

<div
  class="alert {className ?? ''}"
  data-variant={variant}
  role={variant === 'error' ? 'alert' : 'status'}
  {...restProps}
>
  {@render children()}
</div>

<style>
  .alert {
    /* Seeded with the error triple to match the `variant = 'error'` prop
       default, so an unrecognised data-variant can never render unstyled. */
    --_surface: var(--color-status-error-surface);
    --_border: var(--color-status-error-border);
    --_text: var(--color-status-error-text);

    padding: var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    background-color: var(--_surface);
    border: var(--border-width) var(--border-style) var(--_border);
    color: var(--_text);
  }

  .alert[data-variant='error'] {
    --_surface: var(--color-status-error-surface);
    --_border: var(--color-status-error-border);
    --_text: var(--color-status-error-text);
  }

  .alert[data-variant='success'] {
    --_surface: var(--color-status-success-surface);
    --_border: var(--color-status-success-border);
    --_text: var(--color-status-success-text);
  }

  .alert[data-variant='warning'] {
    --_surface: var(--color-status-warning-surface);
    --_border: var(--color-status-warning-border);
    --_text: var(--color-status-warning-text);
  }

  .alert[data-variant='info'] {
    --_surface: var(--color-status-info-surface);
    --_border: var(--color-status-info-border);
    --_text: var(--color-status-info-text);
  }
</style>
