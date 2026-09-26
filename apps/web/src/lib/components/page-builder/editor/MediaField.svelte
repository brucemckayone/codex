<!--
  @component MediaField

  A `media` field: the journey's sell-media slot the field names, picked from
  the org library with the same `MediaPicker` the legacy inspector and the
  Settings tab use. It writes the SLOT (`sellMedia.setSlot`), never the
  section's props — one slot feeds every section that shows it, which is why
  the hint says where else it is set.

  `optionsFor(slot)`, not the raw options, so a still-only slot is never
  offered audio. A failed read is said out loud: an empty picker would
  otherwise read as "you have no media".
-->
<script lang="ts">
  import MediaPicker from '$lib/components/studio/MediaPicker.svelte';
  import type { BlockField } from '$lib/page-builder/kit';
  import { sellMedia } from '$lib/page-builder/sell-media-store.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    field: BlockField;
  }

  const { field }: Props = $props();

  const id = $props.id();
</script>

{#if field.mediaSlot}
  {@const slot = field.mediaSlot}
  <div class="media" role="group" aria-labelledby="{id}-label">
    <span class="media__label" id="{id}-label">{field.label}</span>
    {#if sellMedia.loadError}
      <p class="media__warn" role="alert">{sellMedia.loadError}</p>
    {:else if sellMedia.loading}
      <p class="media__hint" role="status">{m.studio_builder_media_loading()}</p>
    {/if}
    <MediaPicker
      mediaItems={sellMedia.optionsFor(slot)}
      value={sellMedia.slot(slot)}
      name="section-media-{slot}"
      ariaLabel={field.label}
      showLibraryLink
      onchange={(mediaItemId) => sellMedia.setSlot(slot, mediaItemId)}
    />
    <p class="media__hint">{field.hint ?? m.studio_page_editor_media_shared()}</p>
  </div>
{/if}

<style>
  .media {
    display: grid;
    gap: var(--space-1);
  }

  .media__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .media__hint,
  .media__warn {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .media__warn {
    color: var(--color-text);
    font-weight: var(--font-medium);
  }
</style>
