<!--
  @component HeroBlock

  The page's promise and its first way in. Five layouts:
    statement — the headline IS the hero; the image runs full width below it
    split     — words and image side by side (half-bleed in Bold)
    cover     — the image fills the band; luminous words over a scrim. On a
                Moving background with no image, the band is the section's:
                the org's shader (or its glow) under the scheme's own veil
    centered  — centred words over a wide image
    poster    — the headline at full size set round a picture that runs off
                the band's edge (HeroPoster)

  The one sanctioned fallback in the kit: an empty headline renders the course
  title. Media arrives on the streamed `sellPreview`. Structure is identical in
  every Style — the Style changes it through tokens and a few
  `[data-lp-style]` rules — so switching Style never re-mounts the block.

  NO PICTURE (Codex-61zsk.37): the public page draws only what it has, so a
  split, centered or poster hero with no picture is its words alone — split
  set as the statement sets them. The plate that holds a picture's place
  appears where the page is looked at (the canvas, a still thumbnail:
  `page.still`), and there each layout keeps its shape while media loads. On
  the public page it appears only while a hero video the awaited view says is
  attached (`course.filmsAttached.hero`, Codex-61zsk.40) is on its way, so a
  video-only hero is framed from the first paint rather than re-framed above
  the fold; one that then fails to resolve leaves the words alone. The cover
  draws its play button in the words' column, not over the picture, so it
  holds that button's place too, hidden, while the video is on its way.

  A medium or a long headline is marked `data-medium` / `data-long` (the
  kit's tiers, `model/long-heading.ts`; long as the problem statement's): a
  Style whose display would make it a wall steps it down on the headline's
  parent, `<parent>:has(> .hero__headline[data-medium])`. The layout's words
  also carry the drawn headline's length, `--lp-heading-chars`, so a Style
  can scale it character by character on that parent where the browser can
  compute it (`pow()`); the two marks are then its fallback.

  A FILM in a frame (statement, split, centred, poster) plays there
  (`InlineFilm`): the press lays the player over the picture, with sound,
  and the ambient loop under it rests until the film ends. The cover has no
  frame — its film is the band — so its button opens the theatre (`Watch`).
-->
<script lang="ts">
  import { getThumbnailSrcset } from '$lib/utils/image';
  import { pageImageSrcset, resolvePageImageUrl, storedFocus } from '../../../page-images';
  import type { PreviewMedia, SellPreview } from '../../../render/types';
  import { COPY } from '../../model/copy';
  import { heroFacts } from '../../model/facts';
  import { headingLength, headingRuns } from '../../model/long-heading';
  import type { BlockProps } from '../../model/types';
  import { getKitPage } from '../../page-context';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import InlineFilm from '../../primitives/InlineFilm.svelte';
  import Media from '../../primitives/Media.svelte';
  import Text from '../../primitives/Text.svelte';
  import WatchButton from '../../primitives/WatchButton.svelte';
  import Watch from '../video/Watch.svelte';
  import { heroDefinition } from './definition';
  import HeroPoster from './HeroPoster.svelte';
  import { settled as settledValue } from './settled.svelte';

  const { props, section, context, edit }: BlockProps = $props();

  const page = getKitPage();
  const content = $derived(heroDefinition.coerce(props));
  const heading = $derived(content.heading ?? context.course.title);
  const length = $derived(headingLength(heading));
  const chars = $derived(heading.length);
  const runs = $derived(headingRuns(heading));
  const mode = $derived(content.media ?? 'auto');
  const layout = $derived(section.layout);
  // The course's shape and its way in, under the lede (`model/facts.ts`).
  const facts = $derived(heroFacts(context));
  const watchLabel = $derived(content.watchLabel ?? COPY.hero.watch);

  interface HeroMedia {
    still: string | null;
    clip: PreviewMedia | null;
  }

  // The creator's own image (contract A5) replaces the course still — never
  // the clip, which keeps playing wherever it did, over this as its poster.
  const ownStill = $derived(
    mode === 'none' ? null : resolvePageImageUrl(content.image, 'lg', context.mediaBaseUrl)
  );
  // Decorative unless described; only the creator's image can carry words.
  const alt = $derived(ownStill ? (content.image?.alt ?? '') : '');
  // The creator's image offers every size it has, at the width its layout
  // draws it: one 800px image across a cover band upscales (Codex-61zsk.13).
  // Wherever there is one, it is the still every layout draws (`pick`); a
  // course still from the journey is not a page image, so it has none.
  const ownSrcset = $derived(
    ownStill ? pageImageSrcset(content.image, context.mediaBaseUrl) : ''
  );
  // Where the creator placed the image's subject, so a layout's crop keeps it
  // (Codex-61zsk.58); a course still from the journey has none.
  const ownFocus = $derived(ownStill ? storedFocus(content.image) : undefined);
  // The journey's own still (its uploaded hero, or a clip's poster) is no
  // page image: it offers the three sizes every still has, named in its URL,
  // instead of the one large file across the band (Codex-61zsk.66).
  function srcsetOf(still: string | null): string {
    if (!still) return '';
    return still === ownStill ? ownSrcset : getThumbnailSrcset(still);
  }
  const frameSizes = $derived(
    layout === 'split' ? '(min-width: 50rem) 50vw, 100vw' : '100vw'
  );

  // The uploaded hero still rides the AWAITED envelope, so it is in the
  // server-rendered HTML (the page's largest paint); the streamed preview can
  // only add a clip, or a media-item poster when nothing was uploaded.
  const syncStill = $derived(
    mode === 'none' ? null : (ownStill ?? context.course.heroImageUrl ?? null)
  );

  function pick(preview: SellPreview | null): HeroMedia {
    if (mode === 'none') return { still: null, clip: null };
    return {
      still: ownStill ?? preview?.heroImageUrl ?? syncStill,
      clip: mode === 'image' ? null : (preview?.heroClip ?? null),
    };
  }

  // The streamed preview once it settles, for the layouts whose shape depends
  // on whether there is media at all (cover, poster; split and centered on
  // the public page) — read in place, never through `{#await}`
  // (`settled.svelte.ts`). Until it settles, and on the server, the media is
  // the synchronous still.
  const preview = $derived(settledValue(context.sellPreview));
  const settled = $derived<HeroMedia>(
    preview === undefined ? { still: syncStill, clip: null } : pick(preview)
  );
  const pending = $derived(preview === undefined && !syncStill);
  const hasMedia = $derived(Boolean(settled.still || settled.clip));
  // Where the page is looked at rather than read, a picture's place is kept
  // with the plate in it; the public page draws only the picture it has.
  const previewing = $derived(page.still || !!edit);
  // A hero video the awaited view says is attached, still on its way: the
  // public page holds its place as the canvas does (Codex-61zsk.40).
  const heroComing = $derived(
    mode !== 'none' &&
      preview === undefined &&
      context.course.filmsAttached?.hero === true
  );
  const framed = $derived(
    mode !== 'none' && (hasMedia || previewing || heroComing)
  );
  // A cover with nothing to show on a Moving background leaves the band to
  // the section: the org's shader (or the glow standing in for it) under the
  // scheme's own veil and ink. Otherwise it draws its own band — the image,
  // or its glow — under the media colours.
  const coverOwnsBand = $derived(
    section.scheme !== 'atmosphere' || hasMedia || heroComing
  );
</script>

{#snippet copy(align: 'start' | 'center')}
  {#if content.eyebrow}
    <div class="hero__eyebrow hero__enter-c">
      <Eyebrow text={content.eyebrow} type="hero" {edit} />
    </div>
  {/if}
  <div
    class="hero__headline hero__enter-h"
    data-medium={length === 'medium' ? '' : undefined}
    data-long={length === 'long' ? '' : undefined}
  >
    <Heading
      level={section.headingLevel}
      size="display"
      text={heading}
      type="hero"
      field="heading"
      {edit}
    />
  </div>
  {#if content.body || facts.length > 0}
    <div class="hero__lede hero__enter-c">
      {#if content.body}
        <Text text={content.body} size="lead" type="hero" field="body" {edit} />
      {/if}
      {#if facts.length > 0}
        <p class="hero__facts">
          {#each facts as fact, i (fact)}{#if i > 0}<span aria-hidden="true">{' · '}</span
              >{/if}<span>{fact}</span>{/each}
        </p>
      {/if}
    </div>
  {/if}
  <div class="hero__actions hero__enter-c">
    <ButtonRow
      {context}
      section="hero"
      label={content.ctaLabel}
      note={content.note}
      secondaryLabel={content.secondaryLabel}
      secondaryHref={content.secondaryHref}
      {align}
      {edit}
    />
  </div>
{/snippet}

<!-- A clip plays in the frame; while it is up, the ambient loop under the
     player rests and the still stands in for it. -->
{#snippet frame(media: HeroMedia, pending: boolean, ratio: string)}
  {#if media.clip}
    {@const clip = media.clip}
    <InlineFilm {clip} label={watchLabel} title={heading} {edit}>
      {#snippet children(control, player, up)}
        <Media
          image={media.still}
          clip={up ? null : clip}
          srcset={srcsetOf(media.still)}
          sizes={frameSizes}
          focus={ownFocus}
          {ratio}
          {pending}
          priority
          {alt}
        >
          {@render control()}
        </Media>
        {@render player()}
      {/snippet}
    </InlineFilm>
  {:else}
    <Media
      image={media.still}
      srcset={srcsetOf(media.still)}
      sizes={frameSizes}
      focus={ownFocus}
      {ratio}
      {pending}
      priority
      {alt}
    />
  {/if}
{/snippet}

{#if layout === 'cover'}
  <!-- Only the media bleeds (03 X10): the words keep the content column, so
       a Style's atmosphere panel can hold them. -->
  {#if coverOwnsBand}
    <div class="hero-cover__media lp-bleed hero__enter-m" data-lp-on-media>
      {#if hasMedia}
        <Media
          image={settled.still}
          clip={settled.clip}
          srcset={srcsetOf(settled.still)}
          sizes="100vw"
          focus={ownFocus}
          priority
          {alt}
        />
      {:else}
        <span class="lp-atmos" data-drift aria-hidden="true"></span>
      {/if}
    </div>
  {/if}
  <div
    class="hero-cover__copy"
    data-lp-on-media={coverOwnsBand ? '' : undefined}
    style:--lp-heading-chars={chars}
  >
    {@render copy('start')}
    <!-- One box for the play button, held while the video is on its way, so
         the words neither rise nor push the band taller when it lands. -->
    {#if settled.clip || heroComing}
      <div
        class="hero-cover__watch hero__enter-c"
        data-held={settled.clip ? undefined : ''}
        inert={!settled.clip}
      >
        {#if settled.clip}
          <Watch clip={settled.clip} label={watchLabel} title={heading} {edit} />
        {:else}
          <WatchButton label={watchLabel} />
        {/if}
      </div>
    {/if}
  </div>
{:else if layout === 'poster'}
  <!-- Where the page is looked at, the picture's place is held (the clip or
       the plate fills it), so nothing moves when the stream settles; the
       public page sets the words round a picture only once it has one. The
       poster's own box is the headline's parent, where a Style scales it,
       so it takes the headline's length and its words' widths itself. -->
  <HeroPoster
    still={settled.still}
    srcset={srcsetOf(settled.still)}
    focus={ownFocus}
    clip={settled.clip}
    reserve={(previewing || heroComing) && mode !== 'none'}
    {alt}
    {copy}
    {chars}
    {runs}
    {watchLabel}
    title={heading}
    {edit}
  />
{:else if layout === 'split'}
  {#if framed}
    <div class="hero-split" style:--lp-heading-chars={chars}>
      <div class="hero-split__copy">{@render copy('start')}</div>
      <div class="hero-split__media hero__enter-m">
        {@render frame(settled, pending, 'var(--_ratio)')}
      </div>
    </div>
  {:else}
    <!-- No picture to share the band with: the words across it. -->
    <div class="hero-statement" style:--lp-heading-chars={chars}>{@render copy('start')}</div>
  {/if}
{:else if layout === 'centered'}
  <div class="hero-centered" style:--lp-heading-chars={chars}>{@render copy('center')}</div>
  {#if framed}
    <div class="hero-centered__media hero__enter-m">
      {@render frame(settled, pending, 'var(--_ratio)')}
    </div>
  {/if}
{:else}
  <div class="hero-statement" style:--lp-heading-chars={chars}>{@render copy('start')}</div>
  {#await context.sellPreview}
    {#if syncStill}
      <div class="hero-statement__media hero__enter-m">
        {@render frame({ still: syncStill, clip: null }, false, 'var(--_ratio)')}
      </div>
    {:else if heroComing}
      <div class="hero-statement__media hero__enter-m">
        {@render frame({ still: null, clip: null }, true, 'var(--_ratio)')}
      </div>
    {/if}
  {:then preview}
    {@const media = pick(preview)}
    {#if media.still || media.clip}
      <div class="hero-statement__media hero__enter-m">
        {@render frame(media, false, 'var(--_ratio)')}
      </div>
    {/if}
  {/await}
{/if}

<style>
  /* ── the facts line: small, in the soft ink, its figures lined up ──────── */
  .hero__facts {
    margin: 0;
    font-family: var(--lp-font-body);
    font-size: var(--lp-size-small);
    line-height: var(--lp-leading-body);
    font-variant-numeric: tabular-nums;
    color: var(--lp-ink-soft);
    text-wrap: balance;
  }

  .hero__lede:has(> :global(.lp-text)) > .hero__facts {
    margin-block-start: var(--lp-stack);
  }

  /* ── the frames: a film plays over the whole picture (`InlineFilm`) ────── */
  .hero-statement__media,
  .hero-split__media,
  .hero-centered__media {
    position: relative;
  }

  /* ── statement ─────────────────────────────────────────────────────────── */
  .hero-statement {
    display: grid;
    gap: var(--lp-stack);
    grid-template-columns: minmax(0, 1fr);
  }

  /* Wide: the headline spans; the lede and the actions share the row under
     it, the actions pushed to the far edge — unless there is no lede to
     balance them, when they sit under the headline instead. */
  @container (min-width: 52rem) {
    .hero-statement {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      column-gap: var(--lp-gap);
      align-items: end;
    }

    .hero-statement > .hero__eyebrow,
    .hero-statement > .hero__headline {
      grid-column: 1 / -1;
    }

    .hero-statement > .hero__actions {
      grid-column: 2;
      justify-self: end;
    }

    .hero-statement:not(:has(> .hero__lede)) > .hero__actions {
      grid-column: 1;
      justify-self: start;
    }
  }

  .hero-statement__media {
    --_ratio: 4 / 3;
  }

  @container (min-width: 48rem) {
    .hero-statement__media {
      --_ratio: 21 / 9;
    }
  }

  /* Bold's media is full-bleed and meets the next band. */
  :global(.lp[data-lp-style='bold']) :is(.hero-statement__media, .hero-centered__media) {
    grid-column: bleed;
    margin-block-end: calc(-1 * var(--lp-pad));
  }

  /* ── split ─────────────────────────────────────────────────────────────── */
  .hero-split {
    display: grid;
    gap: var(--lp-gap);
    align-items: center;
  }

  .hero-split__copy {
    display: grid;
    gap: var(--lp-stack);
  }

  .hero-split__media {
    --_ratio: 4 / 5;
  }

  /* Two columns share the width, so the headline steps down to share it;
     stacked on a phone it keeps the full display size over the lead. */
  @container (min-width: 50rem) {
    .hero-split {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      column-gap: calc(var(--lp-gap) * 1.5);
    }

    .hero-split__copy {
      --lp-display-scale: 0.7;
    }

    :global(.lp[data-lp-style='bold']) .hero-split {
      grid-column: bleed;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 0;
      align-items: stretch;
      margin-block: calc(-1 * var(--lp-pad));
    }

    :global(.lp[data-lp-style='bold']) .hero-split__copy {
      align-content: center;
      padding-block: var(--lp-pad);
      padding-inline: max(var(--lp-gutter), calc((100cqi - var(--lp-container)) / 2))
        var(--lp-gap);
    }

    :global(.lp[data-lp-style='bold']) .hero-split__media {
      --_ratio: auto;
      display: grid;
    }
  }

  /* From there until the words' column is as wide as a phone (it reaches
     30rem at about 69–71rem), the column is narrower than one — the editor's
     Tablet frame, 820px, is in between — so its buttons keep ButtonRow's
     phone rule: they share the row, or each takes a full row, and a
     link-styled way in keeps its width. Never a ragged stack, in any Style.
     ButtonRow measures the section, so it cannot see this column. */
  @container (50rem <= width < 70rem) {
    .hero-split__copy :global(.lp-actions__row) {
      justify-self: stretch;
    }

    .hero-split__copy :global(.lp-actions__row > .lp-button) {
      flex: 1 1 auto;
    }

    .hero-split__copy :global(.lp-actions__row > .lp-button[data-variant='quiet']),
    :global(.lp[data-lp-style='bold'])
      .hero-split__copy
      :global(.lp-actions__row > .lp-button[data-variant='secondary']) {
      flex: 0 0 auto;
    }
  }

  /* ── cover ─────────────────────────────────────────────────────────────── */
  /* Two layers in one row of the section's grid, each through the band's own
     padding: the media edge to edge behind, the words in the content column. */
  .hero-cover__media,
  .hero-cover__copy {
    grid-row: 1;
    margin-block: calc(-1 * var(--lp-pad));
  }

  /* With no image the glow IS the hero: stronger, and lit opposite the words. */
  .hero-cover__media {
    position: relative;
    display: grid;
    background: var(--lp-bg);
    isolation: isolate;
    --lp-atmos-strength: 0.7;
    --lp-atmos-a: 78% 30%;
    --lp-atmos-b: 34% 92%;
  }

  .hero-cover__media :global(.lp-media) {
    border-radius: 0;
  }

  .hero-cover__copy {
    position: relative;
    display: grid;
    align-content: end;
    gap: var(--lp-stack);
    max-inline-size: 60rem;
    min-block-size: clamp(32rem, 56cqi, 48rem);
    padding-block: calc(var(--lp-pad) * 1.5) var(--lp-pad);
    color: var(--lp-ink);
    isolation: isolate;
  }

  /* Held for a video still on its way: its place, not yet the button. */
  .hero-cover__watch[data-held] {
    visibility: hidden;
  }

  /* A scrim shaped to the WORDS: every line sits on at least 72% of the scrim
     colour however the headline wraps, and it fades out to the right and at
     the top so the rest of the image stays bright. It starts at the band's
     left edge (100cqi is the section), so it never shows a seam. Only over
     the cover's own band: on a Moving background the section's veil does it. */
  .hero-cover__copy[data-lp-on-media]::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset-block: calc(-1 * var(--space-24)) calc(-1 * var(--lp-pad));
    inset-inline: calc((100% - 100cqi) / 2) -30cqi;
    background: linear-gradient(
      to right,
      var(--lp-media-scrim) calc(100% - 30cqi),
      transparent
    );
    mask-image: linear-gradient(to bottom, transparent, black var(--space-24));
    pointer-events: none;
  }

  /* ── centered ──────────────────────────────────────────────────────────── */
  .hero-centered {
    display: grid;
    justify-items: center;
    gap: var(--lp-stack);
    text-align: center;
  }

  .hero-centered :global(.lp-heading),
  .hero-centered :global(.lp-text) {
    margin-inline: auto;
    max-inline-size: calc(18 * var(--lp-measure-unit));
  }

  .hero-centered :global(.lp-text) {
    max-inline-size: calc(var(--lp-measure-lead) * var(--lp-measure-unit));
  }

  .hero-centered__media {
    --_ratio: 4 / 3;
    inline-size: 100%;
  }

  /* A centred line across a wide band steps down a little; a phone keeps
     the full display size. */
  @container (min-width: 48rem) {
    .hero-centered {
      --lp-display-scale: 0.84;
    }

    .hero-centered__media {
      --_ratio: 16 / 7;
    }
  }

  /* ── the headline's size where it is wide ──────────────────────────────── */
  /* Wide, each layout sizes the headline for its length (X34), its poster
     for its words beside the picture (X60) and a borrowed Type for another
     Style's column (X74), measured at 1440 to cut no word, so it is held at
     that size. Narrower, it is fitted to its column as every heading is
     (`Heading.svelte`, X71): at a phone's display floor Bold's and Poster's
     drew "Transformation" past a 390 column, off the screen in four layouts
     and split mid-word in the statement (03 X74). */
  @container (min-width: 56rem) {
    .hero__headline :global(.lp-heading) {
      --lp-heading-hold: 1;
    }
  }

  /* ── the one entrance (keyframes named by the Style) ───────────────────── */
  /* The headline's wrapper is set at the headline's display size, so an
     entrance that draws it through a clip (Bold's lift, Poster's wipe)
     overhangs it in the headline's em, not the body's. The hero keeps its
     entrance's last frame, and a clip in the body's em cut a capital's mark
     and a comma off for as long as the page was open (03 X74). Nothing in
     the wrapper reads its size but that; the headline sets its own. */
  .hero__enter-h {
    font-size: calc(var(--lp-size-display) * var(--lp-display-scale, 1) * var(--lp-type-fit, 1));
  }

  @media (prefers-reduced-motion: no-preference) {
    :global(:root[data-theme] .lp:not([data-lp-still], [data-lp-motion='still'])) .hero__enter-h {
      animation: var(--lp-enter-headline);
    }

    :global(:root[data-theme] .lp:not([data-lp-still], [data-lp-motion='still'])) .hero__enter-c {
      animation: var(--lp-enter-copy);
    }

    :global(:root[data-theme] .lp:not([data-lp-still], [data-lp-motion='still'])) .hero__enter-m {
      animation: var(--lp-enter-media);
    }
  }
</style>
