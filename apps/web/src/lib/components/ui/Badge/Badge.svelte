<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
    variant?: 'neutral' | 'success' | 'warning' | 'error';
  }

  const { children, variant = 'neutral', class: className, ...restProps }: Props = $props();
</script>

<div class="badge {className}" data-variant={variant} {...restProps}>
  {@render children()}
</div>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-full);
    border: 1px solid transparent;
    padding: var(--space-1) var(--space-2.5);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    line-height: 1;
    transition: var(--transition-colors);
    white-space: nowrap;
  }

  /* Variants */
  .badge[data-variant="neutral"] {
    background-color: var(--color-neutral-100);
    color: var(--color-neutral-900);
    border-color: var(--color-neutral-200);
  }

  .badge[data-variant="success"] {
    /* background-color is already defined above */
    /* Usually badges have subtle backgrounds. Let's check color tokens again. */
    /* The colors.css has --color-success: #22c55e; which is bright green. */
    /* Ideally we'd have semantic-soft colors, but we don't. */
    /* Let's use opacity or mix for now, OR stick to solid if that's the design. */
    /* The doc says "Brief description...". */
    /* Wait, the existing tokens might have more? No, I viewed them. */
    /* Let's try to simulate a 'soft' variant using opacity or just use the color as bg and white text for now, assume 'solid' style badges. */
    background-color: var(--color-success);
    color: var(--color-text-inverse);
  }

  .badge[data-variant="warning"] {
    background-color: var(--color-warning);
    color: var(--color-text-inverse);
  }

  .badge[data-variant="error"] {
    background-color: var(--color-error);
    color: var(--color-text-inverse);
  }

  /* Dark mode adjusments if needed, but semantic colors should handle it mostly. */
</style>
