<!--
  @component PageMediaPanel

  The "Media" page-mode panel (Codex-eqh0z). One place to set everything visual a
  journey owns outside its copy:

    • the still COVER — the poster the journey card renders. `courses` had three
      VIDEO refs and no poster column at all, which is why `JourneyCard` was
      typographic-only; this uploads to the new `courses.cover_image_key`.
    • the three sell VIDEOS + the guide PORTRAIT — `courses.introVideoMediaId`,
      `previewVideoMediaId`, `guideVideoMediaId` and `guide.portraitMediaId`. All
      four were READ-ONLY codebase-wide before this, so the `introVideo`, `reel`
      and `guide` sections could never show their primary content.

  The same slots are reachable from each section's inspector (`SectionEditor`'s
  `media` control). Both surfaces read and write the ONE `sellMedia` store, so the
  panel and the inspectors can never disagree about what is pending.

  Cover upload/clear apply IMMEDIATELY (a multipart upload has a different failure
  mode from a JSON patch, and the creator needs the resolved URL back to see what
  they picked). The media slots are pending until Save, like page copy.
-->
<script lang="ts">
  import { MAX_IMAGE_SIZE_BYTES } from '@codex/validation';
  import MediaPicker from '$lib/components/studio/MediaPicker.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import type { JourneySellMediaSlot } from '$lib/page-builder/sell-media-store.svelte';
  import { sellMedia } from '$lib/page-builder/sell-media-store.svelte';

  const MAX_COVER_MB = Math.round(MAX_IMAGE_SIZE_BYTES / 1024 / 1024);

  /**
   * The slots, in the order they appear down the sales page — so the panel reads
   * as a walk through the page rather than an arbitrary list. Hero first, because
   * it is the first thing a visitor sees.
   *
   * Kept in step with `JourneySellMediaSlot`: a slot the store knows and this
   * panel does not is only reachable from a section inspector, which is the
   * two-sources-of-truth problem the store exists to prevent.
   */
  const SLOTS: readonly {
    slot: JourneySellMediaSlot;
    label: string;
    hint: string;
  }[] = [
    {
      slot: 'heroMediaId',
      label: 'Hero image',
      hint: 'The image the hero shows. Its still frame is used.',
    },
    {
      slot: 'introVideoMediaId',
      label: 'Intro film',
      hint: 'The short film the “intro” section plays.',
    },
    {
      slot: 'previewVideoMediaId',
      label: 'Practice reel',
      hint: 'The reel the “reel” section plays.',
    },
    {
      slot: 'guidePortraitMediaId',
      label: 'Guide portrait',
      hint: 'The still shown beside the guide’s bio.',
    },
    {
      slot: 'guideVideoMediaId',
      label: 'Guide video',
      hint: 'A talking-head clip for the guide section. Optional.',
    },
    {
      slot: 'signatureMediaId',
      label: 'Guide signature',
      hint: 'The sign-off mark at the foot of the guide’s letter. Optional.',
    },
  ];

  let fileInput = $state<HTMLInputElement | null>(null);

  async function onCoverChange(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Reset the input so re-picking the SAME file fires `change` again — without
    // this, a failed upload cannot be retried with the identical file.
    input.value = '';
    if (!file) return;
    try {
      await sellMedia.uploadCover(file);
      toast.success('Cover updated');
    } catch (err) {
      // Surface the server's own message (an unsupported format, most commonly)
      // rather than a generic failure — the creator can only fix what they see.
      toast.error(err instanceof Error ? err.message : 'Cover upload failed');
    }
  }

  async function onClearCover(): Promise<void> {
    try {
      await sellMedia.clearCover();
      toast.success('Cover removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove cover');
    }
  }
</script>

<div class="panel">
  <header class="panel__head">
    <h2 class="panel__title">Media</h2>
    <p class="panel__sub">Page-level</p>
  </header>

  <!-- ── Cover ─────────────────────────────────────────────────────────── -->
  <section class="panel__group">
    <h3 class="panel__group-title">Cover</h3>
    <p class="panel__hint">
      The image on this journey’s card. With no cover the card falls back to its
      typographic form — nothing breaks, it is just quieter.
    </p>

    <div class="cover">
      <div class="cover__frame">
        {#if sellMedia.coverImageUrl}
          <img class="cover__img" src={sellMedia.coverImageUrl} alt="Journey cover" />
        {:else}
          <span class="cover__empty">No cover</span>
        {/if}
      </div>

      <div class="cover__actions">
        <input
          bind:this={fileInput}
          type="file"
          class="cover__file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onchange={onCoverChange}
        />
        <button
          type="button"
          class="cover__btn"
          disabled={sellMedia.coverBusy}
          onclick={() => fileInput?.click()}
        >
          {sellMedia.coverBusy
            ? 'Uploading…'
            : sellMedia.coverImageUrl
              ? 'Replace'
              : 'Upload'}
        </button>
        {#if sellMedia.coverImageUrl}
          <button
            type="button"
            class="cover__btn cover__btn--quiet"
            disabled={sellMedia.coverBusy}
            onclick={onClearCover}
          >
            Remove
          </button>
        {/if}
        <span class="panel__hint">JPG, PNG, WebP or GIF · up to {MAX_COVER_MB}MB</span>
      </div>
    </div>
  </section>

  <!-- ── Sell media ────────────────────────────────────────────────────── -->
  <section class="panel__group">
    <h3 class="panel__group-title">Videos &amp; portrait</h3>
    <p class="panel__hint">
      Picked from your media library, so they reuse the same transcoding as the rest
      of your content. Only ready items are offered — an item still transcoding has
      nothing to play yet. Saved with the page.
    </p>

    {#each SLOTS as entry (entry.slot)}
      <div class="panel__field">
        <span class="panel__label">{entry.label}</span>
        <MediaPicker
          mediaItems={sellMedia.options}
          value={sellMedia.slot(entry.slot)}
          name={`journey-media-${entry.slot}`}
          showLibraryLink
          onchange={(mediaItemId) => sellMedia.setSlot(entry.slot, mediaItemId)}
        />
        <span class="panel__hint">{entry.hint}</span>
      </div>
    {/each}
  </section>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-4);
  }

  .panel__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .panel__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .panel__sub {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .panel__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .panel__group-title {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .panel__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .panel__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .panel__hint {
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    color: var(--color-text-muted);
  }

  /* ── Cover ─────────────────────────────────────────────────────────────
     The frame keeps the card's 16/9 ratio so what the creator previews here is
     the shape the card renders. */
  .cover {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .cover__frame {
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
  }

  .cover__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .cover__empty {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .cover__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  /* Hidden but still a real, focusable input — the visible button forwards to it,
     which keeps the native file dialog and its accessibility intact. */
  .cover__file {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  .cover__btn {
    padding: var(--space-1-5) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .cover__btn:hover:not(:disabled) {
    background-color: var(--color-surface-secondary);
    border-color: var(--color-border-strong);
  }

  .cover__btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .cover__btn:disabled {
    opacity: var(--opacity-60);
    cursor: not-allowed;
  }

  .cover__btn--quiet {
    color: var(--color-text-secondary);
  }
</style>
