<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    loading?: boolean;
    children: Snippet;
  }

  const {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    children,
    ...restProps
  }: Props = $props();
</script>

<button
  disabled={disabled || loading}
  aria-busy={loading}
  {...restProps}
>
  {#if loading}
    <span>...</span>
  {/if}
  {@render children()}
</button>

