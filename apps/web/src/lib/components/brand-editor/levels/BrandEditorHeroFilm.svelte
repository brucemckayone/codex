<!--
  @component BrandEditorHeroFilm

  The Hero-group FILM control for the brand studio rail (Codex-376dl): the
  org's intro film, which plays from a chip in the landing hero. A creator
  picks one of their own FINISHED videos from their media library; nothing
  here uploads or polls, because only a ready video can be picked.

  Like the logo and the hero text, the film is not a brand token: it is saved
  the moment it is picked or removed, not by the rail's "Save changes", and
  `onsaved` then reloads the framed landing so the chip appears or goes.

  What visitors get is said under the chosen film, from the same check the
  landing's player runs (`getIntroFilm`): the whole film, its 30-second
  preview when paid content uses it, or nothing, with why. Remove only takes
  the film off the landing; the video stays in the library.
-->
<script lang="ts">
  import type { StudioIntroFilm } from '@codex/shared-types';
  import { brandEditor } from '$lib/brand-editor';
  import { Button } from '$lib/components/ui';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import MediaPicker from '$lib/components/studio/MediaPicker.svelte';
  import {
    getIntroFilm,
    linkIntroVideo,
    unlinkIntroVideo,
  } from '$lib/remote/branding.remote';
  import { listMedia } from '$lib/remote/media.remote';
  import { isFirstLoad, queryErrorMessage } from '$lib/remote/query-result';
  import { formatDuration } from '$lib/utils/format';
  import { getThumbnailUrl } from '$lib/utils/image';
  import * as m from '$paraglide/messages';

  interface Props {
    /** Fired after a pick or a removal lands: the route reloads the preview. */
    onsaved?: () => void;
  }

  const { onsaved }: Props = $props();

  const orgId = $derived(brandEditor.orgId ?? '');
  const film = $derived(orgId ? getIntroFilm(orgId) : null);
  const chosen = $derived<StudioIntroFilm | null>(film?.current ?? null);
  const filmError = $derived(queryErrorMessage(film?.error));

  /** The picker is up: no film yet, or "Change film" was pressed. */
  let changing = $state(false);
  const picking = $derived(
    film?.current === null || (chosen !== null && changing)
  );

  // The library is read only while the picker is up, so a studio with a
  // film already chosen asks for nothing until its creator wants to change it.
  const library = $derived(
    picking ? listMedia({ status: 'ready', mediaType: 'video', limit: 100 }) : null
  );
  const libraryError = $derived(queryErrorMessage(library?.error));
  const videos = $derived(
    (library?.current?.items ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      mediaType: item.mediaType,
      durationSeconds: item.durationSeconds,
      fileSizeBytes: item.fileSizeBytes,
      thumbnailUrl: item.thumbnailUrl,
    }))
  );
  // The read takes the first 100: say so when there are more.
  const libraryTotal = $derived(library?.current?.pagination?.total ?? 0);

  let busy = $state(false);
  let saveError = $state<string | null>(null);

  /** What visitors get, in the studio's words. */
  function playsNote(view: StudioIntroFilm): string {
    if (view.plays === 'full') return m.branding_film_plays_full();
    if (view.plays === 'preview') return m.branding_film_plays_preview();
    if (view.reason === 'paid') return m.branding_film_none_paid();
    if (view.reason === 'not-ready') return m.branding_film_none_not_ready();
    if (view.reason === 'failed') return m.branding_film_none_failed();
    if (view.reason === 'not-video') return m.branding_film_none_not_video();
    if (view.reason === 'creator-left') return m.branding_film_none_creator_left();
    // A reason this build does not know yet: say no more than is known.
    return m.branding_film_none_other();
  }

  async function save(write: () => Promise<unknown>) {
    if (!orgId || busy) return;
    busy = true;
    saveError = null;
    try {
      await write();
      changing = false;
      // The command answers the write alone; the film is re-read here, so a
      // failed read shows as this control's own "Couldn't load your film"
      // rather than failing a save that already landed.
      film?.refresh().catch(() => {});
      onsaved?.();
    } catch (error) {
      saveError = queryErrorMessage(error, m.branding_film_save_failed());
    } finally {
      busy = false;
    }
  }

  // The picker's own "No media" row removes, as Remove does.
  function pick(mediaItemId: string | null) {
    if (mediaItemId === null) {
      if (chosen) void save(() => unlinkIntroVideo(orgId));
      return;
    }
    if (mediaItemId === chosen?.mediaItemId) {
      changing = false;
      return;
    }
    void save(() => linkIntroVideo({ orgId, mediaItemId }));
  }
</script>

<div class="hero-film">
  <p class="hero-film__hint">{m.branding_film_hint()}</p>

  {#if filmError}
    <div class="hero-film__failed" role="alert">
      <p>{m.branding_film_load_failed()}</p>
      <Button variant="secondary" size="sm" onclick={() => film?.refresh()}>
        {m.common_try_again()}
      </Button>
    </div>
  {:else if film === null || isFirstLoad(film)}
    <!-- `film` is null until the studio's branding read names the org: the
         film is not known yet, which is not the same as "No film yet". -->
    <Skeleton height="var(--space-24)" aria-hidden="true" />
  {:else}
    {#if chosen}
      <div class="hero-film__chosen">
        <div class="hero-film__poster">
          {#if chosen.posterUrl}
            <img src={getThumbnailUrl(chosen.posterUrl, 'sm')} alt="" decoding="async" />
          {/if}
          {#if chosen.durationSeconds}
            <span class="hero-film__length">{formatDuration(chosen.durationSeconds)}</span>
          {/if}
        </div>
        <div class="hero-film__body">
          <p class="hero-film__title">{chosen.title}</p>
          <p class="hero-film__plays" data-plays={chosen.plays}>{playsNote(chosen)}</p>
          <div class="hero-film__actions">
            {#if changing}
              <Button variant="secondary" size="sm" disabled={busy} onclick={() => (changing = false)}>
                {m.branding_film_keep()}
              </Button>
            {:else}
              <Button variant="secondary" size="sm" disabled={busy} onclick={() => (changing = true)}>
                {m.branding_film_change()}
              </Button>
            {/if}
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              disabled={busy}
              onclick={() => save(() => unlinkIntroVideo(orgId))}
            >
              {m.branding_film_remove()}
            </Button>
          </div>
        </div>
      </div>
      <p class="hero-film__note">{m.branding_film_remove_note()}</p>
    {:else}
      <p class="hero-film__empty">{m.branding_film_empty()}</p>
    {/if}

    {#if picking}
      <div class="hero-film__field">
        <span class="hero-film__label">{m.branding_film_label()}</span>
        {#if libraryError}
          <p class="hero-film__error" role="alert">{m.branding_film_library_failed()}</p>
          <Button variant="secondary" size="sm" onclick={() => library?.refresh()}>
            {m.common_try_again()}
          </Button>
        {:else if isFirstLoad(library)}
          <!-- Not an empty picker: that would say there are no videos. -->
          <Skeleton height="var(--space-10)" aria-hidden="true" />
        {:else}
          <MediaPicker
            mediaItems={videos}
            value={chosen?.mediaItemId ?? null}
            onchange={pick}
            name="introVideoMediaItemId"
            ariaLabel={m.branding_film_choose()}
            disabled={busy}
            thumbnails
            showLibraryLink
          />
          {#if libraryTotal > videos.length}
            <p class="hero-film__note">
              {m.branding_film_library_capped({ shown: videos.length, total: libraryTotal })}
            </p>
          {/if}
        {/if}
        <p class="hero-film__note">
          {m.branding_film_upload_lead()}
          <a href="/studio/media">{m.branding_film_upload_link()}</a>.
          {m.branding_film_upload_tail()}
        </p>
      </div>
    {/if}
  {/if}

  {#if saveError}
    <p class="hero-film__error" role="alert">{saveError}</p>
  {/if}
</div>

<style>
  .hero-film {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .hero-film__hint,
  .hero-film__note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .hero-film__note a {
    color: var(--color-interactive);
    font-weight: var(--font-semibold);
  }

  .hero-film__empty {
    margin: 0;
    padding: var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    border: var(--border-width) dashed var(--color-border);
    border-radius: var(--radius-md);
  }

  .hero-film__chosen {
    display: grid;
    grid-template-columns: var(--space-32) minmax(0, 1fr);
    gap: var(--space-3);
    align-items: start;
  }

  .hero-film__poster {
    position: relative;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-surface-secondary);
  }

  .hero-film__poster img {
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  .hero-film__length {
    position: absolute;
    inset-block-end: var(--space-1);
    inset-inline-end: var(--space-1);
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--color-player-overlay-heavy);
    color: var(--color-player-text);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
  }

  .hero-film__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-inline-size: 0;
  }

  .hero-film__title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    overflow-wrap: anywhere;
  }

  .hero-film__plays {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .hero-film__plays[data-plays='preview'] {
    color: var(--color-warning-700);
  }

  .hero-film__plays[data-plays='none'] {
    color: var(--color-error-700);
  }

  .hero-film__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .hero-film__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .hero-film__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .hero-film__failed {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .hero-film__failed p {
    margin: 0;
  }

  .hero-film__error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-error-700);
  }
</style>
