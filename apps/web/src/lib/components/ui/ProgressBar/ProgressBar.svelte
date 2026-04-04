<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    value: number;
    max?: number;
    variant?: 'default' | 'success' | 'brand';
    size?: 'sm' | 'md';
  }

  const {
    value,
    max = 100,
    variant = 'default',
    size = 'sm',
    class: className,
    ...restProps
  }: Props = $props();

  const percent = $derived(Math.min(100, Math.max(0, (value / max) * 100)));
</script>

<div
  class="progress-bar {className ?? ''}"
  data-variant={variant}
  data-size={size}
  role="progressbar"
  aria-valuenow={value}
  aria-valuemin={0}
  aria-valuemax={max}
  {...restProps}
>
  <div class="progress-bar__fill" style="width: {percent}%"></div>
</div>

<style>
  .progress-bar {
    width: 100%;
    background-color: var(--color-surface-tertiary);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .progress-bar[data-size="sm"] {
    height: var(--space-1);
  }

  .progress-bar[data-size="md"] {
    height: var(--space-2);
  }

  .progress-bar__fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width var(--duration-slow) var(--ease-default);
  }

  .progress-bar[data-variant="default"] .progress-bar__fill {
    background-color: var(--color-interactive);
  }

  .progress-bar[data-variant="success"] .progress-bar__fill {
    background-color: var(--color-success);
  }

  .progress-bar[data-variant="brand"] .progress-bar__fill {
    background-color: var(--color-brand-primary);
  }
</style>
