<!--
  @component HeroSpot

  The org hero's media, beside its words: the Showcase frame (the org's own
  film looping in it, or the spotlight piece in a frame shaped by what it
  holds) and the Split panel. OrgHero decides what is drawn; this draws it.

  ── ITS CSS READS THE HERO'S ROOT ──────────────────────────────────────────
  A rule that depends on the hero's state (composition, alignment, entrance)
  opens with `:global(.org-hero[...])`, OrgHero's root. Scoped or global, that
  compound weighs the same, so every rule here has the specificity it had in
  OrgHero.svelte. The elements stay scoped to this file, and nothing here is
  styled from OrgHero.svelte.
-->
<script lang="ts">
  import { preloadPlayerOnIntent } from '$lib/components/player/load-core';
  import { HeroLoopVideo } from '$lib/components/ui/HeroLoopVideo';
  import { PlayIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import type { HeroFrameShape, HeroOptions, OrgHeroPiece } from '$lib/org-hero/hero-config';
  import { frameSizes, panelSizes } from '$lib/org-hero/hero-image-sizes';
  import { getThumbnailSrcset } from '$lib/utils/image';

  interface Props {
    /** The composition drawn: a billboard whose picture failed draws as Showcase. */
    comp: HeroOptions['comp'];
    spot: OrgHeroPiece | null;
    film: {
      duration: string | null;
      posterUrl: string | null;
      stillUrl: string | null;
      previewUrl: string | null;
    } | null;
    /** The org's own film fills the Showcase frame. */
    filmFrame: boolean;
    frameShape: HeroFrameShape | undefined;
    filmLabel: string;
    onfilm: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void;
    /** False once a picture has failed: the frame draws the brand's plate instead. */
    shows: (url: string | null | undefined) => url is string;
    onimagefail: (event: Event & { currentTarget: HTMLImageElement }) => void;
  }

  const { comp, spot, film, filmFrame, frameShape, filmLabel, onfilm, shows, onimagefail }: Props = $props();
</script>

{#if comp === 'showcase'}
  {#if filmFrame && film?.previewUrl}
    <!-- The org's own film IS the hero's media. It loops silently in the
         frame; the frame is the press that plays it (grown in the hero on a
         desktop, in the pop-up on a phone). -->
    <button
      type="button"
      class="org-hero__frame org-hero__frame--film"
      data-shape="wide"
      onclick={onfilm}
      aria-label={filmLabel}
      {@attach preloadPlayerOnIntent}
    >
      <span class="org-hero__frame-art" aria-hidden="true">
        <HeroLoopVideo
          src={film.previewUrl}
          posterUrl={film.stillUrl ?? film.posterUrl}
          posterSrcset={getThumbnailSrcset(film.stillUrl ?? film.posterUrl)}
          posterSizes={frameSizes(film.stillUrl ?? film.posterUrl ?? '', frameShape)}
        />
      </span>
      <span class="org-hero__film-call" aria-hidden="true">
        <span class="org-hero__film-pill">
          <span class="org-hero__film-disc"><PlayIcon size={22} /></span>
          <span class="org-hero__film-words">
            {m.org_hero_watch_film()}{#if film.duration}<span class="org-hero__film-dur">{film.duration}</span>{/if}
          </span>
        </span>
      </span>
    </button>
  {:else if spot}
    <!-- The spotlight is a FRAME shaped by what it holds (arch / wide / page),
         as tall as the hero. One link: the whole frame. -->
    <a class="org-hero__frame" data-shape={frameShape} href={spot.href}>
      <span class="org-hero__frame-art" aria-hidden="true">
        {#if shows(spot.imageUrl)}
          <img
            onerror={onimagefail}
            src={spot.imageUrl}
            srcset={getThumbnailSrcset(spot.imageUrl)}
            sizes={frameSizes(spot.imageUrl, frameShape)}
            alt=""
            decoding="async"
            fetchpriority="high"
          />
        {:else}
          <!-- the brand's own plate: the caption below already names the piece -->
          <span class="org-hero__frame-fallback"></span>
        {/if}
      </span>
      {#if spot.kind === 'video' || spot.kind === 'audio'}
        <span class="org-hero__frame-play" aria-hidden="true"><PlayIcon size={22} /></span>
      {/if}
      <span class="org-hero__frame-caption">
        <span class="org-hero__frame-meta">{spot.meta}</span>
        <span class="org-hero__frame-title">{spot.title}</span>
        {#if spot.line}<span class="org-hero__frame-line">{spot.line}</span>{/if}
        <span class="org-hero__frame-go">{spot.cta}</span>
      </span>
    </a>
  {/if}
{:else if comp === 'split' && spot}
  <a class="org-hero__media" href={spot.href} aria-label={m.org_hero_piece_label({ kicker: spot.kicker, title: spot.title })}>
    {#if shows(spot.imageUrl)}
      <img
        onerror={onimagefail}
        src={spot.imageUrl}
        srcset={getThumbnailSrcset(spot.imageUrl)}
        sizes={panelSizes(spot.imageUrl)}
        alt=""
        decoding="async"
        fetchpriority="high"
      />
    {:else}
      <span class="org-hero__frame-fallback" aria-hidden="true">{spot.title}</span>
    {/if}
  </a>
{/if}

<style>
  /* a Split aligned to the end puts its panel first */
  :global(.org-hero[data-align='end'][data-comp='split']) .org-hero__media {
    order: -1;
  }

  .org-hero__frame:focus-visible,
  .org-hero__media:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  /* ── the spotlight frame ─────────────────────────────────────────────────
     The boldest thing in the hero, so everything around it stays quiet. It
     takes the shape of what it holds: a portal is an ARCH (a threshold you step
     through), a film is WIDE footage, an essay or a recording's cover a PAGE.
     Placed with its top and bottom pinned, its height is the hero's and
     aspect-ratio gives its width, capped so the words always keep their half. */
  .org-hero__frame {
    position: absolute;
    /* the base shares the words' baseline (the inner's bottom padding) */
    inset-block: var(--space-10) var(--space-12);
    inset-inline-end: var(--space-6);
    aspect-ratio: 3 / 4;
    max-width: 46%;
    display: block;
    overflow: hidden;
    isolation: isolate;
    border-radius: var(--radius-card);
    background: color-mix(in oklab, var(--color-brand-primary) 32%, var(--_veil));
    box-shadow: var(--shadow-xl);
    color: var(--color-player-text);
    text-decoration: none;
  }

  /* a semicircle top: an oversized radius scales down to half the width */
  .org-hero__frame[data-shape='arch'] {
    border-radius: 100vmax 100vmax var(--radius-card) var(--radius-card);
  }

  .org-hero__frame[data-shape='page'] { aspect-ratio: 4 / 5; }

  :global(.org-hero[data-align='end'][data-comp='showcase']) .org-hero__frame {
    inset-inline: var(--space-6) auto;
  }

  .org-hero__frame-art {
    position: absolute;
    inset: 0;
    z-index: -1;
  }

  .org-hero__frame-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform var(--duration-slowest) var(--ease-smooth);
  }

  .org-hero__frame:hover .org-hero__frame-art img { transform: scale(1.04); }

  /* The film frame is a button: none of a button's own dress. */
  .org-hero__frame--film {
    padding: 0;
    border: 0;
    font: inherit;
    text-align: inherit;
    cursor: pointer;
  }

  /* ONE call, in the middle of the picture: a glass pill that reads on any
     footage, the brand's play disc inside it. One element, so its centre is
     the centre line the words share. */
  .org-hero__film-call {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--color-player-text);
  }

  .org-hero__film-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-6) var(--space-2) var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 62%, transparent);
    backdrop-filter: blur(var(--blur-md));
    box-shadow: var(--shadow-lg);
    transition: transform var(--duration-normal) var(--ease-default);
  }

  .org-hero__film-disc {
    display: grid;
    place-items: center;
    inline-size: var(--space-14);
    block-size: var(--space-14);
    border-radius: var(--radius-full);
    background: var(--_btn-bg);
    color: var(--_btn-ink);
  }

  .org-hero__film-disc :global(svg) { translate: 6% 0; }

  .org-hero__frame--film:hover .org-hero__film-pill { transform: scale(1.04); }

  .org-hero__film-words {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-lg);
    font-weight: var(--font-medium);
  }

  .org-hero__film-dur {
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    color: var(--color-player-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  /* no picture: the brand's own ground; the split panel sets the title on it
     large (the Showcase frame's caption already names the piece) */
  .org-hero__frame-fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: var(--space-10);
    text-align: center;
    font-family: var(--font-heading);
    font-size: var(--text-5xl);
    line-height: var(--leading-tight);
    color: var(--_ink-strong);
    background: radial-gradient(circle at 50% 30%, color-mix(in oklab, var(--color-brand-primary) 55%, transparent), transparent 70%);
  }

  .org-hero__frame-play {
    position: absolute;
    inset: 0 0 auto;
    height: 55%;
    display: grid;
    place-items: center;
  }

  .org-hero__frame-play :global(svg) {
    box-sizing: content-box;
    padding: var(--space-5);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 60%, transparent);
    backdrop-filter: blur(var(--blur-md));
  }

  /* the caption sits in the frame's foot, on a fall of the scrim */
  .org-hero__frame-caption {
    position: absolute;
    inset: auto 0 0;
    display: grid;
    justify-items: start;
    gap: var(--space-4);
    padding: var(--space-24) var(--space-8) var(--space-8);
    background: linear-gradient(
      to top,
      color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 92%, transparent),
      color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 70%, transparent) 55%,
      transparent
    );
  }

  .org-hero__frame-meta {
    font-size: var(--text-sm);
    color: var(--color-player-text-secondary);
  }

  :global(.org-hero) .org-hero__frame-title {
    font-family: var(--font-heading);
    font-weight: var(--heading-weight, var(--font-semibold));
    font-size: calc(var(--text-4xl) * var(--_fit));
    line-height: var(--leading-display);
    letter-spacing: var(--tracking-tight);
    color: var(--_ink-strong);
    text-wrap: balance;
  }

  .org-hero__frame-line {
    max-width: 38ch;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-player-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .org-hero__frame-go {
    margin-top: var(--space-2);
    padding: var(--space-2) var(--space-5);
    border: var(--border-width) var(--border-style) color-mix(in srgb, var(--color-player-text) 45%, transparent);
    border-radius: var(--radius-button);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-player-text);
    transition: background-color var(--duration-normal) var(--ease-default), border-color var(--duration-normal) var(--ease-default);
  }

  .org-hero__frame:hover .org-hero__frame-go {
    background: color-mix(in srgb, var(--color-player-text) 14%, transparent);
    border-color: var(--color-player-text);
  }

  /* ── the split panel ─────────────────────────────────────────────────── */
  .org-hero__media {
    position: relative;
    align-self: stretch;
    min-height: 60%;
    overflow: hidden;
    border-radius: calc(var(--radius-card) * 1.5);
  }

  .org-hero__media img { width: 100%; height: 100%; object-fit: cover; display: block; }

  @media (--breakpoint-md) {
    /* the call sits in the middle of the picture's VISIBLE part (the mask
       dissolves the frame's first 42%) */
    .org-hero__frame--film .org-hero__film-call { inset-inline-start: 42%; }
    .org-hero__frame[data-shape='wide'] {
      inset: 0 0 0 auto;
      width: 66%;
      max-width: none;
      aspect-ratio: auto;
      border-radius: 0;
      box-shadow: none;
      background: none;
    }
    .org-hero__frame[data-shape='wide'] .org-hero__frame-art {
      mask-image:
        linear-gradient(to right, transparent, black 42%),
        linear-gradient(to top, transparent, black 22%);
      mask-composite: intersect;
    }
    /* the scrim rides inside the masked art, so it dissolves with the picture
       instead of drawing a dark band across the ground under the words */
    .org-hero__frame[data-shape='wide'] .org-hero__frame-art::after {
      content: '';
      position: absolute;
      inset: 0;
      background:
        linear-gradient(
          to top,
          color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 88%, transparent),
          color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 30%, transparent) 45%,
          transparent 70%
        ),
        color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 18%, transparent);
    }
    .org-hero__frame[data-shape='wide'] .org-hero__frame-play { inset: 0 0 40% 30%; height: auto; }
    .org-hero__frame[data-shape='wide'] .org-hero__frame-play :global(svg) {
      width: var(--space-8);
      height: var(--space-8);
      padding: var(--space-8);
    }
    .org-hero__frame[data-shape='wide'] .org-hero__frame-caption {
      inset: auto var(--space-10) var(--space-12) auto;
      width: min(30rem, 72%);
      padding: 0;
      background: none;
    }
  }

  /* ── entrance ────────────────────────────────────────────────────────── */
  :global(.org-hero[data-entrance]) .org-hero__media {
    animation: org-hero-fade var(--duration-slowest) var(--ease-out) backwards;
    animation-delay: var(--duration-normal);
  }
  /* The one orchestrated moment: the frame opens upward from its base, the
     picture settles into it, then its caption arrives. */
  :global(.org-hero[data-entrance]) .org-hero__frame {
    animation: org-hero-open calc(var(--duration-slowest) * 1.6) var(--ease-smooth) backwards;
  }
  :global(.org-hero[data-entrance]) .org-hero__frame-art img {
    animation: org-hero-settle calc(var(--duration-slowest) * 3) var(--ease-out) backwards;
  }
  :global(.org-hero[data-entrance]) .org-hero__frame-caption {
    animation: org-hero-fade var(--duration-slowest) var(--ease-out) backwards;
    animation-delay: var(--duration-slowest);
  }
  :global(.org-hero[data-entrance='none']) .org-hero__frame,
  :global(.org-hero[data-entrance='none']) .org-hero__frame-art img,
  :global(.org-hero[data-entrance='none']) .org-hero__frame-caption,
  :global(.org-hero[data-entrance='none']) .org-hero__media {
    animation: none;
  }

  @keyframes org-hero-open { from { clip-path: inset(100% 0 0 0); } to { clip-path: inset(0); } }
  @keyframes org-hero-settle { from { transform: scale(1.12); } }
  /* also in OrgHero.svelte, for the words: a component's keyframes are its own */
  @keyframes org-hero-fade { from { opacity: 0; } }

  /* ── phone ───────────────────────────────────────────────────────────── */
  @media (--below-md) {
    .org-hero__frame,
    :global(.org-hero[data-align='end'][data-comp='showcase']) .org-hero__frame {
      position: relative;
      inset: auto;
      order: -1;
      width: 100%;
      max-width: none;
      /* stretches in its grid row (see the inner in OrgHero.svelte) */
      height: auto;
      aspect-ratio: auto;
      max-height: none;
    }
    /* footage runs edge to edge and dissolves into the ground under it */
    .org-hero__frame[data-shape='wide'] .org-hero__frame-art {
      mask-image: linear-gradient(to top, transparent, black 32%);
    }
    .org-hero__frame--film .org-hero__frame-art::after {
      content: '';
      position: absolute;
      inset: 0;
      background: color-mix(in srgb, var(--media-scrim, var(--color-neutral-900)) 18%, transparent);
    }
    .org-hero__frame--film { box-shadow: none; background: none; }
    .org-hero__frame[data-shape='wide'] {
      width: calc(100% + var(--space-4) * 2);
      margin-inline: calc(var(--space-4) * -1);
      border-radius: 0;
    }
    /* on a phone the frame carries only its title and the way in, so the
       picture stays the picture */
    .org-hero__frame-caption {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      padding: var(--space-12) var(--space-4) var(--space-4);
    }
    .org-hero__frame-meta,
    .org-hero__frame-line { display: none; }
    :global(.org-hero) .org-hero__frame-title { font-size: var(--text-xl); }
    .org-hero__frame-go { margin-top: 0; padding: var(--space-2) var(--space-3); }

    :global(.org-hero[data-comp='split']) .org-hero__media {
      order: -1 !important;
      height: 40svh;
      margin-inline: calc(var(--space-4) * -1);
      border-radius: 0;
    }
  }
</style>
