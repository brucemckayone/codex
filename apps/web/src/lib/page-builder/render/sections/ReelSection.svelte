<!--
  @component ReelSection

  A cinematic practice-preview clip that sits just before the descent map (SPEC
  §4.1 `reel`). Deliberately not the intro film: an ultrawide 2.4:1 frame with an
  editorial split header. Like the intro, the header renders immediately and the
  play affordance is STREAMED from the public preview (no auth). Reuses
  `ui/IntroVideoModal` for HLS playback.
-->
<script lang="ts">
  import { IntroVideoModal } from '$lib/components/ui/IntroVideoModal';
  import { PlayIcon } from '$lib/components/ui/Icon';
  import SectionSkeleton from '../SectionSkeleton.svelte';
  import { asString } from '../coerce';
  import type { ReelSectionProps, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
  }

  const { config, context }: Props = $props();

  const p: ReelSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
    sub: asString(config, 'sub'),
    posterUrl: asString(config, 'posterUrl'),
  });

  const heading = $derived(p.heading ?? 'This is what a descent looks like.');

  let open = $state(false);
</script>

<div class="reel">
  <div class="reel__inner">
    <div class="reel__head">
      <div class="reel__title-wrap">
        {#if p.eyebrow}
          <p class="reel__eyebrow">{p.eyebrow}</p>
        {/if}
        <h2 class="reel__title">{heading}</h2>
      </div>
      {#if p.sub}
        <p class="reel__sub">{p.sub}</p>
      {/if}
    </div>

    <div class="reel__stage" style={p.posterUrl ? `--poster: url(${JSON.stringify(p.posterUrl)})` : undefined}>
      {#await context.sellPreview}
        <SectionSkeleton shape="media" label="Loading the practice preview" />
      {:then preview}
        {#if preview?.reel}
          {@const reel = preview.reel}
          <button
            type="button"
            class="reel__play"
            onclick={() => (open = true)}
            aria-label="Play the practice preview"
          >
            <span class="reel__play-icon" aria-hidden="true">
              <PlayIcon />
            </span>
          </button>
          <IntroVideoModal
            {open}
            src={reel.playlistUrl}
            title={heading}
            onclose={() => (open = false)}
          />
        {:else}
          <div class="reel__empty" aria-hidden="true"></div>
        {/if}
      {/await}
    </div>
  </div>
</div>

<style>
  .reel {
    padding-block: var(--space-16);
    padding-inline: var(--space-5);
  }

  .reel__inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    max-width: 72rem;
    margin-inline: auto;
  }

  .reel__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  @media (--breakpoint-md) {
    .reel__head {
      flex-direction: row;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--space-10);
    }
  }

  .reel__eyebrow {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .reel__title {
    margin: 0;
    max-width: 24ch;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-3xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .reel__sub {
    margin: 0;
    max-width: 30ch;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  @media (--breakpoint-md) {
    .reel__sub {
      text-align: right;
    }
  }

  .reel__stage {
    position: relative;
    isolation: isolate;
    width: 100%;
    aspect-ratio: 2.4 / 1;
    border-radius: var(--radius-card);
    overflow: hidden;
    border: var(--border-width) solid var(--color-border-subtle);
    background:
      var(--poster, none) center / cover no-repeat,
      var(--color-surface-secondary);
    display: grid;
    place-items: center;
  }

  .reel__play {
    display: inline-grid;
    place-items: center;
    width: var(--space-14);
    height: var(--space-14);
    border-radius: var(--radius-full);
    border: none;
    cursor: pointer;
    color: var(--color-text-on-brand);
    background: var(--color-brand-primary);
    transition:
      transform var(--duration-fast) var(--ease-default),
      background-color var(--duration-fast) var(--ease-default);
  }

  .reel__play:hover {
    background: var(--color-brand-primary-hover);
    transform: scale(1.06);
  }

  .reel__play:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .reel__play-icon {
    display: inline-flex;
    width: var(--space-5);
    height: var(--space-5);
    margin-left: 3px;
  }

  .reel__empty {
    width: 100%;
    height: 100%;
  }

  @media (prefers-reduced-motion: reduce) {
    .reel__play {
      transition: none;
    }
    .reel__play:hover {
      transform: none;
    }
  }
</style>
