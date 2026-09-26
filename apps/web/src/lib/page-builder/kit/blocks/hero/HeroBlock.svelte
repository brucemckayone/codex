<!--
  @component HeroBlock

  The page's promise and its first way in. Four layouts:
    statement — the headline IS the hero; the image runs full width below it
    split     — words and image side by side (half-bleed in Bold)
    cover     — the image fills the band; luminous words over a scrim
    centered  — centred words over a wide image

  The one sanctioned fallback in the kit: an empty headline renders the course
  title. Media arrives on the streamed `sellPreview`; each layout holds its
  space while it loads. Structure is identical in every Style — the Style
  changes it through tokens and a few `[data-lp-style]` rules — so switching
  Style never re-mounts the block.
-->
<script lang="ts">
  import IntroVideoModal from '$lib/components/ui/IntroVideoModal/IntroVideoModal.svelte';
  import type { PreviewMedia, SellPreview } from '../../../render/types';
  import { COPY } from '../../model/copy';
  import type { BlockProps } from '../../model/types';
  import ButtonRow from '../../primitives/ButtonRow.svelte';
  import Eyebrow from '../../primitives/Eyebrow.svelte';
  import Heading from '../../primitives/Heading.svelte';
  import Media from '../../primitives/Media.svelte';
  import Text from '../../primitives/Text.svelte';
  import WatchButton from '../../primitives/WatchButton.svelte';
  import { heroDefinition } from './definition';

  const { props, section, context, edit }: BlockProps = $props();

  const content = $derived(heroDefinition.coerce(props));
  const heading = $derived(content.heading ?? context.course.title);
  const mode = $derived(content.media ?? 'auto');
  const layout = $derived(section.layout);
  let watching = $state<PreviewMedia | null>(null);

  interface HeroMedia {
    still: string | null;
    clip: PreviewMedia | null;
  }

  function pick(preview: SellPreview | null): HeroMedia {
    if (mode === 'none' || !preview) return { still: null, clip: null };
    return {
      still: preview.heroImageUrl ?? null,
      clip: mode === 'image' ? null : (preview.heroClip ?? null),
    };
  }

  function watch(clip: PreviewMedia) {
    if (!edit) watching = clip;
  }
</script>

{#snippet copy(align: 'start' | 'center')}
  {#if content.eyebrow}
    <div class="hero__eyebrow hero__enter-c">
      <Eyebrow text={content.eyebrow} type="hero" {edit} />
    </div>
  {/if}
  <div class="hero__headline hero__enter-h">
    <Heading
      level={section.headingLevel}
      size="display"
      text={heading}
      type="hero"
      field="heading"
      {edit}
    />
  </div>
  {#if content.body}
    <div class="hero__lede hero__enter-c">
      <Text text={content.body} size="lead" type="hero" field="body" {edit} />
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

{#snippet watchControl(media: HeroMedia)}
  {#if media.clip}
    <WatchButton
      label={content.watchLabel ?? COPY.hero.watch}
      onclick={() => media.clip && watch(media.clip)}
    />
  {/if}
{/snippet}

{#snippet frame(media: HeroMedia, pending: boolean, ratio: string)}
  {#if media.clip}
    <Media image={media.still} clip={media.clip} {ratio} {pending} priority alt="">
      {@render watchControl(media)}
    </Media>
  {:else}
    <Media image={media.still} {ratio} {pending} priority alt="" />
  {/if}
{/snippet}

{#if layout === 'cover'}
  <div class="hero-cover lp-bleed" data-lp-on-media>
    <div class="hero-cover__media hero__enter-m">
      {#await context.sellPreview}
        <span class="lp-atmos" aria-hidden="true"></span>
      {:then preview}
        {@const media = pick(preview)}
        {#if media.still || media.clip}
          <Media image={media.still} clip={media.clip} priority alt="" />
        {:else}
          <span class="lp-atmos" data-drift aria-hidden="true"></span>
        {/if}
      {/await}
    </div>
    <div class="hero-cover__copy">
      {@render copy('start')}
      {#await context.sellPreview then preview}
        <div class="hero__enter-c">{@render watchControl(pick(preview))}</div>
      {/await}
    </div>
  </div>
{:else if layout === 'split'}
  <div class="hero-split">
    <div class="hero-split__copy">{@render copy('start')}</div>
    {#if mode !== 'none'}
      <div class="hero-split__media hero__enter-m">
        {#await context.sellPreview}
          {@render frame({ still: null, clip: null }, true, 'var(--_ratio)')}
        {:then preview}
          {@render frame(pick(preview), false, 'var(--_ratio)')}
        {/await}
      </div>
    {/if}
  </div>
{:else if layout === 'centered'}
  <div class="hero-centered">{@render copy('center')}</div>
  {#if mode !== 'none'}
    <div class="hero-centered__media hero__enter-m">
      {#await context.sellPreview}
        {@render frame({ still: null, clip: null }, true, 'var(--_ratio)')}
      {:then preview}
        {@render frame(pick(preview), false, 'var(--_ratio)')}
      {/await}
    </div>
  {/if}
{:else}
  <div class="hero-statement">{@render copy('start')}</div>
  {#await context.sellPreview then preview}
    {@const media = pick(preview)}
    {#if media.still || media.clip}
      <div class="hero-statement__media hero__enter-m">
        {@render frame(media, false, 'var(--_ratio)')}
      </div>
    {/if}
  {/await}
{/if}

{#if watching}
  <IntroVideoModal
    open={true}
    src={watching.playlistUrl}
    title={heading}
    onclose={() => (watching = null)}
  />
{/if}

<style>
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

  /* ── cover ─────────────────────────────────────────────────────────────── */
  .hero-cover {
    position: relative;
    display: grid;
    grid-template-columns: inherit;
    margin-block: calc(-1 * var(--lp-pad));
    background: var(--lp-bg);
    color: var(--lp-ink);
    isolation: isolate;
  }

  /* With no image the glow IS the hero: stronger, and lit opposite the words. */
  .hero-cover__media {
    position: absolute;
    inset: 0;
    z-index: -1;
    display: grid;
    --lp-atmos-strength: 0.7;
    --lp-atmos-a: 78% 30%;
    --lp-atmos-b: 34% 92%;
  }

  .hero-cover__media :global(.lp-media) {
    border-radius: 0;
  }

  .hero-cover__copy {
    position: relative;
    grid-column: content;
    display: grid;
    align-content: end;
    gap: var(--lp-stack);
    max-inline-size: 60rem;
    min-block-size: clamp(32rem, 56cqi, 48rem);
    padding-block: calc(var(--lp-pad) * 1.5) var(--lp-pad);
  }

  /* A scrim shaped to the WORDS: every line sits on at least 72% of the scrim
     colour however the headline wraps, and it fades out to the right and at
     the top so the rest of the image stays bright. It starts at the band's
     left edge (100cqi is the section), so it never shows a seam. */
  .hero-cover__copy::before {
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
    max-inline-size: 18ch;
  }

  .hero-centered :global(.lp-text) {
    max-inline-size: var(--lp-measure-lead);
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

  /* ── the one entrance (keyframes named by the Style) ───────────────────── */
  @media (prefers-reduced-motion: no-preference) {
    :global(:root[data-theme] .lp:not([data-lp-still])) .hero__enter-h {
      animation: var(--lp-enter-headline);
    }

    :global(:root[data-theme] .lp:not([data-lp-still])) .hero__enter-c {
      animation: var(--lp-enter-copy);
    }

    :global(:root[data-theme] .lp:not([data-lp-still])) .hero__enter-m {
      animation: var(--lp-enter-media);
    }
  }
</style>
