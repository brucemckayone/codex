<!--
  @component ThumbnailUpload

  Thumbnail preview zone with auto-extract from media or URL input fallback.

  @prop {ContentForm} form - The active form instance
  @prop {string | null} [mediaThumbnailUrl] - Auto-extracted thumbnail URL from media
-->
<script lang="ts">
  import { ImageIcon } from '$lib/components/ui/Icon';
  import { Button } from '$lib/components/ui';
  import type { createContentForm, updateContentForm } from '$lib/remote/content.remote';

  type ContentForm = typeof createContentForm | typeof updateContentForm;

  interface Props {
    form: ContentForm;
    mediaThumbnailUrl?: string | null;
  }

  const { form, mediaThumbnailUrl = null }: Props = $props();

  let showUrlInput = $state(false);
  const thumbnailValue = $derived(form.fields.thumbnailUrl?.value() ?? '');
  const hasCustomThumbnail = $derived(!!thumbnailValue);

  function useMediaThumbnail() {
    if (mediaThumbnailUrl) {
      form.fields.thumbnailUrl.set(mediaThumbnailUrl);
    }
  }

  function clearThumbnail() {
    form.fields.thumbnailUrl.set('');
    showUrlInput = false;
  }
</script>

<section class="form-card">
  <h3 class="card-title">Thumbnail</h3>

  <div class="thumbnail-zone">
    {#if hasCustomThumbnail}
      <div class="thumbnail-preview">
        <img src={thumbnailValue} alt="Content thumbnail" class="thumbnail-image" />
        <div class="thumbnail-overlay">
          <button type="button" class="overlay-btn" onclick={() => (showUrlInput = true)}>
            Change
          </button>
          <button type="button" class="overlay-btn overlay-btn-danger" onclick={clearThumbnail}>
            Remove
          </button>
        </div>
      </div>
    {:else}
      <div class="thumbnail-placeholder">
        <ImageIcon size={32} />
        <span class="placeholder-text">No thumbnail set</span>
        <div class="placeholder-actions">
          {#if mediaThumbnailUrl}
            <Button type="button" variant="primary" size="sm" onclick={useMediaThumbnail}>
              Use media thumbnail
            </Button>
          {/if}
          <Button type="button" variant="ghost" size="sm" onclick={() => (showUrlInput = true)}>
            Enter URL
          </Button>
        </div>
      </div>
    {/if}
  </div>

  {#if showUrlInput}
    <div class="url-input-row">
      <input
        {...form.fields.thumbnailUrl.as('text')}
        id="thumbnailUrl"
        class="field-input"
        placeholder="https://example.com/thumbnail.jpg"
      />
      <Button type="button" variant="primary" size="sm" onclick={() => (showUrlInput = false)}>
        Done
      </Button>
    </div>
  {/if}
</section>

<style>
  .form-card {
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .card-title {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-4) 0;
  }

  .thumbnail-zone {
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    position: relative;
  }

  .thumbnail-preview {
    width: 100%;
    height: 100%;
    position: relative;
  }

  .thumbnail-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumbnail-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    background: var(--color-surface-overlay);
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-default);
  }

  .thumbnail-preview:hover .thumbnail-overlay {
    opacity: 1;
  }

  .overlay-btn {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border: var(--border-width) var(--border-style) color-mix(in srgb, white 50%, transparent);
    background: color-mix(in srgb, black 40%, transparent);
    color: var(--color-text-inverse);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .overlay-btn:hover {
    background: color-mix(in srgb, black 60%, transparent);
    border-color: var(--color-text-inverse);
  }

  .overlay-btn-danger:hover {
    background: var(--color-error-500);
    border-color: var(--color-error-500);
  }

  .thumbnail-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border: var(--border-width-thick) dashed var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
  }

  .placeholder-text {
    font-size: var(--text-sm);
  }

  .placeholder-actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  .url-input-row {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .url-input-row :global(.field-input) {
    flex: 1;
  }

</style>
