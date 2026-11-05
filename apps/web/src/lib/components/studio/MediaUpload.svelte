<!--
  @component MediaUpload

  The media library's way in for files: a full-page drop overlay while the OS
  drags files over the window, and the hidden file input the command bar's
  Upload button opens. Both hand the files to the studio's `uploadQueue`
  (lib/client/upload-queue.svelte.ts), which runs the uploads, and the
  UploadTray in the studio layout shows them (Codex-a6ofh.1.2). The queue used
  to live here, so leaving the page unmounted every running upload.

  @prop triggerPicker  Bindable: the parent sets a ref and calls it to open
                       the native file picker.
-->
<script lang="ts">
  import { uploadQueue } from '$lib/client/upload-queue.svelte';
  import { UploadIcon } from '$lib/components/ui/Icon';
  import { browser } from '$app/environment';
  import * as m from '$paraglide/messages';
  import { MEDIA_FILE_ACCEPT } from './media-upload-file';

  interface Props {
    /** Bindable: the parent assigns a handle and invokes it to open the file picker. */
    triggerPicker?: (() => void) | null;
  }

  let { triggerPicker = $bindable(null) }: Props = $props();

  let isWindowDragging = $state(false);
  /** Files in the drag, when the browser says (null: it doesn't). */
  let draggedCount = $state<number | null>(null);
  let dragDepth = 0; // robust enter/leave tracking across child nodes
  let fileInput: HTMLInputElement | null = $state(null);

  // Wire the picker handle so the parent command bar can trigger it.
  // Set once on mount: the function closes over fileInput via ref binding.
  $effect(() => {
    if (triggerPicker) return;
    triggerPicker = () => fileInput?.click();
  });

  const dropTitle = $derived(
    draggedCount === null || draggedCount === 0
      ? m.media_drop_title()
      : draggedCount === 1
        ? m.media_drop_title_one()
        : m.media_drop_title_many({ count: String(draggedCount) })
  );

  function handleFileInputChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      uploadQueue.add(target.files);
      target.value = '';
    }
  }

  // ─── Global drag overlay ─────────────────────────────────────────────────
  // Use window-level drag events so the drop target is the whole viewport.
  // Track depth to avoid flicker when entering child elements.

  function containsFiles(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    // DataTransferItemList.types contains 'Files' when files are being dragged
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  }

  function countFiles(e: DragEvent): number | null {
    const dragged = e.dataTransfer?.items;
    if (!dragged) return null;
    let count = 0;
    for (let i = 0; i < dragged.length; i++) {
      if (dragged[i]?.kind === 'file') count++;
    }
    return count;
  }

  function handleWindowDragEnter(e: DragEvent) {
    if (!containsFiles(e)) return;
    dragDepth++;
    isWindowDragging = true;
    draggedCount = countFiles(e);
  }

  function handleWindowDragOver(e: DragEvent) {
    if (!containsFiles(e)) return;
    // preventDefault enables drop on the window; otherwise browser navigates
    e.preventDefault();
  }

  function handleWindowDragLeave(e: DragEvent) {
    if (!containsFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) isWindowDragging = false;
  }

  function handleWindowDrop(e: DragEvent) {
    if (!containsFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    isWindowDragging = false;
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      uploadQueue.add(e.dataTransfer.files);
    }
  }
</script>

<svelte:window
  ondragenter={handleWindowDragEnter}
  ondragover={handleWindowDragOver}
  ondragleave={handleWindowDragLeave}
  ondrop={handleWindowDrop}
/>

<!-- Hidden file input: surfaced via the parent's Upload button OR an OS drop -->
<input
  bind:this={fileInput}
  id="media-file-input"
  type="file"
  accept={MEDIA_FILE_ACCEPT}
  multiple
  class="sr-only"
  onchange={handleFileInputChange}
/>

<!-- Full-viewport drop overlay: visible only while the OS reports a file drag -->
{#if browser && isWindowDragging}
  <div class="drop-overlay" role="presentation" aria-hidden="true">
    <div class="drop-overlay-panel">
      <span class="drop-overlay-icon">
        <UploadIcon size={44} stroke-width="1.5" />
      </span>
      <p class="drop-overlay-hero">{dropTitle}</p>
      <p class="drop-overlay-sub">{m.media_drop_sub()}</p>
    </div>
  </div>
{/if}

<style>
  /* ── Full-viewport drop overlay ───────────────────────── */
  .drop-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    background: color-mix(in srgb, var(--color-interactive) 18%, transparent);
    backdrop-filter: blur(var(--blur-lg, 12px));
    -webkit-backdrop-filter: blur(var(--blur-lg, 12px));
    pointer-events: none;
    animation: drop-overlay-in var(--duration-fast) var(--ease-out);
  }

  @media (prefers-reduced-motion: reduce) {
    .drop-overlay { animation: none; }
  }

  @keyframes drop-overlay-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .drop-overlay-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-8) var(--space-12);
    border-radius: var(--radius-xl, var(--radius-lg));
    background: color-mix(in srgb, var(--color-surface) 94%, transparent);
    border: var(--border-width-thick) var(--border-style-dashed, dashed)
      var(--color-interactive);
    box-shadow:
      0 var(--space-4) var(--space-12) color-mix(in srgb, var(--color-text) 18%, transparent);
    max-width: min(32rem, 80vw);
    text-align: center;
  }

  .drop-overlay-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-16);
    height: var(--space-16);
    border-radius: var(--radius-full, 9999px);
    background: var(--color-interactive-subtle);
    color: var(--color-link);
  }

  .drop-overlay-hero {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
  }

  .drop-overlay-sub {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
