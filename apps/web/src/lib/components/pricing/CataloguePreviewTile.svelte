<!--
  @component CataloguePreviewTile

  One non-interactive 3:4 tile in the pricing page's catalogue band. Its whole
  job is to be recognisable: a sharp cover, the item's TITLE, and a flair that
  says what type it is without relying on a text pill.

  ── Why not `ContentCard shape="3:4" titleInCover` ──────────────────────
  That is the tile this one deliberately mirrors, and reusing it was the first
  choice. It cannot express this need for one structural reason: `ContentCard`
  defaults `href = '#'` and always renders its title as an anchor whose
  `::after` covers the whole card. No prop makes it non-interactive. Rendering
  18 of them — duplicated for the marquee seam, so 36 — would put 36 dead
  `href="#"` tab stops in front of the page's Subscribe button, on tiles that
  are drifting away from the pointer.

  So this shares ContentCard's PARTS rather than forking the card: the same
  `AudioWaveform` primitive, the same `PlayIcon`, the same `--media-scrim` /
  `--media-glyph` overlay tokens, the same brand cover-plate gradient, the same
  3:4 ratio and the same `getThumbnailSrcset` responsive source. What it drops
  is everything a proof tile has no use for — price badge, creator byline,
  duration, progress bar, access state, hover lift, link.

  ── What it deliberately does NOT do ────────────────────────────────────
  No `filter: blur()`, no `saturate()` below 1, no `scale()` crop-in, no
  `mix-blend-mode: multiply` scrim. The section this replaces obscured its own
  photography with all four at once, then let a 2.26:1 letterbox crop a 4:5
  portrait down to its middle third — so two different items rendered as the
  same blurred cloud, told apart only by a text badge.

  @prop {string} id - Content id. Seeds the deterministic audio waveform.
  @prop {string} title - Rendered inside the cover over the scrim.
  @prop {'video' | 'audio' | 'written'} contentType - Drives the flair + kind line.
  @prop {string | null} thumbnailUrl - Cover image; null paints the brand plate.
  @prop {string} sizes - The tile's REAL rendered width, for `<img sizes>`. The
        caller owns the cell width, so only the caller can state this.
  @prop {string} class - Forwarded to the root so a caller can place or size the
        tile without reaching in with `:global()`.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { getThumbnailSrcset } from '$lib/utils/image';
  import { PlayIcon } from '$lib/components/ui/Icon';
  import AudioWaveform from '$lib/components/ui/ContentCard/AudioWaveform.svelte';

  interface Props {
    id: string;
    title: string;
    contentType: 'video' | 'audio' | 'written';
    thumbnailUrl?: string | null;
    sizes?: string;
    class?: string;
  }

  const {
    id,
    title,
    contentType,
    thumbnailUrl = null,
    /**
     * NOT `DEFAULT_SIZES`. That declares `800px` above a 1024px viewport, but a
     * band cell is a fixed 13rem (208px) at EVERY viewport, so the browser was
     * picking `lg.webp` for a 208px slot. `sizes` must describe the SLOT, not
     * the page (06-performance.md). ContentCard's use of DEFAULT_SIZES is not
     * precedent here: its cells are fluid, this one is not.
     *
     * MEASURED on the live band at DPR 1 (dev CDN, one real thumbnail):
     * `lg.webp` 67,008B → `md.webp` 44,940B, a 22KB saving per variant-bearing
     * tile. Note md, not sm: `sm.webp` is 200w, just under the 208px slot, so
     * 208 CSS px genuinely needs the 400w step. At DPR 3 both the old and the
     * new `sizes` resolve to `lg`, so this is a desktop win only. The bigger
     * cost is seed items with NO variant ladder at all (`getThumbnailSrcset`
     * returns '' and the full original is fetched) — that is data, tracked as
     * Codex-laytv, and no `sizes` value can fix it.
     */
    sizes = '13rem',
    class: className,
  }: Props = $props();

  /** First letter of the title, for the imageless written-item dropcap. */
  const coverInitial = $derived(title.trim().charAt(0).toUpperCase());

  const kindLabel = $derived(
    contentType === 'audio'
      ? m.pricing_catalogue_kind_audio()
      : contentType === 'written'
        ? m.pricing_catalogue_kind_written()
        : m.pricing_catalogue_kind_video()
  );
</script>

<!-- `figcaption` must be a DIRECT child of `figure`, so the figure itself is
     the cover box rather than wrapping one. -->
<figure class="cpt {className ?? ''}" data-content-type={contentType}>
  <!-- Brand plate is ALWAYS painted behind, so a 404 or a pre-hydration load
       error reveals the gradient with no handler required. -->
  <span class="cpt__plate" aria-hidden="true"></span>
  {#if thumbnailUrl}
    <img
      src={thumbnailUrl}
      srcset={getThumbnailSrcset(thumbnailUrl)}
      {sizes}
      alt=""
      loading="lazy"
      decoding="async"
      class="cpt__image"
    />
  {/if}
  <span class="cpt__flair" aria-hidden="true">
    {#if contentType === 'audio'}
      <!-- The waveform is SIZED BY THIS WRAPPER, not by a class handed to
           AudioWaveform. AudioWaveform's own scoped rule is
           `.waveform { width: 100%; height: 100% }`, and Svelte appends its
           scoping class to that selector, making it (0,2,0) — which beats any
           `:global(.some-class)` a consumer writes at (0,1,0). Passing a sized
           class therefore does nothing: the SVG stretches to the whole
           positioned ancestor and the bars paint over the entire photograph.
           Sizing the wrapper instead leaves the SVG's 100%/100% correct. -->
      <span class="cpt__flair-waveband">
        <AudioWaveform {id} bars={32} />
      </span>
      <span class="cpt__flair-disc"><PlayIcon size={20} /></span>
    {:else if contentType === 'video'}
      <span class="cpt__flair-ring"><PlayIcon size={20} /></span>
    {:else if !thumbnailUrl && coverInitial}
      <span class="cpt__flair-dropcap">{coverInitial}</span>
    {/if}
  </span>
  <figcaption class="cpt__caption">
    <span class="cpt__kind">{kindLabel}</span>
    <span class="cpt__title">{title}</span>
  </figcaption>
</figure>

<style>
  .cpt {
    position: relative;
    margin: 0;
    /* 3:4 matches the portrait sources most orgs upload (0.75–0.80), the
       browse tile on /explore and the journey entry card — so the crop nearly
       disappears and a content item beside a portal reads as one system.
       Declared, not inferred from the image, so the band reserves its box
       before the images arrive: without it a streamed band is a guaranteed
       CLS regression. */
    aspect-ratio: 3 / 4;
    overflow: hidden;
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-md);
    /* New stacking context so the caption's z-index stays local to the tile. */
    isolation: isolate;
  }

  .cpt__plate,
  .cpt__image {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }

  /* Imageless cover — the same brand-tinted ramp ContentCard's title-in-cover
     tile paints, so a thumbnail-less item is a designed tile rather than an
     omission. Warm brand tint at the top falls to the scrim anchor so the
     near-white caption always reads; re-themes per org via the tokens. */
  .cpt__plate {
    background: linear-gradient(
      158deg,
      color-mix(in oklab, var(--color-brand-primary) 26%, var(--color-surface-card)) 0%,
      color-mix(in oklab, var(--color-brand-primary) 12%, var(--color-surface-card)) 34%,
      color-mix(in oklab, var(--media-scrim) 40%, var(--color-surface-card)) 66%,
      var(--media-scrim) 100%
    );
  }

  .cpt__image {
    /* SHARP. No blur, no desaturation, no scale-in. */
    object-fit: cover;
    /* Portrait sources are usually framed head-up; bias the crop upward so a
       3:4 slot keeps the subject rather than the floor. */
    object-position: center 30%;
  }

  .cpt__flair {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    overflow: hidden;
  }

  /* AUDIO — a waveform band with a play disc centred on it. Held to 22% of the
     tile height at 0.6 opacity so it reads as a signature over the photograph
     rather than replacing it. The colour is inherited: AudioWaveform fills its
     bars with `currentColor`. */
  .cpt__flair-waveband {
    position: absolute;
    left: 50%;
    top: 34%;
    transform: translate(-50%, -50%);
    display: block;
    width: 70%;
    height: 22%;
    color: color-mix(in srgb, var(--color-brand-primary) 45%, var(--media-glyph));
    opacity: var(--opacity-60);
  }

  .cpt__flair-disc,
  .cpt__flair-ring {
    position: absolute;
    left: 50%;
    top: 34%;
    transform: translate(-50%, -50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    color: var(--media-glyph);
    background: color-mix(in srgb, var(--media-scrim) 46%, transparent);
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--media-glyph) 55%, transparent);
    backdrop-filter: blur(var(--blur-sm));
    -webkit-backdrop-filter: blur(var(--blur-sm));
  }

  .cpt__flair-disc {
    width: var(--space-10);
    height: var(--space-10);
  }

  /* VIDEO — the same glyph in a larger ring, no waveform behind it. */
  .cpt__flair-ring {
    width: var(--space-12);
    height: var(--space-12);
  }

  .cpt__flair-disc :global(svg),
  .cpt__flair-ring :global(svg) {
    fill: currentColor;
    /* Optical centring of the play triangle inside the disc/ring. */
    margin-left: 0.12em;
  }

  /* WRITTEN with no cover — an oversized ghosted serif initial, the same
     device ContentCard's article flair uses (scaled for a smaller tile). */
  .cpt__flair-dropcap {
    position: absolute;
    left: -0.04em;
    top: -0.12em;
    font-family: var(--font-heading);
    font-weight: var(--font-bold);
    font-size: var(--text-display);
    line-height: var(--leading-none);
    color: color-mix(in srgb, var(--media-glyph) 26%, transparent);
    user-select: none;
  }

  .cpt__caption {
    position: absolute;
    inset: auto 0 0 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    /* The generous TOP padding is load-bearing, not cosmetic: it is the room
       the ramp below needs to fade out ABOVE the text rather than through it. */
    padding: var(--space-8) var(--space-3) var(--space-3);

    /* Scrim ramp, MEASURED rather than copied.
       ContentCard's ramp (opaque → 70% at 45% → 35% at 75% → transparent) is
       tuned for its much taller body block. Reused verbatim on this 70px
       caption it put the kind line at only 0.42 scrim alpha, which measured
       1.41:1 against a bright photograph — a hard WCAG AA failure, and
       invisible unless you test over a white sky. (Codex memory: "opaque scrim
       stops are aspect-coupled" — a media card's ratio silently changes its
       overlaid text contrast.)
       These stops hold the scrim opaque through the whole text block and spend
       the fade in the padding above it: worst case (scrim over a pure-white
       photo) measures 5.6:1 for the kind line and 10.1:1 for the title. */
    background: linear-gradient(
      to top,
      var(--media-scrim) 0%,
      var(--media-scrim) 55%,
      color-mix(in srgb, var(--media-scrim) 78%, transparent) 80%,
      transparent 100%
    );
  }

  .cpt__kind {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: var(--text-transform-label);
    /* Accent-tinted but lightened toward the glyph so it reads on the scrim. */
    color: color-mix(in srgb, var(--color-brand-accent) 55%, var(--media-glyph));
  }

  .cpt__title {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    line-height: var(--leading-snug);
    letter-spacing: var(--tracking-tight);
    /* --media-glyph, not --color-text, so the title never renders dark-on-dark
       over the scrim on a light-background org. */
    color: var(--media-glyph);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-wrap: pretty;
  }

  /* The disc/ring are the only glass surfaces this tile has, and this section
     replaced `.preview__badge` — which WAS covered by the pricing page's own
     `prefers-reduced-transparency` block. Dropping the handling would be a net
     regression on the one surface in the app that had it, so it moves here
     rather than staying in the page: the tile then keeps the behaviour if it is
     ever reused somewhere without that block (05-accessibility.md §6). */
  @media (prefers-reduced-transparency: reduce) {
    .cpt__flair-disc,
    .cpt__flair-ring {
      background: var(--media-scrim);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }
</style>
