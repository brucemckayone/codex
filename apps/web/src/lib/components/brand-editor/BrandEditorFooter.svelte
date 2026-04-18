<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import Button from '$lib/components/ui/Button/Button.svelte';

  interface Props {
    onsave?: () => void;
    saving?: boolean;
  }

  const { onsave, saving = false }: Props = $props();
</script>

<div class="editor-footer">
  <Button
    variant="ghost"
    size="sm"
    disabled={!brandEditor.isDirty}
    onclick={() => brandEditor.discard()}
  >
    Reset
  </Button>

  <div class="editor-footer__right">
    {#if brandEditor.isDirty}
      <span class="editor-footer__dot" aria-hidden="true"></span>
      <span class="editor-footer__hint">Unsaved</span>
    {/if}

    <Button
      variant="primary"
      size="sm"
      disabled={!brandEditor.isDirty || saving}
      loading={saving}
      onclick={() => onsave?.()}
    >
      Save
    </Button>
  </div>
</div>

<style>
  .editor-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .editor-footer__right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .editor-footer__dot {
    width: var(--space-1-5);
    height: var(--space-1-5);
    border-radius: var(--radius-full);
    background-color: var(--color-brand-accent);
  }

  .editor-footer__hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
