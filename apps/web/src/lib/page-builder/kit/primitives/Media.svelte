<!--
  @component Media

  One image or ambient clip, at an aspect ratio, in the Style's media shape.
  With nothing to show it draws a designed PLATE — the scheme's panel colour
  with a disc and ring watermarked in the panel's own ink (glows in
  Cinematic) — so an image-led layout still looks composed before its image
  exists, or without one. A blank box reads as broken.

  The clip is decoration (`HeroLoopVideo` is silent, `aria-hidden`, and shows
  its still under reduced motion); anything meant to be watched is a separate
  player the block opens.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { HeroLoopVideo } from '$lib/components/ui/HeroLoopVideo';
  import type { PreviewMedia } from '../../render/types';

  interface Props {
    image?: string | null;
    clip?: PreviewMedia | null;
    /** Describe the image; `''` marks it decorative. */
    alt?: string;
    /** CSS aspect ratio, e.g. `'4 / 5'`; omit to fill the parent. */
    ratio?: string;
    /** The page's largest image: load it first. */
    priority?: boolean;
    /** Waiting for the streamed media — the plate holds the space. */
    pending?: boolean;
    scrim?: boolean;
    /** Controls laid over the media (a play button). */
    children?: Snippet;
    class?: string;
  }

  const {
    image = null,
    clip = null,
    alt = '',
    ratio,
    priority = false,
    pending = false,
    scrim = false,
    children,
    class: className,
  }: Props = $props();

  // An image that fails (deleted, missing variant, CDN hiccup) falls back to
  // the plate instead of a broken-image glyph. Keyed by URL, so a different
  // image gets its own chance.
  let failed = $state<string | null>(null);
  const still = $derived.by(() => {
    const url = image ?? clip?.posterUrl ?? null;
    return url && url !== failed ? url : null;
  });
  const empty = $derived(!clip && !still);
</script>

<div
  class="lp-media {className ?? ''}"
  data-empty={empty ? '' : undefined}
  data-pending={pending ? '' : undefined}
  style:aspect-ratio={ratio}
>
  {#if clip}
    <HeroLoopVideo src={clip.playlistUrl} posterUrl={still} />
  {:else if still}
    <img
      src={still}
      {alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchpriority={priority ? 'high' : undefined}
      decoding="async"
      onerror={() => (failed = still)}
    />
  {:else}
    <span class="lp-media__plate" aria-hidden="true"></span>
  {/if}
  {#if scrim && !empty}<span class="lp-media__scrim" aria-hidden="true"></span>{/if}
  {#if children}<div class="lp-media__overlay">{@render children()}</div>{/if}
</div>

<style>
  .lp-media {
    position: relative;
    overflow: hidden;
    border-radius: var(--lp-radius-media);
    background: var(--lp-panel);
    isolation: isolate;
  }

  .lp-media > img,
  .lp-media > :global(.hero-loop__video),
  .lp-media > :global(.hero-loop__still),
  .lp-media > :global(.hero-loop__plate) {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  /* The marks are the PANEL's ink mixed into the panel, so they are measured
     against the surface they sit on in every scheme and theme — a watermark
     that says a picture goes here, quieter than any word (about 1.5:1 and
     2.2:1). Never the section's accent: on a brand band that is the band's
     ink, white on a near-white panel. Half a hairline past each hard stop, so
     the disc and ring edges anti-alias. */
  .lp-media__plate {
    --_aa: calc(var(--border-width) / 2);
    --_disc: color-mix(in oklab, var(--lp-panel-ink) 18%, var(--lp-panel));
    --_ring: color-mix(in oklab, var(--lp-panel-ink) 32%, var(--lp-panel));
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 70% 36%, var(--_disc) 0 17%, transparent calc(17% + var(--_aa))),
      radial-gradient(
        circle at 38% 62%,
        transparent 0 27%,
        var(--_ring) 27% calc(27% + var(--border-width-thick)),
        transparent calc(27% + var(--border-width-thick) + var(--_aa))
      ),
      var(--lp-panel);
  }

  :global(.lp[data-lp-style='cinematic']) .lp-media__plate {
    background:
      radial-gradient(
        ellipse 60% 55% at 30% 35%,
        color-mix(in oklch, var(--lp-brand) 55%, white 45%) 0%,
        transparent 65%
      ),
      radial-gradient(
        ellipse 55% 60% at 75% 70%,
        color-mix(in oklch, var(--lp-brand-2) 50%, white 45%) 0%,
        transparent 62%
      ),
      var(--lp-panel);
    opacity: 0.85;
  }

  .lp-media__overlay {
    position: absolute;
    inset-inline-start: var(--space-4);
    inset-block-end: var(--space-4);
  }

  .lp-media__scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to top,
      var(--lp-media-scrim) 0%,
      color-mix(in oklab, var(--lp-media-scrim) 60%, transparent) 45%,
      transparent 80%
    );
    pointer-events: none;
  }
</style>
