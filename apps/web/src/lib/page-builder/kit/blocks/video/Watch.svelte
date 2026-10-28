<!--
  @component Watch

  A clip's play button where there is no frame to play it in (owner P2): the
  guide's quote layout, the hero's cover, whose film is the band itself. The
  press opens the theatre (`IntroVideoModal`), the same player as a framed
  film's (`InlineFilm`), with sound; Escape or its close button dismiss it,
  and focus comes back to this button. On the canvas the button is drawn but
  plays nothing: a click there belongs to the editor.
-->
<script lang="ts">
  import { flushSync } from 'svelte';
  import IntroVideoModal from '$lib/components/ui/IntroVideoModal/IntroVideoModal.svelte';
  import type { PreviewMedia, SalesFilm } from '../../../render/types';
  import type { BlockEdit } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import {
    type FilmSource,
    filmRenewal,
    filmSource,
  } from '../../primitives/film-source';
  import WatchButton from '../../primitives/WatchButton.svelte';

  interface Props {
    clip: PreviewMedia;
    /** Which of the course's films, so a press can ask for it in full. */
    film?: SalesFilm;
    label: string;
    /** The player's accessible title, and the theatre's heading. */
    title: string;
    edit?: BlockEdit | null;
  }

  const { clip, film, label, title, edit = null }: Props = $props();

  const page = getKitPage();

  /** What the open theatre plays; `null` while it is closed. */
  let source = $state.raw<FilmSource | null>(null);
  const renew = $derived(filmRenewal(clip, film, page.requestFilm));
  let returning = $state(false);

  function play() {
    if (edit) return;
    source = filmSource(clip, film, page.requestFilm);
    returning = false;
    // Opened in the press's own tick, so the player's play() keeps the sound.
    flushSync();
  }

  function close() {
    source = null;
    returning = true;
  }
</script>

<WatchButton {label} onclick={play} preload={!edit && !page.still} takeFocus={returning} />
{#if source !== null}
  <IntroVideoModal
    open={true}
    src={source}
    {renew}
    poster={clip.posterUrl}
    {title}
    onclose={close}
  />
{/if}
