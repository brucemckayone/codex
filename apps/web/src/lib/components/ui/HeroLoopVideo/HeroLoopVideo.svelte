<!--
  @component HeroLoopVideo

  An ambient, silent, looping backdrop for a journey hero's media plate — the
  `loop` value of the hero's `heroMedia` mode (`Codex-uj4jc`).

  This is NOT a player. There are no controls, no sound, no playhead and nothing
  focusable: the footage is decoration in exactly the sense the hero's ember glow
  and motes are decoration, which is why the element is `aria-hidden`. Anything a
  visitor is meant to WATCH belongs in the `click` mode, which opens
  `IntroVideoModal` with real controls and a caption slot.

  ── WHY REDUCED MOTION GETS THE POSTER, NOT A PAUSED VIDEO ─────────────────
  A looping backdrop is continuous decoration, which is the precise category
  `prefers-reduced-motion` and the `motion: none` axis exist to remove
  (`docs/design/journey-sections/02-axis-contract.md`). So under reduced motion
  this component never constructs a player at all — it renders the poster still
  and stops. That is cheaper than pausing a video (no manifest fetch, no MSE, no
  hls.js bundle) and it is the same still the `image` mode would have shown, so
  the hero looks deliberate rather than broken.

  ── AUTOPLAY ───────────────────────────────────────────────────────────────
  Muted autoplay is permitted by every current browser; unmuted is not, and
  `playsinline` is required or iOS Safari takes the video fullscreen. If `play()`
  is still refused, the `poster` attribute keeps the frame on screen, so a
  blocked autoplay degrades to exactly the `image` mode rather than to a black
  box. `muted` is set as an attribute AND imperatively, because a late-set
  property is what some engines actually consult.

  ── TEARDOWN ───────────────────────────────────────────────────────────────
  `createHlsPlayer` returns a HANDLE, `{ hls, cleanup }`, not a player. Calling
  `.destroy()` on the handle throws and leaves the real instance alive, which is
  the bug that leaked an hls.js worker on every open of `IntroVideoModal` and
  `HeroInlineVideo` until `28e5daba`. Both halves are needed: `cleanup()` removes
  the Safari native `error` listener, `hls.destroy()` kills the MSE player.
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import type Hls from 'hls.js';
  import { createHlsPlayer } from '$lib/components/VideoPlayer/hls';

  interface Props {
    /** HLS manifest URL — the 30s public sell preview, not the full asset. */
    src: string;
    /** The frame shown before, instead of, and underneath the footage. */
    posterUrl?: string | null;
  }

  const { src, posterUrl = null }: Props = $props();

  let videoEl = $state<HTMLVideoElement | undefined>(undefined);
  let hlsInstance = $state<Hls | null>(null);
  let hlsCleanup = $state<(() => void) | null>(null);

  /**
   * True when the visitor has asked for less motion. Read once per mount and
   * kept live, so flipping the OS preference mid-session takes effect — the
   * hero's own enhancement gate does the same.
   */
  let reduced = $state(false);

  $effect(() => {
    if (!browser) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mql.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reduced = e.matches;
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });

  /** See the component comment: the handle's two halves are both required. */
  function teardownHls() {
    if (hlsCleanup) {
      hlsCleanup();
      hlsCleanup = null;
    }
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
  }

  $effect(() => {
    if (!browser || reduced || !videoEl || !src) return;

    let destroyed = false;
    const media = videoEl;

    async function init() {
      try {
        const handle = await createHlsPlayer({ media, src });
        if (destroyed) {
          handle.cleanup();
          handle.hls?.destroy();
          return;
        }
        hlsInstance = handle.hls;
        hlsCleanup = handle.cleanup;

        media.muted = true;
        media.loop = true;
        try {
          await media.play();
        } catch {
          // Autoplay refused — the poster attribute is already showing the
          // frame, so this degrades to the `image` mode. Nothing to report.
        }
      } catch {
        // A backdrop that cannot load is not an error a visitor can act on, and
        // the poster is already in place. Staying silent is the correct
        // behaviour here specifically because nothing is being withheld.
      }
    }

    init();

    return () => {
      destroyed = true;
      teardownHls();
    };
  });
</script>

{#if reduced || !src}
  <!-- Continuous decoration, removed by preference. The still is the fallback. -->
  {#if posterUrl}
    <img class="hero-loop__still" src={posterUrl} alt="" decoding="async" />
  {:else}
    <span class="hero-loop__plate" aria-hidden="true"></span>
  {/if}
{:else}
  <!--
    No caption track, and no `svelte-ignore` for one either: Svelte's
    `a11y_media_has_caption` rule exempts `muted` elements, so suppressing it
    would be suppressing a warning that never fires. (Prose after a
    `svelte-ignore` code is also parsed as further codes, so a justification
    belongs in a comment like this one rather than on that line.) The backdrop is
    silent, `aria-hidden` and carries nothing the hero's own copy does not —
    anything meant to be watched belongs in the `click` mode, which has captions.
  -->
  <video
    bind:this={videoEl}
    class="hero-loop__video"
    poster={posterUrl ?? undefined}
    muted
    loop
    playsinline
    preload="metadata"
    aria-hidden="true"
    tabindex="-1"
  ></video>
{/if}

<style>
  .hero-loop__video,
  .hero-loop__still {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
    /* The plate's own radius/mask comes from the `media` axis on the ancestor,
       so this element deliberately declares no shape of its own. */
  }

  .hero-loop__plate {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    background: var(--jp-media-plate, var(--color-surface-secondary));
  }
</style>
