<!--
  @component ListenCard

  An audio clip's frame in the Preview block (Codex-61zsk.73), where a film
  would have its picture: a listening card on the scheme's panel, tinted
  toward the brand where the panel is light (THE FILL, below). The course
  still, when there is one, sits small and square at its leading edge; a
  round button plays and pauses; the block's line says what the clip is and
  how long it runs; and along its foot a strip in the brand's colour fills
  as it plays, beside the time played. Before a press the strip is empty and
  the length shows. No photo sits behind the controls.

  It plays through the same `PreviewPlayerCore` as every film, brought by
  the same press as `InlineFilm`'s (`film-press.svelte.ts`), so its
  `play()` keeps the sound, with its picture hidden: a `<video>` plays audio
  HLS. The core draws no controls. The card's button drives it through the
  core's own `toggle` and `toggleMute`, and the core's `clock` (the
  element's own figures: nothing polls) fills the strip. The hidden core
  keeps the card's size, so it pauses once scrolled away and moves the
  floating bar aside as any film does. When the clip ends the core stays,
  the strip full and the time at its end, and the button offers "Play
  again", which replays it in place, unless it asked for the full recording
  and got the preview: then, as `InlineFilm`'s "Watch again", it asks
  afresh. One that cannot play says why beside the button, and a press
  tries again. A full recording whose links ran out mid-play has not ended
  (the core's `lapsed`): the card says so, and a press starts it afresh.
  The canvas never plays.

  What the core's own chrome would show, the card shows instead: while the
  player's code, or the stream's first sound, is on its way, or the stream
  stalls or swaps in renewed links (the strip held where it stood), the
  time reads "Loading…", the button is busy and the card says so politely;
  a start the browser refused shows the length and Play; and a press that
  asked for the full recording and got the preview says so, as
  `InlineFilm` does over a film.

  The ratio is the block's (`--listen-ratio`, 4:3 unless it says otherwise),
  and the card grows past it rather than clip a long line.
-->
<script lang="ts">
  import { flushSync, type Snippet } from 'svelte';
  import { type PlayerCore, preloadPlayer } from '$lib/components/player/load-core';
  import type { PlayerClock } from '$lib/components/player/timeline';
  import { clock } from '$lib/components/player/timeline';
  import { PauseIcon, PlayIcon, RefreshCwIcon, Volume2Icon } from '$lib/components/ui/Icon';
  import { coverCropSizes, getThumbnailSrcset, getThumbnailUrl } from '$lib/utils/image';
  import type { PreviewMedia } from '../../../render/types';
  import type { BlockEdit } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import { FilmPress } from '../../primitives/film-press.svelte';
  import { PREVIEW_COPY } from './copy';

  interface Props {
    clip: PreviewMedia;
    /** The player's accessible title. */
    title: string;
    /** A press plays the clip in full, not its preview (`filmPlays`): the button says which. */
    full: boolean;
    /** How long a press plays (`filmPlays`), shown before it; `null` when unknown. */
    seconds: number | null;
    /** The small square still at the leading edge: decorative. */
    still?: string | null;
    /** The block's line: what the clip is, how long, and its caption. */
    line: Snippet;
    edit?: BlockEdit | null;
  }

  const { clip, title, full, seconds, still = null, line, edit = null }: Props = $props();

  const page = getKitPage();

  /** What a press on the button does now. */
  type Action = 'play' | 'resume' | 'pause' | 'sound' | 'again';

  const LABELS: Record<Exclude<Action, 'play'>, string> = {
    resume: PREVIEW_COPY.resume,
    pause: PREVIEW_COPY.pause,
    sound: PREVIEW_COPY.sound,
    again: PREVIEW_COPY.again,
  };

  const SILENT: PlayerClock = {
    time: 0,
    duration: 0,
    offerPlay: true,
    askSound: false,
    ready: false,
    waiting: false,
    wanted: false,
    resuming: false,
  };

  /**
   * Drawn 4rem square on a phone and up to 10rem wider, cropped from the
   * still (16:9 unless its address records its size): the browser picks the
   * file. An address with no sized files is drawn as it is.
   */
  const STILL_SLOTS = '(min-width: 40rem) 10rem, 4rem';

  // The press and the player; its picture and controls are the card's.
  const press = new FilmPress(
    () => ({ clip, film: 'reel', requestFilm: page.requestFilm }),
    PREVIEW_COPY
  );
  let core = $state.raw<ReturnType<PlayerCore> | null>(null);
  /** Played through: the core stays, at its end, until it plays again. */
  let ended = $state(false);
  // The core's own clock while it is mounted; silence before and after.
  const now = $derived(core?.clock() ?? SILENT);

  const action = $derived.by((): Action => {
    if (ended) return 'again';
    if (press.phase !== 'up') return 'play';
    if (now.askSound) return 'sound';
    if (!now.offerPlay) return 'pause';
    return now.time > 0 ? 'resume' : 'play';
  });
  // Before a press it says what a press plays, the preview or the clip in
  // full; once up, what a press does.
  const label = $derived.by(() => {
    if (action !== 'play') return LABELS[action];
    return full || press.phase === 'up' ? PREVIEW_COPY.play : PREVIEW_COPY.watch;
  });
  // The player's code on its way, or the stream before its first sound
  // while it is wanted, or stalled or swapping in renewed links while it
  // should play: the core's own cues are in its hidden player, so the card
  // shows and says them. A start the browser refused wants nothing: Play.
  const busy = $derived(
    press.phase === 'loading' ||
      (press.phase === 'up' &&
        !ended &&
        ((!now.ready && now.wanted) ||
          ((now.waiting || now.resuming) && !now.offerPlay)))
  );
  // The stream's own length once it says; the length a press plays until then.
  const total = $derived(now.duration > 0 ? now.duration : seconds);
  const played = $derived(total ? Math.min(1, now.time / total) : 0);
  const time = $derived.by(() => {
    if (busy) return PREVIEW_COPY.loading;
    if (press.phase === 'idle') return seconds === null ? '' : clock(seconds);
    return total ? `${clock(now.time)} / ${clock(total)}` : clock(now.time);
  });
  const stillSrcset = $derived(still ? getThumbnailSrcset(still) : '');

  function start() {
    if (edit) return;
    if (ended && press.fellBack) again();
    else if (press.phase === 'up') drive();
    else press.start();
  }

  // Played through on the preview where the full recording was asked for:
  // "Play again" asks for it afresh, as `InlineFilm`'s "Watch again" does.
  // The player goes first, so the press brings a fresh one in this tick.
  function again() {
    ended = false;
    press.finish('end');
    flushSync();
    press.start();
  }

  // A press while it is up does what the core's own buttons would: a refused
  // sound is taken (and a paused clip plays with it), else it plays or
  // pauses, and once played through it plays again from the start, in place.
  function drive() {
    if (action === 'sound') {
      core?.toggleMute();
      if (now.offerPlay) core?.toggle();
      return;
    }
    ended = false;
    core?.toggle();
  }

  // Played through, the core stays at its end. A lapse is no end: the press
  // says so, and the next starts afresh.
  function finish(reason: 'end' | 'lapsed') {
    if (reason === 'end') ended = true;
    else press.finish(reason);
  }
</script>

<div class="listen">
  <div class="listen__in" data-still={still ? '' : undefined}>
    {#if still}
      <img
        class="listen__still"
        src={getThumbnailUrl(still, 'md')}
        srcset={stillSrcset || undefined}
        sizes={stillSrcset ? coverCropSizes(STILL_SLOTS, 1, still, 16 / 9) : undefined}
        alt=""
        loading="lazy"
        decoding="async"
      />
    {/if}
    <button
      type="button"
      class="listen__play"
      aria-label={label}
      aria-busy={busy}
      onclick={start}
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
      <!-- Said by the live region below while it loads, so not twice. -->
      {#if time}<p class="listen__time" aria-hidden={busy || undefined}>{time}</p>{/if}
      <!-- Always mounted and never busy, as InlineFilm's is: a busy region's
           changes may go unsaid, so the button alone carries `aria-busy`. -->
      <div class="listen__status" role="status">
        {#if busy}<span class="sr-only">{PREVIEW_COPY.loading}</span>{/if}
        {#if press.fellBack && press.phase === 'up' && !ended}
          <p class="listen__note">{PREVIEW_COPY.fellBack}</p>
        {/if}
      </div>
      {#if press.note}<p class="listen__note" role="alert">{press.note}</p>{/if}
    </div>
  </div>
  <span class="listen__foot" aria-hidden="true"><span class="listen__fill" style:--_played={played}></span></span>
  {#if press.Player && press.phase === 'up'}
    <!-- The sound only: its picture and its own controls are the card's. -->
    <div class="listen__player" aria-hidden="true" inert>
      <press.Player
        bind:this={core}
        src={press.source}
        renew={press.renew}
        {title}
        start="sound"
        controls={false}
        onplay={() => (ended = false)}
        onended={finish}
        onfail={(message) => press.fail(message)}
      />
    </div>
  {/if}
</div>

<style>
  /* THE FILL (the owner's mockup): a light panel takes the brand's tint,
     the atmosphere scheme's own panel (`--_panel-g` in `schemes.css`, the
     ground moved toward the brand and held at L 0.9-0.965, so dark ink
     reads), where the org's plain card would be an empty white box. A dark
     panel is drawn as it is: the org's ink is proven only up to its band's
     edge, which a tint would pass. The switch is the kit's premultiplied
     color-mix (`--lp-brand-2`): the panel at alpha 1 where it is dark (L
     under 0.565, between the lightest dark band's edge, 0.48, and the
     darkest light band's, 0.65) and 0 where it is light, mixed half and
     half with the tint at alpha 0.004, is the panel within 1/255 or the
     tint exactly, then made opaque. The card's ink is the panel's, which
     holds on any light surface its band allows (`listen-fill.test.ts`).

     A container, so its insides answer its own width; never `overflow:
     hidden`, which would cut a long line instead of letting the card grow. */
  .listen {
    --_strip: var(--space-1-5);
    --_fill: rgb(
      from color-mix(
          in srgb,
          oklch(from var(--lp-panel) l c h / clamp(0, (0.565 - l) * 1e6, 1)) 50%,
          rgb(from var(--_panel-g) r g b / 0.004) 50%
        )
        r g b / 1
    );
    --_button: var(--lp-button-bg);
    --_button-ink: var(--lp-button-ink);
    --_focus: var(--lp-focus);
    position: relative;
    container: listen / inline-size;
    display: grid;
    aspect-ratio: var(--listen-ratio, 4 / 3);
    border-radius: var(--lp-radius-media);
    background: var(--_fill);
    color: var(--lp-panel-ink);
  }

  /* Contrast's panel is the ground's inverse. On the dark pole it is light,
     and the tint, the ground's, would darken it under the button that was
     drawn for it: drawn as it is. */
  :global(.lp [data-lp-scheme='contrast']) .listen {
    --_fill: var(--lp-panel);
  }

  /* A brand or accent band's button and focus ring are its ink, drawn for
     the band's own fill, so on the card they could vanish (a white disc on
     a light card): the card's own pair instead, its ink with the card for a
     label, the band's "button inverted" (`schemes.css`). */
  :global(.lp :is([data-lp-scheme='brand'], [data-lp-scheme='accent'])) .listen {
    --_button: var(--lp-panel-ink);
    --_button-ink: var(--_fill);
    --_focus: var(--lp-panel-ink);
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
    background: var(--_button);
    color: var(--_button-ink);
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
    outline: var(--border-width-thick) solid var(--_focus);
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

  /* Its words sit in the column as the others do: an empty region adds no
     row, so no gap, to the column. */
  .listen__status {
    display: contents;
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
    inset-inline: 0;
    inset-block-end: 0;
    block-size: var(--_strip);
  }

  .listen__foot::before {
    content: '';
    background: color-mix(in oklab, var(--lp-panel-ink) 14%, transparent);
  }

  /* Full width, scaled from the inline start: no layout as it fills. */
  .listen__fill {
    background: var(--_button);
    transform: scaleX(var(--_played, 0));
    transform-origin: left;
  }

  .listen__fill:dir(rtl) {
    transform-origin: right;
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
