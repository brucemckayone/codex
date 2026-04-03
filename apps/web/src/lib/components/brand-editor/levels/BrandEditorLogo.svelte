<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import Button from '$lib/components/ui/Button/Button.svelte';

  // Logo upload reuses the existing LogoUpload component via slot/snippet.
  // This Level 1 view provides the frame: preview + upload/delete actions.

  const logoUrl = $derived(brandEditor.pending?.logoUrl ?? null);
</script>

<div class="logo-level">
  <div class="logo-level__preview" style="background-color: {brandEditor.pending?.backgroundColor ?? 'var(--color-surface)'}">
    {#if logoUrl}
      <img src={logoUrl} alt="Organization logo" class="logo-level__image" />
    {:else}
      <div class="logo-level__placeholder">
        <span>No logo uploaded</span>
      </div>
    {/if}
  </div>

  <div class="logo-level__actions">
    <Button variant="secondary" size="sm">
      Upload Logo
    </Button>
    {#if logoUrl}
      <Button variant="ghost" size="sm" onclick={() => brandEditor.updateField('logoUrl', null)}>
        Remove
      </Button>
    {/if}
  </div>

  <p class="logo-level__hint">
    PNG, SVG, or WebP. Max 2MB. Recommended: 400 x 100px.
  </p>
</div>

<style>
  .logo-level {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .logo-level__preview {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 120px;
    border-radius: var(--radius-lg);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    padding: var(--space-6);
  }

  .logo-level__image {
    max-width: 100%;
    max-height: 80px;
    object-fit: contain;
  }

  .logo-level__placeholder {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .logo-level__actions {
    display: flex;
    gap: var(--space-2);
  }

  .logo-level__hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
