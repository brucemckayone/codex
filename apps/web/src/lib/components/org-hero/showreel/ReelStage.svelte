<!--
  @component ReelStage

  The Showreel's stage (Codex-1yd58.6): the box the film plays in (the hero's
  own), the source media, and what the window's shader is told about them.

  ── ONE COPY OF THE FILM, TWO WAYS TO SEE IT ────────────────────────────────
  Each entry's still and (on the footage path) its silent preview live here,
  inside the stage, as ordinary elements. The window's shader composites the
  playing one into its fixed canvas through `showreelFeed`; once a frame of it
  is on the GPU, ShaderHero sets `data-film` and the layout rule below puts
  these elements at opacity 0. They are never removed or `display: none`, so
  a phone keeps decoding the video the canvas draws (the WP-1 spike). Without
  WebGL2, with a lost context, a broken compositor, no JavaScript or before
  hydration, there is no `data-film`, and these same elements ARE the film.

  ── THE FIXED STAGE ────────────────────────────────────────────────────────
  The stage is measured on layout and resize only (`r.top + scrollY`, its
  place in the document) and held in window space by the compositor: the
  film holds still while the words scroll over it, and fades as the hero
  leaves (WP-1's variant C). Only the fade reads the scroll.

  ── THE PUSH-IN ─────────────────────────────────────────────────────────────
  With `look.push` (WP-5b, owner 2026-11-21: on by default), the still on
  show is drawn slowly in about its centre over its piece, by the curve the
  compositor's `media-push` draws on the canvas (`pushZoom`, stage.ts), on
  the same clock: the reel's own (`--_progress`, which the reel writes each
  frame, as `pieceSeconds` reads it for the canvas). So it restarts as its
  piece comes round, holds wherever it is while the reel holds (paused,
  pressed, a hidden tab: WCAG 2.2.2), and runs under the canvas too, so a
  lost context hands over mid-move. Footage plays, so a video with a frame
  never pushes; with the reel held still (reduced motion), no still does.

  ── iOS DECODE ERROR 3 ─────────────────────────────────────────────────────
  Safari can answer MEDIA_ERR_DECODE after the page returns from the
  background. The entry shows its still (here and on the canvas), its player
  is rebuilt, and the video returns on its first frame. Twice per entry; then
  the entry shows its still for the visit.
-->
<script lang="ts">
  import { showreelFeed } from '$lib/components/ui/ShaderHero/compositor/showreel-feed';
  import {
    type FilmLook,
    PUSH_DEPTH,
    PUSH_SECONDS,
    stageBoxFrom,
  } from '$lib/components/ui/ShaderHero/compositor/stage';
  import { logImageFailure } from '$lib/components/ui/FallbackImage/log-image-failure';
  import { logger } from '$lib/observability';
  import { PIECE_MS } from '$lib/org-hero/showreel/reel-clock.svelte';
  import type { ReelMedia } from '$lib/org-hero/showreel/reel-media';
  import { getThumbnailSrcset } from '$lib/utils/image';

  type HlsHandle = Awaited<ReturnType<typeof import('$lib/components/VideoPlayer/hls').createHlsPlayer>>;

  interface Props {
    media: readonly ReelMedia[];
    /**
     * Each entry's key (`reelKeys`), beside its media. The stage keeps an
     * entry's elements and state by it, so a refresh that moves an entry
     * leaves its film playing where it was.
     */
    keys: readonly string[];
    /** The entry on show. */
    index: number;
    /** The footage plays: not paused, with the tab and the hero in view. */
    playing: boolean;
    look: FilmLook;
    /** A recording's theatre is open: the shader alone, behind its cover. */
    withheld?: boolean;
  }

  let { media, keys, index, playing, look, withheld = false }: Props = $props();

  /** Rebuilds of one entry's player after a decode error, before it shows its still. */
  const RESTARTS = 2;
  const MEDIA_ERR_DECODE = 3;

  let stageEl: HTMLDivElement | undefined = $state();
  // Each entry's state, by its key.
  const videos: Record<string, HTMLVideoElement | null | undefined> = $state({});
  const stills: Record<string, HTMLImageElement | null | undefined> = $state({});
  /** The video has a frame to show. */
  const framed: Record<string, boolean> = $state({});
  /** The browser refused to play it (Low Power Mode, a data saver): its still shows. */
  const refused: Record<string, boolean> = $state({});
  /** The still has loaded. */
  const loaded: Record<string, boolean> = $state({});
  const brokenStill: Record<string, boolean> = $state({});
  /** Rebuilds so far; a new value rebuilds the player. */
  const restarts: Record<string, number> = $state({});
  /** The footage gave up: the still shows for the visit. */
  const dead: Record<string, boolean> = $state({});
  /** The attempt whose failure was handled, so hls.js's report and the
   *  element's own `error` for one failure count once. */
  const failedAt: Record<string, number> = $state({});

  const next = $derived(media.length > 1 ? (index + 1) % media.length : index);
  /** The entry at `i`, by its key. */
  const keyAt = (i: number) => keys[i] ?? String(i);
  /** The key of the entry on show. */
  const on = $derived(keyAt(index));

  /** The video shows: it has a frame, it plays, and it is not given up on. */
  const shows = (k: string) => framed[k] === true && !refused[k] && !dead[k];

  // What the canvas shows: the video once it has a frame, else the still.
  $effect(() => {
    const video = videos[on];
    const still = stills[on];
    if (withheld) showreelFeed.setMedia(null);
    else if (video && shows(on)) showreelFeed.setMedia(video);
    else showreelFeed.setMedia(still && loaded[on] ? still : null);
  });

  $effect(() => {
    showreelFeed.setLook(look);
  });

  $effect(() => {
    const el = stageEl;
    if (!el) return;
    const measure = () =>
      showreelFeed.setStage(stageBoxFrom(el.getBoundingClientRect(), window.scrollY, el.offsetHeight));
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });

  $effect(() => {
    return () => {
      showreelFeed.setMedia(null);
      showreelFeed.setStage(null);
      showreelFeed.setLook(null);
    };
  });

  /**
   * Play it. A refusal (`NotAllowedError`: iOS Low Power Mode, a data saver)
   * shows its still instead of a frozen first frame. Anything else refused
   * nothing: a play cut short by a pause or a new load (`AbortError`), and a
   * source that fails, which `failed()` hears from the player or the element.
   */
  function play(video: HTMLVideoElement, k: string) {
    video.play().then(
      () => {
        refused[k] = false;
      },
      (error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'NotAllowedError')) return;
        refused[k] = true;
        logger.debug('showreel.footage_refused', { reason: error.name });
      }
    );
  }

  /**
   * Play the film on show again if the browser refused it. Call it from the
   * visitor's own gesture (a tap): the one a refusal waits for.
   */
  export function retry() {
    const video = videos[on];
    if (video && refused[on] && playing) play(video, on);
  }

  /** Play the one on show, from its start each time it comes round; pause the rest. */
  let shownAt: string | null = null;
  /** The piece on show has started its film: a pause and play resumes it. */
  let started = false;
  $effect(() => {
    if (on !== shownAt) {
      shownAt = on;
      started = false;
    }
    for (const [k, video] of Object.entries(videos)) {
      if (!video) continue;
      if (k !== on || !playing) {
        video.pause();
        continue;
      }
      // Reached while paused, it starts from its start when play comes.
      if (!started) video.currentTime = 0;
      started = true;
      play(video, k);
    }
  });

  function failed(k: string, kind: string) {
    const attempt = restarts[k] ?? 0;
    if (failedAt[k] === attempt) return;
    failedAt[k] = attempt;
    framed[k] = false;
    const decode = kind === 'media' || videos[k]?.error?.code === MEDIA_ERR_DECODE;
    if (decode && attempt < RESTARTS) {
      restarts[k] = attempt + 1;
      logger.warn('showreel.footage_restarted', { kind, attempt: attempt + 1 });
      return;
    }
    dead[k] = true;
    logger.warn('showreel.footage_failed', { kind, attempt });
  }

  // Back from the background: a video that errored while hidden restarts.
  $effect(() => {
    const back = () => {
      if (document.visibilityState !== 'visible') return;
      if (videos[on]?.error) failed(on, 'media');
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('pageshow', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('pageshow', back);
    };
  });

  /**
   * The entry's preview, attached while it plays or plays next, so a cut
   * never waits on buffering, and detached otherwise. hls.js stays out of
   * the landing's static bundle (WP-0's note): it loads with the first film.
   *
   * Every argument is a settled value (`{@const}` in the markup): Svelte
   * re-runs an attachment whenever what its expression reads changes, and a
   * re-run tears the player down. So a cut, which moves `index` and `next`,
   * leaves alone the film it plays next, the one it preloaded.
   */
  // `_attempt` re-runs the attachment: a new value rebuilds the player.
  function source(src: string, active: boolean, _attempt: number, k: string) {
    return (video: HTMLVideoElement) => {
      if (!active) return;
      let gone = false;
      let handle: HlsHandle | null = null;
      // An attachment torn down while hls.js loads builds nothing: a restart
      // or a cut re-runs it on the SAME element, and a late player there
      // would fight the new one for its source.
      import('$lib/components/VideoPlayer/hls')
        .then(({ createHlsPlayer }) =>
          gone
            ? null
            : createHlsPlayer({
                media: video,
                src,
                onError: (_message, kind) => {
                  if (!gone) failed(k, kind);
                },
              })
        )
        .then((made) => {
          if (!made) return;
          if (gone) {
            made.cleanup();
            made.hls?.destroy();
            return;
          }
          handle = made;
          if (k === on && playing) play(video, k);
        })
        .catch(() => {
          if (!gone) failed(k, 'load');
        });
      return () => {
        gone = true;
        handle?.cleanup();
        handle?.hls?.destroy();
        framed[k] = false;
      };
    };
  }

  function stillLoaded(k: string) {
    return (img: HTMLImageElement) => {
      // Loaded before hydration: no `load` event comes.
      if (img.complete && img.naturalWidth > 0) loaded[k] = true;
    };
  }

  function stillFailed(k: string, event: Event) {
    loaded[k] = false;
    brokenStill[k] = true;
    const img = event.currentTarget;
    if (img instanceof HTMLImageElement) logImageFailure(img.currentSrc || img.src);
  }
</script>

<div
  class="reel-stage"
  bind:this={stageEl}
  data-frame={look.frame}
  data-withheld={withheld ? '' : undefined}
  data-band={look.band === 'none' ? undefined : look.band}
  data-push={look.push ? '' : undefined}
  style:--_push-depth={PUSH_DEPTH}
  style:--_push-rate={PIECE_MS / 1000 / PUSH_SECONDS}
  aria-hidden="true"
>
  {#each media as item, i (keyAt(i))}
    {@const k = keyAt(i)}
    {@const footage = item.footage}
    {@const active = i === index || i === next}
    {@const attempt = restarts[k] ?? 0}
    <div class="reel-stage__item" data-on={i === index ? '' : undefined}>
      {#if item.still && !brokenStill[k]}
        <img
          bind:this={stills[k]}
          {@attach stillLoaded(k)}
          src={item.still}
          srcset={getThumbnailSrcset(item.still) || undefined}
          sizes="100vw"
          alt=""
          crossorigin="anonymous"
          decoding="async"
          loading={i === 0 ? 'eager' : 'lazy'}
          fetchpriority={i === 0 ? 'high' : undefined}
          onload={() => (loaded[k] = true)}
          onerror={(event) => stillFailed(k, event)}
        />
      {/if}
      {#if footage && !dead[k]}
        <video
          bind:this={videos[k]}
          {@attach source(footage, active, attempt, k)}
          data-framed={shows(k) ? '' : undefined}
          muted
          loop
          playsinline
          preload="metadata"
          crossorigin="anonymous"
          disablepictureinpicture
          disableremoteplayback
          tabindex="-1"
          onloadeddata={() => (framed[k] = true)}
          onerror={() => failed(k, 'media')}
        ></video>
      {/if}
    </div>
  {/each}
</div>

<style>
  .reel-stage {
    position: absolute;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    pointer-events: none;
  }

  .reel-stage__item {
    position: absolute;
    inset: 0;
    opacity: 0;
  }

  .reel-stage__item[data-on] {
    opacity: 1;
  }

  .reel-stage__item img,
  .reel-stage__item video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* The poster shows until the video has a frame. */
  .reel-stage__item video:not([data-framed]) {
    opacity: 0;
  }

  /* The push-in (see THE PUSH-IN): the still on show, never footage with a
     frame. `pushZoom`'s curve, eased out then held, at the piece's share
     played (`--_progress`, 0 to 1) over the share of it a push takes. */
  @media (prefers-reduced-motion: no-preference) {
    .reel-stage[data-push] .reel-stage__item[data-on]:not(:has(> video[data-framed])) > img {
      --_t: min(1, var(--_progress, 0) * var(--_push-rate));

      transform: scale(calc(1 + var(--_push-depth) * (1 - (1 - var(--_t)) * (1 - var(--_t)))));
    }
  }

  /* The band, drawn by the page when the canvas cannot: the film gives way
     at its foot (the page has no smoke, so 'under' fades evenly too), and
     for 'edges' at its sides and top as well. The ramps are bandRamp's
     (compositor/stage.ts), as percentages. */
  .reel-stage {
    --_band-top: 50%;
    --_band-end: 95%;
  }

  .reel-stage[data-band] {
    mask-image: linear-gradient(to bottom, black var(--_band-top), transparent var(--_band-end));
  }

  .reel-stage[data-band='under'] {
    --_band-top: 40%;
    --_band-end: 82%;
  }

  .reel-stage[data-band='edges'] {
    mask-image:
      linear-gradient(to bottom, black var(--_band-top), transparent var(--_band-end)),
      linear-gradient(to bottom, transparent, black 20%),
      linear-gradient(to right, transparent, black 12%, black 88%, transparent);
    mask-composite: intersect;
  }

  /* The Name window shows the film through the letters (the title's own
     background in the page); the stage behind stays out of sight. */
  .reel-stage[data-frame='film-name'] {
    opacity: 0;
  }

  /* A recording's theatre: its cover sits over the shader alone. */
  .reel-stage[data-withheld] {
    opacity: 0;
  }

  /* The canvas shows the film: these copies only keep decoding. */
  :global(.org-layout:has(> .shader-hero--fullpage[data-film])) .reel-stage {
    opacity: 0;
  }

  @media (--below-md) {
    .reel-stage {
      --_band-top: 44%;
      --_band-end: 84%;
    }

    .reel-stage[data-band='under'] {
      --_band-top: 38%;
      --_band-end: 76%;
    }
  }
</style>
