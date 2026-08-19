<!--
  @component CreatorPortrait

  The one creator figure in the family. A framed photograph of a person, with a
  monogram fallback when there is no photograph.

  Four components used to implement this independently and two of them were
  broken: the directory card was blowing a 128px avatar up to 420px and the
  drawer hero to 671px, and both drew the no-photo monogram in
  `--color-text-muted` at `opacity: 0.3` — which measures 4.05:1 against its
  panel BEFORE the opacity is applied, i.e. an empty box where a person should
  be. Consolidating fixes both in one place and makes `square` the family
  default.

  ## Why square is the default

  The image pipeline preserves the uploader's aspect ratio and never upscales
  (`packages/image-processing/src/processor.ts` caps at lg=800w), and avatars are
  overwhelmingly square headshots. A 3:4 or 4:5 frame therefore has only two
  options for a square source: crop the head off, or upscale. 1:1 does neither.
  `portrait` (4:5) stays available for the landing carousel, whose editorial
  rhythm predates this and is deliberately unchanged.

  ## Why there is no srcset

  It is tempting to wire `getThumbnailSrcset()` here, and it is wrong for
  avatars. That helper asserts the fixed descriptors `200w / 400w / 800w` from
  the FILENAMES alone, while the pipeline that writes those files never upscales
  — so an avatar uploaded at 150px is stored, identically, as `sm.webp`,
  `md.webp` AND `lg.webp`, all 150px wide. The descriptors are then lies, and a
  browser that believes them derives a pixel density from
  `descriptor ÷ intrinsic` and renders the image SMALLER than its real size:
  measured here, a 128px avatar resolved to 71px of effective resolution, worse
  than the plain `src` it replaced. So the size is chosen explicitly per consumer
  instead — `md` for a contact-sheet cell, `lg` for the drawer hero.

  There is deliberately no `sizes` prop either: `sizes` only means anything
  alongside a `srcset`, so accepting one would be a promise this component
  cannot keep. `CreatorPortrait.svelte.test.ts` pins the absence of `srcset`.

  ## Hover / focus is driven from the parent

  The interactive element is the parent (a card's hit area, a carousel link), so
  the parent owns the hover state and hands it down through two INHERITED custom
  properties. Both have defaults here, so the portrait is complete on its own:

  | Property                      | Default | Effect                            |
  |-------------------------------|---------|-----------------------------------|
  | `--creator-portrait-scale`    | `1`     | Photo zoom                        |
  | `--creator-portrait-rule`     | `0`     | 0–1 draw of the brand rule        |

  @prop {string | null} src - Thumbnail URL; the requested variant comes from
    `size`. No `srcset` — see above.
  @prop {string} name - Used for the monogram only. The image is decorative.
  @prop {'square' | 'portrait'} [aspect='square'] - Frame ratio.
  @prop {'sm' | 'md' | 'lg'} [size='md'] - Which stored variant to request.
  @prop {boolean} [eager=false] - Skip lazy-loading (above-the-fold heroes).
  @prop {Snippet} [children] - Overlay content stacked on the photo.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { getThumbnailUrl } from '$lib/utils/image';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    src?: string | null;
    name: string;
    aspect?: 'square' | 'portrait';
    size?: 'sm' | 'md' | 'lg';
    eager?: boolean;
    children?: Snippet;
  }

  const {
    src,
    name,
    aspect = 'square',
    size = 'md',
    eager = false,
    children,
    class: className,
    ...restProps
  }: Props = $props();

  const initial = $derived(name.trim().charAt(0).toUpperCase());
  const url = $derived(src ? getThumbnailUrl(src, size) : null);
</script>

<div class="portrait {className ?? ''}" data-aspect={aspect} {...restProps}>
  {#if url}
    <img
      class="portrait__img"
      src={url}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  {:else}
    <div class="portrait__fallback" aria-hidden="true">
      <span class="portrait__initial">{initial}</span>
    </div>
  {/if}

  <!-- Decorative brand rule along the bottom edge of the frame. It sits against
       the PHOTOGRAPH, not against the page, which is what makes it legible:
       --color-brand-primary measures only 4.24:1 against this org's near-black
       background, so a rule floating on the page would read as a dark hairline.
       Decoration carries no contrast minimum, and brand ink cannot be trusted as
       text — this is the same reasoning as PageHeader's kicker rule. -->
  <span class="portrait__rule" aria-hidden="true"></span>

  {#if children}{@render children()}{/if}
</div>

<style>
  .portrait {
    position: relative;
    inline-size: 100%;
    overflow: hidden;
    border-radius: var(--radius-lg);
    background: var(--color-surface-tertiary);
    /* A stretched grid row must not be allowed to grow the frame: without this
       a monogram cell and a photo cell drift apart vertically and the uniform
       rows the contact sheet depends on quietly break. */
    flex-shrink: 0;
    isolation: isolate;
  }

  .portrait[data-aspect='square'] {
    aspect-ratio: 1 / 1;
  }

  .portrait[data-aspect='portrait'] {
    aspect-ratio: 4 / 5;
  }

  .portrait__img {
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
    /* Biased upward so heads sit above the optical centre. Local so a consumer
       can retune framing without editing this rule. */
    object-position: var(--_portrait-focal, center 22%);
    transform: scale(var(--creator-portrait-scale, 1));
    transition: transform var(--duration-slower) var(--ease-out);
  }

  .portrait__fallback {
    inline-size: 100%;
    block-size: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    /* The ring is load-bearing, not trim: --color-surface-tertiary measures
       1.17:1 against a dark org background, so without a border the panel has
       no edge and the cell reads as a hole in the grid. */
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: inherit;
  }

  .portrait__initial {
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    /* Full opacity, and --color-text-secondary rather than --color-text-muted:
       muted measures 4.05:1 here and the old opacity: 0.3 took it to roughly
       1.2:1. This is the only identity the cell carries. */
    color: var(--color-text-secondary);
    letter-spacing: var(--tracking-tight);
    user-select: none;
  }

  .portrait__rule {
    position: absolute;
    inset-inline: 0;
    inset-block-end: 0;
    block-size: var(--border-width-thick);
    background: var(--color-brand-primary);
    transform: scaleX(var(--creator-portrait-rule, 0));
    transform-origin: left center;
    transition: transform var(--duration-normal) var(--ease-out);
  }

  @media (prefers-reduced-motion: reduce) {
    .portrait__img,
    .portrait__rule {
      transition: none;
    }
  }
</style>
