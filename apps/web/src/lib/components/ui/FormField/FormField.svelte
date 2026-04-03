<script lang="ts">
  import type { Snippet } from 'svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';

  interface Props {
    label: string;
    id: string;
    error?: string | null;
    help?: string | null;
    children: Snippet;
  }

  const { label, id, error, help, children }: Props = $props();
</script>

<div class="form-field">
  <Label for={id}>{label}</Label>
  {@render children()}
  {#if error}
    <p class="form-field__error">{error}</p>
  {/if}
  {#if help && !error}
    <p class="form-field__help">{help}</p>
  {/if}
</div>

<style>
  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .form-field__error {
    font-size: var(--text-xs);
    color: var(--color-error);
  }

  .form-field__help {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
