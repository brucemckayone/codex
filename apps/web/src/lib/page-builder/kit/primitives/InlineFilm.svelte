<!--
  @component InlineFilm

  A film that plays where its poster is (owner P1): the block's own frame,
  with today's play button over its picture, and on a press the player
  (`PreviewPlayerCore`) laid over that same frame, with sound. Framed sites
  only: the Video and Preview blocks, the guide's portrait, a hero with a
  frame. The frameless ones open the theatre (`blocks/video/Watch.svelte`).

  BEFORE THE PRESS it is exactly the frame the server sent — the poster (or
  plate, or portrait) and the WatchButton — so the HTML and the canvas are
  as they were. Nothing loads but the player's own code, fetched as a
  visitor shows intent (`preloadPlayer`). The canvas never plays (`edit`),
  and neither it nor a still thumbnail fetches anything.

  THE PRESS (`film-press.svelte.ts`, shared with the Preview block's
  listening card) mounts the player in its own tick, so its `play()` keeps
  the sound; a player not fetched yet is waited for, and may then start
  muted. If its code never arrives, or the film cannot play (the player's
  `onfail`), the poster returns, the button says why beside it, and a press
  tries again. A clip the server marked `fullFilm` asks the page for the
  full film once the player is here to play it, and asks again as its links
  run out.

  IN THE FRAME the player covers it edge to edge, the film letterboxed on its
  dark backdrop, so a 4/5 portrait or Bold's 21:9 screen keeps its shape and
  nothing on the page moves (P5). It is laid BESIDE the picture, never inside
  it, so a Style's shaping of the picture — Soft's arch and circles,
  Cinematic's fades and masks — lifts while the film is up and never clips
  the controls. The frame takes the Style's media corners (squared where a
  block or Style squares the picture's: the `.lp-film` rules beside those).
  When the film ends the player goes, and the poster returns with "Watch
  again" (P4); the player adds no buy button of its own.

  The block lays out its own frame: `children` is given the control to set
  over the picture, the player to lay over the whole frame (inside a
  positioned box the size of the picture), and whether the film is up — the
  hero drops its ambient loop under it.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PreviewMedia, SalesFilm } from '../../render/types';
  import type { BlockEdit } from '../model/types';
  import { getKitPage } from '../page-context';
  import { FILM_COPY } from './film-copy';
  import { FilmPress } from './film-press.svelte';
  import WatchButton from './WatchButton.svelte';

  interface Props {
    clip: PreviewMedia;
    /** Which of the course's films, so a press can ask for it in full. */
    film?: SalesFilm;
    label: string;
    /** The player's accessible title. */
    title: string;
    edit?: BlockEdit | null;
    children: Snippet<[control: Snippet, player: Snippet, up: boolean]>;
  }

  const { clip, film, label, title, edit = null, children }: Props = $props();

  const page = getKitPage();

  // The press, the player and the film it plays; the poster while `idle`,
  // and again once `ended`.
  const press = new FilmPress(
    () => ({ clip, film, requestFilm: page.requestFilm }),
    FILM_COPY.failed
  );
  let layer: HTMLDivElement | undefined = $state();
  /** The player had focus when the film ended: "Watch again" takes it. */
  let refocus = $state(false);

  function start() {
    if (edit) return;
    refocus = false;
    press.start();
  }

  function finish() {
    refocus = Boolean(layer?.contains(document.activeElement));
    press.finish();
  }

  // The film cannot play: the poster again, saying why, for another press.
  function fail(message: string) {
    refocus = Boolean(layer?.contains(document.activeElement));
    press.fail(message);
  }
</script>

{#snippet control()}
  {#if press.phase !== 'up'}
    <WatchButton
      label={press.phase === 'ended' ? FILM_COPY.again : label}
      again={press.phase === 'ended'}
      onclick={start}
      preload={!edit && !page.still}
      takeFocus={refocus}
      note={press.note}
    />
  {/if}
{/snippet}

{#snippet player()}
  {#if press.Player && press.phase === 'up'}
    <div class="lp-film" bind:this={layer}>
      <press.Player
        src={press.source}
        renew={press.renew}
        poster={clip.posterUrl}
        stillFit="cover"
        {title}
        start="sound"
        takeFocus
        onended={finish}
        onfail={fail}
      />
    </div>
  {/if}
{/snippet}

{@render children(control, player, press.phase === 'up')}

<style>
  /* Over the whole frame, in the Style's media corners. */
  .lp-film {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: hidden;
    border-radius: var(--lp-radius-media);
  }
</style>
