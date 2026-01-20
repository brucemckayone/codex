<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
  }

  const { children, class: className, ...restProps }: Props = $props();
</script>

<div class="dialog-footer {className}" {...restProps}>
  {@render children()}
</div>

<style>
  .dialog-footer {
    display: flex;
    flex-direction: column-reverse;
    gap: var(--space-2);
  }

  @media (min-width: 640px) {
    .dialog-footer {
      flex-direction: row;
      justify-content: flex-end;
    }
  }
</style>
