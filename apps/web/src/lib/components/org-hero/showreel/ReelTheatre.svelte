<!--
  @component ReelTheatre

  The Showreel's theatre (Codex-1yd58.8, plan §4; the v4 mock's): a piece's
  preview with sound, opened by a press, inside the hero. A film fills the
  hero (or plays whole on the dark where filling would crop more than 40%
  of it: `theatreFit`); a recording shows its cover over the brand's
  shader, its name, and a waveform of its sound. Along the foot a bar gives
  pause, the time, sound and close. Escape closes it and Tab stays inside;
  the Showreel gives focus back to what opened it, once the reel behind is
  no longer inert (review H1, 2026-11-21: asked from here, while it still
  was, focus fell to the body). On a phone it takes the whole screen, the
  page's own tab bar steps aside (`data-covers-page`), and the page behind
  holds still. It says when the preview played to its
  end (`onclose('ended')`), so the reel carries on.

  It plays through `PreviewPlayerCore`, as every film on the site does,
  with the core's own controls off: the bar drives it through the core's
  `toggle` and `toggleMute`, and reads it through its `clock` (ListenCard's
  way). Mount it in the press's own tick (`flushSync`), with the core
  already loaded (`preloadPlayerOnIntent` on the button), so its `play()`
  keeps the sound; otherwise it waits for the core and may start muted, and
  the sound button then reads "Tap for sound".

  ── THE WAVEFORM ──────────────────────────────────────────────────────────
  A recording's sound is read through an AnalyserNode (`reel-waveform.ts`),
  only from hls.js's same-origin stream and only while the context the
  press made is running: tapping a stream the page may not read would
  silence it. Anywhere else the bars rest; under reduced motion no context
  is made at all (they would rest anyway). A context the system interrupts
  (an iPhone's call, Siri) is resumed when it says so, and again on each
  press of the bar, which is the gesture a resume may wait for.

  ── PAUSE ─────────────────────────────────────────────────────────────────
  The reel's own pause is hidden while the theatre is open, so the
  theatre's pause stops everything that moves, the shader included, as the
  reel's does (WCAG 2.2.2; owner Q6).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { loadedPlayerCore, loadPlayerCore, type PlayerCore } from '$lib/components/player/load-core';
  import { clock, type PlayerClock } from '$lib/components/player/timeline';
  import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon, XIcon } from '$lib/components/ui/Icon';
  import { shaderTone } from '$lib/components/ui/ShaderHero/shader-tone';
  import { logger } from '$lib/observability';
  import { barLevels, tapWaveform, WAVE_BARS, type WaveTap } from '$lib/org-hero/showreel/reel-waveform';
  import { type TheatreItem, theatreFit } from '$lib/org-hero/showreel/theatre';
  import { getThumbnailSrcset, getThumbnailUrl } from '$lib/utils/image';
  import { lockScroll } from '$lib/utils/scroll-lock';
  import { tabTarget } from '$lib/utils/tab-trap';
  import * as m from '$paraglide/messages';

  interface Props {
    item: TheatreItem;
    /** The close button's name; the player's own ("Close video") until set. */
    closeLabel?: string;
    /** The line under a recording's name, from the preview's length once it says. */
    caption?: (seconds: number | null) => string;
    /** `ended`: the preview played to its end, and the reel carries on. */
    onclose: (reason: 'closed' | 'ended') => void;
  }

  const {
    item,
    closeLabel = m.player_close(),
    caption = () => m.player_preview_label(),
    onclose,
  }: Props = $props();

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

  // The complement of `--below-md` (breakpoints.css), as the Showreel reads it.
  const desktop = new MediaQuery('(min-width: 48rem)');
  const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');

  let root: HTMLDivElement | undefined = $state();
  let pauseButton: HTMLButtonElement | undefined = $state();
  let waveEl: HTMLDivElement | undefined = $state();

  // ── the player: mounted with the theatre when its code is in ──
  let Player = $state.raw<PlayerCore | null>(loadedPlayerCore());
  let core = $state.raw<ReturnType<PlayerCore> | null>(null);
  let error = $state<string | null>(null);
  $effect(() => {
    if (Player) return;
    let gone = false;
    loadPlayerCore().then(
      (loaded) => {
        if (!gone) Player = loaded;
      },
      () => {
        if (!gone) error = m.player_error();
      }
    );
    return () => {
      gone = true;
    };
  });

  const now = $derived(core?.clock() ?? SILENT);
  const busy = $derived(
    !error &&
      (!core || (!now.ready && now.wanted) || ((now.waiting || now.resuming) && !now.offerPlay))
  );
  const played = $derived(now.duration > 0 ? Math.min(1, now.time / now.duration) : 0);
  const time = $derived(now.duration > 0 ? `${clock(now.time)} / ${clock(now.duration)}` : clock(now.time));

  // ── its element: sound on or off, and its shape for the fit ──
  let media = $state.raw<HTMLVideoElement | null>(null);
  let muted = $state(false);
  let filmSize = $state({ width: 16, height: 9 });
  let boxSize = $state({ width: 0, height: 0 });
  $effect(() => {
    if (!core || !root) return;
    const el = root.querySelector<HTMLVideoElement>('.theatre__player video');
    media = el;
    if (!el) return;
    const sound = () => (muted = el.muted);
    const shape = () => {
      if (el.videoWidth > 0) filmSize = { width: el.videoWidth, height: el.videoHeight };
    };
    sound();
    shape();
    el.addEventListener('volumechange', sound);
    el.addEventListener('loadedmetadata', shape);
    return () => {
      el.removeEventListener('volumechange', sound);
      el.removeEventListener('loadedmetadata', shape);
    };
  });
  $effect(() => {
    const el = root;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      boxSize = { width: el.clientWidth, height: el.clientHeight };
    });
    observer.observe(el);
    return () => observer.disconnect();
  });
  const fit = $derived(theatreFit(boxSize, filmSize));

  // ── a recording's waveform ──
  // Made in the press's tick, so it starts running (reel-waveform.ts). None
  // under reduced motion: its bars would rest, so nothing taps the sound.
  const context =
    untrack(() => item.kind) === 'audio' && !untrack(() => reducedMotion.current) ? makeContext() : null;
  function makeContext(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null;
    const made = new AudioContext();
    // A resume the browser refuses leaves the context suspended, and `canTap`
    // then leaves the bars at rest: the sound itself is untouched.
    void made.resume().catch(() => {});
    return made;
  }
  /** Run the context again if it stopped: once tapped, the sound goes through it. */
  function wake() {
    if (context && context.state !== 'running' && context.state !== 'closed') {
      void context.resume().catch(() => {});
    }
  }
  // An interruption (an iPhone's call, Siri, another app's sound) leaves it
  // suspended or 'interrupted', and a tapped recording silent: resume it as
  // soon as it says so (review M3).
  $effect(() => {
    const ctx = context;
    if (!ctx) return;
    ctx.addEventListener('statechange', wake);
    return () => ctx.removeEventListener('statechange', wake);
  });
  let tap = $state.raw<WaveTap | null>(null);
  $effect(() => {
    const el = media;
    const ctx = context;
    if (!el || !ctx) return;
    let made: WaveTap | null = null;
    const playing = () => {
      if (made) return;
      try {
        made = tapWaveform(el, ctx);
      } catch (cause) {
        // The bars rest: the sound was wired to the speakers first.
        logger.warn('showreel.waveform_untapped', {
          reason: cause instanceof Error ? cause.name : 'unknown',
        });
      }
      tap = made;
    };
    el.addEventListener('playing', playing);
    return () => {
      el.removeEventListener('playing', playing);
      made?.close();
      tap = null;
    };
  });
  $effect(() => () => {
    void context?.close().catch(() => {});
  });

  const bars = $derived(Array.from({ length: desktop.current ? WAVE_BARS.desk : WAVE_BARS.phone }, (_, i) => i));
  $effect(() => {
    const el = waveEl;
    const source = tap;
    if (!el || !source || now.offerPlay || reducedMotion.current) {
      for (const bar of el?.children ?? []) if (bar instanceof HTMLElement) bar.style.removeProperty('--_l');
      return;
    }
    let frame = 0;
    const step = () => {
      const levels = barLevels(source.read(), el.children.length);
      for (const [i, bar] of [...el.children].entries()) {
        if (bar instanceof HTMLElement) bar.style.setProperty('--_l', String(levels[i] ?? 0));
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  });

  // ── what stops: the theatre's pause holds the shader too ──
  $effect(() => {
    if (!core || !now.offerPlay) return;
    return shaderTone.hold();
  });

  // ── a phone's whole screen: the page behind holds still ──
  $effect(() => {
    if (desktop.current) return;
    return lockScroll();
  });

  // ── focus: in on open. The Showreel gives it back on close, once the reel
  // behind it is no longer inert (review H1). ──
  $effect(() => {
    pauseButton?.focus({ preventScroll: true });
  });

  /**
   * Escape closes; Tab stays inside, from the last control to the first and
   * back. Heard on the window (IntroVideoModal's reason): a control that
   * goes, a failed film's included, drops focus to the body.
   */
  function handleKey(event: KeyboardEvent) {
    if (event.defaultPrevented || !root) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose('closed');
      return;
    }
    if (event.key !== 'Tab') return;
    const at = document.activeElement;
    const stops = [...root.querySelectorAll<HTMLElement>('.theatre__bar button:not([disabled])')];
    const target = tabTarget(stops, at, { back: event.shiftKey, inside: root.contains(at), root });
    if (!target) return;
    event.preventDefault();
    // A mouse user tabbing back in from the header is not scrolled (review L7).
    target.focus({ preventScroll: true });
  }

  function togglePlay() {
    wake();
    core?.toggle();
  }

  function toggleSound() {
    wake();
    // A refused start: sound now, and a paused preview plays with it.
    if (now.askSound) {
      core?.toggleMute();
      if (now.offerPlay) core?.toggle();
      return;
    }
    core?.toggleMute();
  }

  const soundLabel = $derived(
    now.askSound ? m.player_tap_for_sound() : muted ? m.player_unmute() : m.player_mute()
  );
  const coverSrcset = $derived(item.still ? getThumbnailSrcset(item.still) : '');
</script>

<svelte:window onkeydown={handleKey} />

<div
  class="theatre"
  data-kind={item.kind}
  role="dialog"
  aria-modal="true"
  aria-label={item.title}
  data-covers-page={desktop.current ? undefined : ''}
  tabindex="-1"
  bind:this={root}
>
  {#if item.kind === 'audio'}
    <div class="theatre__audio">
      {#if item.still}
        <img
          class="theatre__cover"
          src={getThumbnailUrl(item.still, 'lg')}
          srcset={coverSrcset || undefined}
          sizes={coverSrcset ? '(min-width: 48rem) 26rem, 18rem' : undefined}
          alt=""
          decoding="async"
        />
      {/if}
      <p class="theatre__caption">
        <span class="theatre__name">{item.title}</span>
        <span class="theatre__length">{caption(now.duration > 0 ? now.duration : null)}</span>
      </p>
      <div class="theatre__wave" aria-hidden="true" data-live={tap ? '' : undefined} bind:this={waveEl}>
        {#each bars as bar (bar)}<span></span>{/each}
      </div>
    </div>
  {/if}

  <!-- A recording's player is its sound only: its picture is the cover. -->
  <div
    class="theatre__player"
    aria-hidden={item.kind === 'audio' || undefined}
    inert={item.kind === 'audio'}
  >
    {#if Player}
      <Player
        bind:this={core}
        src={item.src}
        poster={item.kind === 'video' ? item.still : null}
        title={item.title}
        start="sound"
        controls={false}
        {fit}
        onended={() => onclose('ended')}
        onfail={(message) => (error = message)}
      />
    {/if}
  </div>

  <div class="theatre__bar">
    <button
      type="button"
      class="theatre__round"
      data-role="pause"
      aria-label={now.offerPlay ? m.player_play() : m.player_pause()}
      aria-busy={busy}
      onclick={togglePlay}
      bind:this={pauseButton}
    >
      {#if now.offerPlay}
        <PlayIcon size={18} fill="currentColor" stroke="none" />
      {:else}
        <PauseIcon size={18} fill="currentColor" stroke="none" />
      {/if}
    </button>
    <p class="theatre__title">{item.title}</p>
    <span class="theatre__progress" aria-hidden="true">
      <span class="theatre__played" style:--_played={played}></span>
    </span>
    <!-- Read when reached, never announced: a live time talks over the preview. -->
    <span class="theatre__time">
      <span aria-hidden="true">{time}</span>
      <span class="sr-only">{m.player_time({ time: clock(now.time), duration: clock(now.duration) })}</span>
    </span>
    <button type="button" class="theatre__round" data-role="sound" aria-label={soundLabel} onclick={toggleSound}>
      {#if muted || now.askSound}
        <VolumeXIcon size={18} />
      {:else}
        <Volume2Icon size={18} />
      {/if}
    </button>
    <button
      type="button"
      class="theatre__round"
      data-role="close"
      aria-label={closeLabel}
      onclick={() => onclose('closed')}
    >
      <XIcon size={18} />
    </button>
    <!-- Always mounted and never busy, as ListenCard's is: a busy region's
         changes may go unsaid, so the pause button carries `aria-busy`. -->
    <div class="sr-only" role="status">
      {#if busy}{m.player_loading()}{/if}
    </div>
    {#if error}<p class="theatre__error" role="alert">{error}</p>{/if}
  </div>
</div>

<style>
  /* Inside the Showreel it takes the reel's inks, scrim and pool (the alpha
     under which those inks keep 4.5:1 over ANY pixel: reel-scrim.ts), so
     the bar and the caption hold the floor by construction too. */
  .theatre {
    --_t-ink: var(--_ink, var(--color-player-text));
    --_t-soft: var(--_ink-soft, var(--color-player-text-secondary));
    --_t-scrim: var(--_scrim, var(--media-scrim, var(--color-neutral-900)));
    --_t-pool: var(--_pool, 0.9);

    position: absolute;
    inset: 0;
    z-index: 1;
    color: var(--_t-ink);
    outline: none;
    animation: theatre-in var(--duration-slow) var(--ease-out) both;
  }

  @keyframes theatre-in {
    from {
      opacity: 0;
    }
  }

  .theatre__player {
    position: absolute;
    inset: 0;
  }

  .theatre[data-kind='audio'] .theatre__player {
    opacity: 0;
    pointer-events: none;
  }

  /* ── a recording: its cover over the shader, its name, its sound ── */
  .theatre__audio {
    position: absolute;
    inset-inline: 0;
    inset-block-start: var(--space-24);
    display: grid;
    justify-items: center;
    gap: var(--space-6);
    padding-inline: var(--space-4);
    isolation: isolate;
  }

  .theatre__cover {
    inline-size: min(26rem, 60vw);
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-xl);
  }

  .theatre__caption {
    position: relative;
    display: grid;
    gap: var(--space-2);
    max-width: none;
    margin: 0;
    text-align: center;
  }

  /* The caption's pool, feathered as the reel's are. */
  .theatre__caption::before {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--space-8));
    z-index: -1;
    border-radius: var(--radius-xl);
    background: var(--_t-scrim);
    opacity: var(--_t-pool);
    filter: blur(var(--space-4));
  }

  .theatre__name {
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-normal);
    line-height: var(--leading-none);
  }

  .theatre__length {
    color: var(--_t-soft);
    font-size: var(--text-sm);
  }

  .theatre__wave {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    block-size: var(--space-14);
  }

  .theatre__wave span {
    inline-size: var(--space-1);
    block-size: 100%;
    border-radius: var(--radius-full);
    background: var(--_t-ink);
    /* At rest a short tick; the sound lifts each bar toward the full height. */
    transform: scaleY(calc(0.08 + var(--_l, 0) * 0.92));
  }

  /* ── the bar: pause, the name, the time, sound, close ── */
  .theatre__bar {
    position: absolute;
    inset-inline: var(--space-24);
    inset-block-end: var(--space-12);
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2-5) var(--space-3) var(--space-2-5) var(--space-2-5);
    border-radius: var(--radius-full);
    /* The scrim at the pool's alpha: the floor holds over the film's lightest frame. */
    background: color-mix(in srgb, var(--_t-scrim) calc(var(--_t-pool) * 100%), transparent);
    backdrop-filter: blur(var(--blur-md));
    -webkit-backdrop-filter: blur(var(--blur-md));
    box-shadow: var(--shadow-lg);
    font-size: var(--text-sm);
  }

  .theatre__round {
    display: grid;
    place-items: center;
    flex: none;
    inline-size: var(--space-10);
    block-size: var(--space-10);
    padding: 0;
    border: var(--border-width) solid color-mix(in srgb, var(--_t-ink) 35%, transparent);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--_t-ink);
    cursor: pointer;
  }

  .theatre__round:focus-visible {
    outline: var(--border-width-thick) solid var(--_t-ink);
    outline-offset: var(--space-0-5);
  }

  .theatre__title {
    max-width: 40%;
    margin: 0;
    overflow: hidden;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .theatre__progress {
    flex: 1;
    block-size: var(--space-0-5);
    overflow: hidden;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--_t-ink) 25%, transparent);
  }

  .theatre__played {
    display: block;
    block-size: 100%;
    background: var(--_t-ink);
    transform: scaleX(var(--_played, 0));
    transform-origin: left;
  }

  .theatre__time {
    color: var(--_t-soft);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .theatre__error {
    position: absolute;
    inset-inline: 0;
    inset-block-end: calc(100% + var(--space-3));
    margin: 0;
    max-width: none;
    text-align: center;
  }

  /* ── a phone: the whole screen, and the bar in two rows (the mock's) ── */
  @media (--below-md) {
    /* Over the whole screen: the theatre's own room, as IntroVideoModal's is
       on a phone. The page's tab bar is fixed above the page's own stacking
       context, so it steps aside for `data-covers-page` instead (review M2:
       it painted over the bar, and Search stayed live under the sound). */
    .theatre {
      position: fixed;
      z-index: var(--z-modal);
      background: var(--color-player-overlay-heavy);
      backdrop-filter: blur(var(--blur-2xl));
      -webkit-backdrop-filter: blur(var(--blur-2xl));
    }

    .theatre__audio {
      inset-block-start: var(--space-20);
    }

    .theatre__cover {
      inline-size: min(18rem, 74vw);
    }

    .theatre__name {
      font-size: var(--text-2xl);
    }

    .theatre__bar {
      inset-inline: var(--space-3);
      /* Clear of a phone's home indicator (review M2). */
      inset-block-end: calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
      display: grid;
      grid-template-columns: var(--space-10) minmax(0, 1fr) var(--space-10) var(--space-10);
      grid-template-areas:
        'pause title sound close'
        'track track time time';
      gap: var(--space-3) var(--space-2-5);
      padding: var(--space-3) var(--space-3) var(--space-3-5) var(--space-3-5);
      border-radius: var(--radius-xl);
    }

    .theatre__round[data-role='pause'] {
      grid-area: pause;
    }

    .theatre__round[data-role='sound'] {
      grid-area: sound;
    }

    .theatre__round[data-role='close'] {
      grid-area: close;
    }

    .theatre__title {
      grid-area: title;
      max-width: none;
    }

    .theatre__progress {
      grid-area: track;
      align-self: center;
    }

    .theatre__time {
      grid-area: time;
      justify-self: end;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .theatre {
      animation: none;
    }
  }
</style>
