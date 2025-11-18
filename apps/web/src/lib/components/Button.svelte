<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'primary' | 'secondary';
    disabled?: boolean;
    onclick?: () => void;
    children?: Snippet;
  }

  const {
    // biome-ignore lint/correctness/noUnusedVariables: used in template
    variant = 'primary',
    // biome-ignore lint/correctness/noUnusedVariables: used in template
    disabled = false,
    // biome-ignore lint/correctness/noUnusedVariables: used in template
    onclick,
    // biome-ignore lint/correctness/noUnusedVariables: used in template
    children,
  }: Props = $props();
</script>

<button class="btn btn-{variant}" disabled={disabled} onclick={onclick}>
  {@render children?.()}
</button>

<style>
  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
    font-size: 1rem;
  }

  .btn-primary {
    background-color: #007bff;
    color: white;
  }

  .btn-secondary {
    background-color: #6c757d;
    color: white;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
