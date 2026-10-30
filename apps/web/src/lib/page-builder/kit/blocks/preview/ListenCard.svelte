<!--
  @component ListenCard

  An audio clip's frame in the Preview block (Codex-61zsk.73), where a film
  would have its picture: a listening card on the scheme's panel. The course
  still, when there is one, sits small and square at its leading edge; a
  round button plays and pauses; the block's line says what the clip is and
  how long it runs; and along its foot a strip in the brand's colour fills
  as it plays, beside the time played. Before a press the strip is empty and
  the length shows. No photo sits behind the controls.

  It plays through the same `PreviewPlayerCore` as every film, mounted on a
  press in the press's own tick, so its `play()` keeps the sound (as
  `InlineFilm` does), with its picture hidden: a `<video>` plays audio HLS.
  The core draws no controls. The card's button drives it through the core's
  own `toggle` and `toggleMute`, and the core's clock (`ontime`, from the
  element's own events: nothing polls) fills the strip. The hidden core
  keeps the card's size, so it pauses once scrolled away and moves the
  floating bar aside as any film does. When the clip ends the core goes and
  the button offers "Play again"; one that cannot play says why beside the
  button, and a press tries again. The canvas never plays.

  The ratio is the block's (`--listen-ratio`, 4:3 unless it says otherwise),
  and the card grows past it rather than clip a long line.
-->
<script lang="ts">
  import { flushSync, type Snippet } from 'svelte';
  import {
    loadedPlayerCore,
    loadPlayerCore,
    type PlayerCore,
    preloadPlayer,
  } from '$lib/components/player/load-core';
  import type { PlayerClock } from '$lib/components/player/timeline';
  import { clock } from '$lib/components/player/timeline';
  import { PauseIcon, PlayIcon, RefreshCwIcon, Volume2Icon } from '$lib/components/ui/Icon';
  import type { PreviewMedia } from '../../../render/types';
  import type { BlockEdit } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import { type FilmSource, filmRenewal, filmSource } from '../../primitives/film-source';
  import { PREVIEW_COPY } from './copy';

  interface Props {
    clip: PreviewMedia;
    /** The player's accessible title. */
    title: string;
    /** How long a press plays (`filmPlays`), shown before it; `null` when unknown. */
    seconds: number | null;
    /** The small square still at the leading edge: decorative. */
    still?: string | null;
    /** The block's line: what the clip is, how long, and its caption. */
    line: Snippet;
    edit?: BlockEdit | null;
  }

  const { clip, title, seconds, still = null, line, edit = null }: Props = $props();

  const page = getKitPage();

  /** What a press on the button does now. */
  type Action = 'play' | 'pause' | 'sound' | 'again';

  const LABELS: Record<Action, string> = {
    play: PREVIEW_COPY.watch,
    pause: PREVIEW_COPY.pause,
    sound: PREVIEW_COPY.sound,
    again: PREVIEW_COPY.again,
  };

  const SILENT: PlayerClock = { time: 0, duration: 0, offerPlay: true, askSound: false };

  // `idle` until a press; `loading` while a first press waits for the
  // player's code; `up` playing or paused; `ended` played through.
  let phase = $state<'idle' | 'loading' | 'up' | 'ended'>('idle');
  let Player = $state.raw<PlayerCore | null>(null);
  let core = $state.raw<ReturnType<PlayerCore> | null>(null);
  let source = $state.raw<FilmSource>('');
  const renew = $derived(filmRenewal(clip, 'reel', page.requestFilm));
  let now = $state.raw<PlayerClock>(SILENT);
  /** Why the last press did not play, said beside the button; a press tries again. */
  let note = $state<string | null>(null);

  const action = $derived.by((): Action => {
    if (phase === 'ended') return 'again';
    if (phase !== 'up') return 'play';
    if (now.askSound) return 'sound';
    return now.offerPlay ? 'play' : 'pause';
  });
  // The stream's own length once it says; the length a press plays until then.
  const total = $derived(now.duration > 0 ? now.duration : seconds);
  const played = $derived(total ? Math.min(1, now.time / total) : 0);
  const time = $derived.by(() => {
    if (phase === 'idle') return seconds === null ? '' : clock(seconds);
    return total ? `${clock(now.time)} / ${clock(total)}` : clock(now.time);
  });

  function press() {
    if (edit || phase === 'loading') return;
    if (phase === 'up') {
      drive();
      return;
    }
    note = null;
    const ready = loadedPlayerCore();
    if (ready) {
      show(ready);
      // Mounted now, in the press's own tick: its play() keeps the sound.
      flushSync();
      return;
    }
    phase = 'loading';
    loadPlayerCore().then(show, () => {
      note = PREVIEW_COPY.failed;
      phase = 'idle';
    });
  }

  // A press while it is up does what the core's own buttons would: a refused
  // sound is taken (and a paused clip plays with it), else it plays or pauses.
  function drive() {
    if (action !== 'sound') {
      core?.toggle();
      return;
    }
    core?.toggleMute();
    if (now.offerPlay) core?.toggle();
  }

  // The full film is asked for only once the player is here to play it.
  function show(next: PlayerCore) {
    source = filmSource(clip, 'reel', page.requestFilm);
    now = SILENT;
    Player = next;
    phase = 'up';
  }

  function hear(next: PlayerClock) {
    now = next;
  }

  function finish() {
    phase = 'ended';
  }

  function fail(message: string) {
    note = message;
    now = SILENT;
    phase = 'idle';
  }
</script>

<div class="listen" style:--_played={played}>
  <div class="listen__in" data-still={still ? '' : undefined}>
    {#if still}<img class="listen__still" src={still} alt="" loading="lazy" decoding="async" />{/if}
    <button
      type="button"
      class="listen__play"
      aria-label={LABELS[action]}
      onclick={press}
      {@attach !edit && !page.still && preloadPlayer}
    >
      {#if action === 'pause'}
        <PauseIcon size={28} fill="currentColor" stroke="none" />
      {:else if action === 'again'}
        <RefreshCwIcon size={26} />
      {:else if action === 'sound'}
        <Volume2Icon size={26} />
      {:else}
        <PlayIcon size={28} fill="currentColor" stroke="none" />
      {/if}
    </button>
    <div class="listen__text">
      <p class="listen__line">{@render line()}</p>
      {#if time}<p class="listen__time">{time}</p>{/if}
      {#if note}<p class="listen__note" role="alert">{note}</p>{/if}
    </div>
  </div>
  <span class="listen__foot" aria-hidden="true"><span class="listen__fill"></span></span>
  {#if Player && phase === 'up'}
    <!-- The sound only: its picture and its own controls are the card's. -->
    <div class="listen__player" aria-hidden="true" inert>
      <Player
        bind:this={core}
        src={source}
        {renew}
        {title}
        start="sound"
        controls={false}
        ontime={hear}
        onended={finish}
        onfail={fail}
      />
    </div>
  {/if}
</div>

<style>
  /* The scheme's panel, the brand's own surface. A container, so its insides
     answer its own width; never `overflow: hidden`, which would cut a long
     line instead of letting the card grow. */
  .listen {
    --_strip: var(--space-1-5);
    position: relative;
    container: listen / inline-size;
    display: grid;
    aspect-ratio: var(--listen-ratio, 4 / 3);
    border-radius: var(--lp-radius-media);
    background: var(--lp-panel);
    color: var(--lp-panel-ink);
  }

  /* On a phone the still sits on top, the button and the line under it. */
  .listen__in {
    --_still: var(--space-16);
    --_play: max(var(--tap-target-min), var(--space-16));
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas: 'play text';
    align-content: center;
    align-items: center;
    gap: var(--space-4) var(--space-5);
    padding: var(--space-5) var(--space-5) calc(var(--space-5) + var(--_strip));
  }

  .listen__in[data-still] {
    grid-template-areas:
      'still still'
      'play text';
    align-content: space-between;
  }

  /* Wider, all three in a row, the still leading. */
  @container listen (min-width: 36rem) {
    .listen__in {
      --_still: clamp(var(--space-24), 17cqi, calc(var(--space-20) * 2));
      --_play: var(--space-20);
      gap: clamp(var(--space-5), 3.5cqi, var(--space-10));
      padding: clamp(var(--space-6), 5cqi, var(--space-14));
    }

    .listen__in[data-still] {
      grid-template-columns: auto auto minmax(0, 1fr);
      grid-template-areas: 'still play text';
      align-content: center;
    }
  }

  .listen__still {
    grid-area: still;
    display: block;
    inline-size: var(--_still);
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: var(--lp-radius-media);
  }

  .listen__play {
    grid-area: play;
    display: grid;
    place-items: center;
    inline-size: var(--_play);
    block-size: var(--_play);
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: var(--lp-button-bg);
    color: var(--lp-button-ink);
    cursor: pointer;
  }

  @media (hover: hover) and (prefers-reduced-motion: no-preference) {
    .listen__play {
      transition: transform var(--duration-fast) var(--ease-out);
    }

    .listen__play:hover {
      transform: scale(1.03);
    }
  }

  .listen__play:focus-visible {
    outline: var(--border-width-thick) solid var(--lp-focus);
    outline-offset: var(--space-1);
  }

  .listen__text {
    grid-area: text;
    display: grid;
    gap: var(--space-1);
    min-inline-size: 0;
  }

  .listen__line,
  .listen__time,
  .listen__note {
    margin: 0;
    max-inline-size: calc(var(--lp-measure) * var(--lp-measure-unit));
  }

  .listen__line {
    font-size: var(--lp-size-body);
    line-height: var(--lp-leading-title);
    text-wrap: pretty;
  }

  .listen__time {
    font-size: var(--lp-size-small);
    font-weight: var(--lp-weight-label);
    font-variant-numeric: tabular-nums;
  }

  .listen__note {
    font-size: var(--lp-size-small);
  }

  /* The strip, cut to the card's corners on a layer of its own, so the card
     itself never clips. Empty before a press; the brand's fill as it plays. */
  .listen__foot {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: inherit;
    pointer-events: none;
  }

  .listen__foot::before,
  .listen__fill {
    position: absolute;
    inset-inline-start: 0;
    inset-block-end: 0;
    block-size: var(--_strip);
  }

  .listen__foot::before {
    content: '';
    inset-inline-end: 0;
    background: color-mix(in oklab, var(--lp-panel-ink) 14%, transparent);
  }

  .listen__fill {
    inline-size: calc(var(--_played) * 100%);
    background: var(--lp-button-bg);
  }

  /* The player plays the sound only: the card's size, so it knows when the
     card is on screen, and unseen. */
  .listen__player {
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
  }
</style>
