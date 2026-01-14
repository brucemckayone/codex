<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
  }

  const { class: className, ...restProps }: Props = $props();
</script>

<div class="skeleton {className}" {...restProps}></div>

<style>
  .skeleton {
    background-color: var(--color-neutral-200); /* Use specific token? */
    border-radius: var(--radius-md);
    animation: skeleton-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  /* Dark mode adjustment if not handled by neutral token */
  :global([data-theme="dark"]) .skeleton {
    background-color: var(--color-neutral-800);
  }

  @keyframes skeleton-pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
</style>
