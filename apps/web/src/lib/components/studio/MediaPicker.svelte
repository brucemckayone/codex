<!--
  @component MediaPicker

  Dropdown selector for attaching a media item to content.
  Shows ready media items with type badge and title.
  Allows clearing selection for content without media.

  @prop {Array} mediaItems - Available media items (status = 'ready')
  @prop {string | null} [value] - Currently selected media item ID
  @prop {(mediaItemId: string | null) => void} [onchange] - Selection callback
-->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface MediaItemOption {
    id: string;
    title: string;
    mediaType: string;
    durationSeconds?: number | null;
    fileSizeBytes?: number | null;
  }

  interface Props {
    mediaItems: MediaItemOption[];
    value?: string | null;
    onchange?: (mediaItemId: string | null) => void;
  }

  const { mediaItems = [], value = null, onchange }: Props = $props();

  function handleChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const selected = target.value || null;
    onchange?.(selected);
  }

  function formatDuration(seconds: number | null | undefined): string {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function formatSize(bytes: number | null | undefined): string {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<div class="media-picker">
  <label class="picker-label" for="media-select">
    Media
  </label>

  <select
    id="media-select"
    class="picker-select"
    value={value ?? ''}
    onchange={handleChange}
  >
    <option value="">No media attached</option>
    {#each mediaItems as item (item.id)}
      <option value={item.id}>
        [{item.mediaType}] {item.title}{#if item.durationSeconds} ({formatDuration(item.durationSeconds)}){/if}{#if item.fileSizeBytes} - {formatSize(item.fileSizeBytes)}{/if}
      </option>
    {/each}
  </select>

  {#if mediaItems.length === 0}
    <p class="picker-hint">
      No ready media available. Upload media first in the Media section.
    </p>
  {/if}
</div>

<style>
  .media-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .picker-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .picker-select {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-background);
    color: var(--color-text);
    transition: var(--transition-colors);
    width: 100%;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--space-3) center;
    padding-right: var(--space-8);
    cursor: pointer;
  }

  .picker-select:focus {
    outline: 2px solid var(--color-primary-500);
    outline-offset: -1px;
    border-color: var(--color-primary-500);
  }

  .picker-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin: 0;
  }

  /* Dark mode */
  :global([data-theme='dark']) .picker-label {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .picker-select {
    background-color: var(--color-background-dark);
    border-color: var(--color-border-dark);
    color: var(--color-text-dark);
  }
</style>
