<!--
  @component HeroInlineVideo

  The org landing's intro film, grown out of its play chip over the hero
  (Codex-376dl; owner: "A: grows out of the hero"). Desktop only: below 48rem
  the landing opens `IntroVideoModal` instead.

  The player is the one every film plays in (`PreviewPlayerCore`): scrubber,
  time, mute and full screen, with sound, because a press opened it. When its
  code has loaded (the chip fetches it on a pointer or focus), the film mounts
  with this, in the press's tick, so its `play()` keeps the sound; otherwise
  it waits for it, and the film may start muted.

  It opens as a circle from the chip (`originX`/`originY`, % of the hero),
  over the shader, and its frame sits in a soft dark halo, so its edge melts
  into the hero. The halo is OUTSIDE the frame: a mask or a vignette over it
  would fade the player's own controls. Reduced motion shows it at once.

  Escape closes it wherever focus is, as do its close button and the film's
  end; the landing then gives the chip its focus back. A full film whose links
  ran out with no fresh ones (a `lapsed` end) does NOT close: it shows its
  poster and "Watch again", which asks afresh, so it never just vanishes.

  The chip is inert while the film is open, so focus needs a home: the
  player's play button once it mounts (`takeFocus`), and the close button
  while its code is still loading or once the film cannot play.

  @prop src - The preview's HLS manifest, or a promise of the full film while
    a press asks for it (`components/player/press-source.ts`)
  @prop renew - Asks again for a full film whose links are running out
  @prop title - The film's name: its region's label and the player's
  @prop poster - Shown until the first frame
  @prop originX - Where the chip is, as % of the hero's width
  @prop originY - Where the chip is, as % of the hero's height
  @prop onclose - Called when the film is dismissed or ends
-->
<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import {
    loadedPlayerCore,
    loadPlayerCore,
    type PlayerCore,
  } from '$lib/components/player/load-core';
  import { RefreshCwIcon, XIcon } from '$lib/components/ui/Icon';
  import { getThumbnailUrl } from '$lib/utils/image';
  import * as m from '$paraglide/messages';

  interface Props {
    src: ComponentProps<PlayerCore>['src'];
    renew?: ComponentProps<PlayerCore>['renew'];
    title: string;
    poster?: string | null;
    originX?: number;
    originY?: number;
    onclose: () => void;
  }

  const {
    src,
    renew,
    title,
    poster = null,
    originX = 50,
    originY = 50,
    onclose,
  }: Props = $props();

  let Player = $state.raw<PlayerCore | null>(loadedPlayerCore());
  let failed = $state(false);

  // The player's code, when the press came before it arrived.
  $effect(() => {
    if (Player) return;
    let gone = false;
    loadPlayerCore().then(
      (loaded) => {
        if (!gone) Player = loaded;
      },
      () => {
        if (!gone) failed = true;
      }
    );
    return () => {
      gone = true;
    };
  });

  let closeButton = $state<HTMLButtonElement | undefined>(undefined);

  // Until the player mounts and takes focus, the close button holds it.
  $effect(() => {
    if (!Player) closeButton?.focus({ preventScroll: true });
  });

  /** The film cannot play: its controls are gone, so focus goes to close. */
  function failedToPlay() {
    closeButton?.focus({ preventScroll: true });
  }

  /** A real end closes the film; a lapse keeps it, with "Watch again". */
  function ended(reason: 'end' | 'lapsed') {
    if (reason === 'end') onclose();
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    onclose();
  }
</script>

<svelte:window onkeydown={handleKey} />

{#snippet again(replay: () => void)}
  {#if poster}
    <img class="hero-film__still" src={getThumbnailUrl(poster, 'lg')} alt="" />
  {/if}
  <button type="button" class="hero-film__again" onclick={replay}>
    <RefreshCwIcon size={16} />
    {m.player_watch_again()}
  </button>
{/snippet}

<div
  class="hero-film"
  style:--film-x="{originX}%"
  style:--film-y="{originY}%"
>
  <div class="hero-film__frame" role="region" aria-label={title}>
    {#if Player}
      <Player
        {src}
        {renew}
        {poster}
        {title}
        stillFit="cover"
        start="sound"
        takeFocus
        onended={ended}
        onfail={failedToPlay}
        ended={again}
      />
    {:else if failed}
      <p class="hero-film__error" role="alert">{m.player_error()}</p>
    {/if}
    <button
      bind:this={closeButton}
      type="button"
      class="hero-film__close"
      onclick={onclose}
      aria-label={m.player_close()}
    >
      <XIcon size={20} />
    </button>
  </div>
</div>

<style>
  /* The hero's whole box, so the frame centres in it; clicks pass to the
     frame alone. Its size is the frame's container. */
  .hero-film {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-items: center;
    padding: var(--space-16) var(--space-6) var(--space-8);
    container-type: size;
    pointer-events: none;
    animation: hero-film-bloom var(--duration-slower) var(--ease-out) backwards;
  }

  /* Opens from the chip. No fill after: the finished film carries no clip. */
  @keyframes hero-film-bloom {
    from {
      clip-path: circle(0% at var(--film-x) var(--film-y));
    }
    to {
      clip-path: circle(150% at var(--film-x) var(--film-y));
    }
  }

  /* 16:9, as large as the hero allows, in a halo that melts into it. */
  .hero-film__frame {
    position: relative;
    inline-size: min(100cqw, var(--container-xl), 100cqh * 16 / 9);
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: var(--radius-lg);
    background: var(--color-neutral-900);
    box-shadow: 0 0 var(--space-16) var(--space-6) var(--color-player-overlay);
    pointer-events: auto;
  }

  .hero-film__close {
    position: absolute;
    inset-block-start: var(--space-3);
    inset-inline-end: var(--space-3);
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: var(--tap-target-min);
    block-size: var(--tap-target-min);
    border: none;
    border-radius: var(--radius-full);
    background: var(--color-player-surface-hover);
    color: var(--color-player-text);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-default);
  }

  .hero-film__close:hover {
    background: var(--color-player-surface-active);
  }

  .hero-film__close:focus-visible {
    outline: var(--border-width-thick) solid var(--color-player-text);
    outline-offset: var(--space-1);
  }

  /* The lapsed layer: the poster again, under "Watch again". */
  .hero-film__still {
    position: absolute;
    inset: 0;
    z-index: -1;
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  .hero-film__again {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-block-size: var(--tap-target-min);
    padding: var(--space-2) var(--space-5) var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-full);
    background: var(--color-player-overlay-heavy);
    color: var(--color-player-text);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    cursor: pointer;
  }

  .hero-film__again:focus-visible {
    outline: var(--border-width-thick) solid var(--color-player-text);
    outline-offset: var(--space-1);
  }

  .hero-film__error {
    position: absolute;
    inset-block-end: var(--space-8);
    inset-inline-start: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: var(--space-2) var(--space-4);
    background: var(--color-error-50);
    color: var(--color-error-700);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .hero-film {
      animation: none;
    }

    .hero-film__close {
      transition: none;
    }
  }
</style>
